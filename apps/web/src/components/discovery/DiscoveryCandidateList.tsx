import React, { useCallback, useEffect, useState } from 'react';
import { Download, Loader2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DiscoveryCandidate } from '@/types';
import { fetchDiscoveryJobCandidates, importDiscoveryCandidate } from '@/services/api';
import { formatCNPJ } from '@/lib/utils';

/**
 * DiscoveryCandidateList (T050) — candidatos do job com paginação, filtro de
 * confiança e importação idempotente para o pipeline de leads (SC-005: o
 * backend devolve o prospect original num segundo import).
 */

const PAGE_SIZE = 12;

export function DiscoveryCandidateList({ jobId }: { jobId: string }) {
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDiscoveryJobCandidates(jobId, { page: targetPage, pageSize: PAGE_SIZE, minConfidence: 0.3 });
      setCandidates(data.candidates || []);
      setTotal(data.total || 0);
      setPage(targetPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar candidatos');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load(1);
  }, [load]);

  async function handleImport(candidate: DiscoveryCandidate) {
    setImporting(candidate.id);
    try {
      await importDiscoveryCandidate(jobId, candidate.id);
      setImportedIds((prev) => new Set(prev).add(candidate.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao importar');
    } finally {
      setImporting(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando candidatos…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-rose-400">{error}</p>}
      {candidates.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Search className="h-3.5 w-3.5" /> Nenhum candidato com confiança ≥ 0.3 até agora.
        </p>
      ) : (
        <ul className="space-y-2">
          {candidates.map((candidate) => {
            const imported = importedIds.has(candidate.id) || candidate.status === 'imported';
            return (
              <li key={candidate.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-card/40 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{candidate.name || 'Sem nome'}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {[candidate.cnpj ? formatCNPJ(candidate.cnpj) : null, candidate.domain].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  conf {candidate.confidence.toFixed(2)}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={imported || importing === candidate.id}
                  onClick={() => handleImport(candidate)}
                >
                  {importing === candidate.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {imported ? 'Importado' : 'Importar'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => load(page - 1)}>Anterior</Button>
          <span>página {page} de {totalPages} ({total} candidatos)</span>
          <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => load(page + 1)}>Próxima</Button>
        </div>
      )}
    </div>
  );
}
