import { InsightPageSkeleton } from "@/components/ai/workload/page-skeleton";

export default function Loading() {
  return <InsightPageSkeleton label="Chargement de la charge de travail…" kpis={4} />;
}
