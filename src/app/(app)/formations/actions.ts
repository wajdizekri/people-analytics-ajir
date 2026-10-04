"use server";

import { refresh } from "next/cache";
import { getContext } from "@/lib/dal/context";
import { trainingRecoUpdateSchema, updateTrainingRecommendation } from "@/lib/dal/ai-training";
import { HttpError } from "@/lib/dal/errors";
import type { RecoActionState } from "@/components/ai/workload/reco-status-form";

export type TrainingRecoActionState = RecoActionState;

export async function updateTrainingRecoAction(_: TrainingRecoActionState, form: FormData): Promise<TrainingRecoActionState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée. Reconnectez-vous." };
  const parsed = trainingRecoUpdateSchema.safeParse({
    id: form.get("id"),
    status: form.get("status"),
    comment: (form.get("comment") as string | null) || undefined,
  });
  if (!parsed.success) {
    const commentIssue = parsed.error.issues.find((i) => i.path[0] === "comment");
    return commentIssue ? { commentError: commentIssue.message } : { error: "Choisissez un statut valide." };
  }
  try {
    updateTrainingRecommendation(ctx, parsed.data);
  } catch (err) {
    if (err instanceof HttpError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Statut enregistré." };
}
