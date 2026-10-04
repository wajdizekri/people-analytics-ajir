"use client";

import { useLinkStatus } from "next/link";
import { Spinner } from "@/components/ui";

// Retour immédiat au clic sur un collaborateur : la fiche n'a pas de loading.tsx (contrôle de périmètre avant tout envoi,
// vraies redirection et 404), l'indicateur apparaît donc sur la ligne cliquée. data-pending colore la ligne (has-[…]).
export function PendingHint() {
  const { pending } = useLinkStatus();
  return (
    <span aria-hidden="true" data-pending={pending || undefined} className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-link">
      {pending && <Spinner className="h-3.5 w-3.5" />}
    </span>
  );
}
