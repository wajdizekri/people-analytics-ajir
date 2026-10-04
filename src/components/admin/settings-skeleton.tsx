import { Skeleton, cardCls } from "@/components/ui";

const ROWS_PER_CARD = [2, 1, 3];

// Squelette de la page Paramètres : même grille que la page chargée (thèmes à gauche à partir de lg, puces en dessous,
// cartes de lignes « libellé à gauche, champ à droite », barre d'enregistrement). Seule l'enveloppe est annoncée.
export function SettingsSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Chargement des paramètres…</span>
      <div aria-hidden="true">
        <div className="mb-6 border-l-4 border-line pl-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-2 h-7 w-48" />
          <Skeleton className="mt-2 h-4 w-full max-w-xl" />
        </div>
        <div className="mb-4 flex flex-wrap gap-2 lg:hidden">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-32 rounded-full" />
          ))}
        </div>
        <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-6">
          <div className={`${cardCls} hidden self-start p-3 lg:block`}>
            <Skeleton className="mb-3 h-3 w-16" />
            <div className="space-y-2">
              {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </div>
          <div className="@container min-w-0 space-y-4">
            {ROWS_PER_CARD.map((rows, s) => (
              <div key={s} className={cardCls}>
                <div className="border-b border-line px-4 py-3 sm:px-5">
                  <Skeleton className="h-5 w-56 max-w-full" />
                  <Skeleton className="mt-2 h-3.5 w-full max-w-md" />
                </div>
                <div className="divide-y divide-line px-4 sm:px-5">
                  {Array.from({ length: rows }, (_, i) => (
                    <div key={i} className="grid gap-x-6 gap-y-2 py-4 @lg:grid-cols-[minmax(0,1fr)_12rem]">
                      <div>
                        <Skeleton className="h-4 w-3/5" />
                        <Skeleton className="mt-2 h-3 w-4/5" />
                      </div>
                      <Skeleton className="h-10 w-48 max-w-full" />
                      <div className="space-y-2 @lg:col-span-2">
                        <Skeleton className="h-3 w-3/4" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className={`${cardCls} flex flex-col gap-3 border-l-4 border-l-line-strong px-4 py-3 md:flex-row md:items-center md:justify-between`}>
              <Skeleton className="h-4 w-56 max-w-full" />
              <Skeleton className="h-10 w-full md:w-60" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
