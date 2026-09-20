"""OSINT-driven worker capabilities (bbot, spiderfoot, social, people).

These capabilities wrap the bounded OSINT providers / public web discovery and
map raw events onto the entity graph (entities + facts + relations + follow-up
discoveries). All discovery is public-data only; confidence and provenance are
always attached.
"""
from __future__ import annotations

import asyncio
import os
import re
import time
from typing import Any

from company_enrichment.db.graph_models import EdgeKind
from company_enrichment.metrics.metrics import (
    ENRICHMENT_OSINT_SCAN_DURATION_SECONDS,
    ENRICHMENT_OSINT_SCANS_BY_OUTCOME,
)
from company_enrichment.observability.otel import get_logger
from company_enrichment.providers.base import ProviderError
from company_enrichment.providers.bbot import BbotEvent
from company_enrichment.providers.spiderfoot import SpiderFootEvent
from company_enrichment.services.entity_resolution import (
    entity_key_for,
    normalize_domain,
    normalize_email,
    normalize_phone,
    social_key,
)
from company_enrichment.workers.capability import (
    CapabilityContext,
    DirectiveOutcome,
    EntityWrite,
    FactWrite,
    WorkerCapability,
)
from company_enrichment.workers.registry import WorkerType

log = get_logger("capabilities.osint")

_LINKEDIN_RE = re.compile(
    r"(https?://(?:www\.)?linkedin\.com/(?:company|in)/[A-Za-z0-9._%-]+)", re.IGNORECASE
)
_INSTAGRAM_RE = re.compile(
    r"(https?://(?:www\.)?instagram\.com/[A-Za-z0-9._-]+)", re.IGNORECASE
)
_FACEBOOK_RE = re.compile(
    r"(https?://(?:www\.|m\.|business\.)?facebook\.com/[A-Za-z0-9._-]+)", re.IGNORECASE
)


_OSINT_EVIDENCE_MAP = {
    "BBOT": "SEARCH",
    "SPIDERFOOT": "SEARCH",
    "SOCIAL": "SOCIAL",
}


def _ev(source_type: str, url: str | None = None, provider: str | None = None) -> dict:
    from company_enrichment.models.evidence.types import EvidenceSource, EvidenceType

    enum_val = _OSINT_EVIDENCE_MAP.get(source_type, source_type)
    src = EvidenceSource(type=EvidenceType(enum_val), url=url, provider=provider)
    return {
        "type": src.type.value,
        "url": src.url,
        "provider": src.provider,
        "observed_at": src.observed_at.isoformat(),
    }


def should_fallback_spiderfoot(events_count: int, min_events: int | None = None) -> bool:
    """FR-011: spiderfoot roda só como fallback — bbot vazio/insuficiente."""
    if min_events is None:
        min_events = int(os.environ.get("OSINT_SPIDERFOOT_MIN_EVENTS", "5"))
    return int(events_count) < int(min_events)


def _osint_deadline_s(tool: str, default: int) -> float:
    env_key = f"OSINT_{tool.upper()}_DEADLINE_S"
    try:
        return float(os.environ.get(env_key, default))
    except (TypeError, ValueError):
        return float(default)


