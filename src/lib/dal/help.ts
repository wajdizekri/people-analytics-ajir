import "server-only";
import { getDb } from "@/db/client";
import { DEFAULT_SETTINGS, getSetting } from "@/lib/settings";
import type { AccessContext } from "./context";

// Paramètres affichés dans le centre d'aide, filtrés par rôle : le manager n'a que la règle de décision des niveaux.
export type HelpSettings = {
  capacityRate: number;
  mediumLift: number;
  qualityThreshold: number | null;
  bradfordThreshold: number | null;
  modelKind: string | null;
};

export function getHelpSettings(ctx: AccessContext): HelpSettings {
  const { sqlite } = getDb();
  const num = (key: string) => {
    const v = Number(getSetting(sqlite, key));
    return Number.isFinite(v) && v > 0 ? v : Number(DEFAULT_SETTINGS[key]);
  };
  const staff = ctx.role === "ADMIN" || ctx.role === "RH";
  const champion = staff ? (sqlite.prepare("SELECT kind FROM model_version WHERE status = 'CHAMPION'").get() as { kind: string } | undefined) : undefined;
  return {
    capacityRate: num("capacity_rate"),
    mediumLift: num("medium_lift"),
    qualityThreshold: staff ? num("quality_threshold") : null,
    bradfordThreshold: ctx.role === "RH" ? num("bradford_threshold") : null,
    modelKind: champion?.kind ?? null,
  };
}
