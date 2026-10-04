import type { ReactNode } from "react";
import { Icon, cardCls } from "@/components/ui";

// Bloc repliable des écrans « Données et modèle » (rapport complet, exemples de lignes, détails techniques) : chevron animé, zone cliquable ≥ 44 px
export function Disclosure({
  summary,
  children,
  className = "",
  bodyClassName = "p-4",
  open,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  open?: boolean;
}) {
  return (
    <details open={open} className={`group/disc ${cardCls} overflow-hidden ${className}`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-medium text-link transition-colors duration-200 hover:bg-primary-soft active:bg-surface-3 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-flex shrink-0 transition-transform duration-200 group-open/disc:rotate-90">
          <Icon name="chevron-right" />
        </span>
        <span className="underline-offset-2 group-hover/disc:underline">{summary}</span>
      </summary>
      <div className={`border-t border-line ${bodyClassName}`}>{children}</div>
    </details>
  );
}
