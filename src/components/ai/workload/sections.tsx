import type { ReactNode } from "react";
import { DataTable, EmptyState, RiskBadge, StatusBadge, type DataTableColumn, type DataTableRow } from "@/components/ui";
import type { GroupView, OverloadView, WorkloadReco } from "@/lib/dal/ai-workload";
import type { RecoItem } from "./reco-status-form";
import { fr } from "./insight-kit";

export const monthLong = fr.monthLong;
export const hours = fr.hours;
const range = (lo: number | null, hi: number | null) => (lo == null || hi == null ? null : `${fr.hours(lo)} à ${fr.hours(hi)}`);

export function TensionBadge({ tension }: { tension: GroupView["tension"] }) {
  if (tension === "PROBABLE") return <StatusBadge tone="danger">Surcharge probable</StatusBadge>;
  if (tension === "POSSIBLE") return <StatusBadge tone="warning">Surcharge possible</StatusBadge>;
  return <StatusBadge tone="success">Sous le seuil</StatusBadge>;
}

const TENSION_RANK = { PROBABLE: 2, POSSIBLE: 1 } as const;
const LEVEL_RANK = { ELEVE: 3, MOYEN: 2, FAIBLE: 1 } as const;
const sub = "block text-xs text-fg-subtle";
// 10 lignes par page : sur mobile, chaque ligne devient une carte
const PAGE = 10;

// Tableau des groupes (DataTable : tri, pagination, cartes sous 640 px) : dernier mois observé, moyenne 12 mois, pic prévu avec sa fourchette, tension
export function GroupTable({
  groups,
  caption,
  showDepartment = true,
  nameHeader = "Équipe",
  empty,
}: {
  groups: GroupView[];
  caption: string;
  showDepartment?: boolean;
  nameHeader?: string;
  empty?: ReactNode;
}) {
  const lastMonth = groups[0]?.observed[groups[0].observed.length - 1]?.month;
  const columns: DataTableColumn[] = [
    { key: "name", label: nameHeader },
    ...(showDepartment ? [{ key: "dept", label: "Département" }] : []),
    { key: "last", label: lastMonth ? `${fr.monthShort(lastMonth)} (observé)` : "Dernier mois", numeric: true },
    { key: "mean", label: "Moyenne 12 mois", numeric: true },
    { key: "peak", label: "Pic prévu (3 mois)", numeric: true },
    { key: "tension", label: "Surcharge prévue" },
  ];
  const rows: DataTableRow[] = groups.map((g) => {
    const r = g.peak ? range(g.peak.lower, g.peak.upper) : null;
    return {
      id: g.key,
      cells: {
        name: <span className="font-medium text-fg">{g.label}</span>,
        dept: g.departmentName ?? "—",
        last: fr.hours(g.last),
        mean: fr.hours(g.mean12),
        peak: g.peak ? (
          <>
            {fr.hours(g.peak.value)} <span className="text-xs text-fg-subtle">en {fr.monthShort(g.peak.month)}</span>
            {r && <span className={sub}>fourchette {r}</span>}
          </>
        ) : (
          "—"
        ),
        tension: <TensionBadge tension={g.tension} />,
      },
      // Tri proposé seulement s'il y a plusieurs lignes (un manager avec une seule équipe n'a rien à trier)
      sort:
        groups.length > 1
          ? { name: g.label, dept: g.departmentName, last: g.last, mean: g.mean12, peak: g.peak?.value, tension: g.tension ? TENSION_RANK[g.tension] : 0 }
          : undefined,
    };
  });
  return <DataTable columns={columns} rows={rows} caption={caption} pageSize={PAGE} empty={empty ?? <EmptyState title="Aucun groupe à afficher" compact />} />;
}

const OVERLOAD_COLUMNS: DataTableColumn[] = [
  { key: "name", label: "Collaborateur" },
  { key: "dept", label: "Département et manager" },
  { key: "since", label: "Depuis", numeric: true },
  { key: "avg", label: "Moyenne par mois", numeric: true },
  { key: "last", label: "Dernier mois", numeric: true },
  { key: "risk", label: "Risque de départ" },
];

export function OverloadTable({ rows }: { rows: OverloadView[] }) {
  const data: DataTableRow[] = rows.map((o) => {
    const last = o.recent[o.recent.length - 1];
    return {
      id: o.employeeId,
      href: `/employees/${o.employeeId}?retour=${encodeURIComponent("/charge#surcharges")}`,
      cells: {
        name: o.name,
        dept: (
          <>
            {o.departmentName ?? "—"}
            <span className={sub}>{o.managerName ? `Manager : ${o.managerName}` : "Sans manager"}</span>
          </>
        ),
        since: (
          <>
            {o.months} mois<span className={sub}>depuis {fr.monthShort(o.start)}</span>
          </>
        ),
        avg: fr.hours(o.average),
        last: last ? (
          <>
            {fr.hours(last.value)}
            <span className={sub}>{fr.monthShort(last.month)}</span>
          </>
        ) : (
          "—"
        ),
        risk: <RiskBadge level={o.level} compact />,
      },
      sort: { name: o.name, dept: o.departmentName, since: o.months, avg: o.average, last: last?.value, risk: o.level ? LEVEL_RANK[o.level] : 0 },
    };
  });
  return (
    <DataTable
      columns={OVERLOAD_COLUMNS}
      rows={data}
      pageSize={PAGE}
      caption="Collaborateurs en surcharge soutenue d'heures supplémentaires"
      empty={
        <EmptyState title="Aucune surcharge individuelle soutenue ce mois-ci" icon="success" compact>
          La liste se remplit quand un collaborateur dépasse le seuil d&apos;heures sup plusieurs mois de suite.
        </EmptyState>
      }
    />
  );
}

const SCOPE = { ENTREPRISE: "Entreprise", DEPARTEMENT: "Département", EQUIPE: "Équipe", SALARIE: "Individuelle (RH)" } as const;

// Recommandations de charge -> éléments de la liste partagée ; toute transition est permise (motif obligatoire pour rejeter)
export function workloadRecoItems(recos: WorkloadReco[], fmtDate: (s: string) => string): RecoItem[] {
  return recos.map((r) => ({
    id: r.id,
    status: r.status,
    priority: r.priority,
    title: r.title,
    rationale: r.rationale,
    scopeLabel: SCOPE[r.scope],
    target: r.groupLabel,
    createdOn: fmtDate(r.createdAt),
    updatedOn: r.updatedAt ? fmtDate(r.updatedAt) : null,
    comment: r.comment,
    allowed: (["PROPOSEE", "REALISEE", "REJETEE"] as const).filter((s) => s !== r.status),
  }));
}
