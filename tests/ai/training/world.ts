import path from "node:path";
import { promoteTopicModel, registerTopicModel } from "@/lib/ai/registry";
import { buildWorld, openDalDb } from "../../fixtures/unit/dal-world";

export const BUNDLE_DIR = path.resolve(__dirname, "../../../models/training/formation-logreg-v1-20260930");
export const VERSION = "formation-logreg-v1-20260930";

// Monde DAL (REF 2025-06-30) + formations obligatoires : 4 échéances proches dans l'équipe directe de MGR, 1 pour S1 (équipe SUB),
// 1 pour X1 (équipe MGR2), 1 lointaine (T5), 1 pour T4 (sorti), 1 en retard (T3), 1 terminée à l'heure (T1).
export function trainingWorld(name: string) {
  const db = openDalDb(name);
  const w = buildWorld(db.sqlite);
  const { fx, e } = w;
  const open = (emp: number, code: string, due: string) =>
    fx.training(emp, { code, mandatory: true, start: "2025-12-01", due, hours: 4, status: "PLANIFIEE" });
  open(e.T1, "SST-T1", "2025-07-03");
  open(e.T2, "SST-T2", "2025-07-03");
  open(e.T3, "SST-T3", "2025-07-04");
  open(e.SUB, "SST-SUB", "2025-07-04");
  open(e.S1, "SST-S1", "2025-07-02");
  open(e.X1, "SST-X1", "2025-07-03");
  open(e.T5, "SST-T5", "2025-10-20");
  open(e.T4, "SST-T4", "2025-07-03");
  open(e.T3, "ISO-T3", "2025-05-15");
  fx.training(e.T1, { code: "ETH-T1", mandatory: true, start: "2025-03-10", end: "2025-03-10", due: "2025-04-01", hours: 3, status: "TERMINEE" });
  return { db, w };
}

export function promoteBundle(sqlite: ReturnType<typeof openDalDb>["sqlite"]) {
  registerTopicModel(sqlite, "FORMATION", BUNDLE_DIR);
  promoteTopicModel(sqlite, VERSION);
}