class BbotCapability(WorkerCapability):
    """BBOT reconnaissance over a domain/email/company, mapped into the graph."""

    worker_type = WorkerType.BBOT

    async def run(
        self,
        *,
        directive_id: Any,
        case_id: Any,
        request_event_id: Any,
        tenant_id: Any,
        company_id: Any,
        entity: Any,
        target: str,
        hints: dict[str, Any],
        depth: int,
        budget_max_facts: int,
        ctx: CapabilityContext,
    ) -> DirectiveOutcome:
        outcome = DirectiveOutcome()
        if ctx.bbot is None or not ctx.bbot.enabled:
            outcome.status = "DISCARDED"
            outcome.error_code = "BBOT_DISABLED"
            outcome.summary = {"enabled": False}
            return outcome

        # Feature 006 (FR-010): deadline com sucesso parcial — timeout NÃO é
        # falha; os eventos coletados até o prazo são aproveitados.
        deadline_s = _osint_deadline_s("bbot", 240)
        started = time.monotonic()
        partial = False
        try:
            events = await asyncio.wait_for(ctx.bbot.scan(target, hints), timeout=deadline_s)
        except TimeoutError:
            events = []
            partial = True
        except ProviderError as exc:
            if exc.code == "BBOT_TIMEOUT":
                events = []
                partial = True
            else:
                raise
        owner_type = entity.entity_type
        owner_key = entity.entity_key

        email_seen: dict[str, float] = {}
        domain_seen: dict[str, float] = {}
        tech_seen: set[str] = set()

        for ev in events[:budget_max_facts]:
            self._map_event(
                ev,
                owner_type=owner_type,
                owner_key=owner_key,
                company_hint=hints.get("cnpj"),
                email_seen=email_seen,
                domain_seen=domain_seen,
                tech_seen=tech_seen,
                outcome=outcome,
            )

        outcome.summary = {
            "events": len(events),
            "emails": len(email_seen),
            "domains": len(domain_seen),
            "technologies": len(tech_seen),
            "partial": partial,  # feature 006 (FR-010): concluiu no deadline?
        }
        outcome_label = "partial" if partial else ("empty" if len(events) == 0 else "full")
        ENRICHMENT_OSINT_SCANS_BY_OUTCOME.labels(tool="bbot", outcome=outcome_label).inc()
        ENRICHMENT_OSINT_SCAN_DURATION_SECONDS.labels(tool="bbot").observe(time.monotonic() - started)
        return outcome

    def _map_event(self, ev: BbotEvent, **kw) -> None:
        kind = ev.event_type
        if kind == "EMAIL_ADDRESS":
            self._email(ev, kw["email_seen"], kw["owner_type"], kw["owner_key"], kw["outcome"], kw["company_hint"])
        elif kind in ("DNS_NAME", "HOST"):
            self._domain(ev, kw["domain_seen"], kw["outcome"])
        elif kind in ("TECHNOLOGY", "WEB_TECHNOLOGY"):
            self._tech(ev, kw["tech_seen"], kw["owner_type"], kw["owner_key"], kw["outcome"])
        elif kind == "URL":
            self._url(ev, kw["owner_type"], kw["owner_key"], kw["outcome"])
        elif kind == "PHONE_NUMBER":
            self._phone(ev, kw["owner_type"], kw["owner_key"], kw["outcome"])

    def _email(self, ev, seen, owner_type, owner_key, outcome, company_hint) -> None:
        email = normalize_email(ev.data)
        if not email:
            return
        conf = 0.95 if company_hint and email.split("@")[1] in (company_hint,) else 0.6
        seen.setdefault(email, conf)
        outcome.relations.append((owner_key, email, EdgeKind.HAS_EMAIL, conf))
        outcome.entities.append(
            EntityWrite("EMAIL", email, label=email, relation_type=EdgeKind.HAS_EMAIL, confidence=conf)
        )

    def _domain(self, ev, seen, outcome) -> None:
        domain = normalize_domain(ev.data)
        if not domain:
            return
        seen.setdefault(domain, 0.7)
        outcome.entities.append(
            EntityWrite("DOMAIN", domain, label=domain, confidence=0.7,
                        meta={"module": ev.module, "source_url": ev.host})
        )

    def _tech(self, ev, seen, owner_type, owner_key, outcome) -> None:
        name = ev.data.strip()
        if not name or name.lower() in seen:
            return
        seen.add(name.lower())
        outcome.facts.append(
            FactWrite(owner_type, owner_key, f"tech:{name.lower()}",
                      {"value": name, "category": "osint"},
                      0.7, _ev("BBOT", provider="bbot"))
        )
        outcome.entities.append(
            EntityWrite("TECHNOLOGY", name.lower(), label=name,
                        relation_type=EdgeKind.USES_TECH, confidence=0.7, emit_discovery=False)
        )

    def _url(self, ev, owner_type, owner_key, outcome) -> None:
        url = entity_key_for("URL", ev.data)
        if not url or not ev.data.startswith("http"):
            return
        outcome.entities.append(
            EntityWrite("URL", url, label=ev.data, confidence=0.5, emit_discovery=False)
        )

    def _phone(self, ev, owner_type, owner_key, outcome) -> None:
        phone = normalize_phone(ev.data)
        if not phone:
            return
        outcome.entities.append(
            EntityWrite("PHONE", phone, label=phone, confidence=0.6, emit_discovery=False)
        )


