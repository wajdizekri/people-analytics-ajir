"use server";

import { requireContext } from "@/lib/dal/context";
import { changeOwnPassword } from "@/lib/dal/account";

export type PasswordState = { ok?: boolean; revoked?: number; error?: string };

export async function changePasswordAction(_: PasswordState, form: FormData): Promise<PasswordState> {
  const ctx = await requireContext();
  const str = (k: string) => (typeof form.get(k) === "string" ? (form.get(k) as string) : "");
  const res = await changeOwnPassword(ctx, { current: str("current"), password: str("password"), confirm: str("confirm") });
  return res.ok ? { ok: true, revoked: res.revoked } : { error: res.error };
}
