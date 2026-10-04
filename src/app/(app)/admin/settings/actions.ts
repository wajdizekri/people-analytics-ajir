"use server";

import { refresh } from "next/cache";
import { ZodError } from "zod";
import { getContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { SETTING_KEYS, settingLabel, updateSettings, type SettingsUpdate } from "@/lib/dal/admin";
import { settingUiLabel } from "@/components/admin/settings-labels";

export type SettingsState = { ok?: string; error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> };

export async function updateSettingsAction(_: SettingsState, form: FormData): Promise<SettingsState> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée. Reconnectez-vous." };
  const raw = Object.fromEntries(SETTING_KEYS.map((k) => [k, String(form.get(k) ?? "")])) as SettingsUpdate;
  for (const k of ["smig_schedule", "budgets"] as const) {
    const v = form.get(k);
    if (typeof v === "string") raw[k] = v;
  }
  try {
    const { changed } = updateSettings(ctx, raw);
    refresh();
    return {
      ok: changed.length
        ? `Paramètres enregistrés : ${changed.map((k) => settingUiLabel(k) ?? settingLabel(k)).join(", ")}. Ils s'appliqueront au prochain calcul ou au prochain import.`
        : "Aucune modification à enregistrer : les valeurs sont identiques aux valeurs en vigueur.",
    };
  } catch (err) {
    if (err instanceof ZodError) {
      // Clé racine du champ ou du bloc (smig_schedule, budgets) : message affiché sous le champ concerné
      const fieldErrors: Record<string, string> = {};
      for (const i of err.issues) fieldErrors[String(i.path[0] ?? "")] ??= i.message;
      return { fieldErrors, values: raw as unknown as Record<string, string>, error: "Paramètres non enregistrés : certaines valeurs sont hors des bornes autorisées. Corrigez les champs signalés en rouge." };
    }
    if (err instanceof HttpError) return { error: err.message };
    throw err;
  }
}
