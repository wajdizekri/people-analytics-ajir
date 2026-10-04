import { ButtonLink, EmptyState } from "@/components/ui";

export default function AlertNotFound() {
  return (
    <div className="mx-auto mt-6 max-w-xl">
      <EmptyState
        headingLevel={1}
        icon="search"
        title="Alerte introuvable"
        action={
          <ButtonLink href="/alerts" variant="primary" icon="arrow-left">
            Revenir à la liste des alertes
          </ButtonLink>
        }
      />
    </div>
  );
}
