"""company graph read view

Revision ID: 0003_company_graph_view
Revises: 0002_entity_graph
Create Date: 2026-08-16

Adds a read-only view `company_enrichment.v_company_graph` that denormalizes the
latest enrichment profile per company plus the labeled entity graph (nodes/edges)
and evidence-cited facts, so downstream APIs/UI can read enrichment data with a
single query. Backward-compatible; no table changes.
"""
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003_company_graph_view"
down_revision = "0002_entity_graph"
branch_labels = None
depends_on = None

SCHEMA = "company_enrichment"


def upgrade() -> None:
    op.execute(f"""
    CREATE OR REPLACE VIEW {SCHEMA}.v_company_graph AS
    WITH latest AS (
        SELECT DISTINCT ON (company_id)
            company_id,
            cnpj,
            enrichment_version,
            result,
            summary,
            created_at
        FROM {SCHEMA}.company_enrichments
        ORDER BY company_id, enrichment_version DESC
    ),
    latest_case AS (
        SELECT DISTINCT ON (company_id)
            company_id,
            status,
            completed_at
        FROM {SCHEMA}.enrichment_cases
        ORDER BY company_id, created_at DESC
    ),
    company_entity AS (
        SELECT id, entity_type, entity_key, label
        FROM {SCHEMA}.entities
        WHERE entity_type = 'COMPANY'
    )
    SELECT
        l.company_id,
        l.cnpj,
        l.enrichment_version,
        lc.status,
        lc.completed_at AS enriched_at,
        l.result AS profile,
        l.summary,
        ce.id AS company_entity_id,
        COALESCE(ce.label, l.cnpj) AS company_label,
        COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', e.id,
                    'type', e.entity_type,
                    'key', e.entity_key,
                    'label', COALESCE(e.label, e.entity_key)
                )
                ORDER BY e.entity_type, e.entity_key
            )
            FROM (
                SELECT DISTINCT e2.id, e2.entity_type, e2.entity_key, e2.label
                FROM {SCHEMA}.entity_relations r
                JOIN {SCHEMA}.entities e2
                  ON e2.id = r.source_entity_id OR e2.id = r.target_entity_id
                WHERE ce.id IS NOT NULL
                  AND (r.source_entity_id = ce.id OR r.target_entity_id = ce.id)
            ) e
        ), '[]'::jsonb) AS nodes,
        COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'source', r.source_entity_id,
                    'target', r.target_entity_id,
                    'type', r.relation_type,
                    'confidence', r.confidence,
                    'source_meta', r.source,
                    'observed_at', r.observed_at
                )
                ORDER BY r.observed_at
            )
            FROM {SCHEMA}.entity_relations r
            WHERE ce.id IS NOT NULL
              AND (r.source_entity_id = ce.id OR r.target_entity_id = ce.id)
        ), '[]'::jsonb) AS edges,
        COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'entity_type', e.entity_type,
                    'entity_key', e.entity_key,
                    'entity_label', COALESCE(e.label, e.entity_key),
                    'fact_key', f.fact_key,
                    'value', f.value,
                    'confidence', f.confidence,
                    'source', f.source,
                    'observed_at', f.observed_at
                )
                ORDER BY f.observed_at
            )
            FROM {SCHEMA}.enrichment_facts f
            JOIN {SCHEMA}.entities e ON e.id = f.entity_id
            WHERE ce.id IS NOT NULL
              AND (
                  f.entity_id = ce.id
                  OR f.entity_id IN (
                      SELECT r.source_entity_id FROM {SCHEMA}.entity_relations r WHERE r.target_entity_id = ce.id
                      UNION
                      SELECT r.target_entity_id FROM {SCHEMA}.entity_relations r WHERE r.source_entity_id = ce.id
                  )
              )
        ), '[]'::jsonb) AS facts
    FROM latest l
    LEFT JOIN latest_case lc ON lc.company_id = l.company_id
    LEFT JOIN company_entity ce
        ON ce.entity_key = regexp_replace(l.cnpj, '\\D', '', 'g')
    """)


def downgrade() -> None:
    op.execute(f"DROP VIEW IF EXISTS {SCHEMA}.v_company_graph")
