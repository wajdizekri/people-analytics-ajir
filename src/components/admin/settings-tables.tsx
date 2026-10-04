import type { Dispatch, SetStateAction } from "react";
import { InfoTip } from "@/components/help/info-tip";
import { Badge, Button, fmt } from "@/components/ui";
import { frNum, parseNum } from "./settings-labels";
import { lastChange, type SettingMeta } from "./settings-row";

// Réglages en tableau : barème SMIG daté et budgets annuels de masse salariale (saisie, contrôles immédiats, résumé en clair).

export type SmigPeriodValue = { from: string | null; value: number };
export type BudgetValue = { year: number; amount: number };
export type SmigRow = { id: number; from: string; value: string };
export type BudgetRowState = { id: number; year: string; amount: string };
/** Erreurs d'une ligne : `when` pour la date d'effet ou l'année, `amount` pour le montant. */
export type RowErrors = Map<number, { when?: string; amount?: string }>;

export const SMIG_BOUNDS = { min: 100, max: 5000 };
const YEARS = { min: 2000, max: 2100 };
const BUDGET_MIN = 1000;

const nextId = (rows: { id: number }[]) => Math.max(-1, ...rows.map((r) => r.id)) + 1;
const typed = (s: string) => (s.trim() === "" ? null : parseNum(s));

export const smigInit = (p: SmigPeriodValue[]): SmigRow[] => p.map((x, i) => ({ id: i, from: x.from ?? "", value: String(x.value) }));
export const budgetInit = (b: BudgetValue[]): BudgetRowState[] => b.map((x, i) => ({ id: i, year: String(x.year), amount: String(x.amount) }));

// Valeur envoyée au serveur ; la DAL valide et trie
export const smigJson = (rows: SmigRow[]) => JSON.stringify(rows.map((r) => ({ from: r.from || null, value: typed(r.value) })));
export const budgetJson = (rows: BudgetRowState[]) => JSON.stringify(rows.map((r) => ({ year: typed(r.year), amount: typed(r.amount) })));

// Comparaison à l'état enregistré sans tenir compte de l'ordre des lignes : la DAL trie à l'enregistrement
export const smigKey = (rows: SmigRow[]) => smigJson([...rows].sort((a, b) => a.from.localeCompare(b.from)));
export const budgetKey = (rows: BudgetRowState[]) => budgetJson([...rows].sort((a, b) => (typed(a.year) ?? 0) - (typed(b.year) ?? 0)));

// Contrôles immédiats, alignés sur ceux de la DAL (smigScheduleSchema, budgetsSchema), seule juge à l'enregistrement
export function smigErrors(rows: SmigRow[], bounds = SMIG_BOUNDS): RowErrors {
  const out: RowErrors = new Map();
  const firstUndated = rows.find((r) => r.from === "")?.id;
  for (const r of rows) {
    const e: { when?: string; amount?: string } = {};
    if (r.from === "") {
      if (r.id !== firstUndated) e.when = "Saisissez la date d'effet.";
    } else if (rows.some((x) => x.id !== r.id && x.from === r.from)) e.when = "Date déjà utilisée par une autre période.";
    const v = typed(r.value);
    if (v === null) e.amount = "Saisissez un montant.";
    else if (!Number.isFinite(v)) e.amount = "Saisissez un nombre.";
    else if (v < bounds.min || v > bounds.max) e.amount = `Entre ${frNum(bounds.min, 0)} et ${frNum(bounds.max, 0)} TND.`;
    if (e.when || e.amount) out.set(r.id, e);
  }
  return out;
}

export function budgetErrors(rows: BudgetRowState[]): RowErrors {
  const out: RowErrors = new Map();
  for (const r of rows) {
    const e: { when?: string; amount?: string } = {};
    const y = typed(r.year);
    if (y === null) e.when = "Saisissez une année.";
    else if (!Number.isInteger(y) || y < YEARS.min || y > YEARS.max) e.when = `Entre ${YEARS.min} et ${YEARS.max}.`;
    else if (rows.some((x) => x.id !== r.id && typed(x.year) === y)) e.when = "Année déjà saisie.";
    const a = typed(r.amount);
    if (a === null) e.amount = "Saisissez un montant.";
    else if (!Number.isFinite(a)) e.amount = "Saisissez un nombre.";
    else if (a < BUDGET_MIN) e.amount = `Au moins ${frNum(BUDGET_MIN, 0)} TND.`;
    if (e.when || e.amount) out.set(r.id, e);
  }
  return out;
}

