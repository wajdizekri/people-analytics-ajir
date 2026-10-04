"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { updateSettingsAction, type SettingsState } from "@/app/(app)/admin/settings/actions";
import { cardCls, useActionToast } from "@/components/ui";
import { SETTINGS_UI, SETTING_GROUPS, boundMessage, fieldChange, inputError, toDisplay, typedToRaw, type EffectContext, type SettingGroup } from "./settings-labels";
import { SettingsNav } from "./settings-nav";
import { SettingRow, type SettingField, type SettingMeta } from "./settings-row";
import { SettingsSaveBar, type SettingChange } from "./settings-save-bar";
import {
  BudgetTable,
  SMIG_BOUNDS,
  SmigTable,
  budgetErrors,
  budgetInit,
  budgetJson,
  budgetKey,
  budgetSummary,
  smigErrors,
  smigInit,
  smigJson,
  smigKey,
  smigPeriods,
  smigTimeline,
  type BudgetRowState,
  type BudgetValue,
  type SmigPeriodValue,
  type SmigRow,
} from "./settings-tables";

export type { SettingField } from "./settings-row";
export type { BudgetValue, SmigPeriodValue } from "./settings-tables";

const toInput = (key: string, raw: string) => (raw === "" || !Number.isFinite(Number(raw)) ? raw : String(toDisplay(key, Number(raw))));
const plural = (n: number) => (n > 1 ? "s" : "");

// Refus de la DAL : ses messages de bornes sont repris dans l'unité affichée
function serverMessage(f: SettingField, msg: string) {
  const m = /^(Minimum|Maximum)\b/.exec(msg);
  return m && SETTINGS_UI[f.key] ? boundMessage(f, m[1] as "Minimum" | "Maximum") : msg;
}

