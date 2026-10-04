import "server-only";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { RH_ONLY_ACTIONS, managerVisibleGroup } from "@/lib/features/spec";
import { isOpposed, opposedEmployeeIds } from "@/lib/privacy";
import { ensurePilotage, isGlobal, scopeFilter, type AccessContext } from "./context";
import { listAlerts } from "./alerts";
import { groupLabel, referenceDate, type AuditMeta, type RiskLevel } from "./employees";
import { MIN_GROUP_SIZE, addDays, addMonths, countPresent, monthEnd, monthRange, workforce } from "./pilotage-metrics";
import { absenteeismOf, guardEmployee, levelsOfRun, monthlyMeasures, overtimePerHeadOf, publishedRuns, scopeMembers, sumMeasures } from "./teams";

// Synthèse du mois (RH et MANAGER) : ce qui a changé depuis le calcul publié précédent, en 5 à 8 constats rédigés.
// MANAGER : sa hiérarchie seulement, sans probabilité ni salaire ; sorties, absentéisme et heures sup masqués sous MIN_GROUP_SIZE.

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const monthLabel = (ym: string) => `${MONTHS_FR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const NBSP = " ";
const dec = (n: number, d = 1) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (r: number) => `${dec(r * 100)}${NBSP}%`;
const pts = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${dec(Math.abs(d) * 100)}${NBSP}pt`;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("fr-FR")} ${n > 1 ? many : one}`;

export type Tone = "alerte" | "attention" | "info" | "positif";
export type Statement = { key: string; tone: Tone; text: string; href: string | null; linkLabel: string | null };
type Draft = Statement & { filler?: boolean };

export const MIN_STATEMENTS = 5;
export const MAX_STATEMENTS = 8;
const TONE_ORDER: Record<Tone, number> = { alerte: 0, attention: 1, info: 2, positif: 3 };

// Constats prioritaires d'abord (alerte, attention, information, positif) ; les constats de remplissage ne servent qu'à atteindre 5
export function pickStatements(drafts: Draft[]): Statement[] {
  const main = drafts.filter((d) => !d.filler);
  const fillers = drafts.filter((d) => d.filler);
  const chosen = [...main, ...fillers.slice(0, Math.max(0, MIN_STATEMENTS - main.length))];
  return chosen
    .map((d, i) => ({ d, i }))
    .sort((a, b) => TONE_ORDER[a.d.tone] - TONE_ORDER[b.d.tone] || a.i - b.i)
    .slice(0, MAX_STATEMENTS)
    .map(({ d }) => ({ key: d.key, tone: d.tone, text: d.text, href: d.href, linkLabel: d.linkLabel }));
}

export type PersonChange = {
  id: number;
  name: string;
  matricule: string;
  department: string | null;
  before: RiskLevel | null;
  after: RiskLevel | null;
  reason: "HAUSSE" | "BAISSE" | "SORTI" | "NON_EVALUE";
};

export type SynthesisDto = {
  view: "RH" | "MANAGER";
  referenceDate: string;
  month: string;
  previousMonth: string;
  current: { asOf: string } | null;
  previous: { asOf: string } | null;
  smallPopulation: boolean;
  statements: Statement[];
  kpis: {
    headcount: { now: number; before: number };
    entries: number;
    exits: number | null;
    voluntaryExits: number | null;
    high: number | null;
    newHigh: number | null;
    leftHigh: number | null;
    absenteeism: { now: number | null; before: number | null };
    overtime: { now: number | null; before: number | null };
    alerts: { open: number; critical: number; sincePrevious: number | null };
    recommendations: { open: number; sincePrevious: number | null };
    trainingsOverdue: { total: number; thisMonth: number };
  };
  newHigh: PersonChange[];
  leftHigh: PersonChange[];
};

type Identity = { id: number; name: string; matricule: string; department: string | null; departmentId: number | null; exitDate: string | null };

function identities(ids: number[]): Map<number, Identity> {
  const rows = getDb()
    .sqlite.prepare(
      `SELECT e.id, e.last_name || ' ' || e.first_name AS name, e.matricule, d.name AS department, d.id AS departmentId, e.exit_date AS exitDate
       FROM employee e LEFT JOIN department d ON d.id = e.department_id WHERE e.id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(ids)) as Identity[];
  return new Map(rows.map((r) => [r.id, r]));
}

