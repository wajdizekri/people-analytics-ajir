import { Skeleton, SkeletonChart, SkeletonHeader, SkeletonKpiRow, SkeletonTable, cardCls } from "@/components/ui";

// Squelettes fidèles de /absenteeism, /charge et /formations (loading.tsx) : en-tête, filtres éventuels, synthèse et indicateurs,
// visuels, actions proposées (cartes de recommandations), détail. Seul le conteneur est annoncé (role="status").

type Layout = "large-etroit" | "moities";

function RecoShape() {
  return (
    <div className="rounded-control border border-l-4 border-line border-l-line-strong p-3 sm:p-4">
      <Skeleton className="h-5 w-28 rounded-full" />
      <Skeleton className="mt-2 h-4 w-2/3" />
      <Skeleton className="mt-2 h-3.5 w-full" />
      <Skeleton className="mt-1.5 h-3.5 w-4/5" />
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-10 w-44" />
        <Skeleton className="h-10 w-48" />
      </div>
    </div>
  );
}

export function InsightPageSkeleton({
  label,
  actions = false,
  filters = false,
  kpis = 4,
  layout = "large-etroit",
}: {
  label: string;
  actions?: boolean;
  filters?: boolean;
  kpis?: number;
  layout?: Layout;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <SkeletonHeader actions={actions} />
        {filters && (
          <div className={`${cardCls} mb-4 flex flex-wrap gap-3 p-4`}>
            <Skeleton className="h-10 w-full sm:w-44" />
            <Skeleton className="hidden h-10 w-44 sm:block" />
            <Skeleton className="hidden h-10 w-44 sm:block" />
            <Skeleton className="h-10 w-40 sm:ml-auto" />
          </div>
        )}
        <div className={`${cardCls} border-l-4 border-l-line-strong px-4 py-3`}>
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-5 w-56 max-w-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-3 w-1/2" />
        </div>
        <SkeletonKpiRow count={kpis} className="mt-3" />
        <div className={`mt-6 grid gap-4 ${layout === "moities" ? "xl:grid-cols-2" : "xl:grid-cols-5"}`}>
          <SkeletonChart height={260} className={layout === "moities" ? "" : "xl:col-span-3"} />
          <SkeletonChart height={260} className={layout === "moities" ? "" : "xl:col-span-2"} />
        </div>
        <div className="mt-8">
          <Skeleton className="h-6 w-36" />
        </div>
        <div className={`${cardCls} mt-3 space-y-3 p-4 sm:p-5`}>
          <Skeleton className="h-4 w-48" />
          <RecoShape />
          <RecoShape />
        </div>
        <SkeletonTable rows={5} columns={5} className="mt-8" />
      </div>
    </div>
  );
}
