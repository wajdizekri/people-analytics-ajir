"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const ALIGN = { center: "left-1/2 -translate-x-1/2", start: "left-0", end: "right-0" } as const;

// Bulle d'aide « ? » : bouton au clavier (Entrée, Espace), Échap ou clic extérieur pour fermer.
// Le texte reste dans le DOM (masqué) et sert de description au bouton : un lecteur d'écran l'annonce dès la prise de focus.
export function InfoTip({
  label,
  children,
  align = "center",
  className = "",
}: {
  label: string;
  children: ReactNode;
  align?: keyof typeof ALIGN;
  className?: string;
}) {
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
        aria-describedby={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-link transition-colors duration-150 hover:bg-primary-soft active:scale-95"
      >
        <span aria-hidden="true" className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-current text-[11px] font-semibold leading-none">
          ?
        </span>
        <span className="sr-only">Définition : {label}</span>
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
        {children}
      </span>
    </span>
  );
}
