import { SkeletonCard, SkeletonChart, SkeletonTable } from "@/components/ui";
import { LoadingPage, SectionShape, TopShape } from "@/components/monitoring/loading-shapes";

// Même ordre que la page : comment il décide (facteurs, fiche et familles, niveaux), fiabilité, équité, suivi mensuel
export default function Loading() {
  return (
    <LoadingPage label="Chargement de la fiche du modèle…">
      <TopShape sections={5} />
      <SectionShape>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <div className="space-y-4 xl:order-2 xl:col-span-2">
            <SkeletonCard lines={5} />
            <SkeletonChart height={236} />
          </div>
          <SkeletonChart height={372} className="xl:order-1 xl:col-span-3" />
        </div>
        <SkeletonCard lines={4} className="mt-4" />
      </SectionShape>
      <SectionShape>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SkeletonCard lines={6} />
          <SkeletonCard lines={6} />
          <SkeletonCard lines={6} />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-5">
          <SkeletonCard lines={6} className="xl:col-span-2" />
          <SkeletonChart height={320} className="xl:col-span-3" />
        </div>
      </SectionShape>
      <SectionShape>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <SkeletonTable rows={3} columns={5} />
          <SkeletonTable rows={3} columns={5} />
        </div>
      </SectionShape>
      <SectionShape>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SkeletonChart height={260} />
          <SkeletonChart height={260} />
          <SkeletonChart height={260} />
        </div>
      </SectionShape>
    </LoadingPage>
  );
}
