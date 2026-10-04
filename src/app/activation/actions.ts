"use server";

import { z } from "zod";
import { activateWithRateLimit } from "@/lib/auth/activation";

export type ActivationState = { ok?: boolean; login?: string; error?: string };

const INVALID_LINK = "Ce lien d'activation est invalide, expiré ou déjà utilisé. Demandez-en un nouveau à l'administrateur de l'outil.";

const schema = z.object({
  token: z.string({ error: INVALID_LINK }).max(100, INVALID_LINK),
  password: z
    .string({ error: "Saisissez un nouveau mot de passe." })
    .min(1, "Saisissez un nouveau mot de passe.")
    .max(200, "Mot de passe trop long : 200 caractères au plus."),
  confirm: z.string({ error: "Saisissez de nouveau le mot de passe dans le champ Confirmation." }).max(200, "Confirmation trop longue : 200 caractères au plus."),
});

export async function activateAction(_: ActivationState, form: FormData): Promise<ActivationState> {
  const parsed = schema.safeParse({ token: form.get("token"), password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Le formulaire est incomplet. Remplissez les deux champs puis réessayez." };
  if (parsed.data.password !== parsed.data.confirm)
    return { error: "Les deux mots de passe saisis sont différents. Saisissez le même mot de passe dans les deux champs." };
  const res = await activateWithRateLimit(parsed.data.token, parsed.data.password);
  return res.ok ? { ok: true, login: res.login } : { error: res.error };
}
