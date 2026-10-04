import { dbPath, openSqlite } from "../src/db/client";
import {
  ensureChampion,
  listModels,
  loadChampionState,
  promoteModel,
  registerBundle,
  rollbackModel,
  verifyModel,
} from "../src/lib/scoring";

const USAGE = `Usage : npx tsx scripts/model.ts <commande> [--user <id>]
  register <dossier>   enregistre un bundle (model.json + golden.json) comme CANDIDAT
  verify <version>     rejoue le golden (tolérance 1e-9) et contrôle l'empreinte des fichiers
  promote <version>    promeut la version (un seul CHAMPION, audit model.promote)
  rollback             repromeut le champion précédent
  list                 liste les versions enregistrées`;

function main() {
  const argv = process.argv.slice(2);
  const userIdx = argv.indexOf("--user");
  const userId = userIdx >= 0 ? Number(argv[userIdx + 1]) : null;
  const [cmd, arg] = argv.filter((_, i) => userIdx < 0 || (i !== userIdx && i !== userIdx + 1));
  if (!cmd || (["register", "verify", "promote"].includes(cmd) && !arg)) {
    console.log(USAGE);
    process.exitCode = cmd ? 1 : 0;
    return;
  }
  if (userId != null && !Number.isInteger(userId)) throw new Error("--user attend un identifiant numérique.");

  const sqlite = openSqlite();
  try {
    const state = loadChampionState(sqlite);
    if (!state.model && state.reason === "ABSENT") {
      ensureChampion(sqlite, userId);
      console.log("Aucun champion : le score à règles B0 a été enregistré et promu.");
    }
    switch (cmd) {
      case "register": {
        const id = registerBundle(sqlite, arg ?? "", userId);
        console.log(`Bundle enregistré (model_version.id = ${id}) depuis ${arg}.`);
        break;
      }
      case "verify": {
        const r = verifyModel(sqlite, arg ?? "");
        console.log(
          r.ok
            ? `OK : ${arg} — golden ${r.goldenRows} lignes, écart max ${r.maxDiff ?? "n/a"}.`
            : `ÉCHEC : ${arg}\n  - ${r.errors.join("\n  - ")}`,
        );
        if (!r.ok) process.exitCode = 1;
        break;
      }
      case "promote":
        promoteModel(sqlite, arg ?? "", userId);
        console.log(`${arg} est désormais le modèle champion.`);
        break;
      case "rollback":
        console.log(`Rollback : ${rollbackModel(sqlite, userId)} est de nouveau champion.`);
        break;
      case "list": {
        const rows = listModels(sqlite);
        console.log(`Base : ${dbPath()}`);
        for (const r of rows)
          console.log(
            `${r.status.padEnd(9)} ${r.version.padEnd(28)} ${r.kind.padEnd(6)} fsv=${r.fsv.padEnd(4)} créé ${r.createdAt.slice(0, 16)}` +
              (r.promotedAt ? `  promu ${r.promotedAt.slice(0, 16)}` : ""),
          );
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
