# Enrichment Policy

Deterministic, evidence-backed, restart-safe. This service enriches company
data; it does not fabricate or over-claim.

## Facts vs inferences

- A discovered fact: observed value + `source` + `observed_at`.
- An inference: a score/classification + `confidence` + reasons.
- Never present an inference as a fact. Revenue estimates are never factual.

## Field ownership

- firmographics (CNPJ/porte/legal nature/CNAE): deterministic lookup.
- domain/website: validated discovery (DNS + RDAP + web).
- contacts/emails: from public pages only, evidence-cited.
- tech stack: deterministic fingerprints (headers, JS markers, DNS).
- scores: deterministic heuristics (see `docs/SCORING.md`).

## Versioning

- `enrichment_version` increments per schema change; older results remain
  queryable; the latest version wins.
- Idempotency key: `company_id` + `enrichment_version`.

## Data minimization

- Only public business data; no PII beyond public business contacts.
- No data leaves the cluster except to the existing AI gateway / public web.
