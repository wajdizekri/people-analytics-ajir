import { ButtonLink, EmptyState } from "@/components/ui";

export default function EmployeeNotFound() {
  return (
    <EmptyState
      title="Collaborateur introuvable"
      icon="user"
      action={
        <ButtonLink href="/employees" variant="secondary" icon="search">
          Rechercher dans la liste des collaborateurs
        </ButtonLink>
      }
    >
      La fiche demandée n&apos;existe pas. Vérifiez le lien, ou retrouvez le collaborateur par son nom ou son matricule.
    </EmptyState>
  );
}
