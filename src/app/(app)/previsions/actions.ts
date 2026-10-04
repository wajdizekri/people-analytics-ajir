"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { WorkforceRecoState } from "@/components/ai/workforce/reco-status-form";
import { updateWorkforceRecommendation, workforceRecoUpdateSchema } from "@/lib/dal/ai-workforce";
import { getContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";

export async function updateWorkforceRecoAction(_: WorkforceRecoState, form: FormData): Promise<WorkforceRecoState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée. Reconnectez-vous." };
  const id = z.coerce.number().int().positive().safeParse(form.get("id"));
  if (!id.success) return { error: "Recommandation invalide." };
  const parsed = workforceRecoUpdateSchema.safeParse({ status: form.get("status"), comment: form.get("comment") ?? undefined });
  if (!parsed.success) {
    const commentIssue = parsed.error.issues.find((i) => i.path[0] === "comment");
    return commentIssue ? { commentError: commentIssue.message } : { error: "Statut invalide." };
  }
  try {
    updateWorkforceRecommendation(ctx, id.data, parsed.data);
  } catch (err) {
    if (err instanceof HttpError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: true };
}
