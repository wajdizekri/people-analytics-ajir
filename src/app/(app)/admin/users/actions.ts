"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { z, ZodError } from "zod";
import { getContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { createActivationToken, createUser, createUserSchema, setUserActive, unlockUser } from "@/lib/dal/admin";

export type ActivationLink = { url: string; login: string; expiresAt: string };
export type CreateUserState = {
  ok?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
  values?: Record<string, string>;
  link?: ActivationLink;
};
export type UserActionState = { ok?: string; error?: string; link?: ActivationLink };

const idSchema = z.coerce.number().int().positive();

// Refus métier rattachés à un champ : message sous le champ, saisie conservée
const FIELD_OF_CODE: Record<string, string> = { LOGIN_EXISTANT: "login", MATRICULE_INCONNU: "matricule", SALARIE_SORTI: "matricule" };

async function activationUrl(token: string): Promise<string> {
  const configured = process.env.APP_URL?.replace(/\/+$/, "");
  if (configured) return `${configured}/activation?token=${token}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "production" ? "https" : "http");
  return `${proto}://${host}/activation?token=${token}`;
}

async function withAdmin<T extends { error?: string }>(fn: (ctx: NonNullable<Awaited<ReturnType<typeof getContext>>>) => Promise<T>): Promise<T> {
  const ctx = await getContext();
  if (!ctx) return { error: "Session expirée. Reconnectez-vous." } as T;
  try {
    return await fn(ctx);
  } catch (err) {
    if (err instanceof HttpError) return { error: err.message } as T;
    if (err instanceof ZodError) return { error: "Action impossible : rechargez la page puis réessayez." } as T;
    throw err;
  }
}

export async function createUserAction(_: CreateUserState, form: FormData): Promise<CreateUserState> {
  return withAdmin<CreateUserState>(async (ctx) => {
    const values = Object.fromEntries(["login", "role", "matricule", "email"].map((k) => [k, String(form.get(k) ?? "")]));
    const parsed = createUserSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const i of parsed.error.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
      return { fieldErrors, values };
    }
    let user: ReturnType<typeof createUser>;
    try {
      user = createUser(ctx, parsed.data);
    } catch (err) {
      if (err instanceof HttpError && FIELD_OF_CODE[err.code]) return { fieldErrors: { [FIELD_OF_CODE[err.code]]: err.message }, values };
      throw err;
    }
    const t = createActivationToken(ctx, user.id);
    refresh();
    return {
      ok: `Compte ${user.login} créé.`,
      link: { url: await activationUrl(t.token), login: t.login, expiresAt: t.expiresAt },
    };
  });
}

export async function setActiveAction(_: UserActionState, form: FormData): Promise<UserActionState> {
  return withAdmin<UserActionState>(async (ctx) => {
    const id = idSchema.parse(form.get("id"));
    const active = form.get("active") === "1";
    const user = setUserActive(ctx, id, active);
    refresh();
    return {
      ok: active
        ? `Compte ${user.login} réactivé : ${user.hasPassword ? "il peut de nouveau se connecter." : "générez un lien d'activation pour qu'il définisse son mot de passe."}`
        : `Compte ${user.login} désactivé : ses sessions ont été fermées.`,
    };
  });
}

export async function unlockAction(_: UserActionState, form: FormData): Promise<UserActionState> {
  return withAdmin<UserActionState>(async (ctx) => {
    const user = unlockUser(ctx, idSchema.parse(form.get("id")));
    refresh();
    return { ok: `Compte ${user.login} déverrouillé : il peut se reconnecter.` };
  });
}

export async function activationLinkAction(_: UserActionState, form: FormData): Promise<UserActionState> {
  return withAdmin<UserActionState>(async (ctx) => {
    const t = createActivationToken(ctx, idSchema.parse(form.get("id")));
    refresh();
    return { link: { url: await activationUrl(t.token), login: t.login, expiresAt: t.expiresAt } };
  });
}
