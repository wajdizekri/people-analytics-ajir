"use client";

import { RecoBoard, type RecoAction, type RecoItem } from "@/components/ai/workload/reco-status-form";

export type { RecoActionState } from "@/components/ai/workload/reco-status-form";

// Relances de formations obligatoires : motif obligatoire pour rejeter (règle de la DAL).
export function TrainingRecoBoard({ items, action, emptyTitle, emptyText }: { items: RecoItem[]; action: RecoAction; emptyTitle: string; emptyText?: string }) {
  return <RecoBoard items={items} action={action} rejectNeedsComment emptyTitle={emptyTitle} emptyText={emptyText} />;
}
