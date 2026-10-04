import { BrandMark } from "@/components/layout/sidebar";
import { ButtonLink, cardCls } from "@/components/ui";

export const metadata = { title: "Page introuvable — People Analytics AJIR" };

// Page 404 globale (adresse inconnue). « / » redirige vers l'accueil du rôle, ou vers la connexion.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-canvas px-4 py-10">
      <BrandMark light />
      <div className={`${cardCls} w-full max-w-md p-6 text-center sm:p-8`}>
        <span aria-hidden="true" className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary-soft text-link">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35 M8.5 8.5l5 5 M13.5 8.5l-5 5" />
          </svg>
        </span>
        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-fg-subtle">Erreur 404</p>
        <h1 className="mt-1 text-2xl font-semibold text-heading">Page introuvable</h1>
        <p className="mt-2 text-sm text-fg-muted">
          L&apos;adresse demandée n&apos;existe pas ou a changé : lien mal copié, favori ancien ou page renommée. Vos données ne sont pas concernées.
        </p>
        <p className="mt-2 text-sm text-fg-muted">Revenez à l&apos;accueil puis passez par le menu, ou cherchez l&apos;écran voulu dans l&apos;aide.</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <ButtonLink href="/" variant="primary" icon="arrow-left">
            Revenir à l&apos;accueil
          </ButtonLink>
          <ButtonLink href="/aide" variant="secondary" icon="help">
            Consulter l&apos;aide
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
