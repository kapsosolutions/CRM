// The plan in force, for every CRM page: which pages and options are open,
// and a way to open the plans dialog from anywhere ("Upgrade to Basic").
// Provided by CrmShell. Without a provider (or before the plan is known)
// nothing is locked: the server still enforces every limit.
import { createContext, useContext } from 'react';
import type { PlanFeature, PlanState, PlanTierKey } from './types';
import { hasFeature as stateHas } from './plans';

export interface PlanContextValue {
  plan: PlanState | null;
  /** Open the plans dialog, optionally highlighting the plan a locked thing needs. */
  openPlans: (opts?: { tier?: PlanTierKey; reason?: string }) => void;
  /** Read the plan again (after a payment). */
  refresh: () => void;
}

export const PlanContext = createContext<PlanContextValue>({
  plan: null,
  openPlans: () => {},
  refresh: () => {},
});

const LIMIT_CODES = ['TEMPLATE_LIMIT', 'CAMPAIGN_LIMIT', 'CONTACT_LIMIT', 'PLAN_LOCKED'];

export function usePlan() {
  const ctx = useContext(PlanContext);
  return {
    ...ctx,
    has: (f: PlanFeature) => stateHas(ctx.plan, f),
    limits: ctx.plan?.limits || null,
    /**
     * A request the plan refused (HTTP 402 with a limit code): open the plans
     * dialog with the server's reason and return true. Anything else: false.
     */
    planLimitHit: (err: unknown): boolean => {
      const data = (err as { data?: { code?: string; needs?: string; message?: string } } | null)?.data;
      if (!data?.code || !LIMIT_CODES.includes(data.code)) return false;
      ctx.openPlans({ tier: (data.needs as PlanTierKey) || undefined, reason: data.message || (err as Error).message });
      return true;
    },
  };
}