function scopedLevels(ctx: AccessContext, runId: number): Map<number, RiskLevel> {
  const scope = scopeFilter(ctx, "e.id");
  const rows = getDb()
    .sqlite.prepare(`SELECT p.employee_id AS id, p.level FROM prediction p JOIN employee e ON e.id = p.employee_id WHERE p.run_id = @runId AND ${scope.clause}`)
    .all({ ...scope.params, runId }) as { id: number; level: RiskLevel }[];
  return new Map(rows.map((r) => [r.id, r.level]));
}

const byName = (a: PersonChange, b: PersonChange) => (a.department ?? "").localeCompare(b.department ?? "", "fr") || a.name.localeCompare(b.name, "fr");

export function getSynthesis(ctx: AccessContext, meta: AuditMeta): SynthesisDto {
  ensurePilotage(ctx, "synthesis.view");
  const { sqlite } = getDb();
  const global = isGlobal(ctx);
  const ref = referenceDate();
  const runs = publishedRuns();
  const cur = runs[0] ?? null;
  const prev = runs[1] ?? null;
  const periodEnd = cur && cur.asOf <= ref ? cur.asOf : ref;
  const month = periodEnd.slice(0, 7);
  const previousMonth = prev ? prev.asOf.slice(0, 7) : addMonths(month, -1);
  const prevEnd = monthEnd(previousMonth);
  const periodStart = addDays(prevEnd, 1);
  const scope = scopeFilter(ctx, "e.id");
  let small = false;

  // Effectif, entrées, sorties : hors stages et SIVP (mêmes définitions que le tableau de bord)
  const members = scopeMembers(ctx, `${previousMonth}-01`, periodEnd);
  const staff = workforce(members);
  const headcountAt = (d: string) => staff.filter((e) => e.hireDate <= d && (!e.exitDate || e.exitDate > d)).length;
  const workStart = new Map(staff.map((e) => [e.id, e.hireDate]));
  const entries = staff.filter((e) => e.hireDate >= periodStart && e.hireDate <= periodEnd).length;
  const exitRows = (
    sqlite
      .prepare(
        `SELECT x.employee_id AS id, x.exit_date AS exitDate, x.reason FROM exit_event x JOIN employee e ON e.id = x.employee_id
         WHERE ${scope.clause} AND x.exit_date BETWEEN @from AND @to`,
      )
      .all({ ...scope.params, from: periodStart, to: periodEnd }) as { id: number; exitDate: string; reason: string }[]
  ).filter((x) => {
    const s = workStart.get(x.id);
    return s != null && x.exitDate >= s;
  });
  const exitsShown = global || countPresent(staff, periodStart, periodEnd) >= MIN_GROUP_SIZE;
  if (!exitsShown) small = true;
  const exits = exitsShown ? exitRows.length : null;
  const voluntaryExits = exitsShown ? exitRows.filter((x) => x.reason === "DEMISSION" || x.reason === "ABANDON").length : null;

  // Absentéisme et heures sup du mois comparé au mois du calcul précédent (tous les présents)
  const months = monthRange(previousMonth, month);
  const set = monthlyMeasures(members, months, periodEnd);
  const ids = members.map((m) => m.id);
  const last = set.buckets.length - 1;
  const monthShown = (i: number) => global || countPresent(members, set.buckets[i].from, set.buckets[i].to) >= MIN_GROUP_SIZE;
  const measureAt = (i: number) => {
    if (i < 0 || !monthShown(i)) {
      if (i >= 0) small = true;
      return { abs: null, ot: null };
    }
    const t = sumMeasures(set, ids, i, i);
    return { abs: absenteeismOf(t), ot: overtimePerHeadOf(t) };
  };
  const now = measureAt(last);
  const before = measureAt(last > 0 ? 0 : -1);

  // Niveaux de risque : calcul courant contre calcul précédent ; salariés opposés exclus
  const opposed = opposedEmployeeIds(sqlite);
  const curLevels = cur ? scopedLevels(ctx, cur.id) : new Map<number, RiskLevel>();
  const prevLevels = prev ? scopedLevels(ctx, prev.id) : new Map<number, RiskLevel>();
  for (const id of opposed) {
    curLevels.delete(id);
    prevLevels.delete(id);
  }
  const newHighIds = prev ? [...curLevels].filter(([id, l]) => l === "ELEVE" && prevLevels.get(id) !== "ELEVE").map(([id]) => id) : [];
  const leftHighIds = prev ? [...prevLevels].filter(([id, l]) => l === "ELEVE" && curLevels.get(id) !== "ELEVE").map(([id]) => id) : [];
  const who = identities([...newHighIds, ...leftHighIds]);
  const person = (id: number, reason: PersonChange["reason"]): PersonChange => {
    const i = who.get(id);
    return { id, name: i?.name ?? "", matricule: i?.matricule ?? "", department: i?.department ?? null, before: prevLevels.get(id) ?? null, after: curLevels.get(id) ?? null, reason };
  };
  const newHigh = newHighIds.map((id) => person(id, "HAUSSE")).sort(byName);
  const leftHigh = leftHighIds
    .map((id) => {
      const exit = who.get(id)?.exitDate;
      return person(id, exit && cur && exit <= cur.asOf ? "SORTI" : curLevels.has(id) ? "BAISSE" : "NON_EVALUE");
    })
    .sort(byName);
  const high = cur ? [...curLevels.values()].filter((l) => l === "ELEVE").length : null;

  // Alertes (visibilité par rôle de listAlerts), recommandations et formations obligatoires en retard
  const alerts = listAlerts(ctx, { status: "NOUVELLE", limit: 500 });
  const critical = alerts.filter((a) => a.severity === "CRITIQUE").length;
  const since = prev?.finishedAt ?? null;
  const alertsSince = since ? alerts.filter((a) => a.createdAt > since).length : null;
  const recos = (
    sqlite
      .prepare(`SELECT r.action_code AS action, r.created_at AS createdAt FROM recommendation r JOIN employee e ON e.id = r.employee_id WHERE r.status = 'PROPOSEE' AND ${scope.clause}`)
      .all(scope.params) as { action: string; createdAt: string }[]
  ).filter((r) => global || !RH_ONLY_ACTIONS.has(r.action));
  const recosSince = since ? recos.filter((r) => r.createdAt > since).length : null;
  const overdue = sqlite
    .prepare(
      `SELECT t.due_date AS due FROM training t JOIN employee e ON e.id = t.employee_id
       WHERE t.mandatory = 1 AND t.status <> 'TERMINEE' AND t.due_date IS NOT NULL AND t.due_date <= @end AND e.status = 'ACTIF' AND ${scope.clause}`,
    )
    .all({ ...scope.params, end: periodEnd }) as { due: string }[];
  const overdueThisMonth = overdue.filter((t) => t.due >= periodStart).length;

  // ---------- Constats ----------
  const M = monthLabel(month);
  const P = monthLabel(previousMonth);
  const drafts: Draft[] = [];
  if (cur && prev) {
    if (newHigh.length) {
      const byDept = new Map<string, { n: number; id: number | null }>();
      for (const p of newHigh) {
        const i = who.get(p.id);
        const k = i?.department ?? "Sans département";
        byDept.set(k, { n: (byDept.get(k)?.n ?? 0) + 1, id: i?.departmentId ?? null });
      }
      const [top, topInfo] = [...byDept].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0], "fr"))[0];
      const n = newHigh.length;
      const text =
        byDept.size === 1
          ? `${plural(n, "collaborateur", "collaborateurs")} de ${top} ${n > 1 ? "sont passés" : "est passé"} en risque élevé depuis le calcul de ${P}.`
          : `${plural(n, "collaborateur", "collaborateurs")} sont passés en risque élevé depuis le calcul de ${P}, dont ${topInfo.n} en ${top}.`;
      const dept = byDept.size === 1 && topInfo.id != null && global ? `&departement=${topInfo.id}` : "";
      drafts.push({ key: "nouveaux-eleves", tone: "alerte", text, href: `/employees?niveau=ELEVE${dept}`, linkLabel: "Voir la liste" });
    } else
      drafts.push({ key: "nouveaux-eleves", tone: "positif", text: `Aucun collaborateur n'est passé en risque élevé depuis le calcul de ${P}.`, href: null, linkLabel: null });
    if (leftHigh.length) {
      const n = leftHigh.length;
      const parts = [
        [leftHigh.filter((p) => p.reason === "BAISSE").length, "dont le niveau a baissé", "dont le niveau a baissé"],
        [leftHigh.filter((p) => p.reason === "SORTI").length, "sorti de l'entreprise", "sortis de l'entreprise"],
        [leftHigh.filter((p) => p.reason === "NON_EVALUE").length, "qui n'est plus évalué", "qui ne sont plus évalués"],
      ] as const;
      const detail = parts
        .filter(([k]) => k > 0)
        .map(([k, one, many]) => `${k} ${k > 1 ? many : one}`)
        .join(", ");
      drafts.push({
        key: "sortis-du-risque",
        tone: "positif",
        text: `${plural(n, "collaborateur", "collaborateurs")} ${n > 1 ? "ne sont plus" : "n'est plus"} en risque élevé (${detail}).`,
        href: "#sortis-du-risque",
        linkLabel: "Voir le détail",
      });
    }
  } else if (cur)
    drafts.push({
      key: "premier-calcul",
      tone: "info",
      text: `${plural(high ?? 0, "collaborateur est", "collaborateurs sont")} en risque élevé au calcul de ${M} ; aucun calcul précédent ne permet de comparer.`,
      href: "/employees?niveau=ELEVE",
      linkLabel: "Voir la liste",
    });

  if (exits != null)
    drafts.push({
      key: "mouvements",
      tone: voluntaryExits ? "attention" : "info",
      text: `${plural(entries, "entrée", "entrées")} et ${plural(exits, "sortie", "sorties")} depuis le calcul de ${P}${exits ? `, dont ${plural(voluntaryExits ?? 0, "départ volontaire", "départs volontaires")}` : ""}.`,
      href: "/dashboard?periode=3m",
      linkLabel: "Tableau de bord",
    });
  else
    drafts.push({
      key: "mouvements",
      tone: "info",
      text: `${plural(entries, "entrée", "entrées")} depuis le calcul de ${P} ; les sorties ne sont pas affichées pour un groupe de moins de ${MIN_GROUP_SIZE} personnes.`,
      href: "/dashboard?periode=3m",
      linkLabel: "Tableau de bord",
    });

  if (now.abs != null && before.abs != null) {
    const d = now.abs - before.abs;
    drafts.push(
      Math.abs(d) < 0.002
        ? { key: "absenteisme", tone: "info", text: `L'absentéisme hors santé reste stable : ${pct(now.abs)} en ${M} (${pct(before.abs)} en ${P}).`, href: "/absenteeism?granularite=mois", linkLabel: "Absentéisme" }
        : {
            key: "absenteisme",
            tone: d > 0 ? (d >= 0.005 ? "attention" : "info") : "positif",
            text: `L'absentéisme hors santé ${d > 0 ? "augmente" : "baisse"} : ${pct(now.abs)} en ${M} contre ${pct(before.abs)} en ${P} (${pts(d)}).`,
            href: "/absenteeism?granularite=mois",
            linkLabel: "Absentéisme",
          },
    );
  }
  if (now.ot != null && before.ot != null) {
    const h = (x: number) => `${dec(x)}${NBSP}h`;
    const rel = before.ot > 0 ? (now.ot - before.ot) / before.ot : null;
    const base = { key: "heures-sup", href: "/charge", linkLabel: "Charge de travail" };
    if (now.ot === 0 && before.ot === 0) drafts.push({ ...base, tone: "info", text: `Aucune heure supplémentaire pointée en ${M} ni en ${P}.`, filler: true });
    else if (rel != null && Math.abs(rel) < 0.1) drafts.push({ ...base, tone: "info", text: `Les heures supplémentaires restent stables : ${h(now.ot)} par personne en ${M} (${h(before.ot)} en ${P}).` });
    else
      drafts.push({
        ...base,
        tone: now.ot > before.ot ? "attention" : "positif",
        text: `Les heures supplémentaires ${now.ot > before.ot ? "augmentent" : "baissent"} : ${h(now.ot)} par personne en ${M} contre ${h(before.ot)} en ${P}${rel != null ? ` (${rel > 0 ? "+" : "−"}${Math.round(Math.abs(rel) * 100)}${NBSP}%)` : ""}.`,
      });
  }

  if (alerts.length)
    drafts.push({
      key: "alertes",
      tone: critical ? "alerte" : "attention",
      text: `${plural(alerts.length, "alerte attend", "alertes attendent")} un traitement${critical ? `, dont ${plural(critical, "critique", "critiques")}` : ""}${alertsSince ? ` ; ${plural(alertsSince, "est apparue", "sont apparues")} depuis le calcul précédent` : ""}.`,
      href: "/alerts?status=NOUVELLE",
      linkLabel: "Voir les alertes",
    });
  else drafts.push({ key: "alertes", tone: "positif", text: "Aucune alerte en attente de traitement.", href: null, linkLabel: null, filler: true });

  if (recos.length)
    drafts.push(
      global
        ? {
            key: "recommandations",
            tone: "attention",
            text: `${plural(recos.length, "recommandation attend", "recommandations attendent")} une décision${recosSince ? `, dont ${plural(recosSince, "nouvelle", "nouvelles")} depuis le calcul précédent` : ""}.`,
            href: "/recommendations?statut=PROPOSEE",
            linkLabel: "Décider",
          }
        : {
            key: "recommandations",
            tone: "info",
            text: `${plural(recos.length, "recommandation concerne", "recommandations concernent")} des collaborateurs de votre équipe ; la RH les instruit avec vous.`,
            href: "/employees?niveau=ELEVE",
            linkLabel: "Mon équipe",
          },
    );
  else drafts.push({ key: "recommandations", tone: "positif", text: "Aucune recommandation en attente de décision.", href: null, linkLabel: null, filler: true });

  if (overdue.length)
    drafts.push({
      key: "formations",
      tone: "attention",
      text: `${plural(overdue.length, "formation obligatoire est", "formations obligatoires sont")} en retard${overdueThisMonth ? `, dont ${plural(overdueThisMonth, "arrivée", "arrivées")} à échéance depuis le calcul de ${P}` : ""}.`,
      href: "/formations",
      linkLabel: "Formations",
    });
  else drafts.push({ key: "formations", tone: "positif", text: "Aucune formation obligatoire en retard.", href: null, linkLabel: null, filler: true });

  const hNow = headcountAt(periodEnd);
  const hBefore = headcountAt(prevEnd);
  const diff = hNow - hBefore;
  drafts.push({
    key: "effectif",
    tone: "info",
    text: `L'effectif compte ${plural(hNow, "collaborateur", "collaborateurs")} (hors stages et SIVP) au ${periodEnd.slice(8, 10)}/${periodEnd.slice(5, 7)}/${periodEnd.slice(0, 4)}${diff ? `, soit ${diff > 0 ? "+" : "−"}${Math.abs(diff)} par rapport à fin ${P}` : `, sans changement depuis fin ${P}`}.`,
    href: "/dashboard",
    linkLabel: "Tableau de bord",
    filler: true,
  });

  audit(
    ctx.userId,
    "synthesis.view",
    { type: "synthesis", id: month },
    "OK",
    { source: meta.source, view: global ? "RH" : "MANAGER", newHigh: newHigh.length, leftHigh: leftHigh.length },
    meta.ip,
  );
  return {
    view: global ? "RH" : "MANAGER",
    referenceDate: ref,
    month,
    previousMonth,
    current: cur ? { asOf: cur.asOf } : null,
    previous: prev ? { asOf: prev.asOf } : null,
    smallPopulation: small,
    statements: pickStatements(drafts),
    kpis: {
      headcount: { now: hNow, before: hBefore },
      entries,
      exits,
      voluntaryExits,
      high,
      newHigh: prev ? newHigh.length : null,
      leftHigh: prev ? leftHigh.length : null,
      absenteeism: { now: now.abs, before: before.abs },
      overtime: { now: now.ot, before: before.ot },
      alerts: { open: alerts.length, critical, sincePrevious: alertsSince },
      recommendations: { open: recos.length, sincePrevious: recosSince },
      trainingsOverdue: { total: overdue.length, thisMonth: overdueThisMonth },
    },
    newHigh,
    leftHigh,
  };
}

