"use client";

import { useActionState } from "react";
import { Card, FormActions, StatusBadge, SubmitButton, fieldCls, type StatusTone } from "@/components/ui";
import { announce } from "@/components/admin/notify";
import type { PowerBiConfigRow } from "@/lib/dal/powerbi";
import { savePowerBiConfigAction, type PowerBiConfigState } from "./actions";

const LABEL: Record<string, string> = { RH: "Rapport RH", MANAGER: "Rapport manager", ADMIN: "Rapport administrateur" };
const AUDIENCE: Record<string, string> = { RH: "Comptes RH", MANAGER: "Managers (filtrage RLS)", ADMIN: "Administrateur, sans donnée RH" };
const STATUS: Record<PowerBiConfigRow["status"], [StatusTone, string]> = { OK: ["success", "Configuré"], ABSENT: ["neutral", "Non configuré"], INVALIDE: ["danger", "Lien refusé"] };
const STEPS = ["Publier le rapport dans un espace de travail Power BI", "Fichier → Incorporer le rapport → Site web ou portail", "Coller le lien ou le code <iframe>"];

const fmtDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);

export function PowerBiConfigForm({ rows }: { rows: PowerBiConfigRow[] }) {
  const [state, action] = useActionState<PowerBiConfigState, FormData>(
    async (prev, fd) => announce(await savePowerBiConfigAction(prev, fd), { success: "Liens Power BI enregistrés", error: "Liens Power BI non enregistrés" }),
    {},
  );

  return (
    <div id="liens" className="scroll-mt-6">
      <Card title="Liens des rapports" className="mt-6">
        <ol aria-label="Où trouver le lien" className="mb-5 grid gap-2 text-sm text-fg-muted sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-start gap-2">
              <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <form action={action} noValidate className="space-y-5">
          {rows.map((r) => {
            const error = state.fieldErrors?.[r.role] ?? (state.values ? undefined : (r.error ?? undefined));
            const [tone, status] = STATUS[r.status];
            const updated = fmtDate(r.updatedAt);
            return (
              <div key={r.role}>
                <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label htmlFor={`powerbi-${r.role}`} className="text-sm font-medium text-fg">
                    {LABEL[r.role]}
                  </label>
                  <StatusBadge tone={tone}>{status}</StatusBadge>
                  <span className="text-xs text-fg-muted">
                    {AUDIENCE[r.role]}
                    {updated && ` · modifié le ${updated}${r.updatedBy ? ` par ${r.updatedBy}` : ""}`}
                  </span>
                </div>
                <input
                  id={`powerbi-${r.role}`}
                  name={r.role}
                  type="text"
                  inputMode="url"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="https://app.powerbi.com/reportEmbed?reportId=…"
                  defaultValue={state.values?.[r.role] ?? r.value}
                  aria-invalid={!!error}
                  aria-describedby={error ? `powerbi-${r.role}-error` : undefined}
                  className={`${fieldCls} font-mono text-[13px]`}
                />
                {error && (
                  <p id={`powerbi-${r.role}-error`} className="mt-1 text-xs text-danger">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
          <FormActions status={state.ok ? <span className="text-sm text-success">{state.ok}</span> : state.error ? <span className="text-sm text-danger">{state.error}</span> : undefined}>
            <SubmitButton pendingLabel="Enregistrement…">Enregistrer</SubmitButton>
          </FormActions>
        </form>
      </Card>
    </div>
  );
}
