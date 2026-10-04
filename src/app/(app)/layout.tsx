import "@/components/export/print.css";
import Link from "next/link";
import { pageContext } from "@/lib/dal/context";
import { countOpenAlerts } from "@/lib/dal/alerts";
import { referenceDate } from "@/lib/dal/employees";
import { NavRailScript } from "@/components/layout/nav-rail";
import { BrandMark, MobileNav, NavToggle, Sidebar } from "@/components/layout/sidebar";
import { Icon, Initials, fmt } from "@/components/ui";
import { ThemeToggle } from "@/components/ui/theme";
import { CommandPalette, CommandPaletteTrigger } from "@/components/ux/command-palette";
import { logoutAction } from "@/app/login/actions";

const ROLE_LABEL = { ADMIN: "Administrateur", RH: "Responsable RH", MANAGER: "Manager" } as const;
// Pastille de rôle lisible dans les deux thèmes (texte ≥ 4,5:1 sur son fond)
const ROLE_TONE = {
  ADMIN: "bg-fuchsia-50 text-brand-magenta ring-fuchsia-200 dark:bg-fuchsia-950/60 dark:text-fuchsia-200 dark:ring-fuchsia-800",
  RH: "bg-info-soft text-info ring-current/25",
  MANAGER: "bg-success-soft text-success ring-current/25",
} as const;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await pageContext();
  const alertCount = countOpenAlerts(ctx);
  const dataDate = fmt.date(referenceDate());
  const roleLabel = ROLE_LABEL[ctx.role];
  return (
    <>
      <NavRailScript />
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-link focus:shadow-pop"
      >
        Aller au contenu
      </a>
      <div className="flex min-h-screen">
        <Sidebar role={ctx.role} alertCount={alertCount} dataDate={dataDate} login={ctx.login} roleLabel={roleLabel} avatar={<Initials name={ctx.login} />} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Une seule ligne à toutes les largeurs : les libellés se replient en icônes, jamais de retour à la ligne */}
          <header className="relative flex h-16 items-center gap-2 border-b border-line bg-surface px-4 md:gap-3 md:px-6 lg:px-8">
            <div className="flex shrink-0 items-center gap-3 md:hidden">
              <MobileNav role={ctx.role} alertCount={alertCount} dataDate={dataDate} login={ctx.login} roleLabel={roleLabel} />
              <BrandMark light compact />
            </div>
            <NavToggle className="-ml-2" />
            {/* Seul contrôle de recherche : la recherche rapide (pages, alertes, actions ; collaborateurs pour RH et manager) */}
            <div className="flex min-w-0 flex-1 justify-end sm:justify-start">
              <CommandPaletteTrigger role={ctx.role} />
            </div>
            <div className="flex shrink-0 items-center gap-1 md:gap-2">
              {/* Date des données : fin du dernier export AJIR importé (repère commun à tous les indicateurs).
                  Entre md et xl elle est dans le pied du menu ; menu réduit, elle revient ici dès md. */}
              <p className="hidden items-center gap-2 whitespace-nowrap rounded-full bg-surface-2 px-3 py-1 text-sm text-fg-muted ring-1 ring-inset ring-line xl:flex in-data-[nav=rail]:md:flex">
                <Icon name="calendar" className="h-4 w-4 text-fg-subtle" />
                <span>
                  Données AJIR au <span className="font-semibold tabular-nums text-fg">{dataDate}</span>
                  <span className="sr-only"> (dernier export AJIR importé)</span>
                </span>
              </p>
              <ThemeToggle />
              <Link
                href="/compte"
                title="Mon compte"
                className="flex min-h-10 items-center gap-2 rounded-full p-1 text-sm text-fg-muted transition-colors duration-150 hover:bg-surface-3 xl:pr-2"
              >
                <span className="sr-only">Mon compte : </span>
                <Initials name={ctx.login} />
                <span className="sr-only 2xl:not-sr-only">
                  <span className="block max-w-40 truncate font-medium text-fg">{ctx.login}</span>
                </span>
                <span className="sr-only xl:not-sr-only">
                  <span className={`block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${ROLE_TONE[ctx.role]}`}>{roleLabel}</span>
                </span>
              </Link>
              <form action={logoutAction}>
                <button
                  type="submit"
                  title="Déconnexion"
                  className="inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-2.5 text-sm font-medium text-fg transition-colors duration-150 hover:border-primary hover:bg-primary-soft active:translate-y-px xl:px-3"
                >
                  <Icon name="logout" />
                  <span className="sr-only xl:not-sr-only">Déconnexion</span>
                </button>
              </form>
            </div>
            <CommandPalette role={ctx.role} />
          </header>
          <main id="contenu" tabIndex={-1} className="min-w-0 flex-1 bg-canvas p-4 md:p-6 lg:p-8">
            <div className="mx-auto max-w-[1600px]">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
