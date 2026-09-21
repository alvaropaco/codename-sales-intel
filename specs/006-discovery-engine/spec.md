# Feature Specification: B2Base Discovery Engine

**Feature Branch**: 006-discovery-engine
**Created**: 2026-09-20
**Status**: Draft

## User Scenarios & Testing
### User Story 1 - Descobrir candidatos comerciais (Priority: P1)
O operador reutiliza CNAE, segmento e localização do onboarding e recebe candidatos reais, deduplicados e com proveniência.
### User Story 2 - Descobrir presença digital e infraestrutura (Priority: P1)
A partir de uma empresa/domínio, o sistema descobre domínio, subdomínios, certificados, DNS e metadados HTTP sem bloquear o pipeline quando uma fonte falha.
### User Story 3 - Busca web substituível e controlada por custo (Priority: P1)
A plataforma usa um contrato comum de search e permite SearXNG, Serper, Brave e Exa sem acoplar o pipeline a uma única API.
### User Story 4 - Enriquecer empresa com dados corporativos, financeiros, jurídicos e ownership (Priority: P1)
A plataforma transforma uma empresa descoberta em um perfil de inteligência empresarial progressivamente enriquecido, preservando fonte, temporalidade e confiança de cada fato.
Independent Test: executar enrichment sobre uma empresa fixture e verificar CNPJ, capital social, CNAEs, sócios, funding e processos como entidades/evidências independentes quando disponíveis.
Acceptance Scenarios: CNPJ identificado → identidade cadastral, CNAEs, endereço e capital social disponíveis são normalizados; dados financeiros públicos → funding, rodadas e investidores persistidos com fonte e observedAt; registros jurídicos públicos → processos, tribunais, partes e eventos persistidos; sócios/administradores públicos → pessoas e vínculos persistidos sem duplicação; fontes conflitantes → ambas permanecem como evidências.
### User Story 5 - Evidências, confiança e relações (Priority: P1)
Toda descoberta mantém source, timestamp, tipo de evidência e confiança, permitindo agregação para enriquecimento e inteligência.
## Edge Cases
Timeout, 429, 403, resposta inválida, ausência de API key, variação de casing/URL/CNPJ/hostname, domínio expirado, resultados conflitantes, dados financeiros estimados apresentados como auditados, processos duplicados, pessoa com múltiplos vínculos, mudanças históricas, retry parcial, mesmo CNPJ em organizações diferentes e resultados fora do ICP.
## Requirements
FR-001..020: manter os requisitos existentes de jobs, providers, normalização, NATS, idempotência, tenant isolation, budgets, observabilidade e SpiderFoot.
FR-021: MUST modelar identidade corporativa incluindo CNPJ, razão social, nome fantasia, situação cadastral, abertura, natureza jurídica, porte, CNAEs e endereços.
FR-022: MUST modelar fatos financeiros incluindo capital social, estimativas financeiras, funding, rodadas, investidores e eventos materiais quando disponíveis.
FR-023: MUST modelar fatos jurídicos incluindo processos, tribunais, partes, documentos e eventos quando públicos.
FR-024: MUST modelar ownership/control incluindo sócios, diretores, representantes e relações de propriedade.
FR-025: MUST preservar temporalidade e proveniência para fatos mutáveis e observações conflitantes.
FR-026: MUST manter schemas específicos de fornecedores jurídicos/financeiros/corporativos atrás de adapters.
FR-027: MUST separar evidence de intelligence signals derivados.
FR-028: MUST permitir novos providers/enrichment domains sem alterar o contrato de DiscoveryJob.
## Key Entities
DiscoveryJob, DiscoveryProviderRun, DiscoveryEntity, CompanyProfile, FinancialProfile, LegalProfile, OwnershipProfile, DigitalProfile, DiscoveryRelationship, DiscoveryEvidence, DiscoveryCandidate, DiscoverySignal.
## Success Criteria
SC-001 provider failure does not stop the job; SC-002 stable identifiers consolidate into one canonical entity; SC-003 known-domain discovery works without SpiderFoot; SC-004 provider terminal state visible in API within 5 seconds; SC-005 replayed events do not duplicate facts; SC-006 latency/success/failure/cost measurable; SC-007 paid providers can be disabled; SC-008 company profile exposes corporate, financial, legal, ownership and digital evidence without provider-specific model; SC-009 conflicting observations remain auditable.
## Assumptions
CNPJ MCP remains the authoritative Brazilian company source and becomes a provider; existing NATS, Prisma/Postgres, SearXNG and workers are reused; legal/financial providers are optional and budget-gated; no graph database in v1; SpiderFoot only as optional compatibility adapter.