const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const tnd3 = (n: number) => `${frNum(n, 3)} TND`;

// Barème en clair : « 528,32 TND jusqu'au 31/12/2025, puis 554,736 TND à partir du 01/01/2026 »
export function smigTimeline(periods: SmigPeriodValue[]): string {
  const sorted = [...periods].sort((a, b) => (a.from ?? "").localeCompare(b.from ?? ""));
  return sorted
    .map((p, i) => {
      const next = sorted[i + 1]?.from;
      if (!p.from) return next ? `${tnd3(p.value)} jusqu'au ${fmt.date(dayBefore(next))}` : `${tnd3(p.value)} sans limite de date`;
      return next ? `${tnd3(p.value)} du ${fmt.date(p.from)} au ${fmt.date(dayBefore(next))}` : `${tnd3(p.value)} à partir du ${fmt.date(p.from)}`;
    })
    .join(", puis ");
}

export const smigPeriods = (rows: SmigRow[]): SmigPeriodValue[] => rows.map((r) => ({ from: r.from || null, value: parseNum(r.value) }));

const byYear = (rows: BudgetRowState[]) => [...rows].sort((a, b) => parseNum(a.year) - parseNum(b.year));
// « 2026 : 1 717 368 TND ; 2027 : 1 800 000 TND » (lignes valides)
export const budgetSummary = (rows: BudgetRowState[]) =>
  rows.length ? byYear(rows).map((r) => `${r.year.trim()} : ${fmt.tnd(parseNum(r.amount))}`).join(" ; ") : "aucun budget";
// « 2026 », « 2026 et 2027 », « 2026, 2027 et 2028 »
export const budgetYears = (rows: BudgetRowState[]) => {
  const years = byYear(rows).map((r) => r.year.trim());
  return years.length <= 1 ? years.join("") : `${years.slice(0, -1).join(", ")} et ${years[years.length - 1]}`;
};

const cellCls =
  "block min-h-10 w-full rounded-control border bg-surface px-2.5 py-1.5 text-sm tabular-nums text-fg transition-colors duration-150 focus:outline-none focus:ring-2";
const tone = (err?: string) => (err ? "border-danger focus:ring-danger/25" : "border-line-strong hover:border-fg-muted focus:border-primary focus:ring-primary/25");
const wrapCls = "mt-3 overflow-x-auto rounded-control border border-line";
const theadCls = "border-b border-line bg-surface-2 text-xs text-fg-muted";
const thCls = "px-2 py-2 font-semibold sm:px-3";
const tdCls = "px-2 py-2 sm:px-3";
const errCls = "text-xs font-medium text-danger";

