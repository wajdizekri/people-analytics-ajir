import { InsightPageSkeleton } from "@/components/ai/workload/page-skeleton";

export default function Loading() {
  return <InsightPageSkeleton label="Chargement des formations…" kpis={4} layout="moities" />;
}
