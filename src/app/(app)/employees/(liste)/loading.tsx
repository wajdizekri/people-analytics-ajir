import { Skeleton, cardCls } from "@/components/ui";

// Squelette fidèle à la liste : en-tête, filtres, puces actives, puis tableau (cartes en zone étroite) et pagination
const ROWS = 10;

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement des collaborateurs…</span>
      <div aria-hidden="true">
        <div className="mb-6 border-l-4 border-line pl-3">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-4 w-full max-w-md" />
          <Skeleton className="mt-2 h-3 w-full max-w-sm" />
        </div>

        <div className={`${cardCls} mb-4 grid grid-cols-1 gap-x-4 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5`}>
          <div className="sm:col-span-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-1.5 h-10 w-full" />
          </div>
          <div className="hidden sm:block">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-1.5 h-10 w-full" />
          </div>
          <div className="hidden sm:block">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-1.5 h-10 w-full" />
          </div>
          <Skeleton className="h-10 w-full sm:hidden" />
          <div className="col-span-full flex justify-end">
            <Skeleton className="h-10 w-40" />
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-6 w-36 rounded-full" />
        </div>

        <div className={`${cardCls} @container overflow-hidden`}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
          <div className="hidden @2xl:block">
            <div className="flex items-center gap-4 border-b-2 border-line bg-surface-2 px-3 py-3">
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-24" />
            </div>
            {Array.from({ length: ROWS }, (_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-line px-3 py-2.5 last:border-0">
                <div className="flex w-1/4 items-center gap-2.5">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-4/5" />
                    <Skeleton className="h-3 w-3/5" />
                  </div>
                </div>
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton className="h-5 w-16 rounded" />
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
          <ul className="divide-y divide-line @2xl:hidden">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-4/5" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-4 py-2.5">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-10 w-56" />
          </div>
        </div>
      </div>
    </div>
  );
}
