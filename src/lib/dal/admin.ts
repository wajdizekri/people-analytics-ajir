import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { getDb } from "@/db/client";
import { ROLES, type Role } from "@/db/schema";
import { audit, type AuditTarget } from "@/lib/audit";
import { hashPassword, passwordPolicyError } from "@/lib/auth/password";
import { hashToken, revokeUserSessions } from "@/lib/auth/session";
import { getSetting, setSetting } from "@/lib/settings";
import type { AccessContext } from "./context";
import { HttpError, forbidden, notFound } from "./errors";

export function ensureRole(ctx: AccessContext, roles: Role[], action: string, target?: AuditTarget): void {
  if (roles.includes(ctx.role)) return;
  audit(ctx.userId, action, target, "REFUSE", { role: ctx.role });
  throw forbidden();
}

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

// ---------- Utilisateurs ----------

export type UserDTO = {
  id: number;
  login: string;
  role: Role;
  email: string | null;
  active: boolean;
  hasPassword: boolean;
  lockedUntil: string | null;
  failedAttempts: number;
  activationExpiresAt: string | null;
  employee: { id: number; matricule: string; name: string } | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export const createUserSchema = z
  .object({
    login: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9._-]{2,49}$/, "Identifiant : 3 à 50 caractères (lettres, chiffres, . _ -)."),
    role: z.enum(ROLES, { error: "Rôle invalide." }),
    matricule: z.preprocess(emptyToUndefined, z.string().trim().max(50, "Matricule trop long : 50 caractères au plus.").optional()),
    email: z.preprocess(emptyToUndefined, z.email("Adresse e-mail invalide : vérifiez la saisie (exemple : prenom.nom@entreprise.tn).").max(200, "Adresse e-mail trop longue : 200 caractères au plus.").optional()),
  })
  .refine((v) => v.role !== "MANAGER" || !!v.matricule, {
    message: "Un compte manager doit être lié à un collaborateur : renseignez son matricule.",
    path: ["matricule"],
  });
export type CreateUserInput = z.input<typeof createUserSchema>;

type UserRow = {
  id: number;
  login: string;
  role: Role;
  email: string | null;
  active: number;
  has_password: number;
  locked_until: string | null;
  failed_attempts: number;
  activation_expires_at: string | null;
  employee_id: number | null;
  matricule: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  last_login_at: string | null;
};

const USER_SELECT = `
  SELECT u.id, u.login, u.role, u.email, u.active, (u.password_hash IS NOT NULL) AS has_password,
         u.locked_until, u.failed_attempts, u.activation_expires_at, u.employee_id, u.created_at,
         e.matricule, e.first_name, e.last_name,
         (SELECT MAX(l.at) FROM audit_log l WHERE l.user_id = u.id AND l.action = 'auth.login' AND l.outcome = 'OK') AS last_login_at
  FROM app_user u LEFT JOIN employee e ON e.id = u.employee_id`;

function toUserDTO(r: UserRow): UserDTO {
  const now = new Date().toISOString();
  return {
    id: r.id,
    login: r.login,
    role: r.role,
    email: r.email,
    active: !!r.active,
    hasPassword: !!r.has_password,
    lockedUntil: r.locked_until && r.locked_until > now ? r.locked_until : null,
    failedAttempts: r.failed_attempts,
    activationExpiresAt: r.activation_expires_at && r.activation_expires_at > now ? r.activation_expires_at : null,
    employee:
      r.employee_id != null && r.matricule
        ? { id: r.employee_id, matricule: r.matricule, name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() }
        : null,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  };
}

export function listUsers(ctx: AccessContext): UserDTO[] {
  ensureRole(ctx, ["ADMIN"], "user.list");
  const rows = getDb().sqlite.prepare(`${USER_SELECT} ORDER BY u.active DESC, u.role, u.login`).all() as UserRow[];
  return rows.map(toUserDTO);
}

function loadUser(id: number): UserRow {
  const row = getDb().sqlite.prepare(`${USER_SELECT} WHERE u.id = ?`).get(id) as UserRow | undefined;
  if (!row) throw notFound("Utilisateur");
  return row;
}