class SpiderFootCapability(WorkerCapability):
    """Complementary passive recon (cert hostnames, co-hosted, WHOIS)."""

    worker_type = WorkerType.SPIDERFOOT

    async def run(
        self,
        *,
        directive_id: Any,
        case_id: Any,
        request_event_id: Any,
        tenant_id: Any,
        company_id: Any,
        entity: Any,
        target: str,
        hints: dict[str, Any],
        depth: int,
        budget_max_facts: int,
        ctx: CapabilityContext,
    ) -> DirectiveOutcome:
        outcome = DirectiveOutcome()
        if ctx.spiderfoot is None or not ctx.spiderfoot.enabled:
            outcome.status = "DISCARDED"
            outcome.error_code = "SPIDERFOOT_DISABLED"
            outcome.summary = {"enabled": False}
            return outcome

        # Feature 006 (FR-010): deadline com sucesso parcial (mesmo trato do bbot).
        deadline_s = _osint_deadline_s("spiderfoot", 480)
        started = time.monotonic()
        partial = False
        try:
            events = await asyncio.wait_for(ctx.spiderfoot.scan(target, hints), timeout=deadline_s)
        except TimeoutError:
            events = []
            partial = True
        except ProviderError as exc:
            if exc.code == "SPIDERFOOT_TIMEOUT":
                events = []
                partial = True
            else:
                raise

        for ev in events[:budget_max_facts]:
            self._map_event(ev, outcome, entity.entity_type, entity.entity_key)
        outcome.summary = {
            "events": len(events),
            "discovered": len(outcome.entities),
            "partial": partial,  # feature 006 (FR-010)
        }
        outcome_label = "partial" if partial else ("empty" if len(events) == 0 else "full")
        ENRICHMENT_OSINT_SCANS_BY_OUTCOME.labels(tool="spiderfoot", outcome=outcome_label).inc()
        ENRICHMENT_OSINT_SCAN_DURATION_SECONDS.labels(tool="spiderfoot").observe(time.monotonic() - started)
        return outcome

    @staticmethod
    def _map_event(
        ev: SpiderFootEvent,
        outcome: DirectiveOutcome,
        owner_type: str,
        owner_key: str,
    ) -> None:
        domain = normalize_domain(ev.data)
        if ev.event_type in ("CO_HOSTED_SITE", "CO_HOSTED_SITE_DOMAIN") and domain:
            outcome.entities.append(
                EntityWrite(
                    "DOMAIN", domain, label=domain,
                    relation_type=EdgeKind.CO_HOSTED_WITH, confidence=0.6,
                    meta={"module": ev.module, "source_type": "SPIDERFOOT"},
                )
            )
            outcome.facts.append(
                FactWrite(
                    "DOMAIN", domain, "co_hosted",
                    {"value": ev.data, "event_type": ev.event_type,
                     "source_domain": ev.source},
                    0.5, _ev("SPIDERFOOT", provider="spiderfoot"),
                )
            )
        elif ev.event_type in ("INTERNET_NAME", "INTERNET_NAME_UNRESOLVED") and domain:
            # Cert/other passive hostnames are subdomains of the scanned target.
            outcome.entities.append(
                EntityWrite(
                    "DOMAIN", domain, label=domain,
                    relation_type=EdgeKind.HAS_DOMAIN, confidence=0.5,
                    meta={"module": ev.module, "source_type": "SPIDERFOOT"},
                )
            )
        elif ev.event_type in ("DOMAIN_NAME", "DOMAIN_NAME_PARENT") and domain:
            outcome.entities.append(
                EntityWrite(
                    "DOMAIN", domain, label=domain,
                    relation_type=EdgeKind.HAS_DOMAIN, confidence=0.7,
                    meta={"module": ev.module, "source_type": "SPIDERFOOT"},
                )
            )
        elif ev.event_type in ("DOMAIN_WHOIS", "NETBLOCK_WHOIS"):
            outcome.facts.append(
                FactWrite(
                    owner_type, owner_key, "whois",
                    {"value": ev.data, "event_type": ev.event_type},
                    0.7, _ev("SPIDERFOOT", provider="spiderfoot"),
                )
            )


