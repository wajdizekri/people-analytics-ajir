// Génère tests/security/.fixtures.json depuis sec.db (ids de périmètre, valeurs sensibles, alertes, comptes).
// Usage : node tests/security/gen-fixtures.cjs   (DATABASE_PATH=data/sec.db par défaut)
const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");

const DB_FILE = process.env.DATABASE_PATH || path.resolve(process.cwd(), "data/sec.db");
const MANAGER_LOGIN = process.env.SEC_MANAGER_LOGIN || "mgr.M10451";
const db = new Database(DB_FILE, { readonly: true });
const q = (s, ...a) => db.prepare(s).all(...a);
const g = (s, ...a) => db.prepare(s).get(...a);

const mgr = g("SELECT id, employee_id FROM app_user WHERE login = ?", MANAGER_LOGIN);
if (!mgr) throw new Error(`Manager ${MANAGER_LOGIN} introuvable dans ${DB_FILE}`);
const scopeRoot = mgr.employee_id;
const sub = `WITH RECURSIVE team(id) AS (SELECT id FROM employee WHERE manager_id=@r UNION SELECT e.id FROM employee e JOIN team t ON e.manager_id=t.id) SELECT id FROM team`;
const inScope = q(`SELECT id FROM (${sub})`, { r: scopeRoot }).map((x) => x.id);
const outScope = q(`SELECT id FROM employee WHERE id NOT IN (${sub}) AND id<>@r ORDER BY id LIMIT 5`, { r: scopeRoot }).map((x) => x.id);
const runId = Number(g("SELECT value FROM app_setting WHERE key='current_run_id'")?.value) || -1;
const inScopeScored = g(`SELECT e.id FROM employee e JOIN prediction p ON p.employee_id=e.id AND p.run_id=@run WHERE e.id IN (${sub}) LIMIT 1`, { r: scopeRoot, run: runId });
const scoredOut = g(`SELECT e.id FROM employee e JOIN prediction p ON p.employee_id=e.id AND p.run_id=@run JOIN payroll_monthly pm ON pm.employee_id=e.id WHERE e.id NOT IN (${sub}) LIMIT 1`, { r: scopeRoot, run: runId });
const maxEmp = g("SELECT MAX(id) m FROM employee").m;

const nums = [
  ...q("SELECT DISTINCT base_salary v FROM payroll_monthly WHERE base_salary IS NOT NULL LIMIT 60"),
  ...q("SELECT DISTINCT gross_salary v FROM payroll_monthly WHERE gross_salary IS NOT NULL LIMIT 60"),
  ...q("SELECT DISTINCT prob6 v FROM prediction WHERE prob6 IS NOT NULL LIMIT 60"),
  ...q("SELECT DISTINCT lift v FROM prediction WHERE lift IS NOT NULL LIMIT 60"),
  ...q("SELECT DISTINCT payroll_mass v FROM agg_kpi_monthly WHERE payroll_mass IS NOT NULL LIMIT 30"),
].map((r) => r.v);
const oldNew = q("SELECT old_value a, new_value b FROM career_event WHERE type='AUGMENTATION' LIMIT 60");
for (const r of oldNew) { nums.push(Number(r.a), Number(r.b)); }
const sensitiveNumbers = [...new Set(nums)].filter((v) => Number.isFinite(v) && v !== 0 && !Number.isInteger(v));
const phrases = q("SELECT DISTINCT phrase_rh p FROM prediction_factor WHERE phrase_rh IS NOT NULL LIMIT 40").map((r) => r.p);
const outNames = q(`SELECT last_name, first_name FROM employee WHERE id NOT IN (${sub}) AND id<>@r`, { r: scopeRoot });
const inNames = q(`SELECT last_name, first_name FROM employee WHERE id IN (${sub})`, { r: scopeRoot });

const out = {
  scopeRoot, runId, maxEmp,
  inScope: inScope.slice(0, 5), inScopeCount: inScope.length, outScope,
  inScopeScored: inScopeScored?.id ?? null, scoredOut: scoredOut?.id ?? null,
  anyAlert: g("SELECT id FROM alert ORDER BY id LIMIT 1")?.id ?? null,
  maxAlert: g("SELECT MAX(id) m FROM alert").m ?? 0,
  imp: g("SELECT MAX(id) m FROM import_batch").m ?? 0,
  reco: g("SELECT id, employee_id, status FROM recommendation WHERE status='PROPOSEE' LIMIT 1") ?? null,
  recoOut: g(`SELECT id FROM recommendation WHERE employee_id NOT IN (${sub}) LIMIT 1`, { r: scopeRoot })?.id ?? null,
  users: q("SELECT id, login, role FROM app_user ORDER BY id LIMIT 5"),
  depts: q("SELECT id FROM department LIMIT 3").map((r) => r.id),
  sensitiveNumbers, phrases, outNames, inNames,
};
db.close();
const dest = path.resolve(__dirname, ".fixtures.json");
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`Fixtures écrites : ${dest} — périmètre ${out.inScopeCount} salariés, ${sensitiveNumbers.length} valeurs sensibles, ${outNames.length} noms hors périmètre.`);
