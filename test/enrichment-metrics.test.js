const test = require('node:test');
const assert = require('node:assert');
const metrics = require('../metrics');

// Só roda com prom-client disponível (instalado nesta stack).
test('US8 métricas do motor expostas no /metrics', { skip: metrics.isEnabled() ? false : 'prom-client ausente' }, async () => {
  metrics.setEnrichmentTaskState('search.news', 'COMPLETED', 3);
  metrics.setEnrichmentTaskState('search.news', 'RUNNING', 1);
  metrics.observeEnrichmentTaskDuration('search.news', 0.250);
  metrics.incEnrichmentProviderRequest('searxng', 'ok');
  metrics.incEnrichmentProviderRequest('searxng', 'error');
  metrics.setEnrichmentProviderState('searxng', 'DEGRADED');
  metrics.setEnrichmentPending('search.news', 7);
  metrics.incQualificationTotal();
  metrics.incQualificationFailure();

  const body = await metrics.renderEnrichmentMetrics();
  // O registry injeta o label default app="b2base" em todas as séries.
  const app = ',app="b2base"';
  for (const fragment of [
    `b2base_enrichment_tasks{capability="search.news",state="COMPLETED"${app}} 3`,
    `b2base_enrichment_tasks{capability="search.news",state="RUNNING"${app}} 1`,
    `b2base_enrichment_task_duration_seconds_count{app="b2base",capability="search.news"} 1`,
    `b2base_enrichment_provider_requests_total{provider="searxng",outcome="ok"${app}} 1`,
    `b2base_enrichment_provider_requests_total{provider="searxng",outcome="error"${app}} 1`,
    `b2base_enrichment_provider_state{provider="searxng",state="DEGRADED"${app}} 1`,
    `b2base_enrichment_tasks_pending{capability="search.news"${app}} 7`,
    `b2base_enrichment_qualification_total${app} 1`,
    `b2base_enrichment_qualification_failures_total${app} 1`,
  ]) {
    assert.ok(body.includes(fragment), `esperado no /metrics: ${fragment}`);
  }
});