// ---------- Fiche : « Quoi de neuf » ----------

export type NewsItem =
  | { kind: "OPPOSITION" }
  | { kind: "RISQUE"; before: RiskLevel | null; after: RiskLevel | null }
  | { kind: "FACTEUR"; text: string }
  | { kind: "CARRIERE"; type: string; date: string; from: string | null; to: string | null }
  | { kind: "FORMATION"; status: "TERMINEE" | "EN_RETARD"; title: string; date: string }
  | { kind: "EVALUATION"; date: string; score: number; previousScore: number | null }
  | { kind: "ABSENCE"; now: number; before: number }
  | { kind: "HEURES_SUP"; now: number; before: number }
  | { kind: "RECOMMANDATION"; actionCode: string; date: string }
  | { kind: "INTERVENTION"; actionCode: string; date: string };

export type EmployeeNewsDto = { view: "RH" | "MANAGER"; employeeId: number; month: string; previousMonth: string; window: { from: string; to: string }; items: NewsItem[] };

type CareerRow = { date: string; type: string; oldValue: string | null; newValue: string | null };

// Valeurs lisibles : départements et managers résolus par leur nom ; augmentation (montants) réservée à la RH
function readableCareer(rows: CareerRow[]): CareerRow[] {
  const { sqlite } = getDb();
  const dept = sqlite.prepare("SELECT name FROM department WHERE code = ?");
  const mgr = sqlite.prepare("SELECT last_name || ' ' || first_name AS name FROM employee WHERE matricule = ?");
  const resolve = (stmt: typeof dept, v: string | null) => (v ? ((stmt.get(v) as { name: string } | undefined)?.name ?? v) : null);
  return rows.map((r) =>
    r.type === "MUTATION"
      ? { ...r, oldValue: resolve(dept, r.oldValue), newValue: resolve(dept, r.newValue) }
      : r.type === "CHANGEMENT_MANAGER"
        ? { ...r, oldValue: resolve(mgr, r.oldValue), newValue: resolve(mgr, r.newValue) }
        : r,
  );
}

