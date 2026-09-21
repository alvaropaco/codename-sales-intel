import React, { useState } from 'react';
import { Loader2, Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DiscoveryJobStatusPayload } from '@/types';
import { startProspectDiscovery } from '@/services/api';
import { LeadSection } from '../lead/shared';
import { DiscoveryJobProgress } from './DiscoveryJobProgress';
import { DiscoveryCandidateList } from './DiscoveryCandidateList';
import { CompanyIntelligence } from './CompanyIntelligence';

/**
 * LeadDiscoveryPanel (T052) — entrypoint do Discovery Engine na tela de lead:
 * dispara o job com a seed (cnpj/domain) do lead, acompanha o progresso por
 * provider e expõe candidatos + inteligência da empresa descoberta.
 */

export function LeadDiscoveryPanel({ prospectId }: { prospectId: string }) {
  const [jobId, setJobId] = useState<string | null>(null);
  const [companyEntityId, setCompanyEntityId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setStarting(true);
    setError(null);
    setCompanyEntityId(null);
    try {
      const result = await startProspectDiscovery(prospectId);
      if (result) setJobId(result.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar discovery');
    } finally {
      setStarting(false);
    }
  }

  function handleJobDone(status: DiscoveryJobStatusPayload) {
    //terminal: carrega inteligência da primeira empresa candidata (seed do lead)
    if (status.job.itemsFound > 0) {
      import('@/services/api')
        .then(({ fetchDiscoveryJobCandidates }) => fetchDiscoveryJobCandidates(jobId as string, { pageSize: 1, minConfidence: 0 }))
        .then((page) => {
          const first = page.candidates?.[0];
          if (first?.companyEntityId) setCompanyEntityId(first.companyEntityId);
        })
        .catch(() => {});
    }
  }

  return (
    <LeadSection
      icon={<Radar className="h-4 w-4" />}
      title="Discovery Engine"
      headerExtra={jobId ? undefined : 'não executado'}
      state="ready"
      className="xl:col-span-2"
    >
      <div className="space-y-4">
        {!jobId ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-xs text-muted-foreground">
              Executa descoberta passiva multi-provider (CNPJ, web, CT/DNS, metadados HTTP) para este lead.
            </p>
            <Button size="sm" onClick={handleStart} disabled={starting}>
              {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
              Iniciar discovery
            </Button>
            {error && <p className="text-xs text-rose-400">{error}</p>}
          </div>
        ) : (
          <>
            <DiscoveryJobProgress jobId={jobId} onJobDone={handleJobDone} />
            <DiscoveryCandidateList jobId={jobId} />
            {companyEntityId && <CompanyIntelligence entityId={companyEntityId} />}
          </>
        )}
      </div>
    </LeadSection>
  );
}
