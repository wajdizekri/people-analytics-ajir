import "server-only";
import { getDb } from "@/db/client";
import { MIN_DEPARTURES_FOR_PROFILES, aggregateProfiles, type DepartmentAggregate, type ProfileAggregate, type TypologyAggregate } from "@/lib/ai/typology/aggregate";
import { loadTypologyModel } from "@/lib/ai/typology/bundle";
import { departureRows } from "@/lib/ai/typology/departures";
import type { TypologyBundle } from "@/lib/ai/typology/model";
import { excludeOpposed } from "@/lib/privacy/opposition";
import { ensurePilotage, isGlobal, type AccessContext } from "./context";
import { referenceDate } from "./employees";
import { MIN_GROUP_SIZE } from "./pilotage-metrics";

export type DepartureProfilesStatus = "OK" | "MODELE_ABSENT" | "MODELE_INVALIDE" | "TROP_PEU";

export type DepartureProfilesDto = {
  status: DepartureProfilesStatus;
  referenceDate: string;
  model: { version: string; trainedAt: string | null; trainFrom: string | null; trainTo: string | null; k: number; minProfileSize: number } | null;
  // Départs volontaires visibles ; classés = avec variables à la veille du départ, hors opposés au traitement
  total: number;
  classified: number;
  unclassified: number;
  firstExit: string | null;
  lastExit: string | null;
  profiles: ProfileAggregate[];
  maskedProfiles: number;
  departments: DepartmentAggregate[];
  otherDepartments: number;
  minGroupSize: number;
  minDepartures: number;
};

const empty = (status: DepartureProfilesStatus, ref: string): DepartureProfilesDto => ({
  status,
  referenceDate: ref,
  model: null,
  total: 0,
  classified: 0,
  unclassified: 0,
  firstExit: null,
  lastExit: null,
  profiles: [],
  maskedProfiles: 0,
  departments: [],
  otherDepartments: 0,
  minGroupSize: MIN_GROUP_SIZE,
  minDepartures: MIN_DEPARTURES_FOR_PROFILES,
});

// ---------- Cache mémoire ----------
// Clé : modèle, référence et version des données (dernier import, agrégats, run publié, variables mensuelles, oppositions),
// relue à chaque appel (requêtes indexées, quelques ms contre ~130 ms pour la sélection et l'affectation des départs).
// Une écriture du worker ou d'un script change la clé ; durée de vie bornée par sécurité, comme dal/dashboard.ts.
const CACHE_MAX = 8;
const CACHE_TTL_MS = 10 * 60_000;
const profilesCache = new Map<string, { at: number; agg: TypologyAggregate }>();

export function clearDepartureProfilesCache(): void {
  profilesCache.clear();
}

function dataVersion(fsv: string): string {
  const v = getDb()
    .sqlite.prepare(
      `SELECT (SELECT id || ':' || status || ':' || IFNULL(finished_at, '') FROM import_batch ORDER BY id DESC LIMIT 1) AS lastImport,
         (SELECT value FROM app_setting WHERE key = 'aggregates_refreshed_at') AS aggregates,
         (SELECT value FROM app_setting WHERE key = 'current_run_id') AS run,
         (SELECT COUNT(*) || ':' || IFNULL(MAX(as_of), '') FROM feature_snapshot WHERE fsv = @fsv) AS snapshots,
         (SELECT COUNT(*) || ':' || IFNULL(MAX(employee_id), '') || ':' || IFNULL(SUM(employee_id), '') FROM employee_opposition) AS opposition,
         (SELECT COUNT(*) || ':' || IFNULL(MAX(id), '') FROM exit_event) AS exits`,
    )
    .get({ fsv });
  return JSON.stringify(v);
}

function cachedAggregate(b: TypologyBundle, ref: string): TypologyAggregate {
  const key = JSON.stringify([b.version, b.trained_at ?? "", ref, dataVersion(b.fsv)]);
  const now = Date.now();
  const hit = profilesCache.get(key);
  profilesCache.delete(key);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    profilesCache.set(key, hit);
    return hit.agg;
  }
  const sqlite = getDb().sqlite;
  const rows = departureRows(sqlite, ref, b.fsv);
  // Opposition (loi 2004-63, art. 42) : rattacher un départ à un profil est un traitement individuel ; les opposés
  // restent comptés parmi les départs, non classés
  const classifiable = excludeOpposed(
    sqlite,
    rows.filter((r) => r.valuesJson != null),
  );
  const agg = aggregateProfiles(b, rows.length, classifiable);
  profilesCache.set(key, { at: now, agg });
  if (profilesCache.size > CACHE_MAX) profilesCache.delete(profilesCache.keys().next().value!);
  return agg;
}

// Profils types de départs (vue RH seule) : agrégats par profil et par département, rien de nominatif. Le manager n'y a pas
// accès (null) : sur une hiérarchie de 5 à 12 personnes, un départ par profil se déduirait. ADMIN : 403 audité.
export function getDepartureProfiles(ctx: AccessContext): DepartureProfilesDto | null {
  ensurePilotage(ctx, "retention.view", { type: "page", id: "/retention" });
  if (!isGlobal(ctx)) return null;
  const ref = referenceDate();
  const model = loadTypologyModel();
  if (model.status === "ABSENT") return empty("MODELE_ABSENT", ref);
  if (model.status === "INVALIDE") return empty("MODELE_INVALIDE", ref);

  const b = model.bundle;
  const agg = cachedAggregate(b, ref);
  return {
    ...empty(agg.classified < MIN_DEPARTURES_FOR_PROFILES ? "TROP_PEU" : "OK", ref),
    model: {
      version: b.version,
      trainedAt: b.trained_at ?? null,
      trainFrom: b.train_from ?? null,
      trainTo: b.train_to ?? null,
      k: b.profiles.length,
      minProfileSize: b.min_profile_size,
    },
    total: agg.total,
    classified: agg.classified,
    unclassified: agg.unclassified,
    firstExit: agg.firstExit,
    lastExit: agg.lastExit,
    ...(agg.classified < MIN_DEPARTURES_FOR_PROFILES
      ? {}
      : { profiles: agg.profiles, maskedProfiles: agg.maskedProfiles, departments: agg.departments, otherDepartments: agg.otherDepartments }),
  };
}
