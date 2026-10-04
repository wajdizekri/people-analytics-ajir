import { Skeleton, SkeletonChart, SkeletonTable, cardCls } from "@/components/ui";
import { LoadingPage } from "@/components/monitoring/loading-shapes";

// Même ordre et mêmes grilles que la console : en-tête, points d'attention, tâches, état de l'outil, sécurité des accès, visuels

function SectionTitle({ description = true }: { description?: boolean }) {
  return (
    <div className="mb-3">
      <Skeleton className="h-6 w-48" />
      {description && <Skeleton className="mt-1.5 h-4 w-full max-w-md" />}
    </div>
  );
}

function Tile({ spark = false }: { spark?: boolean }) {
  return (
    <div className={`${cardCls} p-4`}>
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="mt-2.5 h-8 w-1/3" />
      <Skeleton className="mt-2 h-3 w-4/5" />
      {spark && <Skeleton className="mt-3 h-9 w-full" />}
      <Skeleton className="mt-3 h-3.5 w-2/5" />
    </div>
  );
}

export default function Loading() {
  return (
    <LoadingPage label="Chargement de la console d'administration…">
      <div className="mb-6 border-l-4 border-line pl-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-2 h-7 w-72 max-w-full" />
        <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
        <Skeleton className="mt-2 h-3 w-64 max-w-full" />
      </div>
      <Skeleton className="mb-6 h-20 w-full" />
      <div className="mb-6">
        <SectionTitle description={false} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className={`${cardCls} flex min-h-20 items-center gap-3 p-4`}>
              <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-6">
        <SectionTitle />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Tile key={i} />
          ))}
        </div>
      </div>
      <div className="mb-6">
        <SectionTitle />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Tile key={i} spark />
          ))}
        </div>
      </div>
      <SectionTitle />
      <div className="grid gap-3 xl:grid-cols-2">
        <SkeletonChart className="xl:col-span-2" height={280} />
        <SkeletonChart height={200} />
        <SkeletonChart height={200} />
        <SkeletonTable className="xl:col-span-2" rows={6} columns={3} />
      </div>
    </LoadingPage>
  );
}
