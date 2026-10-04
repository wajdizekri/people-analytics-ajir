"use server";

import { refresh } from "next/cache";
import type { ZodError } from "zod";
import { getContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import {
  closePrivacyRequest,
  closeRequestSchema,
  createPrivacyRequest,
  createRequestSchema,
  liftEmployeeOpposition,
  liftOppositionSchema,
} from "@/lib/dal/privacy";

export type PrivacyActionState = { ok?: string; error?: string };

const field = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
};
const zodMessage = (e: ZodError) => e.issues[0]?.message ?? "Saisie invalide.";

function run(fn: () => string): PrivacyActionState {
  try {
    const ok = fn();
    refresh();
    return { ok };
  } catch (e) {
    if (e instanceof HttpError) return { error: e.message };
    throw e;
  }
}

export async function createRequestAction(_: PrivacyActionState, form: FormData): Promise<PrivacyActionState> {
  const parsed = createRequestSchema.safeParse({ employeeId: field(form, "employeeId"), type: field(form, "type"), note: field(form, "note") });
  if (!parsed.success) return { error: zodMessage(parsed.error) };
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée : reconnectez-vous." };
  return run(() => {
    const r = createPrivacyRequest(ctx, parsed.data);
    if (r.opposition) {
      const p = r.opposition.purged;
      return `Opposition enregistrée (demande n° ${r.id}) : le calcul du risque est suspendu pour ce collaborateur. Supprimé : ${p.predictions} estimation(s), ${p.recommendations} recommandation(s) ouverte(s), ${p.alerts} alerte(s).`;
    }
    return `Demande n° ${r.id} enregistrée. Réponse attendue sous un mois : elle apparaît dans l'historique ci-dessous.`;
  });
}

export async function closeRequestAction(_: PrivacyActionState, form: FormData): Promise<PrivacyActionState> {
  const id = Number(field(form, "requestId"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Demande introuvable : rechargez la page puis réessayez." };
  const parsed = closeRequestSchema.safeParse({ status: field(form, "status"), note: field(form, "note") });
  if (!parsed.success) return { error: zodMessage(parsed.error) };
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée : reconnectez-vous." };
  return run(() => {
    const r = closePrivacyRequest(ctx, id, parsed.data);
    return r.lifted ? "Demande refusée : l'opposition est levée, le collaborateur sera de nouveau évalué au prochain calcul." : "Demande clôturée : la réponse est enregistrée dans le registre.";
  });
}

export async function liftOppositionAction(_: PrivacyActionState, form: FormData): Promise<PrivacyActionState> {
  const id = Number(field(form, "employeeId"));
  if (!Number.isInteger(id) || id <= 0) return { error: "Collaborateur introuvable : rechargez la page puis réessayez." };
  const parsed = liftOppositionSchema.safeParse({ note: field(form, "note") ?? "" });
  if (!parsed.success) return { error: zodMessage(parsed.error) };
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée : reconnectez-vous." };
  return run(() => {
    liftEmployeeOpposition(ctx, id, parsed.data);
    return "Opposition levée : le collaborateur sera de nouveau évalué au prochain calcul.";
  });
}
