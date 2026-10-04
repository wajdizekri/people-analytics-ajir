import { Skeleton, SkeletonChart, SkeletonKpiRow, SkeletonTable, cardCls } from "@/components/ui";

// Squelette fidèle au tableau de bord : en-tête, encart d'aide, « À traiter », filtres, filtres actifs, 7 indicateurs, risques, évolutions, détail
function SectionTitle() {
  return (
    <div className="mb-3 space-y-2">
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-3.5 w-full max-w-md" />
    </div>
  );
}

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement du tableau de bord…</span>
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
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-10 w-44 rounded-full" />
          <Skeleton className="h-10 w-56 rounded-full" />
        </div>
        <div className={`${cardCls} mb-4 flex flex-wrap items-end gap-3 p-3 sm:p-4`}>
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className={`h-10 w-full sm:w-40 ${i > 0 ? "hidden sm:block" : ""}`} />
          ))}
          <Skeleton className="hidden h-10 w-40 sm:ml-auto sm:block" />
        </div>
        <Skeleton className="mb-6 h-4 w-48" />
        <div className="space-y-8">
          <div>
            <SectionTitle />
            <div className="space-y-4">
              <SkeletonKpiRow count={4} />
              <SkeletonKpiRow count={3} className="xl:w-3/4" />
            </div>
          </div>
          <div>
            <SectionTitle />
            <div className="grid gap-4 xl:grid-cols-3">
              <SkeletonChart height={200} />
              <SkeletonChart height={200} className="hidden sm:block xl:col-span-2" />
            </div>
          </div>
          <div>
            <SectionTitle />
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              <SkeletonChart height={240} />
              <SkeletonChart height={240} className="hidden lg:block" />
              <SkeletonChart height={240} className="hidden xl:block" />
            </div>
          </div>
          <SkeletonTable rows={6} columns={6} />
        </div>
      </div>
    </div>
  );
}