export function createUser(ctx: AccessContext, input: CreateUserInput): UserDTO {
  ensureRole(ctx, ["ADMIN"], "user.create");
  const data = createUserSchema.parse(input);
  const { sqlite } = getDb();
  if (sqlite.prepare("SELECT 1 FROM app_user WHERE login = ?").get(data.login)) {
    throw new HttpError(409, "LOGIN_EXISTANT", "Cet identifiant est déjà utilisé. Choisissez-en un autre.");
  }
  let employeeId: number | null = null;
  if (data.matricule) {
    const emp = sqlite.prepare("SELECT id, status FROM employee WHERE matricule = ?").get(data.matricule) as
      | { id: number; status: string }
      | undefined;
    if (!emp) throw new HttpError(422, "MATRICULE_INCONNU", "Aucun collaborateur ne porte ce matricule dans le dernier import AJIR. Vérifiez la saisie.");
    if (data.role === "MANAGER" && emp.status !== "ACTIF") {
      throw new HttpError(422, "SALARIE_SORTI", "Ce collaborateur a quitté l'entreprise : un compte manager doit être lié à un collaborateur en poste.");
    }
    employeeId = emp.id;
  }
  const res = sqlite
    .prepare("INSERT INTO app_user (login, role, employee_id, email, active) VALUES (?, ?, ?, ?, 1)")
    .run(data.login, data.role, employeeId, data.email ?? null);
  const id = Number(res.lastInsertRowid);
  audit(ctx.userId, "user.create", { type: "user", id }, "OK", { login: data.login, role: data.role, employeeId });
  return toUserDTO(loadUser(id));
}

export function setUserActive(ctx: AccessContext, id: number, active: boolean): UserDTO {
  const action = active ? "user.reactivate" : "user.deactivate";
  ensureRole(ctx, ["ADMIN"], action, { type: "user", id });
  const user = loadUser(id);
  const { sqlite } = getDb();
  if (!active) {
    if (id === ctx.userId) throw new HttpError(409, "AUTO_DESACTIVATION", "Vous ne pouvez pas désactiver votre propre compte.");
    if (user.role === "ADMIN" && user.active) {
      const others = sqlite.prepare("SELECT COUNT(*) AS n FROM app_user WHERE role = 'ADMIN' AND active = 1 AND id <> ?").get(id) as { n: number };
      if (others.n === 0) throw new HttpError(409, "DERNIER_ADMIN", "Impossible de désactiver le dernier administrateur actif.");
    }
  }
  sqlite.transaction(() => {
    if (active) sqlite.prepare("UPDATE app_user SET active = 1 WHERE id = ?").run(id);
    else {
      sqlite.prepare("UPDATE app_user SET active = 0, activation_token_hash = NULL, activation_expires_at = NULL WHERE id = ?").run(id);
      revokeUserSessions(id);
    }
  })();
  audit(ctx.userId, action, { type: "user", id }, "OK", { login: user.login });
  return toUserDTO(loadUser(id));
}

export function unlockUser(ctx: AccessContext, id: number): UserDTO {
  ensureRole(ctx, ["ADMIN"], "user.unlock", { type: "user", id });
  const user = loadUser(id);
  getDb().sqlite.prepare("UPDATE app_user SET failed_attempts = 0, locked_until = NULL WHERE id = ?").run(id);
  audit(ctx.userId, "user.unlock", { type: "user", id }, "OK", { login: user.login });
  return toUserDTO(loadUser(id));
}

export const ACTIVATION_DAYS = 7;

// Le jeton n'est renvoyé qu'ici, une seule fois ; seule son empreinte SHA-256 est stockée.
export function createActivationToken(ctx: AccessContext, id: number): { token: string; expiresAt: string; login: string } {
  ensureRole(ctx, ["ADMIN"], "user.activation_link", { type: "user", id });
  const user = loadUser(id);
  if (!user.active) throw new HttpError(409, "COMPTE_INACTIF", "Réactivez le compte avant de générer un lien.");
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ACTIVATION_DAYS * 86_400_000).toISOString();
  getDb()
    .sqlite.prepare("UPDATE app_user SET activation_token_hash = ?, activation_expires_at = ? WHERE id = ?")
    .run(hashToken(token), expiresAt, id);
  audit(ctx.userId, "user.activation_link", { type: "user", id }, "OK", { login: user.login, expiresAt });
  return { token, expiresAt, login: user.login };
}

// ---------- Activation (page publique, sans session) ----------

export const activationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export function checkActivationToken(token: string): { login: string } | null {
  if (!activationTokenSchema.safeParse(token).success) return null;
  const row = getDb()
    .sqlite.prepare("SELECT login FROM app_user WHERE activation_token_hash = ? AND activation_expires_at > ? AND active = 1")
    .get(hashToken(token), new Date().toISOString()) as { login: string } | undefined;
  return row ?? null;
}

