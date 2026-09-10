"""Deterministic worker capabilities (registry, tech, contacts, financial).

These reuse existing providers/services and perform no LLM calls. They persist
facts/entities through the graph runner. Deterministic code only (guardrail:
DNS, HTTP status, regex, scoring are never routed to the LLM).
"""
from __future__ import annotations

import re
import uuid
from typing import Any

from company_enrichment.db.graph_models import EdgeKind
from company_enrichment.models.evidence.types import EvidenceSource
from company_enrichment.models.outputs.results import Firmographics
from company_enrichment.observability.otel import get_logger
from company_enrichment.providers.firmographics import normalize_cnpj
from company_enrichment.services.entity_resolution import (
    entity_key_for,
    normalize_domain,
    normalize_email,
    normalize_phone,
)
from company_enrichment.workers.capability import (
    CapabilityContext,
    DirectiveOutcome,
    EntityWrite,
    FactWrite,
    WorkerCapability,
)
from company_enrichment.workers.registry import WorkerType

log = get_logger("capabilities.deterministic")

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_BR_RE = re.compile(
    r"(?:(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?\d{4,5}[\s.-]?\d{4})"
)


def _ev(evidence_type: str, provider: str | None = None, url: str | None = None) -> dict:
    from company_enrichment.models.evidence.types import (
        EvidenceType,
    )

    src = EvidenceSource(type=EvidenceType(evidence_type), provider=provider, url=url)
    return {
        "type": src.type.value,
        "provider": src.provider,
        "url": src.url,
        "observed_at": src.observed_at.isoformat(),
    }


def _build_firmographics_from_hints(hints: dict[str, Any]) -> Firmographics:
    return Firmographics(
        legal_name=hints.get("legal_name"),
        trade_name=hints.get("trade_name"),
        cnpj=hints.get("cnpj"),
        city=hints.get("city"),
        state=hints.get("state"),
    )


class RegistryCapability(WorkerCapability):
    """Company registry enrichment (firmographics + QSA -> people/owners).

    Deterministic lookup from the existing cnpj warehouse. QSA rows (from a
    future registry source) surface people entities linked with OWNER_OF /
    DIRECTOR_OF edges. Facts written: legal_name, trade_name, cnpj, cnae,
    porte, capital_social, opening_date, legal_nature, contact emails.
    """

    worker_type = WorkerType.REGISTRY

    async def run(
        self,
        *,
        directive_id: uuid.UUID,
        case_id: uuid.UUID,
        request_event_id: uuid.UUID,
        tenant_id: uuid.UUID | None,
        company_id: uuid.UUID,
        entity: Any,
        target: str,
        hints: dict[str, Any],
        depth: int,
        budget_max_facts: int,
        ctx: CapabilityContext,
    ) -> DirectiveOutcome:
        outcome = DirectiveOutcome()
        cnpj = normalize_cnpj(target) or normalize_cnpj(hints.get("cnpj"))
        if not cnpj:
            outcome.status = "DISCARDED"
            outcome.error_code = "INVALID_CNPJ"
            return outcome

        company_key = cnpj
        source = _ev("INTERNAL", provider="cnpj-warehouse")
        outcome.facts.append(
            FactWrite("COMPANY", company_key, "cnpj", {"value": cnpj}, 1.0, source)
        )

        # Firmographics from the existing warehouse (no LLM).
        if ctx.firmographics is not None and ctx.firmographics.enabled:
            enriched = await ctx.firmographics.lookup(cnpj)
            if enriched is not None:
                outcome.facts.extend(self._firmographics_facts(company_key, enriched, source))

        outcome.entities.append(
            EntityWrite("COMPANY", company_key, label=hints.get("legal_name"), emit_discovery=False)
        )

        # QSA (people/owners) via the warehouse (if table configured) or hints.
        qsa_rows: list[dict] = []
        if getattr(ctx, "qsa", None) is not None and ctx.qsa.enabled:
            qsa_rows = await ctx.qsa.lookup(cnpj)
        if not qsa_rows:
            qsa_rows = hints.get("qsa") or []
        outcome.facts.extend(self._qsa_facts(company_key, {"qsa": qsa_rows}, outcome, source))
        if outcome.entities:
            outcome.summary = {
                "people": sum(1 for e in outcome.entities if e.relation_type in (
                    EdgeKind.OWNER_OF, EdgeKind.DIRECTOR_OF
                ))
            }
        return outcome

    @staticmethod
    def _firmographics_facts(
        company_key: str, fg: Firmographics, source: dict
    ) -> list[FactWrite]:
        facts: list[FactWrite] = []
        mapping = {
            "legal_name": fg.legal_name,
            "trade_name": fg.trade_name,
            "opening_date": fg.opening_date,
            "legal_nature": fg.legal_nature,
            "porte": fg.porte,
            "capital_social": fg.capital_social,
            "main_cnae": fg.main_cnae,
            "city": fg.city,
            "state": fg.state,
            "address": fg.address,
        }
        for key, value in mapping.items():
            if value not in (None, ""):
                facts.append(FactWrite("COMPANY", company_key, key, {"value": value}, 0.99, source))
        if fg.email:
            email = normalize_email(fg.email)
            if email:
                facts.append(FactWrite("COMPANY", company_key, "email", {"value": email}, 0.95, source))
        if fg.phone:
            phone = normalize_phone(fg.phone)
            if phone:
                facts.append(FactWrite("COMPANY", company_key, "phone", {"value": phone}, 0.90, source))
        return facts

    @staticmethod
    def _qsa_facts(
        company_key: str, hints: dict[str, Any], outcome: DirectiveOutcome, source: dict
    ) -> list[FactWrite]:
        """Turn QSA hints (quadro societário) into people entities + facts.

        QSA shape (from a registry provider):
            hints["qsa"] = [
              {"name": "...", "role": "Sócio-Administrador"|"Diretor", "share": 50, "document": "..."}
            ]
        """
        qsa: list[dict] = hints.get("qsa") or []
        for member in qsa:
            name = entity_key_for("PERSON", member.get("name"))
            if not name:
                continue
            role = str(member.get("role") or "").lower()
            if "diretor" in role or ("administrador" in role and "socio" not in role):
                edge = EdgeKind.DIRECTOR_OF
            else:
                edge = EdgeKind.OWNER_OF
            label = str(member.get("name")).strip()
            outcome.entities.append(
                EntityWrite(
                    "PERSON",
                    name,
                    label=label,
                    relation_type=edge,
                    confidence=0.8,
                    meta={"role": member.get("role"), "share": member.get("share")},
                )
            )
        return []


