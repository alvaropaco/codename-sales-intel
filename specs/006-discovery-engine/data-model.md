# Data Model: B2Base Discovery & Intelligence

The discovery model is broader than technical OSINT. A company discovered from CNPJ, web search or a domain becomes a canonical business entity that can progressively receive corporate, financial, legal, ownership, commercial and digital intelligence.

## Modeling Principles
1. Canonical entity + domain profiles + immutable evidence; do not create hundreds of nullable columns on DiscoveryEntity.
2. Preserve observed facts separately from inferred relationships/signals.
3. Mutable facts retain observedAt and source provenance.
4. Providers remain source-neutral and vendor-specific schemas stay behind adapters.
5. Every resource is tenant-scoped by orgId.

## DiscoveryJob
id, orgId, status (queued/running/partial/completed/failed/cancelled), trigger, query JSON, providerConfig JSON, counters, timestamps.

## DiscoveryProviderRun
id, jobId, orgId, provider, capability, status, attempt, requests, items, estimatedCost, errorCode, errorMessage, timestamps, lastCursor. Unique (jobId, provider).

## DiscoveryEntity
id, orgId, type, canonicalKey, displayName, identifiers JSON, attributes JSON, firstSeenAt, lastSeenAt, confidence, status, createdAt, updatedAt.

Entity types: company, organization, brand, address, location, cnae, person, partner, director, representative, beneficial_owner, domain, subdomain, host, ip, asn, url, email, phone, social_profile, technology, product, service, market, customer, supplier, funding_round, investor, financial_event, financial_instrument, legal_case, court, legal_party, legal_document, legal_event.

The type is extensible so new enrichment domains do not require a redesign of the discovery engine.

## CompanyProfile
A company projection exposes CNPJ, razão social, nome fantasia, situação cadastral, data de abertura, data de situação, natureza jurídica, porte, matriz/filial, inscrições, CNAEs, activity descriptions, sector, tags, addresses, establishments, official domains, websites, public emails, public phones, social profiles, products/services and markets. These are structured attributes backed by evidence, not duplicated provider records.

## FinancialProfile
Financial facts are typed, source-backed observations: capital social; estimated revenue/revenue ranges; assets/equity; debt/liabilities when public; valuation; funding status; funding rounds with date/type/amount/currency; investors; acquisitions/divestitures and material financial events.

A funding_round is connected through RAISED and investors through INVESTED_BY. Estimated data must carry an explicit evidence type such as estimated, reported or inferred.

## LegalProfile
A legal_case may contain case number/CNJ identifier, court and jurisdiction, case class, subject, filing and last-movement dates, status, claim value, parties, public lawyers, decisions/documents and source reference.

Relations: company/person HAS_PROCESS legal_case; legal_case HEARD_BY court; legal_case INVOLVES legal_party; legal_case HAS_DOCUMENT legal_document; legal_case HAS_EVENT legal_event.

Jusbrasil/Escavador-compatible providers are adapters; the core model is vendor-neutral.

## OwnershipProfile
Represent partners/shareholders, administrators/directors, representatives, ownership percentage when available, roles, effective dates and related companies. Relations include HAS_PARTNER, HAS_DIRECTOR, HAS_REPRESENTATIVE, OWNS and RELATED_TO.

## DigitalProfile
Capture domains/subdomains, DNS, IP/ASN, TLS certificates, HTTP metadata, technologies, public emails/phones and social profiles.

## DiscoveryRelationship
orgId, fromEntityId, toEntityId, type, confidence, metadata JSON, observedAt, createdAt, updatedAt. Recommended types include HAS_CNPJ, HAS_DOMAIN, HAS_SUBDOMAIN, HAS_PHONE, HAS_EMAIL, LOCATED_AT, HAS_CNAE, HAS_PARTNER, HAS_DIRECTOR, HAS_REPRESENTATIVE, OWNS, HAS_PROCESS, INVOLVES, HEARD_BY, RAISED, INVESTED_BY, HAS_FUNDING_ROUND, USES_TECH, HAS_SOCIAL, HAS_PRODUCT, HAS_SERVICE, HAS_BRANCH and RELATED_TO.

Unique constraint: (orgId, fromEntityId, toEntityId, type).

## DiscoveryEvidence
Immutable source of truth: jobId, providerRunId, entityId/relationshipId, evidenceType, sourceProvider, sourceUrl, sourceRef, observedValue JSON, observedAt, capturedAt, confidence, rawHash, metadata JSON.

Examples include CNPJ observations, capital social, funding rounds, legal cases, DNS records and public profiles. A stable hash prevents duplicate evidence on redelivery.

## DiscoveryCandidate
id, orgId, companyEntityId, cnpj, name, domain, location, confidence, status, dedupeKey, evidenceCount, importedProspectId. This remains a sales projection and points to the canonical company entity.

## DiscoverySignal
Optional derived projection: id, orgId, companyEntityId, type, value JSON, confidence, evidenceIds, observedAt, expiresAt. Examples: recent_funding, expansion_signal, new_domain, hiring_signal, legal_risk_signal, technology_adoption. Signals never replace source evidence.

## Provider Config
Job snapshot may include enabled, timeoutMs, maxRequests, concurrency, rateLimit, paid and dailyBudget. Secrets are never serialized.

## Pipeline Boundaries
Discovery establishes candidate existence. Enrichment adds domain-specific facts. Intelligence correlates facts and generates derived signals.

Pipeline: Discovery → Corporate Enrichment → Financial Enrichment → Digital Enrichment → Legal Enrichment → Intelligence.