export function SmigTable({
  rows,
  setRows,
  errors,
  bounds = SMIG_BOUNDS,
  valid,
  changed,
  serverError,
  meta,
}: {
  rows: SmigRow[];
  setRows: Dispatch<SetStateAction<SmigRow[]>>;
  errors: RowErrors;
  bounds?: { min: number; max: number };
  /** Barème enregistré lisible ; sinon le contrôle utilise le SMIG de repli. */
  valid: boolean;
  changed: boolean;
  serverError?: string;
  meta: SettingMeta;
}) {
  const edit = (id: number, patch: Partial<SmigRow>) => setRows((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <div role="group" aria-labelledby="smig-titre" aria-describedby={`smig-help${serverError ? " smig-err" : ""}`} className="py-4">
      <div className="relative">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <h3 id="smig-titre" className="text-sm font-semibold text-fg">
            Barème SMIG daté
          </h3>
          <InfoTip label="Barème SMIG daté" align="start" className="static!">
            Le SMIG en vigueur le 1er du mois de paie s&apos;applique. La première période peut rester sans date : elle couvre tout ce qui précède.
          </InfoTip>
          {changed && <Badge tone="warning">Modifié</Badge>}
        </div>
        <p id="smig-help" className="mt-0.5 text-xs text-fg-muted">
          Montants : {frNum(bounds.min, 0)} à {frNum(bounds.max, 0)} TND
        </p>
      </div>
      {!valid && <p className="mt-2 text-xs font-medium text-warning">Barème illisible : SMIG de repli utilisé</p>}
      {/* Barème illisible et non retouché : non envoyé, pour ne pas bloquer l'enregistrement des autres réglages */}
      {(valid || rows.length > 0) && <input type="hidden" name="smig_schedule" value={smigJson(rows)} />}
      {rows.length > 0 && (
        <div className={wrapCls}>
          <table className="w-full text-left text-sm text-fg">
            <caption className="sr-only">Périodes du barème SMIG</caption>
            <thead className={theadCls}>
              <tr>
                <th scope="col" className={thCls}>
                  À partir du
                </th>
                <th scope="col" className={`${thCls} text-right`}>
                  SMIG mensuel (TND)
                </th>
                <th scope="col" className={`${thCls} w-px`}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => {
                const e = errors.get(r.id);
                const dateNote = e?.when ? `smig-${r.id}-date-err` : r.from === "" ? `smig-${r.id}-date-aide` : undefined;
                return (
                  <tr key={r.id} className="align-top">
                    <td className={tdCls}>
                      <input
                        type="date"
                        aria-label={`Date d'effet de la période ${i + 1}`}
                        value={r.from}
                        onChange={(ev) => edit(r.id, { from: ev.target.value })}
                        aria-invalid={!!e?.when}
                        aria-describedby={dateNote}
                        className={`${cellCls} ${tone(e?.when)} min-w-32 sm:w-44`}
                      />
                      {e?.when ? (
                        <p id={dateNote} className={`mt-1 ${errCls}`}>
                          {e.when}
                        </p>
                      ) : (
                        r.from === "" && (
                          <p id={dateNote} className="mt-1 text-xs text-fg-subtle">
                            Sans date : période initiale
                          </p>
                        )
                      )}
                    </td>
                    <td className={tdCls}>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={bounds.min}
                        max={bounds.max}
                        step={0.001}
                        aria-label={`SMIG mensuel de la période ${i + 1} (TND)`}
                        value={r.value}
                        onChange={(ev) => edit(r.id, { value: ev.target.value })}
                        aria-invalid={!!e?.amount}
                        aria-describedby={e?.amount ? `smig-${r.id}-montant-err` : undefined}
                        className={`${cellCls} ${tone(e?.amount)} ml-auto min-w-24 text-right sm:w-44`}
                      />
                      {e?.amount && (
                        <p id={`smig-${r.id}-montant-err`} className={`mt-1 text-right ${errCls}`}>
                          {e.amount}
                        </p>
                      )}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <Button
                        size="sm"
                        variant="tertiary"
                        disabled={rows.length <= 1}
                        title={rows.length <= 1 ? "Le barème doit garder au moins une période" : undefined}
                        onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))}
                      >
                        Retirer<span className="sr-only"> la période {i + 1}</span>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Button size="sm" icon="plus" className="mt-3" onClick={() => setRows((all) => [...all, { id: nextId(all), from: "", value: all.at(-1)?.value ?? "" }])}>
        Ajouter une période
      </Button>
      {serverError && (
        <p id="smig-err" className={`mt-2 ${errCls}`}>
          {serverError}
        </p>
      )}
      {rows.length > 0 && errors.size === 0 && (
        <p className="mt-3 text-sm text-fg">
          <span className="font-semibold">Barème : </span>
          {smigTimeline(smigPeriods(rows))}
        </p>
      )}
      <p className="mt-1 text-xs text-fg-subtle">{lastChange(meta, !meta.updatedBy)}</p>
    </div>
  );
}

export function BudgetTable({
  rows,
  setRows,
  errors,
  changed,
  serverError,
  meta,
  labelledBy,
}: {
  rows: BudgetRowState[];
  setRows: Dispatch<SetStateAction<BudgetRowState[]>>;
  errors: RowErrors;
  changed: boolean;
  serverError?: string;
  meta: SettingMeta;
  /** id du titre de la carte, qui nomme le groupe. */
  labelledBy: string;
}) {
  const edit = (id: number, patch: Partial<BudgetRowState>) => setRows((all) => all.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const addYear = () => {
    const thisYear = new Date().getFullYear();
    setRows((all) => {
      const years = all.map((r) => typed(r.year)).filter((y): y is number => y !== null && Number.isFinite(y));
      return [...all, { id: nextId(all), year: String(years.length ? Math.max(...years) + 1 : thisYear), amount: "" }];
    });
  };
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={`budgets-help${serverError ? " budgets-err" : ""}`} className="py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p id="budgets-help" className="text-xs text-fg-muted">
          Montant brut annuel, par année civile
        </p>
        {changed && <Badge tone="warning">Modifié</Badge>}
      </div>
      <input type="hidden" name="budgets" value={budgetJson(rows)} />
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">Aucun budget saisi</p>
      ) : (
        <div className={wrapCls}>
          <table className="w-full text-left text-sm text-fg">
            <caption className="sr-only">Budgets annuels de masse salariale</caption>
            <thead className={theadCls}>
              <tr>
                <th scope="col" className={thCls}>
                  Année
                </th>
                <th scope="col" className={`${thCls} text-right`}>
                  Budget brut annuel (TND)
                </th>
                <th scope="col" className={`${thCls} w-px`}>
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r, i) => {
                const e = errors.get(r.id);
                const name = r.year.trim() || i + 1;
                const amount = typed(r.amount);
                return (
                  <tr key={r.id} className="align-top">
                    <td className={tdCls}>
                      <input
                        type="number"
                        min={YEARS.min}
                        max={YEARS.max}
                        step={1}
                        aria-label={`Année du budget ${i + 1}`}
                        value={r.year}
                        onChange={(ev) => edit(r.id, { year: ev.target.value })}
                        aria-invalid={!!e?.when}
                        aria-describedby={e?.when ? `budget-${r.id}-annee-err` : undefined}
                        className={`${cellCls} ${tone(e?.when)} min-w-20 sm:w-28`}
                      />
                      {e?.when && (
                        <p id={`budget-${r.id}-annee-err`} className={`mt-1 ${errCls}`}>
                          {e.when}
                        </p>
                      )}
                    </td>
                    <td className={tdCls}>
                      <input
                        type="number"
                        inputMode="decimal"
                        min={BUDGET_MIN}
                        step={1}
                        aria-label={`Budget brut ${name} (TND)`}
                        value={r.amount}
                        onChange={(ev) => edit(r.id, { amount: ev.target.value })}
                        aria-invalid={!!e?.amount}
                        aria-describedby={e?.amount ? `budget-${r.id}-montant-err` : undefined}
                        className={`${cellCls} ${tone(e?.amount)} ml-auto min-w-28 text-right sm:w-44`}
                      />
                      {e?.amount ? (
                        <p id={`budget-${r.id}-montant-err`} className={`mt-1 text-right ${errCls}`}>
                          {e.amount}
                        </p>
                      ) : (
                        // Montant relu avec séparateurs de milliers : le champ numérique n'en affiche pas
                        amount !== null && <p className="mt-1 text-right text-xs tabular-nums text-fg-subtle">{fmt.tnd(amount)}</p>
                      )}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <Button size="sm" variant="tertiary" onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))}>
                        Retirer<span className="sr-only"> le budget {name}</span>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Button size="sm" icon="plus" className="mt-3" onClick={addYear}>
        Ajouter une année
      </Button>
      {serverError && (
        <p id="budgets-err" className={`mt-2 ${errCls}`}>
          {serverError}
        </p>
      )}
      {rows.length > 0 && errors.size === 0 && (
        <p className="mt-3 text-sm text-fg">
          <span className="font-semibold">Recommandations budgétaires : </span>
          {budgetYears(rows)}
        </p>
      )}
      <p className="mt-1 text-xs text-fg-subtle">{meta.updatedAt ? lastChange(meta) : "Aucun budget enregistré"}</p>
    </div>
  );
}
