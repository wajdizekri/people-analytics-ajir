"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { getContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { decideRecommendation, decideSchema, feedbackSchema, setRecommendationFeedback } from "@/lib/dal/recommendations";

export type RecoActionState = { ok?: string; error?: string };

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
};
const zodMessage = (e: ZodError) => {
  const issue = e.issues[0];
  return issue?.code === "custom" ? issue.message : "Saisie invalide.";
};

async function run(fn: () => { employeeId: number }, ok: string): Promise<RecoActionState> {
  try {
    const { employeeId } = fn();
    revalidatePath(`/employees/${employeeId}`);
    revalidatePath("/recommendations");
    return { ok };
  } catch (e) {
    if (e instanceof HttpError) return { error: e.message };
    throw e;
  }
}

export async function decideRecommendationAction(_: RecoActionState, form: FormData): Promise<RecoActionState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée : reconnectez-vous." };
  const parsed = decideSchema.safeParse({
    recommendationId: field(form, "recommendationId"),
    decision: field(form, "decision"),
    date: field(form, "date"),
    comment: field(form, "comment"),
    feedback: field(form, "feedback"),
  });
  if (!parsed.success) return { error: zodMessage(parsed.error) };
  return run(
    () => decideRecommendation(ctx, parsed.data),
    parsed.data.decision === "REALISEE" ? "Recommandation réalisée : intervention enregistrée." : "Recommandation rejetée.",
  );
}

export async function feedbackRecommendationAction(_: RecoActionState, form: FormData): Promise<RecoActionState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée : reconnectez-vous." };
  const parsed = feedbackSchema.safeParse({ recommendationId: field(form, "recommendationId"), feedback: field(form, "feedback") });
  if (!parsed.success) return { error: zodMessage(parsed.error) };
  return run(() => setRecommendationFeedback(ctx, parsed.data), "Retour enregistré.");
}
