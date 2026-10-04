"use client";

import Form from "next/form";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Button, ButtonLink, FormActions } from "@/components/ui";
import { toast } from "@/components/ui/toast";

const inputCls =
  "h-10 rounded-control border border-line-strong bg-surface px-2.5 text-sm tabular-nums text-fg transition-colors duration-200 placeholder:text-fg-subtle hover:border-fg-muted focus:border-primary";
// Curseur : piste remplie jusqu'à la valeur (dégradé en ligne), pouce agrandi au survol et à la saisie
const thumb =
  "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-card [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-150 hover:[&::-webkit-slider-thumb]:scale-110 active:[&::-webkit-slider-thumb]:scale-125 " +
  "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:transition-transform hover:[&::-moz-range-thumb]:scale-110 active:[&::-moz-range-thumb]:scale-125";
const rangeCls = `h-2 w-full cursor-pointer appearance-none rounded-full ${thumb}`;
const legendCls = "flex flex-wrap items-center gap-2 text-sm font-semibold text-heading";
const helpCls = "mt-0.5 text-xs text-fg-muted";
// Borne haute du rythme des embauches, identique à la validation serveur (workforceScenarioSchema : 0 à 300)
const HIRING_MAX = 300;
const dec = (v: number, d = 1) => v.toLocaleString("fr-FR", { maximumFractionDigits: d });
const num = (s: string | null | undefined) => {
  if (s == null || s.trim() === "") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const same = (a: number | null, b: number | null) => (a == null || b == null ? a === b : Math.abs(a - b) < 1e-9);
const fill = (value: number, max: number): CSSProperties => {
  const p = Math.max(0, Math.min(100, (value / max) * 100));
  return { background: `linear-gradient(to right, var(--pa-primary) ${p}%, var(--pa-line-strong) ${p}%)` };
};

// Recalcul demandé : noté en session (survit au remontage du formulaire pendant la navigation), notifié à l'arrivée
const RECALC_KEY = "pa-previsions-recalc";
function markRecalc(summary: string) {
  try {
    sessionStorage.setItem(RECALC_KEY, JSON.stringify({ summary, at: Date.now() }));
  } catch {
    // stockage indisponible : pas de notification, la page affiche quand même le nouveau calcul
  }
}
function takeRecalc(): string | null {
  try {
    const raw = sessionStorage.getItem(RECALC_KEY);
    sessionStorage.removeItem(RECALC_KEY);
    const v = raw ? (JSON.parse(raw) as { summary: string; at: number }) : null;
    return v && Date.now() - v.at < 60_000 ? v.summary : null;
  } catch {
    return null;
  }
}

function Modified({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-link ring-1 ring-inset ring-primary/30">Modifié</span>;
}

// Formulaire GET (navigation côté client) : le serveur recalcule la projection à partir des paramètres, sans rien enregistrer.
// Curseur et champ chiffré liés ; seul le champ chiffré porte le nom du paramètre. Résultat annoncé par une notification.
export function WorkforceScenarioForm({
  values,
  raiseDefaultPct,
  budgetYear,
  departments,
  baseHires12,
}: {
  values: { embauches?: number; hausse?: number; budget?: number; departement?: number };
  raiseDefaultPct: number;
  budgetYear: number | null;
  departments: { id: number; label: string }[];
  baseHires12: number | null;
}) {
  const [hiring, setHiring] = useState(String(values.embauches ?? 100));
  const [customRaise, setCustomRaise] = useState(values.hausse != null);
  const [raise, setRaise] = useState(String(values.hausse ?? Math.round(raiseDefaultPct * 2) / 2));
  const [budget, setBudget] = useState(values.budget != null ? String(values.budget) : "");
  const [dept, setDept] = useState(values.departement != null ? String(values.departement) : "");
  const query = useSearchParams()?.toString() ?? "";
  // En cours tant que l'adresse n'a pas changé depuis l'envoi
  const [sentFrom, setSentFrom] = useState<string | null>(null);
  const pending = sentFrom !== null && sentFrom === query;
  const hiringPct = num(hiring) ?? 0;
  const raisePct = num(raise) ?? 0;
  const raiseLabel = `${dec(raiseDefaultPct)} %`;

  const applied = { embauches: values.embauches ?? 100, hausse: values.hausse ?? null, budget: values.budget ?? null, departement: values.departement ?? null };
  const changed = {
    embauches: !same(num(hiring), applied.embauches),
    hausse: !same(customRaise ? num(raise) : null, applied.hausse),
    budget: !same(num(budget), applied.budget),
    departement: !same(num(dept), applied.departement),
  };
  const dirty = Object.values(changed).some(Boolean);
  const isDefault = applied.embauches === 100 && applied.hausse == null && applied.budget == null && applied.departement == null;
  const reset = () => {
    setHiring(String(applied.embauches));
    setCustomRaise(applied.hausse != null);
    setRaise(String(applied.hausse ?? Math.round(raiseDefaultPct * 2) / 2));
    setBudget(applied.budget != null ? String(applied.budget) : "");
    setDept(applied.departement != null ? String(applied.departement) : "");
  };

  // Nouvelle page affichée après un recalcul demandé : notification de résultat
  useEffect(() => {
    const summary = takeRecalc();
    if (summary) toast.success("Projection recalculée", { description: `${summary} Rien n'est enregistré.` });
  }, [query]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (!dirty) {
      e.preventDefault();
      toast.info("Aucune hypothèse modifiée", { description: "La projection affichée correspond déjà à ces hypothèses." });
      return;
    }
    const raiseText = customRaise ? `hausse de janvier ${dec(raisePct)} %` : `hausse de janvier observée (${raiseLabel})`;
    markRecalc(`Embauches à ${dec(hiringPct, 0)} % du rythme, ${raiseText}.`);
    setSentFrom(query);
  };

  return (
    <Form action="/previsions" scroll={false} onSubmit={onSubmit} aria-busy={pending || undefined}>
      <div className="grid gap-6 lg:grid-cols-3">
        <fieldset className="min-w-0">
          <legend className={legendCls}>
            1. Rythme des embauches <Modified show={changed.embauches} />
          </legend>
          <p className={helpCls}>
            100 % = rythme des 12 derniers mois{baseHires12 != null ? ` (≈ ${dec(baseHires12, 0)} embauches par an)` : ""} · de 0 à {HIRING_MAX} %
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <input
                type="range"
                min={0}
                max={HIRING_MAX}
                step={5}
                value={Math.min(HIRING_MAX, hiringPct)}
                onChange={(e) => setHiring(e.target.value)}
                aria-label="Rythme des embauches, en pourcentage du rythme actuel"
                aria-valuetext={`${dec(hiringPct, 0)} % du rythme actuel`}
                className={rangeCls}
                style={fill(Math.min(HIRING_MAX, hiringPct), HIRING_MAX)}
              />
              <div aria-hidden="true" className="relative mt-1 h-4 text-[11px] leading-4 text-fg-subtle">
                <span className="absolute left-0">0 %</span>
                <span className="absolute left-1/3 -translate-x-1/2 whitespace-nowrap">100 % (actuel)</span>
                <span className="absolute right-0">{HIRING_MAX} %</span>
              </div>
            </div>
            <label className="inline-flex shrink-0 items-center gap-1 self-start text-sm text-fg">
              <span className="sr-only">Rythme des embauches (% du rythme des 12 derniers mois)</span>
              <input name="embauches" type="number" inputMode="decimal" min={0} max={HIRING_MAX} step={1} value={hiring} onChange={(e) => setHiring(e.target.value)} className={`${inputCls} w-20`} />
              %
            </label>
          </div>
          {baseHires12 != null && (
            <p className="mt-1.5 text-xs text-fg-muted" aria-live="polite">
              ≈ <strong className="tabular-nums text-fg">{dec((baseHires12 * hiringPct) / 100, 0)}</strong> embauches sur 12 mois
            </p>
          )}
        </fieldset>

        <fieldset className="min-w-0">
          <legend className={legendCls}>
            2. Hausse générale des salaires en janvier <Modified show={changed.hausse} />
          </legend>
          <div className="mt-2 space-y-1 text-sm text-fg">
            <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded-control px-1 transition-colors duration-150 hover:bg-surface-3">
              <input type="radio" name="hausse-mode" checked={!customRaise} onChange={() => setCustomRaise(false)} className="h-4 w-4 accent-[var(--pa-primary)]" />
              Celle observée l&apos;an dernier ({raiseLabel})
            </label>
            <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded-control px-1 transition-colors duration-150 hover:bg-surface-3">
              <input type="radio" name="hausse-mode" checked={customRaise} onChange={() => setCustomRaise(true)} className="h-4 w-4 accent-[var(--pa-primary)]" />
              Une autre valeur
            </label>
          </div>
          {customRaise && (
            <div className="mt-2 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <input
                  type="range"
                  min={0}
                  max={15}
                  step={0.5}
                  value={Math.min(15, raisePct)}
                  onChange={(e) => setRaise(e.target.value)}
                  aria-label="Hausse générale des salaires en janvier, en pourcentage"
                  aria-valuetext={`${dec(raisePct)} %`}
                  className={rangeCls}
                  style={fill(Math.min(15, raisePct), 15)}
                />
                <div aria-hidden="true" className="relative mt-1 h-4 text-[11px] leading-4 text-fg-subtle">
                  <span className="absolute left-0">0 %</span>
                  <span className="absolute right-0">15 %</span>
                </div>
              </div>
              <label className="inline-flex shrink-0 items-center gap-1 self-start text-sm text-fg">
                <span className="sr-only">Hausse générale des salaires en janvier (%, de 0 à 30)</span>
                <input name="hausse" type="number" inputMode="decimal" min={0} max={30} step={0.1} value={raise} onChange={(e) => setRaise(e.target.value)} className={`${inputCls} w-20`} />
                %
              </label>
            </div>
          )}
        </fieldset>

        <div className="min-w-0 space-y-4">
          <div>
            <label htmlFor="wf-budget" className={legendCls}>
              3. Budget annuel de masse salariale{budgetYear ? ` ${budgetYear}` : ""} <span className="font-normal text-fg-muted">(facultatif)</span>
              <Modified show={changed.budget} />
            </label>
            <p id="wf-budget-aide" className={helpCls}>
              Montant en TND, sans espace
            </p>
            {/* step="any" : avec min={1} et step={1000}, un montant rond (21000000) était refusé par le navigateur */}
            <input
              id="wf-budget"
              name="budget"
              type="number"
              inputMode="decimal"
              min={1}
              step="any"
              aria-describedby="wf-budget-aide"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="Exemple : 21000000"
              className={`${inputCls} mt-1.5 w-full`}
            />
          </div>
          <div>
            <label htmlFor="wf-departement" className={legendCls}>
              Graphiques affichés pour <Modified show={changed.departement} />
            </label>
            <select id="wf-departement" name="departement" value={dept} onChange={(e) => setDept(e.target.value)} className={`${inputCls} mt-1.5 w-full`}>
              <option value="">Toute l&apos;entreprise</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
      <FormActions
        status={
          <p aria-live="polite" className="flex items-center gap-2 text-sm text-fg-muted">
            {dirty && !pending && (
              <>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" />
                Hypothèses modifiées, non recalculées
              </>
            )}
          </p>
        }
      >
        {dirty && !pending && (
          <Button variant="tertiary" icon="x" onClick={reset}>
            Annuler les modifications
          </Button>
        )}
        {!isDefault && (
          <ButtonLink href="/previsions" variant="secondary" onClick={() => markRecalc("Scénario de référence rétabli.")}>
            Revenir au scénario de référence
          </ButtonLink>
        )}
        <Button type="submit" variant="primary" icon="refresh" pending={pending} pendingLabel="Recalcul en cours…">
          Recalculer la projection
        </Button>
      </FormActions>
    </Form>
  );
}