class TechCapability(WorkerCapability):
    """Technology detection for a company/domain (reuses existing fingerprints)."""

    worker_type = WorkerType.TECH

    async def run(
        self,
        *,
        directive_id: uuid.UUID,
        case_id: uuid.UUID,
        request_event_id: uuid.UUID,
        tenant_id: uuid.UUID | None,
        company_id: uuid.UUID,
        entity: Any,
        target: str,
        hints: dict[str, Any],
        depth: int,
        budget_max_facts: int,
        ctx: CapabilityContext,
    ) -> DirectiveOutcome:
        outcome = DirectiveOutcome()
        domain = normalize_domain(hints.get("domain") or target)
        if not domain or ctx.tech_detection is None:
            outcome.status = "DISCARDED"
            return outcome
        # Deterministic fingerprint detection (no LLM).
        technologies = await ctx.tech_detection.detect_clean(domain, dns=ctx.dns)
        company_key = hints.get("company_key") or normalize_cnpj(hints.get("cnpj") or "")
        owner_key = company_key or domain
        owner_type = "COMPANY" if company_key else "DOMAIN"
        for tech in technologies[:budget_max_facts]:
            t_key = tech.name or tech.category
            outcome.facts.append(
                FactWrite(
                    owner_type,
                    owner_key,
                    f"tech:{t_key}",
                    {"value": tech.name, "category": tech.category},
                    tech.confidence,
                    _ev("DNS", provider="tech-detection"),
                )
            )
            outcome.entities.append(
                EntityWrite(
                    "TECHNOLOGY",
                    str(t_key).lower(),
                    label=tech.name,
                    relation_type=EdgeKind.USES_TECH,
                    confidence=tech.confidence,
                    emit_discovery=False,
                )
            )
        return outcome


