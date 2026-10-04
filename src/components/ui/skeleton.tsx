import { cardCls } from "./classes";

// Squelettes de chargement (loading.tsx) : la forme de la page, sans texte. Décoratifs (aria-hidden) ;
// SkeletonPage porte seul l'annonce « Chargement… » (role="status") pour les lecteurs d'écran.

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-control bg-surface-3 motion-reduce:animate-none ${className}`} />;
}

const WIDTHS = ["w-full", "w-11/12", "w-4/5", "w-10/12", "w-3/4"];

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 && lines > 1 ? "w-3/5" : WIDTHS[i % WIDTHS.length]}`} />
      ))}
    </div>
  );
}

export function SkeletonCard({ lines = 3, title = true, className = "" }: { lines?: number; title?: boolean; className?: string }) {
  return (
    <div aria-hidden="true" className={`${cardCls} p-4 sm:p-5 ${className}`}>
      {title && <Skeleton className="mb-4 h-4 w-2/5" />}
      <SkeletonText lines={lines} />
    </div>
  );
}

function KpiShape() {
  return (
    <div className={`${cardCls} p-4`}>
      <Skeleton className="h-3.5 w-3/5" />
      <Skeleton className="mt-3 h-7 w-1/2" />
      <Skeleton className="mt-3 h-3 w-4/5" />
    </div>
  );
}

const KPI_COLS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 5: "sm:grid-cols-3 lg:grid-cols-5" };

export function SkeletonKpiRow({ count = 4, className = "" }: { count?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={`grid grid-cols-1 gap-4 ${KPI_COLS[count] ?? KPI_COLS[4]} ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <KpiShape key={i} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 8, columns = 5, title = true, className = "" }: { rows?: number; columns?: number; title?: boolean; className?: string }) {
  const cols = Array.from({ length: columns }, (_, i) => i);
  return (
    <div aria-hidden="true" className={`${cardCls} overflow-hidden ${className}`}>
      {title && (
        <div className="p-4 pb-3">
          <Skeleton className="h-4 w-1/3" />
        </div>
      )}
      <div className="flex gap-4 border-y border-line bg-surface-2 px-3 py-3">
        {cols.map((c) => (
          <Skeleton key={c} className={`h-3 ${c === 0 ? "w-1/4" : "flex-1"}`} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-line px-3 py-3 last:border-0">
          {cols.map((c) => (
            <Skeleton key={c} className={`h-3.5 ${c === 0 ? "w-1/4" : c === columns - 1 ? "w-12 flex-none" : "flex-1"}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

const BARS = [45, 70, 55, 85, 60, 75, 40, 90, 65, 50];

export function SkeletonChart({ height = 280, title = true, className = "" }: { height?: number; title?: boolean; className?: string }) {
  return (
    <div aria-hidden="true" className={`${cardCls} p-4 sm:p-5 ${className}`}>
      {title && <Skeleton className="h-4 w-1/2" />}
      <div className="mt-4 flex items-end gap-2 border-b border-l border-line pl-2" style={{ height }}>
        {BARS.map((b, i) => (
          <div key={i} className="flex-1 animate-pulse rounded-t-[4px] bg-surface-3 motion-reduce:animate-none" style={{ height: `${b}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Forme d'un PageHeader (titre, périmètre ; bouton d'action à droite) pour composer un squelette de page sur mesure. */
export function SkeletonHeader({ avatar = false, actions = true }: { avatar?: boolean; actions?: boolean }) {
  return (
    <div aria-hidden="true" className="mb-6 flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {avatar && <Skeleton className="h-12 w-12 shrink-0 rounded-full" />}
        <div className="min-w-0 flex-1">
          <Skeleton className="h-7 w-2/3 max-w-xs" />
          <Skeleton className="mt-2 h-3 w-1/2 max-w-56" />
        </div>
      </div>
      {actions && <Skeleton className="hidden h-10 w-36 sm:block" />}
    </div>
  );
}

export type SkeletonPageVariant = "dashboard" | "liste" | "rapport" | "fiche";

/** Squelette d'une page entière pour loading.tsx : `export default function Loading() { return <SkeletonPage variant="liste" />; }` */
export function SkeletonPage({ variant = "dashboard", label = "Chargement de la page…" }: { variant?: SkeletonPageVariant; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <SkeletonHeader avatar={variant === "fiche"} />
      {variant === "dashboard" && (
        <div className="space-y-6">
          <SkeletonKpiRow count={4} />
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonChart />
            <SkeletonChart />
          </div>
          <SkeletonTable rows={5} />
        </div>
      )}
      {variant === "liste" && (
        <div className="space-y-6">
          <div aria-hidden="true" className={`${cardCls} flex flex-wrap gap-3 p-4`}>
            <Skeleton className="h-10 w-full sm:w-64" />
            <Skeleton className="hidden h-10 w-40 sm:block" />
            <Skeleton className="hidden h-10 w-40 sm:block" />
            <Skeleton className="h-10 w-32 sm:ml-auto" />
          </div>
          <SkeletonTable rows={10} columns={6} title={false} />
          <div aria-hidden="true" className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-48" />
          </div>
        </div>
      )}
      {variant === "rapport" && (
        <div className="space-y-6">
          <SkeletonCard lines={2} />
          <SkeletonKpiRow count={3} />
          <SkeletonChart height={320} />
          <div className="grid gap-4 lg:grid-cols-2">
            <SkeletonChart height={220} />
            <SkeletonCard lines={5} />
          </div>
        </div>
      )}
      {variant === "fiche" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4">
            <SkeletonCard lines={6} />
            <SkeletonCard lines={3} />
          </div>
          <div className="space-y-6 lg:col-span-2">
            <SkeletonKpiRow count={3} />
            <SkeletonChart height={240} />
            <SkeletonCard lines={4} />
          </div>
        </div>
      )}
    </div>
  );
}