export type ActivationResult = { ok: true; login: string } | { ok: false; error: string };

export async function activateAccount(token: string, password: string): Promise<ActivationResult> {
  const invalid = "Ce lien d'activation est invalide, expiré ou déjà utilisé. Demandez-en un nouveau à l'administrateur.";
  if (!activationTokenSchema.safeParse(token).success || !checkActivationToken(token)) {
    audit(null, "user.activate", { type: "activation" }, "REFUSE", { reason: "jeton_invalide" });
    return { ok: false, error: invalid };
  }
  const policy = passwordPolicyError(password);
  if (policy) return { ok: false, error: policy };
  const passwordHash = await hashPassword(password);
  const { sqlite } = getDb();
  // Consommation atomique : un seul appel peut réussir pour un jeton donné.
  const row = sqlite
    .prepare(
      `UPDATE app_user SET password_hash = @hash, activation_token_hash = NULL, activation_expires_at = NULL,
         failed_attempts = 0, locked_until = NULL
       WHERE activation_token_hash = @th AND activation_expires_at > @now AND active = 1
       RETURNING id, login`,
    )
    .get({ hash: passwordHash, th: hashToken(token), now: new Date().toISOString() }) as { id: number; login: string } | undefined;
  if (!row) {
    audit(null, "user.activate", { type: "activation" }, "REFUSE", { reason: "jeton_consomme" });
    return { ok: false, error: invalid };
  }
  revokeUserSessions(row.id);
  audit(row.id, "user.activate", { type: "user", id: row.id }, "OK");
  return { ok: true, login: row.login };
}

// ---------- Paramètres ----------

type SettingSpec = { label: string; help: string; min: number; max: number; step: number; int?: boolean; unit?: string };

export const SETTINGS_SPEC = {
  capacity_rate: {
    label: "Capacité mensuelle (part classée « Élevé »)",
    help: "Part des collaborateurs évalués classée au niveau Élevé chaque mois, selon la capacité d'entretiens RH. Exemple : 0,02 = 2 %.",
    min: 0.005,
    max: 0.2,
    step: 0.001,
  },
  medium_lift: {
    label: "Seuil du niveau « Moyen » (multiple du risque moyen)",
    help: "Un collaborateur hors du niveau Élevé est classé Moyen si son estimation atteint au moins ce multiple de la moyenne (lift).",
    min: 1,
    max: 10,
    step: 0.1,
  },
  min_events_for_model: {
    label: "Départs observés avant d'utiliser le modèle statistique",
    help: "Sous ce nombre de démissions ou abandons de poste observés, le calcul utilise le score à règles au lieu du modèle statistique. 0 désactive cette règle.",
    min: 0,
    max: 5000,
    step: 1,
    int: true,
    unit: "départs",
  },
  indicative_until_events: {
    label: "Départs observés avant une probabilité fiable",
    help: "Sous ce nombre de départs observés, la probabilité est présentée comme « indicative » (calibration encore instable). Au moins égal au seuil précédent.",
    min: 0,
    max: 100000,
    step: 1,
    int: true,
    unit: "départs",
  },
  quality_threshold: {
    label: "Seuil de qualité des imports",
    help: "Sous ce score qualité, l'import est bloqué et le calcul des risques suspendu.",
    min: 0.5,
    max: 1,
    step: 0.01,
  },
  smig_monthly: {
    label: "SMIG mensuel de repli (TND)",
    help: "Valeur du contrôle « salaire de base ≥ SMIG » utilisée seulement si le barème daté est absent ou invalide.",
    min: 100,
    max: 5000,
    step: 0.001,
    unit: "TND",
  },
  bradford_threshold: {
    label: "Seuil du facteur de Bradford",
    help: "Facteur de Bradford (nombre d'absences au carré × jours d'absence, hors santé, sur 12 mois) au-delà duquel un signal individuel « à vérifier » est adressé à la RH.",
    min: 10,
    max: 5000,
    step: 1,
    int: true,
  },
  abs_reco_seuil_niveau: {
    label: "Absentéisme prévu nettement supérieur à l'entreprise",
    help: "Une équipe ou un département est signalé si son absentéisme prévu dépasse le taux de l'entreprise sur 12 mois d'au moins cette part. Exemple : 0,5 = 50 % au-dessus.",
    min: 0,
    max: 5,
    step: 0.05,
  },
  abs_reco_seuil_hausse: {
    label: "Hausse d'absentéisme prévue",
    help: "Signalement si la prévision moyenne des 3 prochains mois dépasse le taux de l'unité sur 12 mois d'au moins cette part. Exemple : 0,25 = 25 % au-dessus.",
    min: 0,
    max: 5,
    step: 0.05,
  },
  abs_reco_ecart_min: {
    label: "Écart minimal de taux d'absence",
    help: "Écart minimal, en taux, pour proposer une action : évite les signaux dus aux petites équipes. Exemple : 0,002 = 0,2 point.",
    min: 0,
    max: 0.05,
    step: 0.0005,
  },
  abs_reco_anomalies_min: {
    label: "Anomalies collectives répétées",
    help: "Nombre d'anomalies collectives sur les 3 derniers mois à partir duquel une action de prévention est proposée.",
    min: 1,
    max: 12,
    step: 1,
    int: true,
    unit: "anomalies",
  },
  workload_ot_threshold_h: {
    label: "Seuil de surcharge individuelle",
    help: "Heures supplémentaires pointées dans le mois au-delà desquelles le mois compte comme surchargé.",
    min: 1,
    max: 200,
    step: 0.5,
    unit: "h / mois",
  },
  workload_ot_months: {
    label: "Durée d'une surcharge soutenue",
    help: "Nombre de mois consécutifs au-delà du seuil pour signaler une surcharge soutenue (entretien à prévoir).",
    min: 1,
    max: 12,
    step: 1,
    int: true,
    unit: "mois",
  },
  retention_inbox_days: {
    label: "Conservation des exports AJIR déposés",
    help: "Durée de conservation des fichiers d'export déposés sur le serveur avant leur purge par le script de rétention.",
    min: 7,
    max: 3650,
    step: 1,
    int: true,
    unit: "jours",
  },
  retention_prediction_months: {
    label: "Conservation des estimations individuelles",
    help: "Durée de conservation des estimations et facteurs individuels hors calcul publié, avant purge par le script de rétention.",
    min: 6,
    max: 120,
    step: 1,
    int: true,
    unit: "mois",
  },
} satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SETTINGS_SPEC;
export const SETTING_KEYS = Object.keys(SETTINGS_SPEC) as SettingKey[];

