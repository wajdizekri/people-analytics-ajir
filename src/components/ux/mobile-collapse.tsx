"use client";

import { useId, useState, type ReactNode } from "react";

// Bloc repliable sous 640 px seulement (filtres) : sur grand écran le contenu reste affiché et le bouton est masqué.
// Usage : <MobileCollapse label="Filtres" count={2}><FilterForm … /></MobileCollapse>
export function MobileCollapse({ label, count = 0, children, defaultOpen = false }: { label: string; count?: number; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="mb-3 inline-flex min-h-10 w-full items-center justify-between gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-link shadow-sm transition-colors duration-200 hover:border-primary hover:bg-primary-soft sm:hidden"
      >
        <span>
          {label}
          {count > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 py-px text-xs font-semibold text-primary-fg">{count} actif{count > 1 ? "s" : ""}</span>}
        </span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div id={id} className={`${open ? "block" : "hidden"} sm:block`}>
        {children}
      </div>
    </div>
  );
}
