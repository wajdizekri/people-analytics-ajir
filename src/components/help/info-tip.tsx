"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const ALIGN = { center: "left-1/2 -translate-x-1/2", start: "left-0", end: "right-0" } as const;
type Align = keyof typeof ALIGN;

// Détails ajoutés par DetailTip à la bulle d'un `tip` fourni par la page (TermTip, InfoTip…) : une seule bulle par élément
const Extra = createContext<ReactNode>(null);

// Bulle d'aide « ? » : bouton au clavier (Entrée, Espace), Échap ou clic extérieur pour fermer.
// Le texte reste dans le DOM (masqué) ; il n'est relié au bouton (aria-describedby) que bulle ouverte, donc rendu.
export function InfoTip({
  label,
  children,
  align = "center",
  className = "",
  prefix = "Définition",
}: {
  label: string;
  children: ReactNode;
  align?: Align;
  className?: string;
  /** Début du nom accessible du bouton : « Définition : Turnover » (défaut), « Détails : Effectif fin de mois ». */
  prefix?: string;
}) {
  const extra = useContext(Extra);
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);

  // Bulle ramenée dans l'écran (bouton près d'un bord, écran de 390 px) : décalage horizontal mesuré à l'ouverture
  useLayoutEffect(() => {
    const el = bubble.current;
    if (!open || !el) return;
    // Marge plutôt que transform : l'animation d'apparition utilise transform
    el.style.marginLeft = "";
    el.style.marginRight = "";
    const r = el.getBoundingClientRect();
    const max = document.documentElement.clientWidth - 8;
    const dx = Math.round(r.left < 8 ? 8 - r.left : r.right > max ? max - r.right : 0);
    if (dx && align === "end") el.style.marginRight = `${-dx}px`;
    else if (dx) el.style.marginLeft = `${dx}px`;
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className={`relative inline-flex align-middle font-normal normal-case tracking-normal ${className}`}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-link transition-colors duration-150 hover:bg-primary-soft active:scale-95"
      >
        <span aria-hidden="true" className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-current text-[11px] font-semibold leading-none">
          ?
        </span>
        <span className="sr-only">
          {prefix} : {label}
        </span>
      </button>
      <span
        ref={bubble}
        id={id}
        hidden={!open}
        className={`absolute top-full z-30 mt-1 block w-72 max-w-[calc(100vw-2rem)] animate-pop-in rounded-control border border-line bg-surface p-3 text-left text-[13px] leading-relaxed text-fg-muted shadow-pop ${ALIGN[align]}`}
      >
        <span className="mb-0.5 block font-semibold text-heading">
          {label}
          <span className="sr-only"> : </span>
        </span>
        <Extra value={null}>
          {children}
          {extra != null && <span className="mt-1.5 block border-t border-line pt-1.5">{extra}</span>}
        </Extra>
      </span>
    </span>
  );
}

const shown = (n: ReactNode) => n != null && n !== false && n !== "";

/**
 * Bulle « ? » d'un titre ou d'une carte : sous-titre, période, aide, note… hors de l'écran, fermée par défaut.
 * Avec `tip` (TermTip, InfoTip…), les détails s'ajoutent à cette bulle ; sinon bulle « Détails : label ». Rien si tout est vide.
 */
export function DetailTip({
  label,
  details,
  tip,
  prefix = "Détails",
  align = "start",
  className = "",
}: {
  label: string;
  details?: ReactNode | ReactNode[];
  tip?: ReactNode;
  prefix?: string;
  align?: Align;
  className?: string;
}) {
  const lines = (Array.isArray(details) ? details : [details]).filter(shown);
  const body = lines.length
    ? lines.map((d, i) => (
        <span key={i} className={i ? "mt-1 block" : "block"}>
          {d}
        </span>
      ))
    : null;
  if (shown(tip)) return body ? <Extra value={body}>{tip}</Extra> : <>{tip}</>;
  if (!body) return null;
  return (
    <InfoTip label={label} prefix={prefix} align={align} className={className}>
      {body}
    </InfoTip>
  );
}