const fr = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });

function numberField(spec: Pick<SettingSpec, "min" | "max" | "int" | "unit">) {
  const u = spec.unit ? ` ${spec.unit}` : "";
  let n = z
    .number({ error: "Saisissez un nombre (virgule ou point pour les décimales)." })
    .min(spec.min, `Minimum ${fr(spec.min)}${u} : saisissez une valeur plus grande.`)
    .max(spec.max, `Maximum ${fr(spec.max)}${u} : saisissez une valeur plus petite.`);
  if (spec.int) n = n.int("Saisissez un nombre entier, sans décimale.");
  return z.preprocess((v) => {
    if (typeof v !== "string") return v;
    const s = v.trim().replace(/\s/g, "").replace(",", ".");
    return s === "" ? undefined : Number(s);
  }, n);
}

export const settingsSchema = z
  .object(Object.fromEntries(SETTING_KEYS.map((k) => [k, numberField(SETTINGS_SPEC[k])])) as Record<SettingKey, ReturnType<typeof numberField>>)
  .superRefine((v, c) => {
    const min = v.min_events_for_model;
    const ind = v.indicative_until_events;
    if (typeof min === "number" && typeof ind === "number" && ind < min)
      c.addIssue({ code: "custom", path: ["indicative_until_events"], message: `Au moins égal au seuil du modèle statistique (${fr(min)}).` });
  });
export type SettingsInput = Record<SettingKey, number | string>;

// Barème SMIG daté (clé smig_schedule) : valeur en vigueur à partir de chaque date d'effet ; la première période peut être sans borne
export type SmigPeriod = { from: string | null; value: number };
export const smigScheduleSchema = z
  .array(
    z.object({
      from: z.preprocess((v) => (v === "" ? null : v), z.iso.date("Date d'effet invalide (AAAA-MM-JJ).").nullable()),
      value: numberField(SETTINGS_SPEC.smig_monthly),
    }),
  )
  .min(1, "Le barème doit compter au moins une période.")
  .max(30, "30 périodes au maximum.")
  .superRefine((rows, c) => {
    if (rows.filter((r) => r.from === null).length > 1) c.addIssue({ code: "custom", message: "Une seule période peut être sans date d'effet (la première)." });
    const dates = rows.map((r) => r.from).filter((d): d is string => d !== null);
    if (new Set(dates).size !== dates.length) c.addIssue({ code: "custom", message: "Deux périodes ont la même date d'effet." });
  })
  .transform((rows): SmigPeriod[] => [...rows].sort((a, b) => (a.from ?? "").localeCompare(b.from ?? "")));

