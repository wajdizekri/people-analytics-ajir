// Boîte grise HTTP : utilitaires partagés par les tests de sécurité.
// Cible : serveur de production isolé sur http://127.0.0.1:3300 (NEXT_DIST_DIR=.next-sec, DATABASE_PATH=data/sec.db).
// Aucune écriture dans app.db : seules des sessions/comptes de test sont écrits dans sec.db.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export const BASE = process.env.SEC_BASE_URL || "http://127.0.0.1:3300";
export const DB_FILE = process.env.DATABASE_PATH || path.resolve(process.cwd(), "data/sec.db");

export type Fixtures = {
  scopeRoot: number;
  runId: number;
  maxEmp: number;
  inScope: number[];
  inScopeCount: number;
  outScope: number[];
  inScopeScored: number | null;
  scoredOut: number | null;
  anyAlert: number | null;
  maxAlert: number;
  imp: number;
  reco: { id: number; employee_id: number; status: string } | null;
  recoOut: number | null;
  users: { id: number; login: string; role: string }[];
  depts: number[];
  sensitiveNumbers: number[];
  phrases: string[];
  outNames: { last_name: string; first_name: string }[];
  inNames: { last_name: string; first_name: string }[];
};

export function loadFixtures(): Fixtures {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "tests/security/.fixtures.json"), "utf8"));
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function db(): Database.Database {
  const d = new Database(DB_FILE);
  d.pragma("busy_timeout = 5000");
  return d;
}

// Crée une session de test directement dans sec.db (format de src/lib/auth/session.ts) et renvoie le jeton du cookie.
export function makeSession(userId: number, hours = 10): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + hours * 3600_000).toISOString();
  const d = db();
  d.prepare("INSERT INTO session (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)").run(
    sha256(token),
    userId,
    expiresAt,
    "sectest",
    "sectest",
  );
  d.close();
  return token;
}

export function deleteSession(token: string): void {
  const d = db();
  d.prepare("DELETE FROM session WHERE id = ?").run(sha256(token));
  d.close();
}

export function userId(login: string): number {
  const d = db();
  const r = d.prepare("SELECT id FROM app_user WHERE login = ?").get(login) as { id: number } | undefined;
  d.close();
  if (!r) throw new Error(`user ${login} introuvable dans sec.db`);
  return r.id;
}

export function rawDb() {
  return db();
}

export type Resp = {
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
  setCookies: string[];
};

export async function req(
  method: string,
  urlPath: string,
  opts: { token?: string; headers?: Record<string, string>; body?: BodyInit; origin?: string } = {},
): Promise<Resp> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers["Cookie"] = `pa_session=${opts.token}`;
  if (opts.origin) headers["Origin"] = opts.origin;
  const res = await fetch(`${BASE}${urlPath}`, { method, headers, body: opts.body, redirect: "manual" });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { status: res.status, headers: res.headers, text, json, setCookies };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Rejoue un formulaire Server Action (progressive enhancement, sans JS) : GET la page, extrait les champs cachés, POST en multipart.
export async function submitForm(
  pagePath: string,
  fields: Record<string, string>,
  cookie?: string,
  opts: { formLabel?: string; origin?: string } = {},
): Promise<{ status: number; location: string | null; setCookies: string[]; text: string }> {
  const getHeaders: Record<string, string> = {};
  if (cookie) getHeaders["Cookie"] = `pa_session=${cookie}`;
  const page = await fetch(`${BASE}${pagePath}`, { headers: getHeaders });
  let html = await page.text();
  if (opts.formLabel) {
    const forms = [...html.matchAll(/<form[\s\S]*?<\/form>/g)].map((m) => m[0]);
    const f = forms.find((x) => x.includes(opts.formLabel!));
    if (f) html = f;
  }
  const inputs = [...html.matchAll(/<(?:input|button)[^>]*>/g)].map((m) => m[0]);
  const form: Record<string, string> = {};
  for (const t of inputs) {
    const name = (t.match(/name="([^"]*)"/) || [])[1];
    if (!name || !name.startsWith("$ACTION")) continue;
    const value = (t.match(/value="([^"]*)"/) || [])[1] ?? "";
    form[name] = decodeEntities(value);
  }
  for (const [k, v] of Object.entries(fields)) form[k] = v;
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  const postHeaders: Record<string, string> = {};
  if (cookie) postHeaders["Cookie"] = `pa_session=${cookie}`;
  if (opts.origin) postHeaders["Origin"] = opts.origin;
  const res = await fetch(`${BASE}${pagePath}`, { method: "POST", body: fd, headers: postHeaders, redirect: "manual" });
  const text = await res.text();
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { status: res.status, location: res.headers.get("location"), setCookies, text };
}

export async function logoutViaPage(pagePath: string, cookie: string) {
  return submitForm(pagePath, {}, cookie, { formLabel: "Déconnexion" });
}

export async function login(loginName: string, password: string) {
  return submitForm("/login", { login: loginName, password });
}

// Extrait le jeton pa_session d'un en-tête Set-Cookie.
export function cookieToken(setCookies: string[]): string | null {
  for (const c of setCookies) {
    const m = c.match(/^pa_session=([^;]+)/);
    if (m && m[1] && m[1].length > 5) return m[1];
  }
  return null;
}

// ---------- Détection de fuites ----------

const FORBIDDEN_KEY =
  /salar|payroll|gross|compensation|masse|\bmass\b|probab|prob6|\blift\b|contribution|phrase_?rh|modelVersion|modelKind|healthDays|payroll_mass|avgLift/i;

export function fullNames(list: { last_name: string; first_name: string }[]): string[] {
  const out = new Set<string>();
  for (const n of list) {
    const l = (n.last_name || "").trim();
    const f = (n.first_name || "").trim();
    if (l && f) {
      out.add(`${f} ${l}`);
      out.add(`${l} ${f}`);
    }
  }
  return [...out];
}

// Parcours récursif : clés interdites, valeurs numériques sensibles (salaires/prob/lift/masse), phrases RH, noms hors périmètre, mention TND.
export function scanLeaks(
  value: unknown,
  sensitiveNumbers: number[],
  sensitiveStrings: string[],
  at = "$",
  out: string[] = [],
): string[] {
  const isSensitiveNumber = (n: number) => sensitiveNumbers.some((s) => Math.abs(s - n) < 1e-6);
  if (typeof value === "number") {
    if (isSensitiveNumber(value)) out.push(`${at} = ${value} (valeur sensible)`);
  } else if (typeof value === "string") {
    if (value.trim() !== "" && !Number.isNaN(Number(value)) && isSensitiveNumber(Number(value))) out.push(`${at} = "${value}" (nombre sensible)`);
    if (/\bTND\b/.test(value)) out.push(`${at} contient "TND"`);
    for (const s of sensitiveStrings) if (s && value.includes(s)) out.push(`${at} contient une chaîne interdite: ${JSON.stringify(s.slice(0, 40))}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => scanLeaks(v, sensitiveNumbers, sensitiveStrings, `${at}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      // Une clé interdite n'est une fuite que si sa valeur peut porter une donnée (nombre/chaîne/objet), pas un simple drapeau booléen de permission.
      if (FORBIDDEN_KEY.test(k) && typeof v !== "boolean" && v !== null) out.push(`${at}.${k} (clé interdite)`);
      scanLeaks(v, sensitiveNumbers, sensitiveStrings, `${at}.${k}`, out);
    }
  }
  return out;
}
