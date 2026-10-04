"use client";

import Link from "next/link";
import type { Ref } from "react";
import { InfoTip } from "@/components/help/info-tip";
import { Badge, ButtonLink, RiskBadge, cardCls } from "@/components/ui";
import { MIN_GROUP_SIZE } from "@/lib/dal/pilotage-metrics";
import type { OrgMetrics, OrgNode } from "@/lib/dal/org-chart";
import { absenteeismText, people, riskText } from "./scale";

function Indicator({ label, team, subtree, text, rh }: { label: string; team: OrgMetrics; subtree: OrgMetrics; text: (m: OrgMetrics) => string; rh: boolean }) {
  const cell = (m: OrgMetrics) => (
    <td className="px-2 py-2 align-top tabular-nums">
      {text(m)}
      {rh && m.small && m.headcount > 0 && (
        <span className="mt-0.5 block">
          <Badge tone="amber">Petit effectif</Badge>
        </span>
      )}
    </td>
  );
  return (
    <tr className="border-b border-line last:border-0">
      <th scope="row" className="px-2 py-2 text-left align-top font-medium text-fg-muted">
        {label}
      </th>
      {cell(team)}
      {cell(subtree)}
    </tr>
  );
}

// Lien vers une fiche ou la liste avec retour vers l'organigramme (couleur conservée)
export const withBack = (path: string, back: string, params: Record<string, string | number> = {}) =>
  `${path}?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), retour: back })}`;

export function OrgDetailPanel({
  node,
  rh,
  onSelect,
  headingRef,
  back = "/organigramme",
}: {
  node: OrgNode;
  rh: boolean;
  onSelect: (key: string) => void;
  headingRef: Ref<HTMLHeadingElement>;
  back?: string;
}) {
  const virtual = node.employeeId == null;
  const isSelf = !rh && node.depth === 0 && !virtual;
  const meta = [node.jobTitle, node.department].filter(Boolean).join(" · ");
  const teams = node.members.filter((m) => m.leadsTeam).length;
  const childKey = new Map(node.children.map((c) => [c.employeeId, c.key]));
  return (
    <section aria-labelledby="org-detail-title" className={`${cardCls} min-w-0 p-4 sm:p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">Sélection</p>
      <h2 id="org-detail-title" ref={headingRef} tabIndex={-1} className="mt-1 text-lg font-semibold leading-snug text-heading focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {node.name}
        {isSelf && <span className="ml-1 text-sm font-normal text-fg-muted">(vous)</span>}
      </h2>
      {meta && <p className="text-sm text-fg-muted">{meta}</p>}
      {virtual && <p className="text-sm text-fg-muted">{rh ? "Responsables sans manager dans AJIR" : "Aucun collaborateur rattaché"}</p>}
      {!virtual && !isSelf && (
        <p className="mt-2">
          <RiskBadge level={node.level} />
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-control bg-surface-2 p-3">
          <dt className="text-xs text-fg-muted">Effectif total rattaché</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums text-heading">{people(node.subtree.headcount)}</dd>
        </div>
        <div className="rounded-control bg-surface-2 p-3">
          <dt className="text-xs text-fg-muted">Équipe directe</dt>
          <dd className="mt-0.5 text-xl font-semibold tabular-nums text-heading">{people(node.team.headcount)}</dd>
          <dd className="text-xs text-fg-muted">
            {teams} responsable{teams > 1 ? "s" : ""} d&apos;équipe · {node.leaves} sans équipe
          </dd>
        </div>
      </dl>

      <div className="mt-4 flex items-center gap-1">
        <h3 className="text-sm font-semibold text-heading">Indicateurs</h3>
        <InfoTip label="Indicateurs" prefix="Détails" align="end">
          Absentéisme hors maladie et maternité.
          {rh ? ` « Petit effectif » : moins de ${MIN_GROUP_SIZE} personnes, taux peu fiable.` : ` Aucun taux sous ${MIN_GROUP_SIZE} personnes.`}
        </InfoTip>
      </div>
      <table className="mt-1 w-full text-sm text-fg">
        <caption className="sr-only">Indicateurs de l&apos;équipe directe et de l&apos;ensemble rattaché</caption>
        <thead className="border-b-2 border-line text-xs text-fg-muted">
          <tr>
            <th scope="col" className="px-2 py-1.5 text-left font-semibold">
              Indicateur
            </th>
            <th scope="col" className="px-2 py-1.5 text-left font-semibold">
              Équipe directe
            </th>
            <th scope="col" className="px-2 py-1.5 text-left font-semibold">
              Ensemble rattaché
            </th>
          </tr>
        </thead>
        <tbody>
          <Indicator label="Risque de départ élevé ou moyen" team={node.team} subtree={node.subtree} text={riskText} rh={rh} />
          <Indicator label="Absentéisme hors santé (3 mois)" team={node.team} subtree={node.subtree} text={absenteeismText} rh={rh} />
        </tbody>
      </table>

      {!virtual && (
        <div className="mt-4 flex flex-wrap gap-2">
          {node.openable && (
            <ButtonLink href={withBack(`/employees/${node.employeeId}`, back)} size="sm" icon="user">
              Ouvrir la fiche
            </ButtonLink>
          )}
          <ButtonLink href={withBack("/employees", back, { manager: node.employeeId! })} size="sm" variant="tertiary" icon="users">
            Voir l&apos;équipe
          </ButtonLink>
        </div>
      )}

      <h3 className="mt-5 text-base font-semibold text-heading">
        Collaborateurs directs <span className="text-sm font-normal text-fg-muted">({node.members.length})</span>
      </h3>
      {node.members.length === 0 ? (
        <p className="mt-1 text-sm text-fg-muted">Aucun collaborateur actif rattaché.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line text-sm">
          {node.members.map((m) => {
            const key = childKey.get(m.id);
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <div className="min-w-0">
                  <Link href={withBack(`/employees/${m.id}`, back)} className="font-medium text-link underline-offset-2 hover:underline">
                    {m.name}
                  </Link>
                  {m.jobTitle && <span className="block text-xs text-fg-muted">{m.jobTitle}</span>}
                  {key && (
                    <button
                      type="button"
                      onClick={() => onSelect(key)}
                      className="mt-0.5 inline-flex min-h-8 items-center gap-1 rounded-control text-xs font-medium text-link underline-offset-2 transition-colors hover:underline"
                    >
                      Détail de l&apos;équipe<span className="sr-only"> de {m.name}</span>
                      <span aria-hidden="true">›</span>
                    </button>
                  )}
                </div>
                <RiskBadge level={m.level} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
