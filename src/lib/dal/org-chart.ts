import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit } from "@/lib/audit";
import { ensurePilotage, isGlobal, scopeFilter, type AccessContext } from "./context";
import { getPublishedRun, referenceDate, type AuditMeta, type RiskLevel } from "./employees";
import { MIN_GROUP_SIZE, addMonths, monthRange, ratio, smallGroupMask } from "./pilotage-metrics";
import { TEAM_WINDOW_MONTHS, monthlyMeasures, sumMeasures } from "./teams";

// Organigramme (RH : toute l'entreprise sous une racine virtuelle ; MANAGER : son sous-arbre, enraciné sur lui).
// Hiérarchie = employee.manager_id du dernier import AJIR, salariés actifs à la date de référence.
// Nœuds = managers (au moins un subordonné actif) ; les collaborateurs sans subordonné sont comptés dans leur manager.

export const ORG_COLOR_BY = ["effectif", "risque", "absenteisme"] as const;
export type OrgColorBy = (typeof ORG_COLOR_BY)[number];
export const orgChartQuerySchema = z.object({ couleur: z.enum(ORG_COLOR_BY).default("effectif") });

export const ORG_MAX_DEPTH = 30;
const VIRTUAL_ROOT = 0;

export type OrgPerson = {
  id: number;
  managerId: number | null;
  active: boolean;
  name: string;
  jobTitle: string | null;
  department: string | null;
  level: RiskLevel | null;
};

// PETIT_GROUPE : moins de MIN_GROUP_SIZE personnes ; PROTECTION : masqué pour qu'un petit groupe ne se déduise pas par différence
export type OrgMask = "PETIT_GROUPE" | "PROTECTION";

export type OrgMetrics = {
  headcount: number;
  small: boolean;
  scored: number | null;
  atRisk: number | null;
  riskShare: number | null;
  riskMask: OrgMask | null;
  absenteeism: number | null;
  absenteeismMask: OrgMask | null;
};

export type OrgMember = { id: number; name: string; jobTitle: string | null; level: RiskLevel | null; leadsTeam: boolean };

export type OrgNode = {
  key: string;
  employeeId: number | null;
  name: string;
  jobTitle: string | null;
  department: string | null;
  level: RiskLevel | null;
  openable: boolean;
  depth: number;
  team: OrgMetrics;
  subtree: OrgMetrics;
  leaves: number;
  members: OrgMember[];
  children: OrgNode[];
};

export type OrgStats = { people: number; managers: number; depth: number; reattached: number; cycles: number; flattened: number };

export type OrgChartDto = {
  view: "RH" | "MANAGER";
  referenceDate: string;
  runAsOf: string | null;
  window: { from: string; to: string };
  root: OrgNode;
  reference: { absenteeism: number | null; riskShare: number | null };
  stats: OrgStats;
};

export type OrgHierarchy = {
  rootKey: number;
  children: Map<number, number[]>;
  depth: Map<number, number>;
  order: number[];
  anomalies: { reattached: number; cycles: number; flattened: number };
};

// Parent effectif de chaque actif : premier ancêtre actif (les managers sortis ou absents de la base sont sautés),
// sinon la racine. Cycles rompus (le plus petit identifiant du cycle passe sous la racine), profondeur bornée.
export function resolveHierarchy(people: OrgPerson[], anchor: number | null): OrgHierarchy {
  const rootKey = anchor ?? VIRTUAL_ROOT;
  const byId = new Map(people.map((p) => [p.id, p]));
  const actives = people.filter((p) => p.active && p.id !== anchor);
  const parent = new Map<number, number>();
  let reattached = 0;
  for (const p of actives) {
    const seen = new Set([p.id]);
    let target = rootKey;
    let m = p.managerId;
    let skipped = false;
    while (m != null) {
      if (m === anchor) break;
      const q = byId.get(m);
      if (!q || seen.has(m)) {
        skipped = true;
        break;
      }
      if (q.active) {
        target = m;
        break;
      }
      seen.add(m);
      skipped = true;
      m = q.managerId;
    }
    if (skipped) reattached++;
    parent.set(p.id, target);
  }

  let cycles = 0;
  const state = new Map<number, "open" | "done">();
  for (const p of actives) {
    const path: number[] = [];
    let x = p.id;
    while (x !== rootKey && !state.has(x)) {
      state.set(x, "open");
      path.push(x);
      x = parent.get(x) ?? rootKey;
    }
    if (x !== rootKey && state.get(x) === "open") {
      const cycle = path.slice(path.indexOf(x));
      parent.set(Math.min(...cycle), rootKey);
      cycles++;
    }
    for (const y of path) state.set(y, "done");
  }

  const kids = new Map<number, number[]>();
  for (const [c, p] of parent) {
    const list = kids.get(p);
    if (list) list.push(c);
    else kids.set(p, [c]);
  }
  const children = new Map<number, number[]>();
  const depth = new Map<number, number>([[rootKey, 0]]);
  const finalParent = new Map<number, number>();
  const order = [rootKey];
  let flattened = 0;
  for (let i = 0; i < order.length; i++) {
    const n = order[i];
    const d = depth.get(n)!;
    for (const c of kids.get(n) ?? []) {
      let p = n;
      let dc = d + 1;
      if (dc > ORG_MAX_DEPTH) {
        p = finalParent.get(n) ?? rootKey;
        dc = d;
        flattened++;
      }
      finalParent.set(c, p);
      depth.set(c, dc);
      const list = children.get(p);
      if (list) list.push(c);
      else children.set(p, [c]);
      order.push(c);
    }
  }
  return { rootKey, children, depth, order, anomalies: { reattached, cycles, flattened } };
}

