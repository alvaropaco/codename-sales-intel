# Scoring

Deterministic heuristics, never LLM, never presented as fact. Revenue is never
estimated as factual.

## Confidence levels

| Score | Level |
|---|---|
| ≥ 80 | VERY_HIGH |
| 65–79 | HIGH |
| 45–64 | MEDIUM |
| 25–44 | LOW |
| < 25 | VERY_LOW |

## Launch velocity (0–100)

Signals: active domain, HTTPS, corporate email, social presence, tech footprint,
opening date. High when the company already operates online.

## Operational readiness (0–100)

Signals: domain active, website active, corporate email, MX, analytics, marketing
stack, social, payments, communications.

## Commercial potential (0–100)

Inputs: capital social, porte, legal nature, CNAE, recency, digital readiness,
tech footprint, launch velocity, location, contactability. Output carries a
`confidence` and a reasons list. Never labeled as revenue.

## Buying intent (per vertical)

Vertical list: ACCOUNTING, BANKING, PAYMENTS, CRM, ERP, PROFESSIONAL_EMAIL,
CLOUD, CYBERSECURITY, TELECOM, MARKETING, INSURANCE, HR_SOFTWARE, ECOMMERCE.

Each vertical yields `score` (0–100) and `confidence` (0–1), driven by
professional email, present technology categories, and CNAE/sizing heuristics.

## Evidence principle

Every score derived from observed signals; an inferred score always carries a
confidence and never implies a confirmed fact about the company.
