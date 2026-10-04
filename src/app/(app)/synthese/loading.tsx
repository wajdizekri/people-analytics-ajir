import { Skeleton, SkeletonCard, SkeletonKpiRow, SkeletonTable, cardCls } from "@/components/ui";

// Squelette fidèle à la synthèse : en-tête, encart d'aide, synthèse rédigée, « À traiter en priorité », chiffres clés, autres constats, listes nominatives
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement de la synthèse du mois…</span>
      <div aria-hidden="true">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 border-l-4 border-line pl-3">
            <Skeleton className="h-7 w-56 max-w-full" />
            <Skeleton className="mt-2 h-4 w-full max-w-xl" />
            <Skeleton className="mt-2 h-3 w-2/3 max-w-sm" />
          </div>
          <Skeleton className="hidden h-10 w-52 sm:block" />
        </div>
        <div className={`${cardCls} mb-4 p-4`}>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3.5 w-full max-w-lg" />
        </div>
        <div className="space-y-8">
          <SkeletonCard lines={5} />
          <div className={`${cardCls} p-4 sm:p-5`}>
            <Skeleton className="h-5 w-56" />
            <Skeleton className="mt-2 h-3.5 w-64 max-w-full" />
            <div className="mt-4 space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-control border-l-4 border-line p-3 ring-1 ring-inset ring-line">
                  <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="hidden h-8 w-52 sm:block" />
                </div>
              ))}
            </div>
          </div>
          <div>
            <Skeleton className="mb-3 h-5 w-72 max-w-full" />
            <div className="space-y-4">
              <SkeletonKpiRow count={4} />
              <SkeletonKpiRow count={3} className="xl:w-3/4" />
            </div>
          </div>
          <SkeletonCard lines={3} />
          <SkeletonTable rows={5} columns={4} />
        </div>
      </div>
    </div>
  );
}