class ContactsCapability(WorkerCapability):
    """Corporate/public email + phone discovery from public page text and HTML.

    Deterministic extraction (regex/`mailto:`) gated by the existing crawler
    bounds. Only publicly accessible pages; never authorized/private data.
    """

    worker_type = WorkerType.CONTACTS

    async def run(
        self,
        *,
        directive_id: uuid.UUID,
        case_id: uuid.UUID,
        request_event_id: uuid.UUID,
        tenant_id: uuid.UUID | None,
        company_id: uuid.UUID,
        entity: Any,
        target: str,
        hints: dict[str, Any],
        depth: int,
        budget_max_facts: int,
        ctx: CapabilityContext,
    ) -> DirectiveOutcome:
        outcome = DirectiveOutcome()
        domain = normalize_domain(hints.get("domain") or target)
        pages_text = hints.get("page_text") or ""
        pages_html = hints.get("page_html") or ""

        owner_type = "COMPANY" if normalize_cnpj(hints.get("cnpj") or "") else "DOMAIN"
        owner_key = normalize_cnpj(hints.get("cnpj") or "") or domain or target

        emails: dict[str, float] = {}
        for m in _EMAIL_RE.findall(f"{pages_text} {pages_html}"):
            email = normalize_email(m)
            if email:
                conf = 0.95 if email.split("@")[1] == domain else 0.7
                emails[email] = max(emails.get(email, 0), conf)

        for email, conf in list(emails.items())[:budget_max_facts]:
            domain_part = email.split("@")[1]
            outcome.facts.append(
                FactWrite(owner_type, owner_key, "email", {"value": email, "domain": domain_part}, conf,
                          _ev("CONTACT", provider="crawler"))
            )
            outcome.entities.append(
                EntityWrite("EMAIL", email, label=email, relation_type=EdgeKind.HAS_EMAIL,
                            confidence=conf)
            )

        phones: dict[str, float] = {}
        for m in _PHONE_BR_RE.findall(f"{pages_text} {pages_html}"):
            phone = normalize_phone(m)
            if phone:
                phones[phone] = max(phones.get(phone, 0), 0.8)
        for phone, conf in list(phones.items())[:budget_max_facts]:
            outcome.facts.append(
                FactWrite(owner_type, owner_key, "phone", {"value": phone}, conf,
                          _ev("CONTACT", provider="crawler"))
            )
            outcome.entities.append(
                EntityWrite("PHONE", phone, label=phone, relation_type=EdgeKind.HAS_EMAIL,
                            confidence=conf, emit_discovery=False)
            )

        if not emails and not phones:
            outcome.status = "COMPLETED"
            outcome.summary = {"emails": 0, "phones": 0, "source": "no-contact-pages"}
        else:
            outcome.summary = {"emails": len(emails), "phones": len(phones)}
        return outcome


class FinancialCapability(WorkerCapability):
    """Financial/revenue indicators from registry data only.

    Never fabricates or reports revenue as fact; emits *indicator* facts
    (porte, capital_social, CNAE, MEI/simple tax option, funding signals) with
    confidence < 1 and a clear `is_estimate` flag.
    """

    worker_type = WorkerType.FINANCIAL

    async def run(
        self,
        *,
        directive_id: uuid.UUID,
        case_id: uuid.UUID,
        request_event_id: uuid.UUID,
        tenant_id: uuid.UUID | None,
        company_id: uuid.UUID,
        entity: Any,
        target: str,
        hints: dict[str, Any],
        depth: int,
        budget_max_facts: int,
        ctx: CapabilityContext,
    ) -> DirectiveOutcome:
        outcome = DirectiveOutcome()
        cnpj = normalize_cnpj(target) or normalize_cnpj(hints.get("cnpj") or "")
        if not cnpj:
            outcome.status = "DISCARDED"
            return outcome
        fg = _build_firmographics_from_hints(hints)
        if ctx.firmographics is not None and ctx.firmographics.enabled:
            enriched = await ctx.firmographics.lookup(cnpj)
            if enriched is not None:
                fg = enriched
        company_key = cnpj
        source = _ev("INTERNAL", provider="cnpj-warehouse")
        # Registry-provided values (already present in hints) win; warehouse augments.
        indicators = {
            "porte": fg.porte or hints.get("porte"),
            "capital_social": fg.capital_social if fg.capital_social is not None else hints.get("capital_social"),
            "main_cnae": fg.main_cnae,
            "opening_date": fg.opening_date,
            "legal_nature": fg.legal_nature,
        }
        for key, value in indicators.items():
            if value in (None, ""):
                continue
            outcome.facts.append(
                FactWrite(
                    "COMPANY", company_key, f"indicator:{key}",
                    {"value": value, "is_estimate": False, "kind": key},
                    0.8, source,
                )
            )
        outcome.summary = {
            "indicators": sum(1 for f in outcome.facts if f.fact_key.startswith("indicator:")),
            "note": "revenue_estimates_not_factual",
        }
        return outcome


