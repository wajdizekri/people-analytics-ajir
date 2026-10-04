"use client";

import { useEffect, useRef } from "react";
import { Button, cardCls } from "@/components/ui";
import { pendingLabel } from "./settings-labels";

export type SettingChange = { key: string; text: string; invalid?: boolean };

const plural = (n: number) => (n > 1 ? "s" : "");

// Barre d'enregistrement, collée en bas de l'écran : compteur et récapitulatif des modifications, valeurs à corriger,
// refus du serveur, annulation et enregistrement. Dernier élément du formulaire : en fin de page, elle reprend sa place
// sous la dernière carte et ne masque aucun champ.
export function SettingsSaveBar({
  changes,
  refusal,
  pending,
  onReset,
}: {
  changes: SettingChange[];
  /** Refus du serveur encore d'actualité. */
  refusal?: string;
  pending: boolean;
  onReset: () => void;
}) {
  // La barre recouvre le bas de l'écran : la page réserve sa hauteur (scroll-padding), pour qu'un champ atteint au clavier
  // défile au-dessus d'elle au lieu de rester caché dessous
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const root = document.documentElement;
    const reserve = () => {
      root.style.scrollPaddingBottom = `${el.offsetHeight + 24}px`;
    };
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.scrollPaddingBottom = "";
    };
  }, []);

  const toSave = changes.filter((c) => !c.invalid);
  const toFix = changes.filter((c) => c.invalid);
  const clean = changes.length === 0;
  return (
    <div ref={bar} className={`${cardCls} sticky bottom-2 z-20 mt-4 border-l-4 px-4 py-3 shadow-pop ${clean ? "border-l-line-strong" : "border-l-accent"}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1 space-y-1 text-sm" aria-live="polite">
          {refusal && (
            <p role="alert" className="font-medium text-danger">
              {refusal}
            </p>
          )}
          {toSave.length > 0 && (
            <>
              <p className="font-semibold text-fg">{pendingLabel(toSave.length)} :</p>
              {/* Liste longue : hauteur bornée, donc défilante ; elle prend alors le focus pour rester lisible au clavier */}
              <ul
                tabIndex={toSave.length > 5 ? 0 : undefined}
                aria-label="Récapitulatif des modifications"
                className={`list-disc space-y-0.5 pl-5 text-xs text-fg ${toSave.length > 5 ? "max-h-24 overflow-y-auto" : ""}`}
              >
                {toSave.map((c) => (
                  <li key={c.key}>{c.text}</li>
                ))}
              </ul>
            </>
          )}
          {toFix.length > 0 && (
            <>
              <p className="font-semibold text-danger">
                {toFix.length} valeur{plural(toFix.length)} à corriger :
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs font-medium text-danger">
                {toFix.map((c) => (
                  <li key={c.key}>{c.text}</li>
                ))}
              </ul>
            </>
          )}
          {clean && (
            <p id="settings-etat" className="text-fg-muted">
              Aucune modification à enregistrer.
            </p>
          )}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {!clean && (
            <Button variant="tertiary" onClick={onReset} disabled={pending}>
              Annuler les modifications
            </Button>
          )}
          <Button type="submit" variant="primary" icon="save" pending={pending} pendingLabel="Enregistrement…" disabled={clean} aria-describedby={clean ? "settings-etat" : undefined}>
            Enregistrer les paramètres
          </Button>
        </div>
      </div>
    </div>
  );
}
