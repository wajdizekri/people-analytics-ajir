"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { login } from "@/lib/auth/login";
import { destroySession, readSession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { safeNextPath } from "./next-path";

export type LoginState = { error?: string };

const GENERIC = "Identifiant ou mot de passe incorrect. Vérifiez votre saisie, majuscules comprises, puis réessayez.";

const schema = z.object({
  login: z.string({ error: "Saisissez votre identifiant." }).trim().min(1, "Saisissez votre identifiant.").max(100, GENERIC),
  password: z.string({ error: "Saisissez votre mot de passe." }).min(1, "Saisissez votre mot de passe.").max(200, GENERIC),
});

export async function loginAction(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ login: form.get("login"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? GENERIC };
  const res = await login(parsed.data.login, parsed.data.password);
  if (!res.ok) return { error: res.message };
  // Retour à la page demandée : la page de connexion, désormais avec session, vérifie que le rôle y a accès
  const next = safeNextPath(form.get("next"));
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/");
}

export async function logoutAction(): Promise<void> {
  const s = await readSession();
  await destroySession();
  if (s) audit(s.userId, "auth.logout", { type: "user", id: s.userId });
  redirect("/login");
}