export type MaskNode = { team: number; subtree: number; children: number[] };

// Masques côté manager. Équipes directes : même masquage que « Mes équipes » (smallGroupMask sur toutes les équipes).
// Sous-arbre : affiché seulement si, une fois retirées ses parties affichées (équipes et sous-arbres), il ne reste aucune
// équipe masquée ; sinon la différence révélerait une équipe masquée, ici ou sur « Mes équipes ». Le reste masqué remonte
// au parent. Exception : la racine (total du périmètre, déjà connu ailleurs) quand ce reste atteint K personnes.
// Nœuds en ordre parent avant enfants, racine en 0.
export function orgMasks(nodes: MaskNode[], k = MIN_GROUP_SIZE): { team: OrgMask | null; subtree: OrgMask | null }[] {
  const teamMasked = smallGroupMask(nodes.map((n) => n.team), [], k);
  const residual = new Array<number>(nodes.length).fill(0);
  const subtreeShown = new Array<boolean>(nodes.length).fill(false);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    residual[i] = (teamMasked[i] ? n.team : 0) + n.children.reduce((s, c) => s + (subtreeShown[c] ? 0 : residual[c]), 0);
    subtreeShown[i] = n.subtree >= k && (residual[i] === 0 || (i === 0 && residual[i] >= k));
  }
  const reason = (n: number): OrgMask => (n < k ? "PETIT_GROUPE" : "PROTECTION");
  return nodes.map((n, i) => ({ team: teamMasked[i] ? reason(n.team) : null, subtree: subtreeShown[i] ? null : reason(n.subtree) }));
}

export type AbsenceTotals = { absence: number; workable: number };
type Acc = { n: number; eleve: number; moyen: number; faible: number; absence: number; workable: number };
const emptyAcc = (): Acc => ({ n: 0, eleve: 0, moyen: 0, faible: 0, absence: 0, workable: 0 });
function addAcc(a: Acc, b: Acc) {
  a.n += b.n;
  a.eleve += b.eleve;
  a.moyen += b.moyen;
  a.faible += b.faible;
  a.absence += b.absence;
  a.workable += b.workable;
}

function metrics(a: Acc, guarded: boolean, absMask: OrgMask | null, k: number): OrgMetrics {
  const scored = a.eleve + a.moyen + a.faible;
  const small = a.n < k;
  const riskMask: OrgMask | null = guarded && small ? "PETIT_GROUPE" : null;
  const mask = guarded ? absMask : null;
  return {
    headcount: a.n,
    small,
    scored: riskMask ? null : scored,
    atRisk: riskMask ? null : a.eleve + a.moyen,
    riskShare: riskMask ? null : ratio(a.eleve + a.moyen, scored),
    riskMask,
    absenteeism: mask ? null : ratio(a.absence, a.workable),
    absenteeismMask: mask,
  };
}

export type BuildOptions = { anchor: number | null; guarded: boolean; rootLabel: string; absence?: Map<number, AbsenceTotals>; k?: number };

