import { hash, verify } from "@node-rs/argon2";

// Paramètres argon2id recommandés OWASP (m=19 MiB, t=2, p=1)
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

export function passwordPolicyError(password: string): string | null {
  if (password.length < 10) return "Le mot de passe doit contenir au moins 10 caractères.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "Le mot de passe doit contenir des lettres et des chiffres.";
  return null;
}
