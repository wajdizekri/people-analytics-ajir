"use client";

import { RouteError } from "@/components/pilotage/route-states";

export default function RouteErrorBoundary({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError title="Impossible d'afficher les comptes utilisateurs" retry={retry} digest={error.digest} />;
}
