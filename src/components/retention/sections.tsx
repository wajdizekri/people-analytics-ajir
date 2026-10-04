import Link from "next/link";
import type { ReactNode } from "react";
import { Card, fmt, tableCls } from "@/components/ui";
import type { RetentionGroup } from "@/lib/dal/retention";
import type { CurveSummary } from "@/lib/retention/summary";
import { monthsText, pct } from "./chart-options";

const at = (c: CurveSummary, months: number) => c.milestones.find((m) => m.months === months)?.survival ?? null;

export function medianText(c: CurveSummary): string {
  return c.medianMonths != null ? monthsText(Math.round(c.medianMonths)) : "Non atteinte";
}

type Row = { label: string; n: number | null; events: number | null; curve: CurveSummary | null; note?: string };

function rowsOf(overall: { label: string; n: number; curve: CurveSummary | null }, groups: RetentionGroup[]): Row[] {
  return [
    { label: overall.label, n: overall.n, events: overall.curve?.events ?? null, curve: overall.curve },
    ...groups.map((g) => ({
      label: g.label,
      n: g.n,
      events: g.curve?.events ?? null,
      curve: g.curve,
      note: g.masked ? "Non affiché : petit groupe" : g.curve && g.curve.stopMonths <= 0 ? "Moins de 5 personnes suivies" : undefined,
    })),
  ];
}

// Détail par groupe : effectif suivi, sorties, maintien à 12 et 24 mois, durée médiane ; vue en cartes sous 640 px
export function GroupTable({ overall, groups, caption }: { overall: { label: string; n: number; curve: CurveSummary | null }; groups: RetentionGroup[]; caption: string }) {
  const rows = rowsOf(overall, groups);
  const cell = (r: Row, v: string) => (r.note ? <span className="text-fg-subtle">—</span> : v);
  return (
    <>
      <div className={tableCls.wrap}>
        <table className={`${tableCls.table} hidden sm:table`}>
          <caption className="sr-only">{caption}</caption>
          <thead className={tableCls.thead}>
            <tr>
              <th scope="col" className={tableCls.th}>
                Groupe
              </th>
              <th scope="col" className={`${tableCls.th} ${tableCls.num}`}>
                Embauches suivies
              </th>
              <th scope="col" className={`${tableCls.th} ${tableCls.num}`}>
                Sorties observées
              </th>
              <th scope="col" className={`${tableCls.th} ${tableCls.num}`}>
                À 12 mois
              </th>
              <th scope="col" className={`${tableCls.th} ${tableCls.num}`}>
                À 24 mois
              </th>
              <th scope="col" className={`${tableCls.th} ${tableCls.num}`}>
                Durée médiane
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.label} className={`${tableCls.tr} ${i === 0 ? "bg-surface-2 font-semibold" : ""}`}>
                <th scope="row" className={`${tableCls.td} font-normal ${i === 0 ? "font-semibold" : ""}`}>
                  {r.label}
                  {r.note && <span className="block text-xs font-normal text-fg-subtle">{r.note}</span>}
                </th>
                <td className={`${tableCls.td} ${tableCls.num}`}>{r.n == null ? "—" : fmt.int(r.n)}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{r.events == null ? "—" : fmt.int(r.events)}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{r.curve ? cell(r, pct(at(r.curve, 12))) : "—"}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{r.curve ? cell(r, pct(at(r.curve, 24))) : "—"}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{r.curve ? cell(r, medianText(r.curve)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 sm:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={r.label} className="rounded-control border border-line bg-surface p-3 text-sm">
            <p className="font-semibold text-fg">{r.label}</p>
            {r.note ? (
              <p className="text-xs text-fg-subtle">{r.note}</p>
            ) : (
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-fg-muted">
                <dt>Embauches suivies</dt>
                <dd className="text-right tabular-nums text-fg">{r.n == null ? "—" : fmt.int(r.n)}</dd>
                <dt>À 12 mois</dt>
                <dd className="text-right tabular-nums text-fg">{r.curve ? pct(at(r.curve, 12)) : "—"}</dd>
                <dt>À 24 mois</dt>
                <dd className="text-right tabular-nums text-fg">{r.curve ? pct(at(r.curve, 24)) : "—"}</dd>
                <dt>Durée médiane</dt>
                <dd className="text-right tabular-nums text-fg">{r.curve ? medianText(r.curve) : "—"}</dd>
              </dl>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

// Encarts « Comment lire » et « Limites » : listes courtes, détail dans l'aide
export function ReadingNotes({ reading, limits, helpHref, headingLevel = 2 }: { reading: ReactNode[]; limits: ReactNode[]; helpHref?: string; headingLevel?: 2 | 3 }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Comment lire" headingLevel={headingLevel}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-muted">
          {reading.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {helpHref && (
          <p className="mt-3 text-sm">
            <Link href={helpHref} className="font-medium text-link underline underline-offset-2 transition-colors duration-150 hover:decoration-2">
              En savoir plus dans l&apos;aide
            </Link>
          </p>
        )}
      </Card>
      <Card title="Limites" headingLevel={headingLevel}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-muted">
          {limits.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