// Budgets annuels de masse salariale brute (clés budget_masse_salariale_<AAAA>) : recommandations budgétaires des prévisions
export const BUDGET_PREFIX = "budget_masse_salariale_";
export type BudgetRow = { year: number; amount: number };
export const budgetsSchema = z
  .array(
    z.object({
      year: z.coerce.number({ error: "Année attendue." }).int("Année attendue.").min(2000, "Année entre 2000 et 2100.").max(2100, "Année entre 2000 et 2100."),
      amount: numberField({ min: 1000, max: 10_000_000_000, unit: "TND" }),
    }),
  )
  .max(30, "30 années au maximum.")
  .superRefine((rows, c) => {
    const years = rows.map((r) => r.year);
    if (new Set(years).size !== years.length) c.addIssue({ code: "custom", message: "Une même année est saisie deux fois." });
  })
  .transform((rows): BudgetRow[] => [...rows].sort((a, b) => a.year - b.year));

type Issue = z.core.$ZodIssue;

// Bloc JSON (barème, budgets) : erreurs rattachées à la clé du bloc, collectées avec celles des champs numériques
function parseBlock<T>(schema: z.ZodType<T>, raw: string, key: string, issues: Issue[]): T | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    issues.push({ code: "custom", path: [key], message: "Tableau illisible : rechargez la page puis saisissez de nouveau les valeurs.", input: raw });
    return null;
  }
  const r = schema.safeParse(json);
  if (r.success) return r.data;
  issues.push(...r.error.issues.map((i) => ({ ...i, path: [key, ...i.path] })));
  return null;
}

export type SettingDTO = { key: SettingKey; value: string; updatedAt: string | null; updatedBy: string | null } & SettingSpec;

type Meta = { updated_at: string; login: string | null } | undefined;
const metaStmt = () => getDb().sqlite.prepare("SELECT s.updated_at, u.login FROM app_setting s LEFT JOIN app_user u ON u.id = s.updated_by WHERE s.key = ?");

export function getAdminSettings(ctx: AccessContext): SettingDTO[] {
  ensureRole(ctx, ["ADMIN"], "settings.view");
  const { sqlite } = getDb();
  const stmt = metaStmt();
  return SETTING_KEYS.map((key) => {
    const meta = stmt.get(key) as Meta;
    return { key, ...SETTINGS_SPEC[key], value: getSetting(sqlite, key), updatedAt: meta?.updated_at ?? null, updatedBy: meta?.login ?? null };
  });
}

export type SettingsExtrasDTO = {
  smig: { periods: SmigPeriod[]; valid: boolean; updatedAt: string | null; updatedBy: string | null };
  budgets: { rows: BudgetRow[]; updatedAt: string | null; updatedBy: string | null };
};

// Réglages structurés : barème SMIG daté et budgets annuels (montants d'entreprise, aucune donnée nominative)
export function getAdminSettingsExtras(ctx: AccessContext): SettingsExtrasDTO {
  ensureRole(ctx, ["ADMIN"], "settings.view");
  const { sqlite } = getDb();
  let periods: SmigPeriod[] = [];
  let valid = false;
  try {
    const parsed = smigScheduleSchema.safeParse(JSON.parse(getSetting(sqlite, "smig_schedule")));
    if (parsed.success) [periods, valid] = [parsed.data, true];
  } catch {
    valid = false;
  }
  const smigMeta = metaStmt().get("smig_schedule") as Meta;
  const budgetRows = sqlite
    .prepare(
      `SELECT s.key, s.value, s.updated_at, u.login FROM app_setting s LEFT JOIN app_user u ON u.id = s.updated_by
       WHERE s.key LIKE @p ORDER BY s.key`,
    )
    .all({ p: `${BUDGET_PREFIX}%` }) as { key: string; value: string; updated_at: string | null; login: string | null }[];
  const rows = budgetRows
    .map((r) => ({ year: Number(r.key.slice(BUDGET_PREFIX.length)), amount: Number(r.value) }))
    .filter((r) => Number.isInteger(r.year) && Number.isFinite(r.amount) && r.amount > 0);
  const last = [...budgetRows].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))[0];
  return {
    smig: { periods, valid, updatedAt: smigMeta?.updated_at ?? null, updatedBy: smigMeta?.login ?? null },
    budgets: { rows, updatedAt: last?.updated_at ?? null, updatedBy: last?.login ?? null },
  };
}

