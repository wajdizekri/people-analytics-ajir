import type { ReactNode } from "react";

export function DefinitionList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`divide-y divide-line ${className}`}>{children}</dl>;
}

// Une définition : terme, phrase courte, puis calcul, périmètre, exclusions, unité et période quand ils sont utiles
export function Definition({
  term,
  children,
  formula,
  scope,
  exclusions,
  unit,
  period,
}: {
  term: string;
  children: ReactNode;
  formula?: ReactNode;
  scope?: ReactNode;
  exclusions?: ReactNode;
  unit?: ReactNode;
  period?: ReactNode;
}) {
  const facts: [string, ReactNode][] = (
    [
      ["Calcul", formula],
      ["Périmètre", scope],
      ["Exclusions", exclusions],
      ["Unité", unit],
      ["Période", period],
    ] as [string, ReactNode][]
  ).filter(([, v]) => v != null && v !== "");
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="text-sm font-semibold text-heading">{term}</dt>
      <dd className="mt-0.5 text-sm text-fg-muted">
        <p>{children}</p>
        {facts.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-fg-muted">
            {facts.map(([k, v]) => (
              <li key={k}>
                <span className="font-medium text-fg">{k} :</span> {v}
              </li>
            ))}
          </ul>
        )}
      </dd>
    </div>
  );
}
