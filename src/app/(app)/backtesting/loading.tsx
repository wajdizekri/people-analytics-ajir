import { Skeleton, SkeletonCard, SkeletonChart, SkeletonKpiRow, SkeletonTable, cardCls } from "@/components/ui";
import { LoadingPage, TopShape } from "@/components/monitoring/loading-shapes";

// Même ordre que la page : choix de la date, résultat, 5 indicateurs, 3 visuels (2 + 1 pleine largeur), tableau, liste
export default function Loading() {
  return (
    <LoadingPage label="Chargement de la vérification a posteriori…">
      <TopShape summary={false} sections={0} />
      <div className={`${cardCls} mb-4 p-4`}>
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-2 h-3.5 w-full max-w-xl" />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-10 w-48" />
        </div>
      </div>
      <SkeletonCard lines={3} className="mb-4 border-l-4" />
      <SkeletonKpiRow count={5} className="mb-4" />
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonChart height={260} />
        <SkeletonChart height={260} />
        <SkeletonChart height={240} className="lg:col-span-2" />
      </div>
      <SkeletonTable rows={4} columns={7} className="mb-6" />
      <SkeletonTable rows={6} columns={6} />
    </LoadingPage>
  );
}
