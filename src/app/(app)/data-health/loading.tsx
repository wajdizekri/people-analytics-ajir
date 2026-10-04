import { SkeletonChart, SkeletonKpiRow, SkeletonTable } from "@/components/ui";
import { BarsShape, LoadingPage, SectionShape, TopShape } from "@/components/monitoring/loading-shapes";

// Même ordre que la page : indicateurs, contrôles de l'import (Pareto puis tableau), historique, tendances
export default function Loading() {
  return (
    <LoadingPage label="Chargement de la santé des données…">
      <TopShape action sections={4} />
      <SkeletonKpiRow count={5} className="mb-8" />
      <SectionShape>
        <BarsShape rows={6} />
        <SkeletonTable rows={5} columns={5} title={false} className="mt-4" />
      </SectionShape>
      <SectionShape intro={false}>
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
          <SkeletonTable rows={4} columns={6} className="2xl:col-span-3" />
          <SkeletonTable rows={4} columns={4} className="2xl:col-span-2" />
        </div>
      </SectionShape>
      <SectionShape>
        <div className="space-y-4">
          <SkeletonChart height={160} />
          <SkeletonChart height={160} />
        </div>
      </SectionShape>
    </LoadingPage>
  );
}