// smig_schedule et budgets (JSON) sont facultatifs : absents, ils ne sont pas modifiés
export type SettingsUpdate = SettingsInput & { smig_schedule?: string; budgets?: string };

export function updateSettings(ctx: AccessContext, input: SettingsUpdate): { changed: string[] } {
  ensureRole(ctx, ["ADMIN"], "settings.update");
  const issues: Issue[] = [];
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) issues.push(...parsed.error.issues);
  const smig = input.smig_schedule === undefined ? null : parseBlock(smigScheduleSchema, input.smig_schedule, "smig_schedule", issues);
  const budgets = input.budgets === undefined ? null : parseBlock(budgetsSchema, input.budgets, "budgets", issues);
  if (issues.length || !parsed.success) throw new z.ZodError(issues);
  const data = parsed.data as Record<SettingKey, number>;
  const { sqlite } = getDb();
  const changes: Record<string, { from: string | null; to: string | null }> = {};
  sqlite.transaction(() => {
    for (const key of SETTING_KEYS) {
      // Comparaison à la valeur en vigueur (défaut compris) : une valeur par défaut inchangée n'est pas écrite
      const from = getSetting(sqlite, key);
      const to = String(data[key]);
      if (Number(from) === data[key] && from !== "") continue;
      setSetting(sqlite, key, to, ctx.userId);
      changes[key] = { from, to };
    }
    if (smig) {
      const from = getSetting(sqlite, "smig_schedule");
      const to = JSON.stringify(smig);
      let same = false;
      try {
        same = JSON.stringify(smigScheduleSchema.parse(JSON.parse(from))) === to;
      } catch {
        same = false;
      }
      if (!same) {
        setSetting(sqlite, "smig_schedule", to, ctx.userId);
        changes.smig_schedule = { from, to };
      }
    }
    if (budgets) {
      const current = new Map(
        (sqlite.prepare("SELECT key, value FROM app_setting WHERE key LIKE ?").all(`${BUDGET_PREFIX}%`) as { key: string; value: string }[]).map((r) => [r.key, r.value]),
      );
      const wanted = new Map(budgets.map((b) => [`${BUDGET_PREFIX}${b.year}`, String(b.amount)]));
      for (const [key, to] of wanted) {
        const from = current.get(key) ?? null;
        if (from !== null && Number(from) === Number(to)) continue;
        setSetting(sqlite, key, to, ctx.userId);
        changes[key] = { from, to };
      }
      for (const [key, from] of current) {
        if (wanted.has(key)) continue;
        sqlite.prepare("DELETE FROM app_setting WHERE key = ?").run(key);
        changes[key] = { from, to: null };
      }
    }
  })();
  const changed = Object.keys(changes);
  if (changed.length) audit(ctx.userId, "settings.update", { type: "settings" }, "OK", { changes });
  return { changed };
}

// Libellé d'un paramètre modifié (message de confirmation)
export function settingLabel(key: string): string {
  if (key in SETTINGS_SPEC) return SETTINGS_SPEC[key as SettingKey].label;
  if (key === "smig_schedule") return "Barème SMIG daté";
  if (key.startsWith(BUDGET_PREFIX)) return `Budget de masse salariale ${key.slice(BUDGET_PREFIX.length)}`;
  return key;
}

// ---------- Console d'administration ----------

export type AdminOverviewDTO = {
  accounts: { active: Record<Role, number>; inactive: number; pendingActivation: number; locked: number; openSessions: number };
  security: { days: number; logins: number; failedLogins: number; refusals: number };
  recentRefusals: { id: number; at: string; login: string | null; action: string; target: string | null; ip: string | null }[];
};

