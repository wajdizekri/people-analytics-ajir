import { DEFAULT_CHARGE_RATE_PCT, LEVER_LIMITS, NON_CAUSAL_NOTICE } from "@/lib/whatif";
import { WhatIfPanel } from "./what-if-panel";

// RH seulement (la page ne l'affiche pas au manager) : salaire et grade servent à l'aperçu des leviers
export function WhatIfZone({ employeeId, baseSalary = null, grade = null }: { employeeId: number; baseSalary?: number | null; grade?: string | null }) {
  return (
    <WhatIfPanel
      employeeId={employeeId}
      notice={NON_CAUSAL_NOTICE}
      limits={LEVER_LIMITS}
      defaultChargeRatePct={DEFAULT_CHARGE_RATE_PCT}
      baseSalary={baseSalary}
      grade={grade}
    />
  );
}
