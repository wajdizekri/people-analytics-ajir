import type { ReactNode } from "react";
import { BrandMark } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/ui/theme";
import { Constellation } from "./constellation";
import { CONSTELLATION_VARS, ConstellationStatic } from "./constellation-static";

// Gabarit des pages publiques (connexion, activation) : panneau visuel marine à gauche (≥ 1024 px), formulaire à droite.
// Sous 1024 px : bandeau marine compact avec la constellation fixe, puis le formulaire. Le formulaire ne recouvre jamais
// la constellation : aucune animation derrière les champs.

const POINTS = ["Indicateurs RH", "Priorités du mois", "Accès par rôle"];

const GLOW = (
  <>
    <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-brand-blue/40 blur-3xl dark:bg-brand-blue/25" />
    <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 left-10 h-72 w-72 rounded-full bg-brand-magenta/20 blur-3xl dark:bg-brand-magenta/10" />
  </>
);

// Bords fondus : la constellation se dissout dans le fond marine
const FADE = "[mask-image:radial-gradient(ellipse_at_center,#000_45%,transparent_78%)]";

export function AuthShell({ interactive = false, children }: { interactive?: boolean; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section aria-label="Présentation de People Analytics" className={`on-navy relative hidden overflow-hidden bg-nav px-12 py-10 text-white lg:flex lg:flex-col ${CONSTELLATION_VARS}`}>
        {GLOW}
        <div className="relative z-10">
          <BrandMark />
        </div>
        <div className={`relative -mx-12 my-2 min-h-56 flex-1 opacity-90 ${FADE}`}>
          <Constellation interactive={interactive}>
            <ConstellationStatic />
          </Constellation>
        </div>
        <div className="relative z-10 max-w-md">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-orange">Module du SIRH AJIR</p>
          <p className="mt-2 text-3xl font-semibold leading-tight">Aide à la décision RH</p>
          <ul className="mt-6 space-y-3 xl:mt-8 xl:space-y-4">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3 font-medium">
                <span aria-hidden="true" className="h-5 w-1 shrink-0 rounded-full bg-brand-orange" />
                {p}
              </li>
            ))}
          </ul>
          <p className="mt-8 text-xs text-white/70">ArabSoft · Tunis</p>
        </div>
      </section>

      <div className="flex min-w-0 flex-col">
        <div className={`on-navy relative flex h-24 shrink-0 items-center overflow-hidden bg-nav px-4 sm:px-6 lg:hidden ${CONSTELLATION_VARS}`}>
          {GLOW}
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-3/5 [mask-image:linear-gradient(to_right,transparent,#000_45%)]">
            <ConstellationStatic />
          </div>
          <div className="relative z-10">
            <BrandMark />
          </div>
        </div>
        <div className="flex justify-end px-4 pt-3 sm:px-6 lg:pt-5">
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-start justify-center px-4 pb-10 pt-2 sm:px-6 lg:items-center lg:pb-16">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </main>
  );
}

/** Carte du formulaire : titre (h1), mention courte facultative, contenu. */
export function AuthCard({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-surface p-6 text-fg shadow-pop sm:p-8">
      <h1 className={`text-xl font-semibold text-fg ${intro ? "" : "mb-6"}`}>{title}</h1>
      {intro && <div className="mb-6 mt-1 text-sm text-fg-muted">{intro}</div>}
      {children}
    </div>
  );
}

/** Encart d'aide repliable sous la carte (mot de passe oublié, première connexion). */
export function AuthHelp({ id, summary, children }: { id?: string; summary: string; children: ReactNode }) {
  return (
    <details id={id} className="group scroll-mt-4 rounded-card border border-line bg-surface px-4 py-1.5 text-sm">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-control font-medium text-fg [&::-webkit-details-marker]:hidden">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-link transition-transform duration-200 group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
        {summary}
      </summary>
      <div className="mb-2 mt-1 text-fg-muted">{children}</div>
    </details>
  );
}
