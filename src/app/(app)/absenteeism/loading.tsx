import { InsightPageSkeleton } from "@/components/ai/workload/page-skeleton";

export default function Loading() {
  return <InsightPageSkeleton label="Chargement de l'absentéisme…" actions filters kpis={4} />;
}
