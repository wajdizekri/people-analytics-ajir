import path from "node:path";
import { dbPath, openSqlite } from "../src/db/client";
import { buildCalendar } from "../src/lib/calendar";
import { runImport, RULES, type Rule } from "../src/lib/import";
import { refreshAggregates } from "../src/lib/aggregates";

// Usage : npm run import -- <dossier> [--user <id>]
function parseArgs(argv: string[]): { dir?: string; userId?: number } {
  let dir: string | undefined;
  let userId: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--user") userId = Number(argv[++i]);
    else if (!argv[i].startsWith("--")) dir ??= argv[i];
  }
  if (userId !== undefined && !Number.isInteger(userId)) throw new Error("--user attend un identifiant numérique");
  return { dir, userId };
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
const pct = (x: number | null) => (x === null ? "-" : `${(x * 100).toFixed(1).replace(".", ",")} %`);

async function main() {
  const { dir, userId } = parseArgs(process.argv.slice(2));
  if (!dir) {
    console.error("Usage : npm run import -- <dossier> [--user <id>]");
    process.exit(2);
  }
  const sqlite = openSqlite();
  const t0 = performance.now();
  const res = await runImport(sqlite, dir, { userId });
  const tImport = performance.now() - t0;

  // Plage du calendrier : faits importés (pointages, paie, absences), prolongée d'un an
  const span = sqlite
    .prepare(
      `SELECT MIN(d) AS first, MAX(d) AS last FROM (
         SELECT MIN(date) AS d FROM attendance_daily UNION ALL SELECT MAX(date) FROM attendance_daily
         UNION ALL SELECT MIN(month) || '-01' FROM payroll_monthly UNION ALL SELECT MAX(month) || '-01' FROM payroll_monthly
         UNION ALL SELECT MIN(start_date) FROM absence_episode UNION ALL SELECT MAX(end_date) FROM absence_episode
       ) WHERE d IS NOT NULL`,
    )
    .get() as { first: string | null; last: string | null };
  const thisYear = new Date().getFullYear();
  const fromYear = span.first ? Number(span.first.slice(0, 4)) : thisYear;
  const toYear = (span.last ? Number(span.last.slice(0, 4)) : thisYear) + 1;
  const t1 = performance.now();
  const days = buildCalendar(sqlite, fromYear, toYear);
  const tCal = performance.now() - t1;

  const t2 = performance.now();
  const aggRows = res.status === "ECHEC" ? 0 : refreshAggregates(sqlite);
  const tAgg = performance.now() - t2;

  const r = res.report;
  console.log(`\nImport AJIR « ${r.source} » (lot n° ${res.batchId}) — base ${path.relative(process.cwd(), dbPath())}`);
  console.log(`Statut : ${res.status} — score qualité ${pct(res.qualityScore)} (seuil ${pct(r.quality.threshold)})`);
  if (r.error) console.log(`Erreur : ${r.error}`);
  console.log("\nFichier                 lignes         ok     rejets     durée");
  for (const [file, f] of Object.entries(r.files)) {
    if (!f.present) {
      console.log(`${file.padEnd(20)}  absent`);
      continue;
    }
    console.log(
      `${file.padEnd(20)} ${String(f.rows).padStart(9)} ${String(f.ok).padStart(10)} ${String(f.rejected).padStart(10)} ${sec(f.durationMs).padStart(9)}${f.headerError ? `  (${f.headerError})` : ""}`,
    );
  }
  const rules = (Object.entries(r.rules) as [Rule, number][]).sort((a, b) => b[1] - a[1]);
  if (rules.length) {
    console.log("\nContrôles déclenchés :");
    for (const [rule, n] of rules) console.log(`  ${String(n).padStart(7)}  ${rule.padEnd(22)} ${RULES[rule].severity.padEnd(13)} ${RULES[rule].label}`);
  }
  if (r.quality.payrollMonth)
    console.log(`\nPaie ${r.quality.payrollMonth} : ${r.quality.activeWithoutPayroll} salarié(s) en poste sans paie sur ${r.quality.activeCount}`);
  console.log(`Fin des données (dernier pointage) : ${res.dataEndDate ?? "-"}`);
  if (r.users) {
    const u = r.users;
    console.log(
      `Comptes : ${u.created.length} créé(s), ${u.reactivated.length} réactivé(s), ${u.deactivated.length} désactivé(s), ${u.updated} mis à jour, ${u.protectedAdmins.length} admin(s) protégé(s)`,
    );
  }
  if (res.activationLinks.length) {
    console.log("\nLiens d'activation (valables 7 jours, non conservés en clair — à transmettre maintenant) :");
    for (const l of res.activationLinks) console.log(`  ${l.login.padEnd(20)} ${l.link}`);
  }
  console.log(`\nDurées : import ${sec(tImport)} · calendrier ${fromYear}-${toYear} (${days} jours) ${sec(tCal)} · agrégats (${aggRows} lignes) ${sec(tAgg)}`);
  console.log(`Total : ${sec(performance.now() - t0)}`);
  sqlite.close();
  process.exitCode = res.status === "ECHEC" ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