class SocialCapability(WorkerCapability):
    """Social network discovery from page text / search (public profiles only)."""

    worker_type = WorkerType.SOCIAL

    SOCIAL_PATTERNS = {
        "linkedin": (_LINKEDIN_RE, EdgeKind.FOLLOWS),
        "instagram": (_INSTAGRAM_RE, EdgeKind.FOLLOWS),
        "facebook": (_FACEBOOK_RE, EdgeKind.FOLLOWS),
    }

    async def run(
        self,
        *,
        directive_id: Any,
        case_id: Any,
        request_event_id: Any,
        tenant_id: Any,
        company_id: Any,
        entity: Any,
        target: str,
        hints: dict[str, Any],
        depth: int,
        budget_max_facts: int,
        ctx: CapabilityContext,
    ) -> DirectiveOutcome:
        outcome = DirectiveOutcome()
        text = hints.get("page_text") or ""
        html = hints.get("page_html") or ""
        owner_type = entity.entity_type
        owner_key = entity.entity_key
        found: set[str] = set()
        for platform, (pattern, edge) in self.SOCIAL_PATTERNS.items():
            for match in pattern.findall(f"{text} {html}"):
                key = social_key(platform, match)
                if not key or key in found:
                    continue
                found.add(key)
                outcome.entities.append(
                    EntityWrite("SOCIAL_PROFILE", key, label=match,
                                relation_type=edge, confidence=0.75)
                )
                outcome.facts.append(
                    FactWrite(owner_type, owner_key, f"social:{platform}",
                              {"value": match, "platform": platform}, 0.75,
                              _ev("SOCIAL", url=match))
                )
        outcome.summary = {"profiles": len(found)}
        return outcome


class PeopleCapability(WorkerCapability):
    """People enrichment: owners/directors from QSA hints + links from pages."""

    worker_type = WorkerType.PEOPLE

    async def run(
        self,
        *,
        directive_id: Any,
        case_id: Any,
        request_event_id: Any,
        tenant_id: Any,
        company_id: Any,
        entity: Any,
        target: str,
        hints: dict[str, Any],
        depth: int,
        budget_max_facts: int,
        ctx: CapabilityContext,
    ) -> DirectiveOutcome:
        outcome = DirectiveOutcome()
        # Owners/directors from QSA.
        for member in hints.get("qsa") or []:
            name = entity_key_for("PERSON", member.get("name"))
            if not name:
                continue
            role = str(member.get("role") or "").lower()
            edge = (
                EdgeKind.DIRECTOR_OF if "diretor" in role or "administrador" in role
                else EdgeKind.OWNER_OF
            )
            outcome.entities.append(
                EntityWrite("PERSON", name, label=str(member.get("name")).strip(),
                            relation_type=edge, confidence=0.8,
                            meta={"role": member.get("role"), "share": member.get("share")})
            )
        # People linked from pages (email-prefix -> person).
        text = hints.get("page_text") or ""
        for email in set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text)):
            normalized = normalize_email(email)
            if not normalized:
                continue
            person = normalized.split("@")[0].replace(".", " ").strip()
            if len(person) >= 3:
                outcome.entities.append(
                    EntityWrite("PERSON", person, label=person,
                                relation_type=EdgeKind.EMPLOYEE_OF, confidence=0.5)
                )
                outcome.entities.append(
                    EntityWrite("EMAIL", normalized, label=normalized,
                                relation_type=EdgeKind.HAS_EMAIL, confidence=0.7)
                )
        outcome.summary = {"people": sum(1 for e in outcome.entities if e.entity_type == "PERSON")}
        return outcome


class RelationshipsCapability(WorkerCapability):
    """Relationship/dedup inference between entities (deterministic).

    Co-ownership: any two people sharing the same owner-company edge already
    carry the company as the shared target; here we materialize SAME_OWNER
    edges when a directive hints at it (used after registry fan-out).
    """

    worker_type = WorkerType.RELATIONSHIPS

    async def run(
        self,
        *,
        directive_id: Any,
        case_id: Any,
        request_event_id: Any,
        tenant_id: Any,
        company_id: Any,
        entity: Any,
        target: str,
        hints: dict[str, Any],
        depth: int,
        budget_max_facts: int,
        ctx: CapabilityContext,
    ) -> DirectiveOutcome:
        outcome = DirectiveOutcome()
        siblings = hints.get("co_owners") or []
        for other in siblings[:budget_max_facts]:
            other_key = entity_key_for("PERSON", other)
            if not other_key or other_key == entity.entity_key:
                continue
            outcome.relations.append(
                (entity.entity_key, other_key, EdgeKind.SAME_OWNER, 0.6)
            )
        outcome.summary = {"same_owner_edges": len(outcome.relations), "note": "deterministic"}
        return outcome
