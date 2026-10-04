"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Button, FormActions, Notice, RiskBadge, Skeleton, cardCls, fieldCls, fmt, tableCls, toast } from "@/components/ui";
import type { WhatIfDto } from "@/lib/dal/whatif";
import { formatDate, formatLiftWords, formatPoints, formatProb } from "./labels";

type Limits = { salaryPct: number; overtimeCutH: number; trainingHours: number };
type Form = { salaryPct: number; overtimeCutH: number; trainingHours: number; promotion: boolean; chargeRatePct: number };
type Placement = WhatIfDto["before"];
type Level = Placement["level"];

const inputCls = `block h-10 ${fieldCls} py-1.5 pr-16! tabular-nums`;
const dec = (n: number, d = 1) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (n: number, d: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${dec(Math.abs(n), d)}`;

const ICONS = {
  money: "M3 6h18v12H3z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M6 9v.01 M18 15v.01",
  clock: "M12 7v5l3 2 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18",
  training: "M22 10 12 5 2 10l10 5 10-5z M6 12v5c3 2 9 2 12 0v-5",
  grade: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12 M8.5 13.5 7 21l5-3 5 3-1.5-7.5",
  flask: "M9 3h6 M10 3v6l-5.5 9.5A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3 M7.5 15h9",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  down: "M12 5v14 M19 12l-7 7-7-7",
  up: "M12 19V5 M5 12l7-7 7 7",
  chevron: "M6 9l6 6 6-6",
} as const;

function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

// Un levier = une question (« … le salaire augmente ? »), un champ, ses bornes et un aperçu de la valeur obtenue
function Lever({
  id,
  icon,
  question,
  label,
  unit,
  hint,
  preview,
  active,
  children,
}: {
  id: string;
  icon: keyof typeof ICONS;
  question: string;
  label: string;
  unit: string;
  hint: string;
  preview?: ReactNode;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col rounded-control p-3 ring-1 ring-inset transition-colors ${active ? "bg-primary-soft ring-primary" : "bg-surface-2 ring-line"}`}>
      <p className="flex items-start gap-2 text-sm font-semibold text-heading">
        <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface text-link ring-1 ring-inset ring-line">
          <Icon name={icon} className="h-3.5 w-3.5" />
        </span>
        <span className="pt-0.5">{question}</span>
      </p>
      <label htmlFor={id} className="mt-2 block text-xs font-medium text-fg-muted">
        {label}
      </label>
      <div className="relative mt-auto pt-1">
        {children}
        <span aria-hidden="true" className="pointer-events-none absolute bottom-0 right-2.5 top-1 flex items-center text-xs text-fg-subtle">
          {unit}
        </span>
      </div>
      <p id={`${id}-hint`} className="mt-1 text-xs text-fg-muted">
        {hint}
      </p>
      {preview && <p className="mt-1 text-xs font-medium text-link">{preview}</p>}
    </div>
  );
}

const LEVEL_WORD: Record<Level, string> = { ELEVE: "Élevé", MOYEN: "Moyen", FAIBLE: "Faible" };
const LEVEL_RANK: Record<Level, number> = { FAIBLE: 0, MOYEN: 1, ELEVE: 2 };
const LEVEL_BORDER: Record<Level, string> = { ELEVE: "border-l-danger", MOYEN: "border-l-warning", FAIBLE: "border-l-success" };
const ordinal = (n: number) => (n === 1 ? "1er" : `${fmt.int(n)}e`);

