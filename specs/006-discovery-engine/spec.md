# Feature Specification: B2Base Discovery Engine

**Feature Branch**: `006-discovery-engine`
**Created**: 2026-09-20
**Status**: Draft

## User Scenarios & Testing

### User Story 1 - Descobrir candidatos comerciais (Priority: P1)
O operador reutiliza CNAE, segmento e localização do onboarding e recebe candidatos reais, deduplicados e com proveniência.

**Independent Test**: executar um discovery job e verificar candidatos, fontes e deduplicação.

**Acceptance Scenarios**:
1. Given um perfil de CNAEs/regiões, When o job é iniciado, Then os providers habilitados são executados de forma rastreável.
2. Given resultados de múltiplos providers, When normalizados, Then a mesma empresa vira um candidato canônico com múltiplas evidências.
3. Given uma empresa já importada, When reaparece, Then não é criada como prospect duplicado.

### User Story 2 - Descobrir presença digital e infraestrutura (Priority: P1)
A partir de uma empresa/domínio, o sistema descobre domínio, subdomínios, certificados, DNS e metadados HTTP sem bloquear o pipeline quando uma fonte falha.

**Independent Test**: executar discovery com seed de domínio e verificar entidades, relações e isolamento de falhas.

**Acceptance Scenarios**:
1. Given um domínio, When CT/DNS/subdomain providers executam, Then entidades e evidências são persistidas.
2. Given um provider indisponível, When o job continua, Then os demais providers ainda concluem.
3. Given o mesmo domínio vindo de duas fontes, When resolvido, Then uma entidade canônica permanece com múltiplas evidências.

### User Story 3 - Busca web substituível e controlada por custo (Priority: P1)
A plataforma usa um contrato comum de search e permite SearXNG, Serper, Brave e Exa sem acoplar o pipeline a uma única API.

**Independent Test**: executar uma query em dois providers e validar o mesmo contrato normalizado.

### User Story 4 - Evidências, confiança e relações (Priority: P2)
Toda descoberta mantém source, timestamp, tipo de evidência e confiança, permitindo agregação de relações para enriquecimento.

**Independent Test**: fixtures determinísticas produzem as mesmas entidades, relações e níveis de confiança.

## Edge Cases
- Timeout, 429, 403, resposta inválida ou ausência de API key.
- Variação de casing, URL, CNPJ e hostname.
- Domínio expirado ou sem DNS.
- Resultados contraditórios.
- Job reiniciado após sucesso parcial.
- Mesmo CNPJ presente em várias organizações.
- Termos de busca retornando empresas fora do ICP.

## Requirements
- **FR-001**: System MUST create a discovery job with org, criteria and provider configuration snapshot.
- **FR-002**: System MUST execute providers independently and isolate failures.
- **FR-003**: System MUST expose a common provider contract for search, CT, DNS/RDAP, subdomain and HTTP metadata.
- **FR-004**: System MUST normalize output into canonical entities, relationships and evidence.
- **FR-005**: System MUST deduplicate companies using CNPJ when available and normalized domain/name signals otherwise.
- **FR-006**: System MUST preserve source provider, source URL/reference, capture time, evidence type and confidence.
- **FR-007**: System MUST support SearXNG and external search providers behind the same interface.
- **FR-008**: System MUST support CNPJ/enterprise source, search, CT, DNS/RDAP, subdomain and HTTP metadata providers.
- **FR-009**: System MUST support provider-specific timeout, retry, rate and concurrency policies.
- **FR-010**: System MUST keep SpiderFoot optional and outside the critical path.
- **FR-011**: System MUST use versioned NATS JetStream events for distributed execution.
- **FR-012**: System MUST make result persistence idempotent on redelivery.
- **FR-013**: System MUST support commercial-criteria and known-domain seeds.
- **FR-014**: System MUST expose job/provider state, counts and errors through API.
- **FR-015**: System MUST enforce organization isolation on all discovery resources.
- **FR-016**: System MUST keep provider credentials out of git.
- **FR-017**: System MUST provide deterministic evidence confidence and distinguish observed facts from inferred relationships.
- **FR-018**: System MUST allow paid providers to be disabled per job/organization.
- **FR-019**: System MUST record request/cost metadata when available.
- **FR-020**: System MUST resume partially completed jobs without rerunning successful providers unnecessarily.

## Key Entities
- DiscoveryJob
- DiscoveryProviderRun
- DiscoveryEntity
- DiscoveryRelationship
- DiscoveryEvidence
- DiscoveryCandidate

## Success Criteria
- **SC-001**: A job continues when an individual provider is unavailable.
- **SC-002**: 99% of observations with a stable identifier are consolidated into one canonical candidate within a job.
- **SC-003**: Known-domain discovery works without SpiderFoot.
- **SC-004**: Provider failure state is visible in the job API within 5 seconds of terminal handling.
- **SC-005**: Replayed provider result events do not duplicate persisted facts.
- **SC-006**: Provider-level latency, success/failure and cost metadata are available for operational measurement.
- **SC-007**: Paid providers can be disabled while self-hosted/free discovery remains functional.

## Assumptions
- Existing CNPJ MCP discovery remains the authoritative Brazilian company source and becomes a provider.
- Existing NATS, Prisma/Postgres, SearXNG and search/identity/deep workers are reused.
- No graph database is introduced in v1.
- SpiderFoot is retained only as an optional compatibility adapter.
