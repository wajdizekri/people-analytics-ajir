import type { ReactNode } from "react";
import { tableCls } from "@/components/ui";

// Alternative textuelle d'un graphique (accessibilité) : la première colonne sert d'en-tête de ligne.
// numeric : colonnes de valeurs alignées à droite (charte § 6)
export function DataDetails({
  summary,
  headers,
  rows,
  caption,
  numeric = false,
}: {
  summary: string;
  headers: string[];
  rows: ReactNode[][];
  caption?: string;
  numeric?: boolean;
}) {
  const label = caption ?? summary;
  const align = (j: number) => (numeric && j > 0 ? " text-right" : "");
  return (
    <details className="group mt-2 text-sm">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-control px-1 text-[13px] font-medium text-link transition-colors duration-200 hover:bg-primary-soft hover:underline active:translate-y-px [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-4 w-4 transition-transform duration-200 group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M7 5l5 5-5 5" />
        </svg>
        {summary}
        {caption && <span className="sr-only"> : {caption}</span>}
      </summary>
      {/* Zone défilante atteignable au clavier (WCAG 2.1.1) */}
      <div className="mt-2 max-h-72 overflow-auto rounded-control border border-line" tabIndex={0} role="region" aria-label={label}>
        <table className={tableCls.table}>
          <caption className="sr-only">{label}</caption>
          <thead className={tableCls.thead}>
            <tr>
              {headers.map((h, j) => (
                <th key={h} scope="col" className={`${tableCls.th}${align(j)}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={tableCls.tr}>
                {r.map((c, j) =>
                  j === 0 ? (
                    <th key={j} scope="row" className={`${tableCls.td} whitespace-nowrap font-normal`}>
                      {c}
                    </th>
                  ) : (
                    <td key={j} className={`${tableCls.td} tabular-nums${align(j)}`}>
                      {c}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