export function getEmployeeNews(ctx: AccessContext, employeeId: number, meta: AuditMeta): EmployeeNewsDto {
  guardEmployee(ctx, employeeId, "employee.news.view", meta);
  const { sqlite } = getDb();
  const global = isGlobal(ctx);
  const ref = referenceDate();
  const runs = publishedRuns();
  const cur = runs[0] ?? null;
  const prev = runs[1] ?? null;
  const to = cur && cur.asOf <= ref ? cur.asOf : ref;
  const month = to.slice(0, 7);
  const previousMonth = prev ? prev.asOf.slice(0, 7) : addMonths(month, -1);
  const after = monthEnd(previousMonth);
  const inWindow = (d: string | null | undefined) => !!d && d.slice(0, 10) > after && d.slice(0, 10) <= to;
  const p = { id: employeeId, after, to };
  const items: NewsItem[] = [];

  // Opposition : mention pour la RH seulement ; le manager voit l'absence d'estimation sans en connaître la raison
  // (minimisation, getOppositionFlag dans dal/privacy.ts)
  if (isOpposed(sqlite, employeeId)) {
    if (global) items.push({ kind: "OPPOSITION" });
  } else if (cur) {
    const before = prev ? (levelsOfRun(prev.id, [employeeId]).get(employeeId) ?? null) : null;
    const now = levelsOfRun(cur.id, [employeeId]).get(employeeId) ?? null;
    if (now || before) items.push({ kind: "RISQUE", before, after: now });
    const factors = (runId: number) =>
      sqlite
        .prepare(
          `SELECT f.group_code AS "group", f.phrase_rh AS rh, f.phrase_manager AS mgr FROM prediction_factor f JOIN prediction p ON p.id = f.prediction_id
           WHERE p.run_id = ? AND p.employee_id = ? AND f.direction = 'HAUSSE' AND f.rank <= 3 ORDER BY f.rank`,
        )
        .all(runId, employeeId) as { group: string; rh: string | null; mgr: string | null }[];
    const previousGroups = new Set(prev ? factors(prev.id).map((f) => f.group) : []);
    for (const f of factors(cur.id)) {
      if (!prev || previousGroups.has(f.group)) continue;
      if (global) items.push({ kind: "FACTEUR", text: f.rh ?? groupLabel(f.group, "RH") });
      else if (managerVisibleGroup(f.group, cur.kind)) items.push({ kind: "FACTEUR", text: f.mgr ?? groupLabel(f.group, "MANAGER") });
    }
  }

  const career = readableCareer(
    sqlite
      .prepare("SELECT date, type, old_value AS oldValue, new_value AS newValue FROM career_event WHERE employee_id = @id AND date > @after AND date <= @to ORDER BY date")
      .all(p) as CareerRow[],
  );
  for (const c of career) if (global || c.type !== "AUGMENTATION") items.push({ kind: "CARRIERE", type: c.type, date: c.date, from: c.oldValue, to: c.newValue });

  const trainings = sqlite
    .prepare(
      `SELECT title, status, mandatory, end_date AS endDate, due_date AS dueDate FROM training
       WHERE employee_id = @id AND ((status = 'TERMINEE' AND end_date > @after AND end_date <= @to) OR (mandatory = 1 AND status <> 'TERMINEE' AND due_date > @after AND due_date <= @to))`,
    )
    .all(p) as { title: string; status: string; mandatory: number; endDate: string | null; dueDate: string | null }[];
  for (const t of trainings)
    items.push(t.status === "TERMINEE" ? { kind: "FORMATION", status: "TERMINEE", title: t.title, date: t.endDate! } : { kind: "FORMATION", status: "EN_RETARD", title: t.title, date: t.dueDate! });

  const evals = sqlite.prepare("SELECT eval_date AS date, score FROM evaluation WHERE employee_id = ? AND eval_date <= ? ORDER BY eval_date DESC LIMIT 2").all(employeeId, to) as {
    date: string;
    score: number;
  }[];
  if (evals[0] && inWindow(evals[0].date)) items.push({ kind: "EVALUATION", date: evals[0].date, score: evals[0].score, previousScore: evals[1]?.score ?? null });

  // Signaux individuels d'absence et d'heures sup : RH seulement
  if (global) {
    const member = sqlite.prepare("SELECT id, hire_date AS hireDate, exit_date AS exitDate FROM employee WHERE id = ?").get(employeeId) as { id: number; hireDate: string; exitDate: string | null };
    const set = monthlyMeasures([member], monthRange(previousMonth, month), to);
    const m = set.byEmployee.get(employeeId);
    const last = set.buckets.length - 1;
    if (m && last > 0) {
      const absNow = m.absence[last];
      const absBefore = m.absence[0];
      if (absNow > 0 || absBefore > 0) items.push({ kind: "ABSENCE", now: absNow, before: absBefore });
      const otNow = m.overtime[last];
      const otBefore = m.overtime[0];
      if (otNow > 0 || otBefore > 0) items.push({ kind: "HEURES_SUP", now: otNow, before: otBefore });
    }
  }

  const recos = sqlite
    .prepare("SELECT action_code AS actionCode, created_at AS createdAt FROM recommendation WHERE employee_id = ? ORDER BY created_at")
    .all(employeeId) as { actionCode: string; createdAt: string }[];
  for (const r of recos) if (inWindow(r.createdAt) && (global || !RH_ONLY_ACTIONS.has(r.actionCode))) items.push({ kind: "RECOMMANDATION", actionCode: r.actionCode, date: r.createdAt.slice(0, 10) });
  if (global) {
    const interventions = sqlite
      .prepare("SELECT action_code AS actionCode, date FROM intervention WHERE employee_id = @id AND date > @after AND date <= @to ORDER BY date")
      .all(p) as { actionCode: string; date: string }[];
    for (const i of interventions) items.push({ kind: "INTERVENTION", actionCode: i.actionCode, date: i.date });
  }

  audit(ctx.userId, "employee.news.view", { type: "employee", id: employeeId }, "OK", { source: meta.source, view: global ? "RH" : "MANAGER", items: items.length }, meta.ip);
  return { view: global ? "RH" : "MANAGER", employeeId, month, previousMonth, window: { from: addDays(after, 1), to }, items };
}

