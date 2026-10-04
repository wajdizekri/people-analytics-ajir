"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./icons";

// Menu « Plus d'actions » : bouton (aria-haspopup, aria-expanded), flèches haut/bas, Début/Fin, Échap rend le focus au bouton,
// clic extérieur ou Tab pour fermer. Les éléments sont des MenuLink / MenuButton (role="menuitem").
// Après le choix d'un élément, le focus revient au bouton ; le menu se recale s'il sortirait de l'écran (mobile).
export function MoreActions({ label = "Plus d'actions", children, align = "end" }: { label?: string; children: ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);

  const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);

  useLayoutEffect(() => {
    const m = menu.current;
    if (!m) return;
    m.style.left = "";
    m.style.right = "";
    if (!open) return;
    const r = m.getBoundingClientRect();
    if (align === "end" && r.left < 8) {
      m.style.right = "auto";
      m.style.left = "0";
    } else if (align === "start" && r.right > window.innerWidth - 8) {
      m.style.left = "auto";
      m.style.right = "0";
    }
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const list = items();
    (focusLast.current ? list[list.length - 1] : list[0])?.focus();
    focusLast.current = false;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      list[(n + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={root} className="relative inline-block">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            focusLast.current = e.key === "ArrowUp";
            setOpen(true);
          }
        }}
        className="inline-flex min-h-10 w-full items-center justify-center gap-2 whitespace-nowrap rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-link shadow-sm transition-[color,background-color,border-color,transform] duration-200 hover:border-primary hover:bg-primary-soft active:translate-y-px aria-expanded:border-primary aria-expanded:bg-primary-soft"
      >
        <Icon name="more" />
        {label}
        <Icon name="chevron-down" className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        ref={menu}
        id={id}
        role="menu"
        aria-label={label}
        hidden={!open}
        onKeyDown={onMenuKey}
        onClick={(e) => {
          // Un élément qui ouvre une boîte de dialogue (ConfirmButton) garde le menu affiché : la boîte en dépend
          const item = (e.target as HTMLElement).closest('[role="menuitem"]');
          if (!item || item.getAttribute("aria-haspopup") === "dialog") return;
          setOpen(false);
          trigger.current?.focus();
        }}
        className={`absolute top-full z-40 mt-1 min-w-56 max-w-[calc(100vw-2rem)] animate-pop-in rounded-control border border-line bg-surface p-1 shadow-pop ${align === "end" ? "right-0" : "left-0"}`}
      >
        {children}
      </div>
    </div>
  );
}