function Estimate({ title, r, kind, max, highlight = false }: { title: string; r: Placement; kind: WhatIfDto["model"]["kind"]; max: number; highlight?: boolean }) {
  const b0 = kind === "B0";
  return (
    <div className={`rounded-control p-3.5 ring-1 ring-inset ${highlight ? "bg-primary-soft ring-primary" : "bg-surface-2 ring-line"}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{title}</p>
      <div className="mt-2">
        <RiskBadge level={r.level} />
      </div>
      {b0 ? (
        <p className="mt-1.5 text-lg font-semibold tabular-nums text-heading">{formatPoints(r.score)}</p>
      ) : (
        <p className="mt-1.5 text-sm text-fg-muted">
          Probabilité à 6 mois : <span className="text-2xl font-semibold tabular-nums text-heading">{formatProb(r.score)}</span>
        </p>
      )}
      <div aria-hidden="true" className="mt-1.5 h-2.5 rounded-full bg-surface ring-1 ring-inset ring-line">
        <div className={`h-2.5 rounded-full ${highlight ? "bg-primary" : "bg-fg-subtle"}`} style={{ width: `${Math.max(2, Math.round((r.score / max) * 100))}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-fg-muted">
        {ordinal(r.rank)} rang sur {fmt.int(r.population)} collaborateurs évalués (1er = le plus exposé)
        {!b0 && `, ${formatLiftWords(r.lift)}`}
      </p>
    </div>
  );
}

const panelCls = "rounded-control bg-surface-2 p-3.5 ring-1 ring-inset ring-line";
const panelTitle = "mb-2 text-sm font-semibold text-heading";

function Headline({ r }: { r: WhatIfDto }) {
  const b0 = r.model.kind === "B0";
  const { before, after } = r;
  const delta = after.score - before.score;
  const moved = LEVEL_RANK[after.level] - LEVEL_RANK[before.level];
  const value = (x: Placement) => (b0 ? `${dec(x.score, 0)} point${x.score > 1 ? "s" : ""}` : formatProb(x.score));
  const change = b0 ? `${signed(delta, 0)} point${Math.abs(delta) > 1 ? "s" : ""}` : `${signed(delta * 100, 1)} pt`;
  const sense = delta < 0 ? "en baisse" : delta > 0 ? "en hausse" : "inchangé";
  return (
    <div className={`rounded-control border-l-4 bg-surface p-4 ring-1 ring-inset ring-line ${LEVEL_BORDER[after.level]}`}>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-lg font-semibold text-heading">
        {moved === 0 ? (
          <>
            Le niveau de risque resterait <RiskBadge level={after.level} />
          </>
        ) : (
          <>
            Le niveau de risque passerait de <RiskBadge level={before.level} /> à <RiskBadge level={after.level} />
            <span className="sr-only">
              {" "}
              ({LEVEL_WORD[before.level]} vers {LEVEL_WORD[after.level]})
            </span>
          </>
        )}
      </p>
      <p className="mt-1 text-sm text-fg-muted">
        {b0 ? "Score à règles" : "Probabilité à 6 mois"} : {value(before)} <span aria-hidden="true">→</span>
        <span className="sr-only">puis</span> <span className="font-semibold text-heading">{value(after)}</span> ({change}, {sense}).
      </p>
      <p className="mt-2 text-sm text-fg-muted">
        Coût annuel estimé : <span className="text-xl font-semibold tabular-nums text-heading">{fmt.tnd(r.cost.annual)}</span>
      </p>
      <p className="text-xs text-fg-muted">
        Hausse de salaire × 12, charges patronales comprises ({dec(r.cost.chargeRate * 100, 2)} %) ; hors coût de la formation.
      </p>
    </div>
  );
}

// Le titre reçoit le focus à l'arrivée du résultat (il défile alors dans la vue, utile sur mobile) ; l'annonce est faite par le toast.
// outdated : les leviers ont été modifiés depuis ce calcul, le résultat affiché ne correspond plus au formulaire.
export function WhatIfResult({ r, headingRef, outdated = false }: { r: WhatIfDto; headingRef?: RefObject<HTMLHeadingElement | null>; outdated?: boolean }) {
  const b0 = r.model.kind === "B0";
  const d = b0 ? 0 : 2;
  const a = r.applied;
  const max = Math.max(r.before.score, r.after.score, 1e-9) * 1.1;
  const moved = r.groups.filter((g) => Math.abs(g.after - g.before) > 1e-6);
  return (
    <div className="mt-5 animate-fade-in space-y-4 border-t border-line pt-5">
      <h3 ref={headingRef} tabIndex={-1} className="scroll-mt-4 text-base font-semibold text-heading">
        3. Résultat de la simulation
      </h3>
      {outdated && (
        <Notice tone="warning" title="Résultat à mettre à jour">
          Les actions ont été modifiées depuis ce calcul : le résultat ci-dessous porte sur les valeurs précédentes. Relancez la simulation pour l&apos;actualiser.
        </Notice>
      )}
      <Headline r={r} />
      <div className="grid items-stretch gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <Estimate title="Avant (calcul publié)" r={r.before} kind={r.model.kind} max={max} />
        <span aria-hidden="true" className="hidden items-center justify-center text-fg-muted sm:flex">
          <Icon name="arrow" className="h-6 w-6" />
        </span>
        <Estimate title="Après les actions simulées" r={r.after} kind={r.model.kind} max={max} highlight />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={panelCls}>
          <h4 className={panelTitle}>Ce qui change dans le dossier</h4>
          {r.changes.length === 0 ? (
            <p className="text-sm text-fg-muted">Aucune donnée du calcul n&apos;est modifiée par ces actions.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {r.changes.map((c) => (
                <li key={c.feature}>
                  {c.before} <span aria-hidden="true" className="text-fg-muted">→</span>
                  <span className="sr-only">devient</span> <span className="font-medium text-fg">{c.after}</span>
                </li>
              ))}
            </ul>
          )}
          {moved.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5 border-t border-line pt-2">
              {moved.map((g) => {
                const less = g.after < g.before;
                return (
                  <li
                    key={g.group}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${less ? "bg-success-soft text-success ring-success/40" : "bg-danger-soft text-danger ring-danger/40"}`}
                  >
                    <Icon name={less ? "down" : "up"} className="h-3 w-3" />
                    {g.label} : {less ? "pèse moins sur le risque" : "pèse davantage sur le risque"}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className={panelCls}>
          <h4 className={panelTitle}>Actions appliquées</h4>
          <ul className="space-y-1 text-sm">
            {a.salary && (
              <li>
                Salaire de base : {fmt.tnd(a.salary.before)} → {fmt.tnd(a.salary.after)} par mois
              </li>
            )}
            {a.grade && (
              <li>
                Grade : {a.grade.before} → {a.grade.after}
              </li>
            )}
            {r.levers.overtimeCutH > 0 && <li>Heures supplémentaires retirées : {dec(a.overtimeRemovedH)} h sur les 3 derniers mois</li>}
            {a.trainingHours > 0 && <li>Formation ajoutée : {dec(a.trainingHours, 0)} h</li>}
            {!a.salary && !a.grade && r.levers.overtimeCutH <= 0 && a.trainingHours <= 0 && <li className="text-fg-muted">Aucune action appliquée.</li>}
          </ul>
        </div>
      </div>

      <details className="group">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-control pr-2 text-sm font-medium text-link transition-colors hover:bg-primary-soft hover:underline [&::-webkit-details-marker]:hidden">
          <Icon name="chevron" className="h-4 w-4 transition-transform group-open:rotate-180" />
          Voir le détail du calcul par groupe de facteurs
        </summary>
        <div className="mt-2 overflow-x-auto rounded-control ring-1 ring-inset ring-line">
          <table className={tableCls.table}>
            <caption className="border-b border-line px-3 py-2 text-left text-sm font-semibold text-heading">
              Contributions par groupe ({b0 ? "points des règles déclenchées" : "écart au profil moyen, en log-odds : positif = fait monter le risque"})
            </caption>
            <thead className={tableCls.thead}>
              <tr>
                <th scope="col" className={tableCls.th}>Groupe</th>
                <th scope="col" className={`${tableCls.th} text-right`}>Avant</th>
                <th scope="col" className={`${tableCls.th} text-right`}>Après</th>
                <th scope="col" className={`${tableCls.th} text-right`}>Écart</th>
              </tr>
            </thead>
            <tbody>
              {r.groups.length === 0 ? (
                <tr className={tableCls.tr}>
                  <td colSpan={4} className={`${tableCls.td} text-fg-muted`}>Aucune règle déclenchée, avant comme après.</td>
                </tr>
              ) : (
                r.groups.map((g) => {
                  const delta = g.after - g.before;
                  return (
                    <tr key={g.group} className={tableCls.tr}>
                      <th scope="row" className={`${tableCls.td} font-normal`}>{g.label}</th>
                      <td className={`${tableCls.td} text-right tabular-nums`}>{signed(g.before, d)}</td>
                      <td className={`${tableCls.td} text-right tabular-nums`}>{signed(g.after, d)}</td>
                      <td className={`${tableCls.td} text-right font-medium tabular-nums ${delta > 0 ? "text-danger" : delta < 0 ? "text-success" : "text-fg-muted"}`}>
                        {signed(delta, d)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-fg-muted">
          Calcul avec le {fmt.model(r.model.version)}, situation au {formatDate(r.asOf)}. Niveau et rang recalculés parmi les collaborateurs évalués ce mois-ci.
        </p>
      </details>
      {r.notes.map((n) => (
        <Notice key={n} tone="warning">
          {n}
        </Notice>
      ))}
    </div>
  );
}

// Même forme que le résultat : titre, phrase de synthèse, avant → après, deux encadrés
function ResultSkeleton() {
  return (
    <div aria-hidden="true" className="mt-5 space-y-4 border-t border-line pt-5">
      <Skeleton className="h-5 w-56" />
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-3 sm:grid-cols-[1fr_1.5rem_1fr]">
        <Skeleton className="h-32" />
        <span className="hidden sm:block" />
        <Skeleton className="h-32" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  );
}

const SALARY_PRESETS = [3, 5, 10];

export function WhatIfPanel({
  employeeId,
  notice,
  limits,
  defaultChargeRatePct,
  baseSalary = null,
  grade = null,
}: {
  employeeId: number;
  notice: string;
  limits: Limits;
  defaultChargeRatePct: number;
  baseSalary?: number | null;
  grade?: string | null;
}) {
  const initial: Form = { salaryPct: 0, overtimeCutH: 0, trainingHours: 0, promotion: false, chargeRatePct: defaultChargeRatePct };
  const [form, setForm] = useState<Form>(initial);
  const [result, setResult] = useState<WhatIfDto | null>(null);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  // Valeurs des leviers envoyées pour le résultat affiché : s'en écarter rend le résultat périmé
  const [computedFor, setComputedFor] = useState<Form | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const num = (k: keyof Omit<Form, "promotion">) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value === "" ? 0 : Number(e.target.value) }));
  const nothing = form.salaryPct <= 0 && form.overtimeCutH <= 0 && form.trainingHours <= 0 && !form.promotion;
  const outdated = result != null && computedFor != null && (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== computedFor[k]);

  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);

  function fail(code: string | null, message: string) {
    setResult(null);
    setComputedFor(null);
    setError({ code, message });
    if (code === "OPPOSITION") toast.error("Simulation refusée", { description: message });
    else toast.error(message);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (nothing) return;
    const sent = form;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/employees/${employeeId}/what-if`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sent),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) fail(body?.error?.code ?? null, body?.error?.message ?? "Simulation impossible. Vérifiez les valeurs saisies puis relancez.");
      else {
        const r = body as WhatIfDto;
        setResult(r);
        setComputedFor(sent);
        const same = r.after.level === r.before.level;
        toast.success("Simulation terminée", {
          description: `${same ? `Le niveau de risque resterait ${LEVEL_WORD[r.after.level]}` : `Niveau de risque : ${LEVEL_WORD[r.before.level]} → ${LEVEL_WORD[r.after.level]}`}, coût annuel estimé ${fmt.tnd(r.cost.annual)}. Rien n'est enregistré.`,
        });
      }
    } catch {
      fail(null, "Simulation impossible : le serveur ne répond pas. Réessayez dans un instant.");
    } finally {
      setPending(false);
    }
  }

  const id = `whatif-${employeeId}`;
  // 409 OPPOSITION : opposition au traitement prédictif enregistrée, la simulation est refusée
  const opposed = error?.code === "OPPOSITION";
  const salaryPreview =
    baseSalary != null && form.salaryPct > 0
      ? `Soit environ ${fmt.tnd(baseSalary * (1 + form.salaryPct / 100))} par mois (+${fmt.tnd((baseSalary * form.salaryPct) / 100)}).`
      : baseSalary != null
        ? `Salaire de base actuel : ${fmt.tnd(baseSalary)} par mois.`
        : undefined;
  return (
    <section id="simulation" aria-labelledby={`${id}-title`} className={`${cardCls} mt-6 scroll-mt-4 p-4 sm:p-5`}>
      <header className="mb-4 flex items-start gap-3 border-b border-line pb-3">
        <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-link">
          <Icon name="flask" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-lg font-semibold leading-8 text-heading">
            Simulation « et si ? »
          </h2>
          <p className="text-sm text-fg-muted">
            Testez l&apos;effet estimé d&apos;une action avant de la décider. Calcul sur les données au jour du calcul publié ; rien n&apos;est enregistré.
          </p>
        </div>
      </header>
      <Notice tone="warning">{notice}</Notice>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <fieldset>
          <legend className="text-base font-semibold text-heading">1. Que se passe-t-il si… ?</legend>
          <p className="text-sm text-fg-muted">Choisissez une ou plusieurs actions.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Lever
              id={`${id}-salary`}
              icon="money"
              question="…le salaire de base augmente ?"
              label="Augmentation du salaire de base (%)"
              unit="%"
              hint={`De 0 à ${limits.salaryPct} %`}
              preview={salaryPreview}
              active={form.salaryPct > 0}
            >
              <input
                id={`${id}-salary`}
                type="number"
                min={0}
                max={limits.salaryPct}
                step={0.5}
                value={form.salaryPct}
                onChange={num("salaryPct")}
                aria-describedby={`${id}-salary-hint`}
                className={inputCls}
              />
            </Lever>
            <Lever
              id={`${id}-overtime`}
              icon="clock"
              question="…les heures supplémentaires baissent ?"
              label="Heures supplémentaires en moins par mois (moyenne des 3 derniers mois)"
              unit="h / mois"
              hint={`De 0 à ${limits.overtimeCutH} h par mois`}
              active={form.overtimeCutH > 0}
            >
              <input
                id={`${id}-overtime`}
                type="number"
                min={0}
                max={limits.overtimeCutH}
                step={1}
                value={form.overtimeCutH}
                onChange={num("overtimeCutH")}
                aria-describedby={`${id}-overtime-hint`}
                className={inputCls}
              />
            </Lever>
            <Lever
              id={`${id}-training`}
              icon="training"
              question="…le collaborateur suit plus de formation ?"
              label="Heures de formation ajoutées"
              unit="h"
              hint={`De 0 à ${limits.trainingHours} h`}
              active={form.trainingHours > 0}
            >
              <input
                id={`${id}-training`}
                type="number"
                min={0}
                max={limits.trainingHours}
                step={1}
                value={form.trainingHours}
                onChange={num("trainingHours")}
                aria-describedby={`${id}-training-hint`}
                className={inputCls}
              />
            </Lever>
            <div className={`flex flex-col rounded-control p-3 ring-1 ring-inset transition-colors ${form.promotion ? "bg-primary-soft ring-primary" : "bg-surface-2 ring-line"}`}>
              <p className="flex items-start gap-2 text-sm font-semibold text-heading">
                <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface text-link ring-1 ring-inset ring-line">
                  <Icon name="grade" className="h-3.5 w-3.5" />
                </span>
                <span className="pt-0.5">…le collaborateur est promu ?</span>
              </p>
              <label className="mt-2 flex min-h-10 cursor-pointer items-center gap-2.5 rounded-control bg-surface px-2.5 py-2 text-sm ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-3">
                <input
                  type="checkbox"
                  checked={form.promotion}
                  onChange={(e) => setForm((f) => ({ ...f, promotion: e.target.checked }))}
                  aria-describedby={`${id}-promotion-hint`}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <span className="font-medium text-fg">Promotion au grade supérieur</span>
              </label>
              <p id={`${id}-promotion-hint`} className="mt-1 text-xs text-fg-muted">
                {grade ? `Grade actuel : ${grade}. ` : ""}Salaire porté au moins à la médiane du nouveau grade, même famille de métier.
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
            <span>Augmentations courantes :</span>
            {SALARY_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setForm((f) => ({ ...f, salaryPct: p }))}
                aria-pressed={form.salaryPct === p}
                className={`inline-flex min-h-8 items-center rounded-full px-3 text-xs font-medium ring-1 ring-inset transition-colors active:translate-y-px ${
                  form.salaryPct === p ? "bg-primary-soft text-link ring-primary" : "bg-surface text-fg-muted ring-line-strong hover:bg-surface-3 hover:text-fg"
                }`}
              >
                <span className="sr-only">Fixer l&apos;augmentation à </span>+{p} %
              </button>
            ))}
          </div>
        </fieldset>

        <details className="group rounded-control ring-1 ring-inset ring-line">
          <summary className="flex min-h-10 cursor-pointer items-center rounded-control px-3 text-sm text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg">
            <span>
              Hypothèse de coût : charges patronales de <span className="font-medium tabular-nums">{dec(form.chargeRatePct, 2)} %</span>
            </span>
          </summary>
          <div className="max-w-xs px-3 pb-3">
            <label htmlFor={`${id}-charges`} className="block text-xs font-medium text-fg-muted">
              Charges patronales (%)
            </label>
            <div className="relative mt-1">
              <input
                id={`${id}-charges`}
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={form.chargeRatePct}
                onChange={num("chargeRatePct")}
                aria-describedby={`${id}-charges-hint`}
                className={inputCls}
              />
              <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-fg-subtle">
                %
              </span>
            </div>
            <p id={`${id}-charges-hint`} className="mt-1 text-xs text-fg-muted">
              Par défaut : {dec(defaultChargeRatePct, 2)} %. Sert seulement au calcul du coût.
            </p>
          </div>
        </details>

        <FormActions
          className="mt-4!"
          status={
            error && !opposed ? (
              <p className="text-sm font-medium text-danger">{error.message}</p>
            ) : (
              <p className="text-sm font-semibold text-heading">2. Lancer la simulation</p>
            )
          }
        >
          <Button
            icon="refresh"
            onClick={() => {
              setForm(initial);
              setResult(null);
              setComputedFor(null);
              setError(null);
            }}
          >
            Réinitialiser la simulation
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon="play"
            pending={pending}
            pendingLabel="Simulation en cours…"
            disabled={opposed || nothing}
            disabledReason={nothing && !opposed ? "Choisissez au moins une action ci-dessus." : undefined}
          >
            Simuler ces actions
          </Button>
        </FormActions>
        {opposed && <Notice tone="warning">{error?.message}</Notice>}
      </form>
      {/* Pendant un calcul, le squelette avant/après remplace aussi un résultat précédent (sinon on lirait l'ancien comme le nouveau) */}
      <div aria-busy={pending || undefined}>
        {pending ? <ResultSkeleton /> : result && <WhatIfResult r={result} headingRef={resultHeading} outdated={outdated} />}
      </div>
    </section>
  );
}
