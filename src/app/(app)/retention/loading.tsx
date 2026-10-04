import { Skeleton, SkeletonChart, SkeletonKpiRow, SkeletonTable, cardCls } from "@/components/ui";

// Squelette de la page : en-tête, filtres, réponse et 4 indicateurs, courbe de maintien, détail par groupe
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Calcul des courbes de maintien…</span>
      <div aria-hidden="true" className="mb-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-full max-w-lg" />
        <Skeleton className="mt-2 h-3 w-1/2 max-w-64" />
      </div>
      <div aria-hidden="true" className={`${cardCls} mb-4 flex flex-wrap gap-3 p-4`}>
        <Skeleton className="h-10 w-full sm:w-56" />
        <Skeleton className="h-10 w-full sm:w-56" />
        <Skeleton className="h-10 w-40 sm:ml-auto" />
      </div>
      <div className="space-y-6">
        <div aria-hidden="true" className={`${cardCls} p-4`}>
          <Skeleton className="h-5 w-72" />
          <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
        </div>
        <SkeletonKpiRow count={4} />
        <SkeletonChart height={340} />
        <SkeletonTable rows={5} columns={6} />
      </div>
    </div>
  );
}
