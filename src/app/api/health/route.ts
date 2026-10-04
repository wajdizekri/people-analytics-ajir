import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { getSystemHealth } from "@/lib/dal/imports";

// 503 si la base est inaccessible ou si le worker est hors service (aucun signal depuis plus de 10 min, état PERIME,
// seuil de l'alerte « Worker de calcul arrêté ») ; 200 sinon, y compris « degrade » (worker en retard, jamais démarré,
// champion absent) : lire `status`. Corps limité à des états, sans chemin, version ni donnée métier.
export const GET = withApi(async () => {
  const health = getSystemHealth();
  const down = health.database !== "ok" || health.worker.state === "PERIME";
  return NextResponse.json(health, {
    status: down ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
});
