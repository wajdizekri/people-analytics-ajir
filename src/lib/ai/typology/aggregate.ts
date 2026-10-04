import { MIN_GROUP_SIZE, smallGroupMask } from "@/lib/dal/pilotage-metrics";
import { FEATURE_INDEX, FEATURES } from "@/lib/features/spec";
import type { DepartureRow } from "./departures";
import { assignProfile, rawFromSnapshot, type TypologyBundle } from "./model";

// Sous ce nombre de départs classés, aucun profil n'est affiché (même ordre de grandeur que min_events_for_model)
export const MIN_DEPARTURES_FOR_PROFILES = 30;

export type ProfileAggregate = {
  id: number;
  label: string;
  traits: { text: string; direction: "HAUSSE" | "BAISSE" | "PROCHE" }[];
  stability: number | null;
  // null : profil masqué (moins de MIN_GROUP_SIZE départs, ou déductible par différence avec le total)
  departures: number | null;
  share: number | null;
  medianTenureMonths: number | null;
  masked: boolean;
};

export type DepartmentAggregate = { department: string; departures: number; topProfileId: number | null; topShare: number | null };

export type TypologyAggregate = {
  total: number;
  classified: number;
  unclassified: number;
  firstExit: string | null;
  lastExit: string | null;
  profiles: ProfileAggregate[];
  maskedProfiles: number;
  departments: DepartmentAggregate[];
  // Départs classés des départements de moins de MIN_GROUP_SIZE départs (regroupés, sans détail)
  otherDepartments: number;
};

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

const TENURE = FEATURE_INDEX.tenure_months;

// Agrégats par profil, rien de nominatif. `classifiable` : départs ayant des variables à la veille du départ, opposés au
// traitement déjà retirés ; `total` : tous les départs volontaires visibles (les autres comptent comme non classés).
export function aggregateProfiles(b: TypologyBundle, total: number, classifiable: DepartureRow[], minGroup = MIN_GROUP_SIZE): TypologyAggregate {
  const members = new Map<number, number[]>(b.profiles.map((p) => [p.id, []]));
  const byDept = new Map<string, Map<number, number>>();
  let firstExit: string | null = null;
  let lastExit: string | null = null;
  let classified = 0;
  for (const r of classifiable) {
    if (!r.valuesJson) continue;
    const values = JSON.parse(r.valuesJson) as number[];
    if (values.length !== FEATURES.length) throw new Error(`Variables du départ ${r.exitId} : ${values.length} valeurs, ${FEATURES.length} attendues.`);
    const { profileId } = assignProfile(b, rawFromSnapshot(b, values));
    members.get(profileId)!.push(values[TENURE]);
    const dept = r.departmentName ?? "Sans département";
    if (!byDept.has(dept)) byDept.set(dept, new Map());
    const counts = byDept.get(dept)!;
    counts.set(profileId, (counts.get(profileId) ?? 0) + 1);
    classified++;
    if (!firstExit || r.exitDate < firstExit) firstExit = r.exitDate;
    if (!lastExit || r.exitDate > lastExit) lastExit = r.exitDate;
  }

  const sizes = b.profiles.map((p) => members.get(p.id)!.length);
  const masked = smallGroupMask(sizes, [], minGroup);
  const profiles: ProfileAggregate[] = b.profiles.map((p, i) => ({
    id: p.id,
    label: p.label,
    traits: p.traits.map((t) => ({ text: t.text, direction: t.direction })),
    stability: p.stability,
    departures: masked[i] ? null : sizes[i],
    share: masked[i] || !classified ? null : sizes[i] / classified,
    medianTenureMonths: masked[i] ? null : median(members.get(p.id)!),
    masked: masked[i],
  }));
  const visible = new Set(profiles.filter((p) => !p.masked && (p.departures ?? 0) > 0).map((p) => p.id));

  const departments: DepartmentAggregate[] = [];
  let otherDepartments = 0;
  for (const [department, counts] of byDept) {
    const n = [...counts.values()].reduce((s, v) => s + v, 0);
    if (n < minGroup) {
      otherDepartments += n;
      continue;
    }
    let top: [number, number] | null = null;
    for (const p of b.profiles) {
      const c = counts.get(p.id) ?? 0;
      if (visible.has(p.id) && c >= minGroup && (!top || c > top[1])) top = [p.id, c];
    }
    departments.push({ department, departures: n, topProfileId: top?.[0] ?? null, topShare: top ? top[1] / n : null });
  }
  departments.sort((x, y) => y.departures - x.departures || x.department.localeCompare(y.department, "fr"));

  return {
    total,
    classified,
    unclassified: total - classified,
    firstExit,
    lastExit,
    profiles,
    maskedProfiles: profiles.filter((p) => p.masked).length,
    departments,
    otherDepartments,
  };
}