// Arbre affichable (fonction pure) : regroupement, indicateurs d'équipe directe et de sous-arbre, masques côté manager
export function buildOrgChart(people: OrgPerson[], opts: BuildOptions): { root: OrgNode; stats: OrgStats } {
  const k = opts.k ?? MIN_GROUP_SIZE;
  const h = resolveHierarchy(people, opts.anchor);
  const byId = new Map(people.map((p) => [p.id, p]));
  const own = (id: number): Acc => {
    const p = byId.get(id);
    const abs = opts.absence?.get(id);
    return {
      n: 1,
      eleve: p?.level === "ELEVE" ? 1 : 0,
      moyen: p?.level === "MOYEN" ? 1 : 0,
      faible: p?.level === "FAIBLE" ? 1 : 0,
      absence: abs?.absence ?? 0,
      workable: abs?.workable ?? 0,
    };
  };
  const isNode = (id: number) => id === h.rootKey || (h.children.get(id)?.length ?? 0) > 0;
  const nodeIds = h.order.filter(isNode);
  const team = new Map<number, Acc>();
  const subtree = new Map<number, Acc>();
  for (let i = nodeIds.length - 1; i >= 0; i--) {
    const id = nodeIds[i];
    const t = emptyAcc();
    const s = emptyAcc();
    for (const c of h.children.get(id) ?? []) {
      addAcc(t, own(c));
      const sc = subtree.get(c);
      if (sc) addAcc(s, sc);
    }
    addAcc(s, t);
    team.set(id, t);
    subtree.set(id, s);
  }

  const index = new Map(nodeIds.map((id, i) => [id, i]));
  const masks = opts.guarded
    ? orgMasks(
        nodeIds.map((id) => ({
          team: team.get(id)!.n,
          subtree: subtree.get(id)!.n,
          children: (h.children.get(id) ?? []).filter(isNode).map((c) => index.get(c)!),
        })),
        k,
      )
    : nodeIds.map(() => ({ team: null, subtree: null }));

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "fr");
  const built = new Map<number, OrgNode>();
  for (let i = nodeIds.length - 1; i >= 0; i--) {
    const id = nodeIds[i];
    const kids = h.children.get(id) ?? [];
    const p = id === VIRTUAL_ROOT && opts.anchor == null ? null : byId.get(id);
    const isAnchor = id === opts.anchor;
    built.set(id, {
      key: id === VIRTUAL_ROOT && opts.anchor == null ? "root" : `e${id}`,
      employeeId: p ? id : null,
      name: p?.name ?? opts.rootLabel,
      jobTitle: p?.jobTitle ?? null,
      department: p?.department ?? null,
      level: isAnchor ? null : (p?.level ?? null),
      openable: !!p && !isAnchor,
      depth: h.depth.get(id) ?? 0,
      team: metrics(team.get(id)!, opts.guarded, masks[i].team, k),
      subtree: metrics(subtree.get(id)!, opts.guarded, masks[i].subtree, k),
      leaves: kids.filter((c) => !isNode(c)).length,
      members: kids
        .map((c) => {
          const m = byId.get(c)!;
          return { id: c, name: m.name, jobTitle: m.jobTitle, level: m.level, leadsTeam: isNode(c) };
        })
        .sort(byName),
      children: kids
        .filter(isNode)
        .map((c) => built.get(c)!)
        .sort((a, b) => b.subtree.headcount - a.subtree.headcount || byName(a, b)),
    });
  }
  let maxDepth = 0;
  for (const d of h.depth.values()) maxDepth = Math.max(maxDepth, d);
  const managers = nodeIds.filter((id) => (h.children.get(id)?.length ?? 0) > 0 && !(id === VIRTUAL_ROOT && opts.anchor == null)).length;
  return { root: built.get(h.rootKey)!, stats: { people: h.order.length - 1, managers, depth: maxDepth, ...h.anomalies } };
}

export function getOrgChart(ctx: AccessContext, meta: AuditMeta): OrgChartDto {
  ensurePilotage(ctx, "org_chart.view");
  const { sqlite } = getDb();
  const global = isGlobal(ctx);
  const anchor = global ? null : ctx.employeeId;
  const ref = referenceDate();
  const run = getPublishedRun();
  const scope = scopeFilter(ctx, "e.id");
  const rows = sqlite
    .prepare(
      `SELECT e.id, e.manager_id AS managerId, e.last_name || ' ' || e.first_name AS name, e.job_title AS jobTitle, d.name AS department,
        e.hire_date AS hireDate, e.exit_date AS exitDate, (e.hire_date <= @ref AND (e.exit_date IS NULL OR e.exit_date > @ref)) AS active, p.level
       FROM employee e LEFT JOIN department d ON d.id = e.department_id
       LEFT JOIN prediction p ON p.run_id = @runId AND p.employee_id = e.id
       WHERE (${scope.clause}) OR e.id = @self`,
    )
    .all({ ...scope.params, ref, runId: run?.id ?? -1, self: anchor ?? -1 }) as (Omit<OrgPerson, "active"> & { active: number; hireDate: string; exitDate: string | null })[];

  const refMonth = ref.slice(0, 7);
  const months = monthRange(addMonths(refMonth, -(TEAM_WINDOW_MONTHS - 1)), refMonth);
  const actives = rows.filter((r) => r.active && r.id !== anchor);
  const set = monthlyMeasures(
    actives.map((r) => ({ id: r.id, hireDate: r.hireDate, exitDate: r.exitDate })),
    months,
    ref,
  );
  const absence = new Map<number, AbsenceTotals>();
  for (const r of actives) {
    const t = sumMeasures(set, [r.id]);
    absence.set(r.id, { absence: t.absenceDays, workable: t.workableDays });
  }
  const people: OrgPerson[] = rows.map((r) => ({
    id: r.id,
    managerId: r.managerId,
    active: !!r.active,
    name: r.name,
    jobTitle: r.jobTitle,
    department: r.department,
    level: r.level ?? null,
  }));
  const { root, stats } = buildOrgChart(people, { anchor, guarded: !global, rootLabel: global ? "Entreprise" : "Votre hiérarchie", absence });

  audit(ctx.userId, "org_chart.view", { type: "org_chart" }, "OK", { source: meta.source, view: global ? "RH" : "MANAGER", nodes: stats.managers }, meta.ip);
  return {
    view: global ? "RH" : "MANAGER",
    referenceDate: ref,
    runAsOf: run?.asOf ?? null,
    window: { from: set.buckets[0]?.from ?? `${months[0]}-01`, to: ref },
    root,
    reference: { absenteeism: root.subtree.absenteeism, riskShare: root.subtree.riskShare },
    stats,
  };
}
