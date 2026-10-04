"use client";

import { Button, Icon, SkeletonPage, type SkeletonPageVariant } from "@/components/ui";

// L'écran d'erreur remplace la page : son titre devient le h1
export function RouteError({ title, retry, digest }: { title: string; retry: () => void; digest?: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-card border border-l-4 border-line border-l-danger bg-danger-soft p-5 text-sm text-fg sm:p-6">
      <Icon name="error" className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
      <div className="min-w-0">
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="mt-1 text-fg-muted">
          Une erreur est survenue lors du chargement des données. Réessayez ; si le problème persiste, contactez l&apos;administrateur
          {digest ? ` (référence ${digest})` : ""}.
        </p>
        <Button icon="refresh" onClick={() => retry()} className="mt-3">
          Réessayer
        </Button>
      </div>
    </div>
  );
}

const VARIANT: Record<"default" | "dashboard" | "list" | "report", SkeletonPageVariant> = { default: "rapport", dashboard: "dashboard", list: "liste", report: "rapport" };

// Squelette qui reprend la forme de l'écran attendu (compatibilité : préférer SkeletonPage dans loading.tsx)
export function RouteLoading({ label, variant = "default" }: { label: string; variant?: "default" | "dashboard" | "list" | "report" }) {
  return <SkeletonPage variant={VARIANT[variant]} label={label} />;
}
