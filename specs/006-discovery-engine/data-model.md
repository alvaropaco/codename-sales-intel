# Data Model: B2Base Discovery Engine

## DiscoveryJob
id, orgId, status (queued/running/partial/completed/failed/cancelled), trigger, query JSON, providerConfig JSON, counters, timestamps.

## DiscoveryProviderRun
id, jobId, orgId, provider, capability, status, attempt, requests, items, estimatedCost, errorCode, errorMessage, timestamps, lastCursor. Unique (jobId, provider).

## DiscoveryEntity
Types: company, domain, subdomain, host, ip, person, social_profile, technology, url. Unique (orgId,type,canonicalKey).

## DiscoveryRelationship
fromEntityId, toEntityId, type, confidence, metadata, timestamps. Unique (orgId,fromEntityId,toEntityId,type).

## DiscoveryEvidence
job/provider references, entity/relationship reference, evidenceType, sourceUrl/sourceRef, observedValue, confidence, capturedAt, rawHash, metadata. Immutable; stable hash prevents duplicates.

## DiscoveryCandidate
company projection with CNPJ, name, domain, location, confidence, status, dedupeKey, evidenceCount and importedProspectId. Unique (orgId,dedupeKey).

## Provider Config
Job snapshot may include enabled, timeoutMs, maxRequests, paid and dailyBudget. Secrets are never serialized.