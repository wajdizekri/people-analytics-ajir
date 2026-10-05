"use server";

import { refresh } from "next/cache";
import { getContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { updatePowerBiConfig } from "@/lib/dal/powerbi";
import { POWERBI_ROLES } from "@/lib/powerbi";

export type PowerBiConfigState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

const ROLE_REPORT: Record<string, string> = { RH: "rapport RH", MANAGER: "rapport manager", ADMIN: "rapport administrateur" };

export async function savePowerBiConfigAction(_: PowerBiConfigState, form: FormData): Promise<PowerBiConfigState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée. Reconnectez-vous." };
  const values = Object.fromEntries(POWERBI_ROLES.map((r) => [r, String(form.get(r) ?? "")]));
  try {
    const res = updatePowerBiConfig(ctx, values);
    if (!res.ok) return { error: "Liens non enregistrés : corrigez les champs signalés.", fieldErrors: res.fieldErrors, values };
    refresh();
    return { ok: res.changed.length ? `Enregistré : ${res.changed.map((r) => ROLE_REPORT[r]).join(", ")}.` : "Aucune modification." };
  } catch (err) {
    if (err instanceof HttpError) return { error: err.message };
    throw err;
  }
}