// Comptes, sessions et refus d'accès : aucune donnée RH, seulement l'état de l'outil.
export function getAdminOverview(ctx: AccessContext, days = 7): AdminOverviewDTO {
  ensureRole(ctx, ["ADMIN"], "admin.overview");
  const { sqlite } = getDb();
  const now = new Date().toISOString();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const active = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  for (const r of sqlite.prepare("SELECT role, COUNT(*) AS n FROM app_user WHERE active = 1 GROUP BY role").all() as { role: Role; n: number }[]) active[r.role] = r.n;
  const acc = sqlite
    .prepare(
      `SELECT SUM(active = 0) AS inactive,
              SUM(active = 1 AND password_hash IS NULL) AS pending,
              SUM(active = 1 AND locked_until > @now) AS locked
       FROM app_user`,
    )
    .get({ now }) as { inactive: number | null; pending: number | null; locked: number | null };
  const openSessions = (sqlite.prepare("SELECT COUNT(*) AS n FROM session WHERE expires_at > ?").get(now) as { n: number }).n;
  const sec = sqlite
    .prepare(
      `SELECT SUM(action = 'auth.login' AND outcome = 'OK') AS logins,
              SUM(action = 'auth.login' AND outcome = 'REFUSE') AS failed,
              SUM(action <> 'auth.login' AND outcome = 'REFUSE') AS refusals
       FROM audit_log WHERE at >= ?`,
    )
    .get(since) as { logins: number | null; failed: number | null; refusals: number | null };
  const recent = sqlite
    .prepare(
      `SELECT a.id, a.at, u.login, a.action, a.target_type, a.target_id, a.ip
       FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id
       WHERE a.outcome = 'REFUSE' AND a.action <> 'auth.login'
       ORDER BY a.at DESC, a.id DESC LIMIT 8`,
    )
    .all() as { id: number; at: string; login: string | null; action: string; target_type: string | null; target_id: string | null; ip: string | null }[];
  return {
    accounts: { active, inactive: acc.inactive ?? 0, pendingActivation: acc.pending ?? 0, locked: acc.locked ?? 0, openSessions },
    security: { days, logins: sec.logins ?? 0, failedLogins: sec.failed ?? 0, refusals: sec.refusals ?? 0 },
    recentRefusals: recent.map((r) => ({
      id: r.id,
      at: r.at,
      login: r.login,
      action: r.action,
      target: r.target_type ? `${r.target_type}${r.target_id ? ` #${r.target_id}` : ""}` : null,
      ip: r.ip,
    })),
  };
}

// ---------- Journal d'audit ----------

const isoDate = z.preprocess(emptyToUndefined, z.iso.date("Date invalide (AAAA-MM-JJ).").optional());

export const auditFiltersSchema = z.object({
  user: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  action: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  outcome: z.preprocess(emptyToUndefined, z.enum(["OK", "REFUSE", "ECHEC"]).optional()),
  from: isoDate,
  to: isoDate,
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100_000).default(1)),
});
export type AuditFilters = z.input<typeof auditFiltersSchema>;

export type AuditRowDTO = {
  id: number;
  at: string;
  login: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: "OK" | "REFUSE" | "ECHEC";
  detail: string | null;
  ip: string | null;
};

export const AUDIT_PAGE_SIZE = 50;