// ---------- Fiche : « Parcours » ----------

export const LONG_ABSENCE_DAYS = 5;

export type JourneyKind =
  | "EMBAUCHE"
  | "CONTRAT"
  | "PROMOTION"
  | "AUGMENTATION"
  | "MUTATION"
  | "CHANGEMENT_MANAGER"
  | "CHANGEMENT_POSTE"
  | "ABSENCE_LONGUE"
  | "FORMATION"
  | "FORMATION_RETARD"
  | "RECOMMANDATION"
  | "INTERVENTION"
  | "SORTIE";

export type JourneyEvent = {
  date: string;
  kind: JourneyKind;
  label: string | null;
  from: string | null;
  to: string | null;
  days: number | null;
  hours: number | null;
  endDate: string | null;
  status: string | null;
};

export type EmployeeJourneyDto = { view: "RH" | "MANAGER"; employeeId: number; referenceDate: string; longAbsenceDays: number; events: JourneyEvent[] };

const KIND_ORDER: Record<JourneyKind, number> = {
  SORTIE: 0,
  INTERVENTION: 1,
  RECOMMANDATION: 2,
  FORMATION_RETARD: 3,
  FORMATION: 4,
  ABSENCE_LONGUE: 5,
  CHANGEMENT_POSTE: 6,
  CHANGEMENT_MANAGER: 7,
  MUTATION: 8,
  AUGMENTATION: 9,
  PROMOTION: 10,
  CONTRAT: 11,
  EMBAUCHE: 12,
};