export function SettingsForm({
  fields,
  context,
  smig,
  budgets,
}: {
  fields: SettingField[];
  context: Omit<EffectContext, "values">;
  smig: { periods: SmigPeriodValue[]; valid: boolean } & SettingMeta;
  budgets: { rows: BudgetValue[] } & SettingMeta;
}) {
  const [state, dispatch, pending] = useActionState<SettingsState, FormData>(updateSettingsAction, {});
  // Succès annoncé par un toast ; en cas de refus, le détail reste dans la barre d'enregistrement et sous chaque champ
  useActionToast(state, {
    error: "Paramètres non enregistrés",
    description: state.fieldErrors ? "Corrigez les champs signalés en rouge, puis enregistrez de nouveau." : state.error ? "Le motif est indiqué dans la barre d'enregistrement." : undefined,
  });
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, toInput(f.key, f.value)])));
  const [smigRows, setSmigRows] = useState<SmigRow[]>(() => smigInit(smig.periods));
  const [budgetRows, setBudgetRows] = useState<BudgetRowState[]>(() => budgetInit(budgets.rows));

  const byKey = new Map(fields.map((f) => [f.key, f]));
  const typedOf = (key: string) => (vals[key] ?? "").trim();
  const rawOf = (key: string) => typedToRaw(key, vals[key] ?? "");
  // Valeur envoyée au serveur : unité de stockage (les % sont reconvertis), ou saisie telle quelle si elle est illisible
  const sentOf = (key: string) => {
    const raw = rawOf(key);
    return typedOf(key) === "" ? "" : Number.isFinite(raw) ? String(raw) : typedOf(key);
  };
  const effectCtx: EffectContext = { ...context, values: Object.fromEntries(fields.map((f) => [f.key, rawOf(f.key)])) };

  // Refus du serveur : affiché tant que rien n'a été modifié depuis l'envoi refusé ; ensuite, les contrôles immédiats prennent le relais
  const sentNow = (key: string) => (key === "smig_schedule" ? smigJson(smigRows) : key === "budgets" ? budgetJson(budgetRows) : sentOf(key));
  const untouched = !!state.values && Object.entries(state.values).every(([key, sent]) => sent === sentNow(key));
  const refused = (key: string) => (untouched ? state.fieldErrors?.[key] : undefined);
  const refusal = state.fieldErrors && !untouched ? undefined : state.error;
  const errorOf = (f: SettingField) => {
    const server = refused(f.key);
    return inputError(f, vals[f.key] ?? "") ?? (server ? serverMessage(f, server) : null);
  };

  const smigField = byKey.get("smig_monthly");
  const smigBounds = smigField ? { min: smigField.min, max: smigField.max } : SMIG_BOUNDS;
  const smigErr = smigErrors(smigRows, smigBounds);
  const budgetErr = budgetErrors(budgetRows);

  const changes: SettingChange[] = fields.flatMap((f): SettingChange[] => {
    const change = fieldChange(f, vals[f.key] ?? "");
    return change ? [{ key: f.key, ...change }] : [];
  });
  const toFix = (n: number) => `${n} ligne${plural(n)} à corriger`;
  if (smigErr.size) changes.push({ key: "smig_schedule", text: `Barème SMIG daté : ${toFix(smigErr.size)}`, invalid: true });
  else if (smigKey(smigRows) !== smigKey(smigInit(smig.periods))) changes.push({ key: "smig_schedule", text: `Barème SMIG daté : ${smigTimeline(smigPeriods(smigRows))}` });
  if (budgetErr.size) changes.push({ key: "budgets", text: `Budgets de masse salariale : ${toFix(budgetErr.size)}`, invalid: true });
  else if (budgetKey(budgetRows) !== budgetKey(budgetInit(budgets.rows))) changes.push({ key: "budgets", text: `Budgets de masse salariale : ${budgetSummary(budgetRows)}` });
  const changedKeys = new Set(changes.map((c) => c.key));

  const grouped = new Set(SETTING_GROUPS.flatMap((g) => g.keys));
  const others = fields.filter((f) => !grouped.has(f.key) && SETTINGS_UI[f.key]).map((f) => f.key);
  const groups: SettingGroup[] = others.length ? [...SETTING_GROUPS, { id: "autres", title: "Autres réglages", nav: "Autres réglages", intro: "", keys: others }] : SETTING_GROUPS;
  const changedIn = (g: SettingGroup) =>
    g.keys.filter((k) => changedKeys.has(k)).length + (g.block === "smig" && changedKeys.has("smig_schedule") ? 1 : 0) + (g.block === "budgets" && changedKeys.has("budgets") ? 1 : 0);

  function reset() {
    setVals(Object.fromEntries(fields.map((f) => [f.key, toInput(f.key, f.value)])));
    setSmigRows(smigInit(smig.periods));
    setBudgetRows(budgetInit(budgets.rows));
  }

  // Envoi manuel (pas de réinitialisation du formulaire par React) ; valeurs affichées en % reconverties en valeurs stockées
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    for (const f of fields) data.set(f.key, sentOf(f.key));
    startTransition(() => dispatch(data));
  }

  const renderRow = (key: string) => {
    const f = byKey.get(key);
    const ui = SETTINGS_UI[key];
    if (!f || !ui) return null;
    const raw = rawOf(key);
    return (
      <SettingRow
        key={key}
        field={f}
        ui={ui}
        value={vals[key] ?? ""}
        raw={raw}
        changed={changedKeys.has(key)}
        error={errorOf(f)}
        effect={Number.isFinite(raw) ? ui.effect(raw, effectCtx) : null}
        onChange={(value) => setVals((all) => ({ ...all, [key]: value }))}
      />
    );
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
        <SettingsNav items={groups.map((g) => ({ id: g.id, label: g.nav, changed: changedIn(g) }))} />
        {/* Conteneur des requêtes de largeur sur la colonne, pas sur chaque carte : bulles d'aide et barre collante
            restent dans le même contexte d'empilement (une bulle n'est jamais recouverte par la carte suivante) */}
        <div className="@container min-w-0">
          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.id} id={g.id} aria-labelledby={`sg-${g.id}`} className={`${cardCls} min-w-0 scroll-mt-4`}>
                <div className="border-b border-line px-4 py-3 sm:px-5">
                  <h2 id={`sg-${g.id}`} className="text-base font-semibold text-heading">
                    {g.title}
                  </h2>
                  {g.intro && <p className="mt-0.5 text-sm text-fg-muted">{g.intro}</p>}
                </div>
                <div className="divide-y divide-line px-4 sm:px-5">
                  {g.keys.map(renderRow)}
                  {g.block === "smig" && (
                    <SmigTable
                      rows={smigRows}
                      setRows={setSmigRows}
                      errors={smigErr}
                      bounds={smigBounds}
                      valid={smig.valid}
                      changed={changedKeys.has("smig_schedule")}
                      serverError={refused("smig_schedule")}
                      meta={smig}
                    />
                  )}
                  {g.block === "budgets" && (
                    <BudgetTable
                      rows={budgetRows}
                      setRows={setBudgetRows}
                      errors={budgetErr}
                      changed={changedKeys.has("budgets")}
                      serverError={refused("budgets")}
                      meta={budgets}
                      labelledBy={`sg-${g.id}`}
                    />
                  )}
                </div>
              </section>
            ))}
          </div>

          <SettingsSaveBar changes={changes} refusal={refusal} pending={pending} onReset={reset} />
        </div>
      </div>
    </form>
  );
}
