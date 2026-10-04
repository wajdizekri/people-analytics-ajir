// Classes partagées, en jetons du design system (clair et sombre) : docs/qa/DESIGN_SYSTEM.md

/** Surface commune des cartes (Card, KpiTile, visuels) : rayon 12 px, bordure et ombre de carte. */
export const cardCls = "rounded-card border border-line bg-surface text-fg shadow-card";

/** Tableaux : en-tête collant, survol de ligne, nombres à droite (tableCls.num). */
export const tableCls = {
  /** Conteneur à défilement horizontal (et vertical si maxHeight) : à poser autour de <table>. */
  wrap: "overflow-x-auto",
  table: "w-full text-left text-sm text-fg",
  thead: "sticky top-0 z-[1] border-b-2 border-line bg-surface-2 text-xs text-fg-muted",
  th: "px-3 py-2.5 font-semibold",
  tr: "border-b border-line last:border-0 transition-colors duration-150 hover:bg-surface-3",
  td: "px-3 py-2.5",
  /** Colonne de nombres : alignée à droite, chiffres tabulaires. */
  num: "text-right tabular-nums",
};

/** Champ de saisie (input, select, textarea) : bordure ≥ 3:1, focus visible. */
export const fieldCls =
  "block min-h-10 w-full rounded-control border border-line-strong bg-surface px-3 text-sm text-fg transition-colors duration-150 placeholder:text-fg-subtle hover:border-fg-muted focus:border-primary disabled:cursor-not-allowed disabled:opacity-60";
