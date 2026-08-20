import { useEffect, useState } from 'react';
import { fetchPlan } from '@/services/api';
import { PlanInfo } from '@/types';

export interface PlanState {
  plan: PlanInfo | null;
  loading: boolean;
  canExport: boolean;
}

/**
 * Loads the current organization's plan (trial | premium) and exposes a
 * convenient `canExport` flag for gating data-export actions in the UI.
 */
export function usePlan(): PlanState {
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchPlan()
      .then((p) => {
        if (active) setPlan(p);
      })
      .catch(() => {
        // Unknown plan: default to no export until confirmed.
        if (active) setPlan(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return { plan, loading, canExport: Boolean(plan?.canExport) };
}
