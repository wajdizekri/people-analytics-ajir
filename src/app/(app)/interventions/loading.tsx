import { Skeleton, SkeletonHeader, SkeletonKpiRow, SkeletonTable, cardCls } from "@/components/ui";

function ShareBars() {
  return (
    <div className={`${cardCls} p-4 sm:p-5`}>
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-2 h-3 w-1/2" />
      <div className="mt-5 space-y-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 w-28 shrink-0" />
            <Skeleton className="h-5 flex-1 rounded-[4px]" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-4 h-3 w-40" />
    </div>
  );
}

// Squelette de /interventions : en-tête, encadré, avertissement, 5 indicateurs, 2 visuels en barres 100 %, 2 tableaux
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement du suivi des interventions…</span>
      <div aria-hidden="true">
        <SkeletonHeader actions={false} />
        <div className="space-y-6">
          <div className={`${cardCls} p-4`}>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-full max-w-3xl" />
          </div>
          <Skeleton className="h-12 w-full rounded-card" />
          <SkeletonKpiRow count={5} />
          <div className="grid gap-4 lg:grid-cols-2">
            <ShareBars />
            <ShareBars />
          </div>
          <SkeletonTable rows={5} columns={6} />
          <SkeletonTable rows={8} columns={7} />
        </div>
      </div>
    </div>
  );
}
