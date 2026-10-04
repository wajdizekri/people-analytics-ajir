import { Skeleton, SkeletonHeader, SkeletonKpiRow, SkeletonTable, cardCls } from "@/components/ui";

const TILES = ["col-span-3 row-span-2", "col-span-2 row-span-2", "col-span-2", "col-span-1", "col-span-2", "col-span-3", "col-span-2"];

// Squelette de /equipes : en-tête (bouton « Voir l'organigramme »), encadré d'explication, filtres, 5 indicateurs, carte des équipes, tableau trié
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement des équipes…</span>
      <div aria-hidden="true">
        <SkeletonHeader />
        <div className="space-y-6">
          <div className={`${cardCls} p-4`}>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-full max-w-3xl" />
            <Skeleton className="mt-2 h-3 w-4/5 max-w-2xl" />
          </div>
          <div className={`${cardCls} flex flex-wrap items-end gap-3 p-4`}>
            <Skeleton className="h-10 w-full sm:w-64" />
            <Skeleton className="hidden h-10 w-56 sm:block" />
            <Skeleton className="h-10 w-40 sm:ml-auto" />
          </div>
          <SkeletonKpiRow count={5} />
          <div className={`${cardCls} p-4 sm:p-5`}>
            <Skeleton className="h-4 w-2/3 max-w-lg" />
            <Skeleton className="mt-2 h-3 w-1/3" />
            <Skeleton className="mt-4 h-14 w-full" />
            <div className="mt-3 grid h-72 grid-cols-6 grid-rows-3 gap-1">
              {TILES.map((c, i) => (
                <Skeleton key={i} className={`h-full w-full rounded-[4px] ${c}`} />
              ))}
            </div>
          </div>
          <SkeletonTable rows={8} columns={7} />
        </div>
      </div>
    </div>
  );
}
