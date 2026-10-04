import { SkeletonCard, SkeletonChart, SkeletonKpiRow } from "@/components/ui";
import { BarsShape, ListShape, LoadingPage, SectionShape, TopShape } from "@/components/monitoring/loading-shapes";

// Même ordre que la page : indicateurs, indices par variable (barres) à côté des groupes de variables, puis observé et prévu
export default function Loading() {
  return (
    <LoadingPage label="Calcul de la dérive des données…">
      <TopShape sections={2} />
      <SkeletonKpiRow count={4} className="mb-8" />
      <SectionShape>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <BarsShape rows={12} className="xl:col-span-2" />
          <div className="space-y-4 xl:col-span-3">
            <ListShape rows={4} />
            <ListShape rows={2} />
            <SkeletonCard lines={1} title={false} />
          </div>
        </div>
      </SectionShape>
      <SectionShape>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SkeletonChart height={260} />
          <SkeletonChart height={260} />
        </div>
      </SectionShape>
    </LoadingPage>
  );
}
