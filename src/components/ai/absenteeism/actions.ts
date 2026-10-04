"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/dal/context";
import { absRecoUpdateSchema, updateAbsenteeismRecommendation } from "@/lib/dal/ai-absenteeism";
import { HttpError } from "@/lib/dal/errors";
import type { RecoActionState } from "@/components/ai/workload/reco-status-form";

export type AbsRecoActionState = RecoActionState;

export async function updateAbsRecoAction(_: AbsRecoActionState, form: FormData): Promise<AbsRecoActionState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée : reconnectez-vous." };
  const id = z.coerce.number().int().positive().safeParse(form.get("id"));
  if (!id.success) return { error: "Recommandation invalide." };
  const comment = form.get("comment");
  const parsed = absRecoUpdateSchema.safeParse({ status: form.get("status"), comment: typeof comment === "string" ? comment : undefined });
  if (!parsed.success) {
    const commentIssue = parsed.error.issues.find((i) => i.path[0] === "comment");
    return commentIssue ? { commentError: commentIssue.message } : { error: "Choisissez un statut valide." };
  }
  try {
    updateAbsenteeismRecommendation(ctx, id.data, parsed.data);
  } catch (err) {
    if (err instanceof HttpError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Statut enregistré." };
}