export function listAudit(
  ctx: AccessContext,
  filters: AuditFilters,
): { rows: AuditRowDTO[]; total: number; page: number; pageSize: number; actions: string[] } {
  ensureRole(ctx, ["ADMIN"], "audit.view");
  const f = auditFiltersSchema.parse(filters);
  const { sqlite } = getDb();
  const where = `
    WHERE (@user IS NULL OR u.login = @user)
      AND (@action IS NULL OR substr(a.action, 1, length(@action)) = @action)
      AND (@outcome IS NULL OR a.outcome = @outcome)
      AND (@from IS NULL OR a.at >= @from)
      AND (@to IS NULL OR a.at < date(@to, '+1 day'))`;
  const params = { user: f.user ?? null, action: f.action ?? null, outcome: f.outcome ?? null, from: f.from ?? null, to: f.to ?? null };
  const total = (sqlite.prepare(`SELECT COUNT(*) AS n FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id ${where}`).get(params) as { n: number }).n;
  const rows = sqlite
    .prepare(
      `SELECT a.id, a.at, u.login, a.action, a.target_type, a.target_id, a.outcome, a.detail_json, a.ip
       FROM audit_log a LEFT JOIN app_user u ON u.id = a.user_id ${where}
       ORDER BY a.at DESC, a.id DESC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: AUDIT_PAGE_SIZE, offset: (f.page - 1) * AUDIT_PAGE_SIZE }) as {
    id: number;
    at: string;
    login: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    outcome: AuditRowDTO["outcome"];
    detail_json: string | null;
    ip: string | null;
  }[];
  const actions = (sqlite.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all() as { action: string }[]).map((r) => r.action);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      at: r.at,
      login: r.login,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      outcome: r.outcome,
      detail: r.detail_json ? r.detail_json.slice(0, 400) : null,
      ip: r.ip,
    })),
    total,
    page: f.page,
    pageSize: AUDIT_PAGE_SIZE,
    actions,
  };
}

// ---------- Modèles par sujet (page Transparence) ----------

export type TopicModelDTO = {
  topic: string;
  version: string;
  kind: string;
  status: "CANDIDAT" | "CHAMPION" | "RETIRE";
  createdAt: string;
  promotedAt: string | null;
  metrics: { label: string; value: string }[];
};

const dec = (n: number, d = 2) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const numAt = (o: unknown, ...path: (string | number)[]): number | null => {
  let cur: unknown = o;
  for (const k of path) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[String(k)];
  }
  return typeof cur === "number" && Number.isFinite(cur) ? cur : null;
};

// Métriques clés agrégées (évaluation hors ligne), selon le format propre à chaque sujet ; aucune donnée individuelle
function topicMetrics(topic: string, json: string | null): TopicModelDTO["metrics"] {
  let m: unknown;
  try {
    m = json ? JSON.parse(json) : null;
  } catch {
    return [];
  }
  if (!m || typeof m !== "object") return [];
  const out: TopicModelDTO["metrics"] = [];
  const push = (label: string, v: number | null, f: (n: number) => string) => {
    if (v != null) out.push({ label, value: f(v) });
  };
  if (topic === "FORMATION") {
    push("AUC", numAt(m, "auc_lr", "value"), (v) => dec(v));
    push("AUC de la règle de référence", numAt(m, "auc_base", "value"), (v) => dec(v));
    push("Observé / prévu", numAt(m, "oe_lr", "value"), (v) => dec(v));
  } else if (topic === "ABSENTEISME") {
    push("Erreur moyenne à 1 mois (entreprise)", numAt(m, "cells", "ENTREPRISE|1", "mae"), (v) => `${dec(v * 100)} pt`);
    push("Erreur rapportée à la moyenne 12 mois", numAt(m, "cells", "ENTREPRISE|1", "ratio_vs_ma12", "value"), (v) => dec(v));
    push("Couverture de l'intervalle à 80 %", numAt(m, "cells", "ENTREPRISE|1", "coverage80"), (v) => `${dec(v * 100, 0)} %`);
  } else if (topic === "EFFECTIF" || topic === "MASSE_SALARIALE") {
    const total = (m as { test?: { total?: Record<string, { all?: { mape?: number } }> } }).test?.total ?? {};
    push("Erreur relative moyenne à 12 mois (modèle)", numAt(total, "modele_taux", "all", "mape"), (v) => `${dec(v)} %`);
    const naive = Object.entries(total)
      .filter(([k]) => !k.startsWith("modele"))
      .map(([, v]) => v?.all?.mape)
      .filter((v): v is number => typeof v === "number");
    push("Meilleure référence naïve", naive.length ? Math.min(...naive) : null, (v) => `${dec(v)} %`);
  } else if (topic === "CHARGE_TRAVAIL") {
    push("Erreur moyenne à 1 mois (équipes, h / ETP)", numAt(m, "forecast", "EQUIPE", "1", "mae", "RIDGE"), (v) => dec(v));
    push("Gain sur la meilleure référence", numAt(m, "forecast", "EQUIPE", "1", "skill_vs_best_baseline"), (v) => `${dec(v * 100, 1)} %`);
  }
  return out;
}

export function listTopicModels(ctx: AccessContext): TopicModelDTO[] {
  ensureRole(ctx, ["ADMIN", "RH"], "model.view");
  const rows = getDb()
    .sqlite.prepare(
      `SELECT topic, version, kind, status, metrics_json, created_at, promoted_at FROM topic_model
       ORDER BY topic, CASE status WHEN 'CHAMPION' THEN 0 WHEN 'CANDIDAT' THEN 1 ELSE 2 END, created_at DESC`,
    )
    .all() as { topic: string; version: string; kind: string; status: TopicModelDTO["status"]; metrics_json: string | null; created_at: string; promoted_at: string | null }[];
  return rows.map((r) => ({
    topic: r.topic,
    version: r.version,
    kind: r.kind,
    status: r.status,
    createdAt: r.created_at,
    promotedAt: r.promoted_at,
    metrics: topicMetrics(r.topic, r.metrics_json),
  }));
}
