import { getContext, homePath } from "@/lib/dal/context";
import { ROLE_LABEL } from "@/lib/help/content";
import { BrandMark } from "@/components/layout/sidebar";
import { ButtonLink, cardCls } from "@/components/ui";

export const metadata = { title: "Accès refusé — People Analytics AJIR" };

const WHY = {
  ADMIN: "Par séparation des tâches, l'administrateur gère l'outil sans voir les données RH : tableaux de bord, fiches et recommandations lui sont fermés.",
  RH: "Cette page relève de l'administration de l'outil (comptes, paramètres, journal d'audit), réservée à l'administrateur.",
  MANAGER: "Cette page est réservée à la RH ou concerne un collaborateur hors de votre équipe. Vous voyez uniquement les collaborateurs de votre hiérarchie.",
} as const;

const HOME_LABEL = { ADMIN: "Revenir à la console", RH: "Revenir au tableau de bord", MANAGER: "Revenir au tableau de bord" } as const;

export default async function Forbidden() {
  const ctx = await getContext();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-4 py-10">
      <BrandMark light />
      <div className={`${cardCls} w-full max-w-md p-6 text-center sm:p-8`}>
        <span aria-hidden="true" className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-warning-soft text-warning">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Erreur 403</p>
        <h1 className="mt-1 text-2xl font-semibold text-heading">Accès refusé</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {ctx ? (
            <>
              Cette page ne fait pas partie de votre périmètre (rôle : <span className="font-medium">{ROLE_LABEL[ctx.role]}</span>). Rien n&apos;a été modifié.
            </>
          ) : (
            "Cette page demande une connexion avec un compte autorisé."
          )}
        </p>
        {ctx && <p className="mt-2 text-sm text-fg-muted">{WHY[ctx.role]}</p>}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <ButtonLink href={ctx ? homePath(ctx.role) : "/login"} variant="primary" icon={ctx ? "arrow-left" : "user"}>
            {ctx ? HOME_LABEL[ctx.role] : "Se connecter"}
          </ButtonLink>
          {ctx && (
            <ButtonLink href="/aide#confidentialite" variant="secondary" icon="help">
              Voir ce que mon rôle permet
            </ButtonLink>
          )}
        </div>
        {ctx?.role !== "ADMIN" && (
          <p className="mt-4 text-xs text-fg-muted">
            Besoin de cet accès pour votre travail ? Demandez-le à l&apos;administrateur de l&apos;outil : les droits dépendent du rôle du compte.
          </p>
        )}
      </div>
    </main>
  );
}
