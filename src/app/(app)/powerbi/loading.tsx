import { Skeleton, cardCls } from "@/components/ui";

export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement du rapport Power BI…</span>
      <div aria-hidden="true">
        <div className="mb-6 border-l-4 border-line pl-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="mt-2 h-3.5 w-56" />
        </div>
        <div className={`${cardCls} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-64" />
          </div>
          <Skeleton className="h-[calc(100dvh-13rem)] min-h-[520px] w-full rounded-none" />
        </div>
      </div>
    </div>
  );
}
