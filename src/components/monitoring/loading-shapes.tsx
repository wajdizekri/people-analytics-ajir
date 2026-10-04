import type { ReactNode } from "react";
import { Skeleton, SkeletonText, cardCls } from "@/components/ui";

// Squelettes des écrans « Données et modèle » : même ordre que la page (en-tête, verdict, encart d'aide, sommaire, indicateurs, sections)

export function LoadingPage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

export function TopShape({ action = false, summary = true, sections = 3 }: { action?: boolean; summary?: boolean; sections?: number }) {
  return (
    <>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 border-l-4 border-line pl-3">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-7 w-2/3 max-w-sm" />
          <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
        </div>
        {action && <Skeleton className="hidden h-10 w-52 sm:block" />}
      </div>
      {summary && (
        <div className={`${cardCls} mb-4 flex gap-3 border-l-4 p-4`}>
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="mt-2 h-5 w-11/12" />
            <SkeletonText lines={2} className="mt-3 max-w-2xl" />
          </div>
        </div>
      )}
      <div className={`${cardCls} mb-4 flex gap-3 px-4 py-3`}>
        <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-3.5 w-44" />
          <SkeletonText lines={3} className="mt-2 max-w-3xl" />
        </div>
      </div>
      {sections > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-3 w-28" />
          {Array.from({ length: sections }, (_, i) => (
            <Skeleton key={i} className="h-9 w-32 rounded-full" />
          ))}
        </div>
      )}
    </>
  );
}

export function SectionShape({ children, intro = true }: { children: ReactNode; intro?: boolean }) {
  return (
    <div className="mb-8">
      <Skeleton className="h-5 w-72 max-w-full" />
      {intro && <Skeleton className="mt-2 mb-4 h-4 w-full max-w-2xl" />}
      {!intro && <div className="mb-4" />}
      {children}
    </div>
  );
}

export function ListShape({ rows = 3 }: { rows?: number }) {
  return (
    <div className={`${cardCls} divide-y divide-line`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid grid-cols-1 gap-3 p-3 md:grid-cols-[15rem_1fr]">
          <div>
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="mt-2 h-5 w-3/5 rounded-full" />
          </div>
          <SkeletonText lines={2} />
        </div>
      ))}
    </div>
  );
}

const BAR_WIDTHS = ["w-11/12", "w-3/4", "w-3/5", "w-2/5", "w-1/3", "w-1/4", "w-1/5", "w-1/6"];

// Visuel en barres horizontales triées (Pareto des contrôles, indices de dérive) : titre, sous-titre, un libellé et une barre par ligne
export function BarsShape({ rows = 6, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`${cardCls} p-4 sm:p-5 ${className}`}>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="mt-2 h-3 w-1/3" />
      <div className="mt-4 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-3 sm:grid-cols-[minmax(0,13rem)_1fr]">
            <Skeleton className="h-3 w-full" />
            <Skeleton className={`h-3.5 ${BAR_WIDTHS[Math.min(i, BAR_WIDTHS.length - 1)]}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