const event = (date: string, kind: JourneyKind, e: Partial<Omit<JourneyEvent, "date" | "kind">> = {}): JourneyEvent => ({
  date,
  kind,
  label: e.label ?? null,
  from: e.from ?? null,
  to: e.to ?? null,
  days: e.days ?? null,
  hours: e.hours ?? null,
  endDate: e.endDate ?? null,
  status: e.status ?? null,
});

// Frise : embauche, contrats, carrière, absences longues hors santé (RH), formations, recommandations, interventions (RH), sortie.
// Manager : ni augmentation, ni absence, ni intervention datée, ni motif de sortie, ni action réservée à la RH.
export function getEmployeeJourney(ctx: AccessContext, employeeId: number, meta: AuditMeta): EmployeeJourneyDto {
  guardEmployee(ctx, employeeId, "employee.journey.view", meta);
  const { sqlite } = getDb();
  const global = isGlobal(ctx);
  const ref = referenceDate();
  const events: JourneyEvent[] = [];
  const e = sqlite.prepare("SELECT hire_date AS hireDate FROM employee WHERE id = ?").get(employeeId) as { hireDate: string };
  events.push(event(e.hireDate, "EMBAUCHE"));

  const contracts = sqlite.prepare("SELECT type, start_date AS startDate FROM contract WHERE employee_id = ? ORDER BY start_date, id").all(employeeId) as { type: string; startDate: string }[];
  contracts.forEach((c, i) => events.push(event(c.startDate, "CONTRAT", { label: c.type, from: i > 0 ? contracts[i - 1].type : null, to: c.type })));

  const career = readableCareer(
    sqlite.prepare("SELECT date, type, old_value AS oldValue, new_value AS newValue FROM career_event WHERE employee_id = ? ORDER BY date").all(employeeId) as CareerRow[],
  );
  for (const c of career) if (global || c.type !== "AUGMENTATION") events.push(event(c.date, c.type as JourneyKind, { from: c.oldValue, to: c.newValue }));

  if (global) {
    const absences = sqlite
      .prepare(
        `SELECT start_date AS startDate, end_date AS endDate, days, category FROM absence_episode
         WHERE employee_id = ? AND is_health = 0 AND category <> 'CONGE_ANNUEL' AND days >= ? ORDER BY start_date`,
      )
      .all(employeeId, LONG_ABSENCE_DAYS) as { startDate: string; endDate: string; days: number; category: string }[];
    for (const a of absences) events.push(event(a.startDate, "ABSENCE_LONGUE", { label: a.category, days: a.days, endDate: a.endDate }));
  }

  const trainings = sqlite
    .prepare("SELECT title, status, mandatory, end_date AS endDate, due_date AS dueDate, hours FROM training WHERE employee_id = ?")
    .all(employeeId) as { title: string; status: string; mandatory: number; endDate: string | null; dueDate: string | null; hours: number }[];
  for (const t of trainings) {
    if (t.status === "TERMINEE" && t.endDate) events.push(event(t.endDate, "FORMATION", { label: t.title, hours: t.hours }));
    else if (t.mandatory && t.status !== "TERMINEE" && t.dueDate && t.dueDate < ref) events.push(event(t.dueDate, "FORMATION_RETARD", { label: t.title }));
  }

  const recos = sqlite
    .prepare("SELECT action_code AS actionCode, status, created_at AS createdAt FROM recommendation WHERE employee_id = ?")
    .all(employeeId) as { actionCode: string; status: string; createdAt: string }[];
  for (const r of recos) if (global || !RH_ONLY_ACTIONS.has(r.actionCode)) events.push(event(r.createdAt.slice(0, 10), "RECOMMANDATION", { label: r.actionCode, status: r.status }));
  if (global) {
    const interventions = sqlite.prepare("SELECT action_code AS actionCode, date FROM intervention WHERE employee_id = ?").all(employeeId) as { actionCode: string; date: string }[];
    for (const i of interventions) events.push(event(i.date, "INTERVENTION", { label: i.actionCode }));
  }

  const exit = sqlite.prepare("SELECT exit_date AS exitDate, reason FROM exit_event WHERE employee_id = ? ORDER BY exit_date DESC LIMIT 1").get(employeeId) as
    | { exitDate: string; reason: string }
    | undefined;
  if (exit) events.push(event(exit.exitDate, "SORTIE", { label: global ? exit.reason : null }));

  events.sort((a, b) => b.date.localeCompare(a.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  audit(ctx.userId, "employee.journey.view", { type: "employee", id: employeeId }, "OK", { source: meta.source, view: global ? "RH" : "MANAGER", events: events.length }, meta.ip);
  return { view: global ? "RH" : "MANAGER", employeeId, referenceDate: ref, longAbsenceDays: LONG_ABSENCE_DAYS, events };
}
