"""Graph aggregator: composes the final company profile from graph state.

When a case finishes (pending == 0), this reads the entities/facts/relations
accumulated by the worker types and produces the durable `EnrichmentResult`
dict plus a summary, mirroring the legacy company_enrichments.result shape so
downstream consumers keep the same contract. All values remain evidence-cited
(value + confidence + source) as produced by the graph.
"""
from __future__ import annotations

from typing import Any

from company_enrichment.db.graph_models import EdgeKind


class GraphAggregator:
    """Pure aggregator: takes graph rows, returns result + summary dicts."""

    #: fact_key prefixes -> section of the company profile
    _SECTION_BY_PREFIX = (
        ("indicator:", "financial_indicators"),
        ("tech:", "technologies"),
        ("social:", "social"),
        ("email", "contact_points"),
        ("phone", "contact_points"),
        ("website", "domain"),
    )

    def __init__(
        self,
        *,
        facts: list[Any],
        entity_labels: dict[str, str],
        relations: list[Any],
    ) -> None:
        self._facts = facts
        self._entity_labels = entity_labels  # entity_id -> label
        self._relations = relations

    def compose(self) -> tuple[dict[str, Any], dict[str, Any]]:
        """Return (result_dict, summary_dict)."""
        profile: dict[str, Any] = {
            "firmographics": {},
            "domain": None,
            "social": {},
            "contact_points": [],
            "financial_indicators": {},
            "technologies": [],
            "people": [],
            "relationships": [],
            "evidence": [],
        }
        for fact in self._facts:
            self._apply_fact(profile, fact)

        self._compose_relations(profile)
        summary = self._summary(profile)
        return profile, summary

    def _apply_fact(self, profile: dict, fact) -> None:
        value = fact.value or {}
        key = fact.fact_key
        if key == "cnpj":
            profile["firmographics"]["cnpj"] = value.get("value")
        elif key == "legal_name":
            profile["firmographics"]["legal_name"] = value.get("value")
        elif key == "trade_name":
            profile["firmographics"]["trade_name"] = value.get("value")
        elif key == "opening_date":
            profile["firmographics"]["opening_date"] = value.get("value")
        elif key == "porte":
            profile["firmographics"]["porte"] = value.get("value")
        elif key == "capital_social":
            profile["firmographics"]["capital_social"] = value.get("value")
        elif key == "main_cnae":
            profile["firmographics"]["main_cnae"] = value.get("value")
        elif key == "legal_nature":
            profile["firmographics"]["legal_nature"] = value.get("value")
        elif key == "website":
            profile["domain"] = value
        elif key == "email":
            profile["contact_points"].append(
                {"type": "email", "value": value.get("value"), "confidence": fact.confidence}
            )
        elif key == "phone":
            profile["contact_points"].append(
                {"type": "phone", "value": value.get("value"), "confidence": fact.confidence}
            )
        elif key.startswith("indicator:"):
            name = key.split(":", 1)[1]
            profile["financial_indicators"][name] = value
        elif key.startswith("tech:"):
            profile["technologies"].append(
                {"name": value.get("value"), "category": value.get("category"),
                 "confidence": fact.confidence}
            )
        elif key.startswith("social:"):
            platform = key.split(":", 1)[1]
            profile["social"][platform] = {
                "url": value.get("value"),
                "confidence": fact.confidence,
            }
        else:
            profile["raw_facts"] = profile.get("raw_facts", [])
            profile["raw_facts"].append(
                {"key": key, "value": value, "confidence": fact.confidence}
            )

    def _compose_relations(self, profile: dict) -> None:
        people = profile.setdefault("people", [])
        seen_people: set[tuple[str, str]] = set()
        co_owners: set[str] = set()
        for rel in self._relations:
            edge = rel.relation_type
            if edge in (EdgeKind.OWNER_OF.value, EdgeKind.DIRECTOR_OF.value):
                # Company is the target; the person is the source entity.
                person_id = str(rel.source_entity_id)
                label = self._entity_labels.get(person_id, person_id)
                record = {
                    "id": person_id,
                    "label": label,
                    "role": "owner" if edge == EdgeKind.OWNER_OF.value else "director",
                    "confidence": rel.confidence,
                }
                key = (person_id, edge)
                if key not in seen_people:
                    people.append(record)
                    seen_people.add(key)
                co_owners.add(label)
            elif edge == EdgeKind.HAS_EMAIL.value:
                profile["contact_points"].append(
                    {"type": "email_link", "from": str(rel.source_entity_id),
                     "to": str(rel.target_entity_id), "confidence": rel.confidence}
                )
        profile["relationships"] = {
            "co_owners": sorted(co_owners),
            "edge_count": len(self._relations),
            "edges": [
                {
                    "source": str(r.source_entity_id),
                    "target": str(r.target_entity_id),
                    "type": r.relation_type,
                    "confidence": r.confidence,
                }
                for r in self._relations
            ],
        }

    @staticmethod
    def _summary(profile: dict) -> dict:
        return {
            "domain": (profile.get("domain") or {}).get("value"),
            "corporate_email": bool(profile.get("contact_points")),
            "people": len(profile.get("people") or []),
            "technologies": len(profile.get("technologies") or []),
            "social_platforms": len(profile.get("social") or {}),
            "financial_indicators": len(profile.get("financial_indicators") or {}),
            "relationship_edges": (profile.get("relationships") or {}).get("edge_count", 0),
        }
