"use client";

import { RecoBoard, type RecoItem } from "@/components/ai/workload/reco-status-form";
import { updateAbsRecoAction } from "./actions";

// Recommandations collectives d'absentéisme : le motif d'un rejet est facultatif (règle de la DAL) ; le manager ne peut que « Marquer comme réalisée ».
export function AbsRecoBoard({ items, emptyTitle, emptyText }: { items: RecoItem[]; emptyTitle: string; emptyText?: string }) {
  return <RecoBoard items={items} action={updateAbsRecoAction} rejectNeedsComment={false} emptyTitle={emptyTitle} emptyText={emptyText} />;
}
