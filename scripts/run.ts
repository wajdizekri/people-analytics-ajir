import { dbPath, openSqlite } from "../src/db/client";
import { supersedeSameMonthEffects } from "../src/lib/engine/recommendations";
import { listRuns, rollbackRun } from "../src/lib/jobs/runs";
import { getSetting } from "../src/lib/settings";

const USAGE = `Usage : npx tsx scripts/run.ts <commande> [--user <id>] [--force] [--apply]
  list [n]             derniers calculs (défaut 24) ; * = calcul publié courant, P = déjà publié comme courant
  rollback <runId>     repointe le calcul publié courant vers un run PUBLIE antérieur (audité scoring.rollback)
  supersede            mois recalculé avec un autre modèle : recommandations encore proposées d'un autre calcul du même
                       mois et non reproposées → REJETEE, alertes de risque devenues sans objet → REJETEE,
                       alertes antérieures encore valables → facteurs du calcul courant
                       (simulation ; --apply pour écrire, audité scoring.supersede)
  --force              autorise un run jamais publié comme courant (backtest) ou un calcul en cours`;

function main() {
  const argv = process.argv.slice(2);
  const userIdx = argv.indexOf("--user");
  const userId = userIdx >= 0 ? Number(argv[userIdx + 1]) : null;
  const force = argv.includes("--force");
  const apply = argv.includes("--apply");
  const [cmd, arg] = argv.filter((a, i) => a !== "--force" && a !== "--apply" && (userIdx < 0 || (i !== userIdx && i !== userIdx + 1)));
  if (userId != null && !Number.isInteger(userId)) throw new Error("--user attend un identifiant numérique.");
  if (!cmd || (cmd === "rollback" && !/^\d+$/.test(arg ?? "")) || (cmd === "list" && arg !== undefined && !/^\d+$/.test(arg))) {
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  const sqlite = openSqlite();
  try {
    switch (cmd) {
      case "list": {
        console.log(`Base : ${dbPath()}`);
        console.log("   id  coupure     statut   scorés  modèle");
        for (const r of listRuns(sqlite, arg ? Number(arg) : 24))
          console.log(
            `${r.current ? "*" : " "}${r.everCurrent ? "P" : " "}${String(r.id).padStart(4)}  ${r.asOf}  ${r.status.padEnd(7)} ${String(r.nScored).padStart(6)}  ${r.model} (${r.kind})` +
              (r.finishedAt ? `  fini ${r.finishedAt.slice(0, 16)}` : ""),
          );
        break;
      }
      case "rollback": {
        const r = rollbackRun(sqlite, Number(arg), { userId, force });
        console.log(`Calcul publié courant : run ${r.to} au ${r.asOf} (${r.model}), à la place du run ${r.from ?? "—"}.`);
        console.log(
          "Les recommandations et alertes déjà créées restent en place. Le prochain batch mensuel (ou Recalcul mensuel) republiera le dernier mois complet.",
        );
        break;
      }
      case "supersede": {
        const current = Number(getSetting(sqlite, "current_run_id"));
        if (!Number.isInteger(current) || current <= 0) throw new Error("Aucun calcul publié courant.");
        const r = supersedeSameMonthEffects(sqlite, current, { apply, userId });
        console.log(`Base : ${dbPath()} — calcul courant : run ${r.runId} au ${r.asOf}`);
        console.log(`  recommandations non reproposées → REJETEE : ${r.rejected.length}`);
        console.log(`  recommandations reproposées, rattachées au run ${r.runId} : ${r.relinked.length}`);
        console.log(`  alertes de risque sans objet → REJETEE : ${r.alerts.length}${r.alerts.length ? ` (ids ${r.alerts.join(", ")})` : ""}`);
        console.log(`  alertes de risque antérieures, message recalculé : ${r.refreshed.length}${r.refreshed.length ? ` (ids ${r.refreshed.join(", ")})` : ""}`);
        console.log(r.applied ? "Écrit et audité (scoring.supersede)." : "Simulation : rien n'est écrit. Relancer avec --apply.");
        break;
      }
      default:
        console.log(USAGE);
        process.exitCode = 1;
    }
  } catch (e) {
    console.error(`Erreur : ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    sqlite.close();
  }
}

main();
