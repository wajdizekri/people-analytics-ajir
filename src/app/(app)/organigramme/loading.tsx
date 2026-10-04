import { Skeleton, SkeletonCard, SkeletonChart, SkeletonHeader, SkeletonKpiRow, cardCls } from "@/components/ui";

// Squelette de /organigramme : en-tête (bouton « Voir les équipes »), encadré d'explication, 3 indicateurs, choix couleur / affichage, hiérarchie + panneau
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement de l&apos;organigramme…</span>
      <SkeletonHeader />
      <div className="space-y-6">
        <div aria-hidden="true" className={`${cardCls} p-4`}>
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-full max-w-3xl" />
          <Skeleton className="mt-2 h-3 w-4/5 max-w-2xl" />
        </div>
        <SkeletonKpiRow count={3} />
        <div aria-hidden="true" className="flex flex-wrap justify-between gap-3">
          <Skeleton className="h-12 w-full max-w-sm" />
          <Skeleton className="h-12 w-48" />
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <SkeletonChart height={520} />
          <SkeletonCard lines={8} />
        </div>
      </div>
    </div>
  );
}
