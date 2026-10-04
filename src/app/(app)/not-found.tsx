import { ButtonLink, EmptyState } from "@/components/ui";

export const metadata = { title: "Élément introuvable — People Analytics AJIR" };

// notFound() levé par une page de l'application sans not-found propre : rendu dans le gabarit, menu conservé
export default function AppNotFound() {
  return (
    <div className="mx-auto mt-6 max-w-xl">
      <EmptyState
        headingLevel={1}
        icon="search"
        title="Élément introuvable"
        actions={
          <>
            <ButtonLink href="/" variant="primary" icon="arrow-left">
              Revenir à l&apos;accueil
            </ButtonLink>
            <ButtonLink href="/aide" variant="secondary" icon="help">
              Consulter l&apos;aide
            </ButtonLink>
          </>
        }
      >
        <p>
          Ce que vous cherchez n&apos;existe pas ou n&apos;est plus disponible : lien ancien, élément supprimé ou numéro mal saisi dans l&apos;adresse.
        </p>
        <p className="mt-2">Reprenez depuis l&apos;accueil ou le menu : les listes affichent toujours les éléments à jour.</p>
      </EmptyState>
    </div>
  );
}
