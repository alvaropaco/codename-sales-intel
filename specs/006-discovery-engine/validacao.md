# Validação: B2Base Discovery Engine

Data: 2026-09-21 · Branch: `006-discovery-engine`

## Testes (T009, T016, T022, T027, T031, T035, T047, T048, T054, T055)

- `pnpm test`: **418/418 passando** (inclui 7 arquivos novos `test/discovery-*.test.js`).
- `pnpm --filter web test`: **63/63** (vitest, sem regressão).
- `pnpm --filter web build`: `tsc && vite build` OK.
- Serviços Python (`services/`): sem alteração nesta feature — pytest não
  aplicável a este diff.

Cobertura comportamental por user story:

| Critério | Teste |
|---|---|
| SC-001 provider falho não para o job | `discovery-orchestrator: US1/T016 … → job partial` |
| SC-002 identidade estável consolida entidade | `discovery-normalizer: canonicalKey…` + `discovery-persistence: mesma canonicalKey consolida` |
| SC-003 discovery por domínio sem SpiderFoot | `discovery-orchestrator: US2 seed de domínio…` (crtsh + http-metadata apenas) |
| SC-005 replay não duplica fatos | `discovery-persistence: redelivery…` + `discovery-orchestrator: SC-005 replay…` + idempotência do `runJob` |
| SC-007 providers pagos desligáveis | `T040/T042` (NOT_CONFIGURED/BUDGET_EXHAUSTED → fallback) |
| FR-025 conflitos coexistem | `discovery-persistence: observações CONFLITANTES coexistem` + `discovery-enrichers: capital social conflitante` |
| T047 confiança determinística | `discovery-confidence: determinismo…` |
| T048 sinal não substitui evidência | `discovery-enrichers: T048…` |

## Comparação nativo × SpiderFoot (T056)

Cobertura na mesma semente (`seed.domain`):

| Dimensão | Nativo (crtsh + dns-rdap + projectdiscovery + http-metadata) | SpiderFoot (adapter opcional) |
|---|---|---|
| Subdomínios | CT logs + enumeração Chaos, confiança 0.85–0.92 | Equivalente (fontes semelhantes), confiança 0.7 |
| Infra (IP/NS/MX/RDAP) | Direto do resolvedor + rdap.org, custo 0 | Depende de módulos SF, scan completo ≈ minutos |
| Metadados HTTP/contatos | 1–2 requests bounded, 2 MB cap | Crawler amplo — risco de custo/latência |
| Timeout por seed | 45s por coletor, concorrência 2 | Hard timeout 60s fora do caminho crítico |
| Custo | R$ 0 (sem chaves) | Infra própria da instância SF |
| Falha | Job `partial`, fallback por capability | Scanner monolítico: falha perde tudo |

Conclusão: o caminho nativo cobre o escopo passivo do v1 com custo zero e
granularidade por provider; SpiderFoot permanece como adapter opcional
(`providers/spiderfoot.js`) para organizações que já operam uma instância.
