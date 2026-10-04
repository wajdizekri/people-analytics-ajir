"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Actualise la page tant qu'un traitement asynchrone est en cours (import, recalcul) ; suspendable (WCAG 2.2.2), inactif onglet masqué
export function AutoRefresh({ active, label, seconds = 5 }: { active: boolean; label: string; seconds?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!active || paused) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(id);
  }, [active, paused, seconds, router]);

  if (!active) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control border border-info/30 bg-info-soft px-3 py-2 text-sm text-fg">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full bg-info ${paused ? "" : "animate-pulse motion-reduce:animate-none"}`} />
      {/* Annonce la suspension ou la reprise (le texte ne change pas à chaque actualisation) */}
      <span aria-live="polite">
        {label} {paused ? "Actualisation automatique suspendue." : `La page s'actualise toutes les ${seconds} s.`}
      </span>
      <button
        type="button"
        onClick={() => setPaused((p) => !p)}
        className="inline-flex min-h-10 items-center rounded-control px-1 font-medium text-link underline underline-offset-2 hover:decoration-2"
      >
        {paused ? "Reprendre l'actualisation" : "Suspendre l'actualisation"}
      </button>
    </p>
  );
}
