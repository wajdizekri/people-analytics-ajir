import "server-only";
import { headers } from "next/headers";
import { audit } from "@/lib/audit";
import { activateAccount, type ActivationResult } from "@/lib/dal/admin";
import { RATE_RULES, recordFailure, retryAfter, tooManyMessage, trustedClientIp } from "./rate-limit";
import { clientIp, hashToken } from "./session";

// Activation publique limitée par compte (empreinte du jeton = compte visé) et par IP fiable (TRUST_PROXY).
// Seuls les échecs comptent ; un refus pour limite est audité sans appeler argon2 ni la base.
export async function activateWithRateLimit(token: string, password: string): Promise<ActivationResult> {
  let h: Headers | null = null;
  try {
    h = await headers();
  } catch {
    h = null;
  }
  const trusted = h ? trustedClientIp(h) : null;
  const keys: [string, (typeof RATE_RULES)[keyof typeof RATE_RULES]][] = [[`activation:acct:${hashToken(token)}`, RATE_RULES.activationAccount]];
  if (trusted) keys.push([`activation:ip:${trusted}`, RATE_RULES.activationIp]);
  const wait = Math.max(...keys.map(([k, rule]) => retryAfter(k, rule)));
  if (wait > 0) {
    audit(null, "user.activate", { type: "activation" }, "REFUSE", { reason: "limite" }, h ? clientIp(h) : undefined);
    return { ok: false, error: tooManyMessage(wait) };
  }
  const res = await activateAccount(token, password);
  if (!res.ok) for (const [k, rule] of keys) recordFailure(k, rule);
  return res;
}
