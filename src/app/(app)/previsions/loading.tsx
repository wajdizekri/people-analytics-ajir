import { Skeleton, SkeletonHeader, SkeletonChart, SkeletonTable, cardCls } from "@/components/ui";

// Squelette de /previsions : en-tête, projection à 12 mois (3 chiffres), scénario (3 hypothèses), 2 projections, tableau, recommandations
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Calcul de la projection des effectifs…</span>
      <div aria-hidden="true">
        <SkeletonHeader actions={false} />
        <div className="space-y-6">
          <div className={`${cardCls} border-l-4 border-l-primary/40 p-4 sm:p-5`}>
            <Skeleton className="h-5 w-56" />
            <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="mt-2 h-7 w-1/2" />
                  <Skeleton className="mt-2 h-3 w-5/6" />
                </div>
              ))}
            </div>
          </div>
          <div className={`${cardCls} p-4 sm:p-5`}>
            <Skeleton className="h-4 w-48" />
            <div className="mt-5 grid gap-6 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="mt-2 h-3 w-4/5" />
                  <div className="mt-4 flex items-center gap-3">
                    <Skeleton className="h-2 flex-1 rounded-full" />
                    <Skeleton className="h-10 w-20" />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
              <Skeleton className="h-10 w-56" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <SkeletonChart height={300} />
            <SkeletonChart height={300} />
          </div>
          <SkeletonTable rows={9} columns={6} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className={`${cardCls} space-y-3 p-4 sm:p-5 xl:col-span-2`}>
              <Skeleton className="h-4 w-44" />
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-control border border-line border-l-4 p-4">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="mt-3 h-4 w-4/5" />
                  <Skeleton className="mt-2 h-3 w-full" />
                  <div className="mt-3 flex gap-2">
                    <Skeleton className="h-9 w-48" />
                    <Skeleton className="h-9 w-24" />
                  </div>
                </div>
              ))}
            </div>
            <SkeletonTable rows={8} columns={4} />
          </div>
        </div>
      </div>
    </div>
  );
}
