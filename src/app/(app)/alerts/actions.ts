"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/dal/context";
import { alertUpdateSchema, updateAlert } from "@/lib/dal/alerts";
import { HttpError } from "@/lib/dal/errors";

export type AlertActionState = { ok?: boolean; error?: string; commentError?: string };

export async function updateAlertAction(_: AlertActionState, form: FormData): Promise<AlertActionState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée. Reconnectez-vous." };
  const id = z.coerce.number().int().positive().safeParse(form.get("id"));
  if (!id.success) return { error: "Alerte invalide." };
  const parsed = alertUpdateSchema.safeParse({ status: form.get("status"), comment: form.get("comment") ?? undefined });
  if (!parsed.success) {
    const commentIssue = parsed.error.issues.find((i) => i.path[0] === "comment");
    return commentIssue ? { commentError: commentIssue.message } : { error: "Choisissez un nouveau statut." };
  }
  try {
    updateAlert(ctx, id.data, parsed.data);
  } catch (err) {
    if (err instanceof HttpError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: true };
}
