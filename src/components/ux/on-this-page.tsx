"use client";

import { useEffect, useRef, useState } from "react";

const DESKTOP = "(min-width: 1024px)";

// Sommaire des pages longues : ancres vers les sections (cibles avec `scroll-mt-4`). La section affichée est mise en
// évidence (aria-current) ; à partir de 1024 px le sommaire reste collé en haut de l'écran et la marge de défilement de
// la page tient compte de sa hauteur (ancres et éléments focalisés jamais cachés dessous).
export function OnThisPage({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  const ids = items.map((i) => i.id).join(" ");

  useEffect(() => {
    const targets = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (!targets.length || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    // Bande de lecture : sous le sommaire collé, jusqu'au milieu de l'écran ; en bas de page, la dernière section
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        const first = atBottom() ? targets[targets.length - 1] : targets.find((t) => visible.get(t.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-80px 0px -50% 0px" },
    );
    targets.forEach((t) => io.observe(t));
    const onScroll = () => {
      if (atBottom()) setActive(targets[targets.length - 1].id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [ids]);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollPaddingTop;
    const mq = window.matchMedia?.(DESKTOP);
    const apply = () => {
      root.style.scrollPaddingTop = mq?.matches && nav.current ? `${nav.current.offsetHeight + 8}px` : previous;
    };
    apply();
    mq?.addEventListener?.("change", apply);
    return () => {
      mq?.removeEventListener?.("change", apply);
      root.style.scrollPaddingTop = previous;
    };
  }, []);

  return (
    <nav
      ref={nav}
      aria-label="Sur cette page"
      className="mb-4 flex flex-wrap items-center gap-2 text-sm lg:sticky lg:top-0 lg:z-20 lg:-mx-2 lg:rounded-b-control lg:bg-canvas/95 lg:px-2 lg:py-2 lg:backdrop-blur"
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Sur cette page</span>
      <ul className="flex flex-wrap gap-2">
        {items.map((i) => (
          <li key={i.id}>
            <a
              href={`#${i.id}`}
              aria-current={active === i.id ? "true" : undefined}
              onClick={() => setActive(i.id)}
              className="inline-flex min-h-9 items-center rounded-full border border-line-strong bg-surface px-3 text-fg transition-colors duration-150 hover:border-primary hover:bg-primary-soft active:translate-y-px aria-[current]:border-primary aria-[current]:bg-primary-soft aria-[current]:font-medium aria-[current]:text-link"
            >
              {i.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
