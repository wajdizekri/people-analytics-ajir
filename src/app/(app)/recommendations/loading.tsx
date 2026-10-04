import { Skeleton, SkeletonHeader, SkeletonKpiRow, cardCls } from "@/components/ui";

// Squelette de /recommendations : en-tête, filtres, suivi de l'adoption (barre + 4 indicateurs), liste de cartes « Pour qui / Pourquoi / Que faire »
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement des recommandations…</span>
      <div aria-hidden="true">
        <SkeletonHeader actions={false} />
        <div className="space-y-6">
          <div className={`${cardCls} flex flex-wrap items-end gap-3 p-4`}>
            <Skeleton className="h-10 w-full sm:w-48" />
            <Skeleton className="hidden h-10 w-48 sm:block" />
            <Skeleton className="hidden h-10 w-48 sm:block" />
            <Skeleton className="h-10 w-40 sm:ml-auto" />
          </div>
          <div className={`${cardCls} p-4 sm:p-5`}>
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="mt-2 h-3 w-1/2" />
            <Skeleton className="mt-4 h-4 w-full rounded-full" />
            <Skeleton className="mt-2 h-3 w-2/3" />
            <SkeletonKpiRow count={4} className="mt-4" />
          </div>
          <div className={`${cardCls} overflow-hidden`}>
            <div className="border-b border-line px-4 py-3">
              <Skeleton className="h-5 w-48" />
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="border-b border-l-4 border-line px-4 py-4 last:border-b-0">
                <Skeleton className="h-3 w-56" />
                <div className="mt-3 grid gap-4 md:grid-cols-3">
                  <div className="flex gap-2.5">
                    <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3.5 w-4/5" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-3.5 w-full" />
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Skeleton className="h-9 w-48" />
                  <Skeleton className="h-9 w-28" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
