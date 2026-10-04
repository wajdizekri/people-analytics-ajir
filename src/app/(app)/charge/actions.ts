"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { RecoActionState } from "@/components/ai/workload/reco-status-form";
import { getContext } from "@/lib/dal/context";
import { updateWorkloadRecommendation, workloadRecoUpdateSchema } from "@/lib/dal/ai-workload";
import { HttpError } from "@/lib/dal/errors";

export async function updateWorkloadRecoAction(_: RecoActionState, form: FormData): Promise<RecoActionState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée. Reconnectez-vous." };
  const id = z.coerce.number().int().positive().safeParse(form.get("id"));
  if (!id.success) return { error: "Recommandation invalide." };
  const parsed = workloadRecoUpdateSchema.safeParse({ status: form.get("status"), comment: form.get("comment") ?? undefined });
  if (!parsed.success) {
    const commentIssue = parsed.error.issues.find((i) => i.path[0] === "comment");
    return commentIssue ? { commentError: commentIssue.message } : { error: "Choisissez un statut valide." };
  }
  try {
    updateWorkloadRecommendation(ctx, id.data, { status: parsed.data.status, comment: parsed.data.comment });
  } catch (err) {
    if (err instanceof HttpError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Statut enregistré." };
}
