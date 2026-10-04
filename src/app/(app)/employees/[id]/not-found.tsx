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
    />
  );
}