class DomainCapability(WorkerCapability):
    """Website/domain discovery + validation (reuses existing services)."""

    worker_type = WorkerType.DOMAIN

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

        fg = _build_firmographics_from_hints(hints)
        evidence: list = []
        if ctx.domain_discovery is None or ctx.domain_validation is None:
            outcome.status = "DISCARDED"
            outcome.error_code = "DOMAIN_SERVICES_UNAVAILABLE"
            return outcome

        candidates, evidence = await ctx.domain_discovery.discover(fg, evidence)
        best_domain = None
        canonical = ""
        for candidate in candidates[:budget_max_facts]:
            info, final_domain, evidence = await ctx.domain_validation.validate(
                candidate, evidence, fg
            )
            if info is not None:
                best_domain = info
                canonical = final_domain
                break
        if best_domain is None or not canonical:
            outcome.summary = {"domain": None, "validated": False}
            return outcome

        company_key = normalize_cnpj(hints.get("cnpj") or "") or entity.entity_key
        outcome.facts.append(
            FactWrite("COMPANY", company_key, "website",
                      {"value": canonical, "https": best_domain.https,
                       "title": best_domain.title, "redirects_to": best_domain.redirects_to},
                      0.95, _ev("HTTPS", url=f"https://{canonical}", provider="domain-validation"))
        )
        outcome.entities.append(
            EntityWrite("DOMAIN", normalize_domain(canonical) or canonical,
                        label=canonical, relation_type=EdgeKind.HAS_DOMAIN, confidence=0.9)
        )
        domain_key = normalize_domain(canonical) or canonical
        outcome.facts.append(
            FactWrite("DOMAIN", domain_key, "website",
                      {"value": canonical, "valid": True, "https": best_domain.https},
                      0.95, _ev("HTTPS", url=f"https://{canonical}", provider="domain-validation"))
        )

        # Crawl the validated domain and persist page content as facts so the
        # contacts/social/tech follow-ups have real data (the graph chain).
        if ctx.crawler is not None:
            try:
                pages, page_text = await ctx.crawler.crawl(canonical)
            except Exception:  # noqa: BLE001 - crawl failure must not fail the directive
                pages, page_text = [], ""
            if pages:
                scripts_text = "\n".join(s for p in pages for s in p.scripts)
                outcome.facts.append(
                    FactWrite("DOMAIN", domain_key, "page_text",
                              {"value": page_text, "title": pages[0].title},
                              0.9, _ev("HTTP", url=canonical, provider="crawler"))
                )
                if scripts_text:
                    outcome.facts.append(
                        FactWrite("DOMAIN", domain_key, "page_html",
                                  {"value": scripts_text}, 0.9,
                                  _ev("HTML", url=canonical, provider="crawler"))
                    )
        outcome.summary = {"domain": canonical, "validated": True}
        return outcome


class ValidatorCapability(WorkerCapability):
    """Deterministic candidate validation/normalization (no LLM).

    Screens candidate emails/phones/domains supplied in hints and only emits
    syntactically-valid, normalized values. Used as a gate before candidates
    become durable facts.
    """

    worker_type = WorkerType.VALIDATOR

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
        owner_type = entity.entity_type
        owner_key = entity.entity_key
        source = _ev("INTERNAL", provider="validator")

        for candidate in (hints.get("emails") or [])[:budget_max_facts]:
            email = normalize_email(candidate)
            if email:
                outcome.facts.append(
                    FactWrite(owner_type, owner_key, "email",
                              {"value": email, "validated": True}, 0.95, source)
                )
                outcome.entities.append(
                    EntityWrite("EMAIL", email, label=email,
                                relation_type=EdgeKind.HAS_EMAIL, confidence=0.95,
                                emit_discovery=False)
                )
        for candidate in (hints.get("phones") or [])[:budget_max_facts]:
            phone = normalize_phone(candidate)
            if phone:
                outcome.facts.append(
                    FactWrite(owner_type, owner_key, "phone",
                              {"value": phone, "validated": True}, 0.9, source)
                )
        for candidate in (hints.get("domains") or [])[:budget_max_facts]:
            domain = normalize_domain(candidate)
            if domain:
                outcome.facts.append(
                    FactWrite(owner_type, owner_key, "website",
                              {"value": domain, "validated": True}, 0.85, source)
                )

        outcome.summary = {
            "valid_emails": sum(1 for f in outcome.facts if f.fact_key == "email"),
            "valid_phones": sum(1 for f in outcome.facts if f.fact_key == "phone"),
            "valid_domains": sum(1 for f in outcome.facts if f.fact_key == "website"),
            "note": "deterministic_normalization",
        }
        return outcome
