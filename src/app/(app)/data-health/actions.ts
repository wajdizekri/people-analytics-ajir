"use server";

import { refresh } from "next/cache";
import { getContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { requestRecompute } from "@/lib/dal/imports";

export type RecomputeState = { ok?: string; error?: string };

export async function recomputeAction(): Promise<RecomputeState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée. Reconnectez-vous." };
  try {
    const res = requestRecompute(ctx);
    refresh();
    return {
      ok: res.alreadyQueued
        ? `Calcul mensuel déjà en attente ou en cours (traitement n° ${res.jobId}) : inutile de le relancer.`
        : `Calcul mensuel relancé (traitement n° ${res.jobId}).`,
    };
  } catch (err) {
    if (err instanceof HttpError) return { error: err.message };
    throw err;
  }
}
