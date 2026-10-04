"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@/db/schema";
import { Icon, Spinner, type IconName } from "@/components/ui/icons";
import { setTheme, type ThemePreference } from "@/components/ui/theme";
import { toast } from "@/components/ui/toast";
import type { SearchAlert, SearchResults } from "@/lib/dal/search";
import {
  ACTION_ITEMS,
  RECENTS_KEY,
  addRecent,
  filterItems,
  isEditableTarget,
  isMacPlatform,
  isPaletteShortcut,
  pageItems,
  parseRecents,
  type StaticItem,
} from "./command-palette-items";

// Recherche rapide (Ctrl/⌘+K) : pages du menu et actions filtrées localement ; collaborateurs (RH, manager) et alertes
// ouvertes via GET /api/search, périmètre décidé côté serveur. Dialogue modal natif, motif combobox + listbox.

const OPEN_EVENT = "pa:command-palette-open";
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

const noopSubscribe = () => () => {};
const useIsMac = () => useSyncExternalStore(noopSubscribe, () => isMacPlatform(navigator), () => false);

/**
 * Seul contrôle de recherche de l'en-tête : bouton en forme de champ (icône seule sous 640 px) qui ouvre la recherche rapide.
 * Nom accessible « Recherche rapide » ; le texte indicatif sert de description, comme celui d'un champ de saisie.
 */
export function CommandPaletteTrigger({ role, className = "" }: { role?: Role; className?: string }) {
  const mac = useIsMac();
  const hintId = useId();
  const hint = mac ? "⌘K" : "Ctrl K";
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
      aria-describedby={hintId}
      title={`Recherche rapide (${hint})`}
      onClick={(e) => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: e.currentTarget }))}
      className={`inline-flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-control border border-line-strong bg-surface px-2.5 text-sm text-fg-subtle transition-colors duration-150 hover:border-fg-muted hover:text-fg-muted active:translate-y-px sm:w-full sm:max-w-md sm:justify-start sm:px-3 ${className}`}
    >
      <Icon name="search" className="h-4 w-4" />
      <span className="sr-only">Recherche rapide</span>
      <span id={hintId} aria-hidden="true" className="hidden min-w-0 flex-1 truncate text-left sm:block">
        {role && role !== "ADMIN" ? "Rechercher un collaborateur, une page…" : "Rechercher une page, une alerte…"}
      </span>
      <kbd aria-hidden="true" className="hidden rounded border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-xs font-medium text-fg-subtle lg:inline">
        {hint}
      </kbd>
    </button>
  );
}

/** À monter une fois (gabarit de l'app) : raccourci clavier global et dialogue. */
export function CommandPalette({ role }: { role: Role }) {
  const [open, setOpen] = useState(false);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const show = (from: unknown) => {
      returnTo.current = from instanceof HTMLElement ? from : null;
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.repeat || !isPaletteShortcut(e, open || isEditableTarget(e.target))) return;
      e.preventDefault();
      if (open) setOpen(false);
      else show(document.activeElement);
    };
    const onOpen = (e: Event) => show((e as CustomEvent).detail ?? document.activeElement);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [open]);

  useEffect(() => {
    if (open) return;
    const el = returnTo.current;
    returnTo.current = null;
    if (el?.isConnected) el.focus();
  }, [open]);

  return open ? <CommandPaletteDialog role={role} onClose={() => setOpen(false)} /> : null;
}

type Option = { key: string; label: string; detail?: string; icon: IconName; iconTone?: string; href?: string; theme?: ThemePreference; storeId?: string };
type Group = { key: string; label: string; options: Option[] };
type Remote = { q: string } & ({ status: "ok"; data: SearchResults } | { status: "error"; message: string });

const SEVERITY: Record<SearchAlert["severity"], { label: string; tone: string }> = {
  CRITIQUE: { label: "Critique", tone: "text-danger" },
  ATTENTION: { label: "Attention", tone: "text-warning" },
  INFO: { label: "Information", tone: "text-info" },
};
const STATUS: Record<SearchAlert["status"], string> = { NOUVELLE: "Nouvelle", EN_COURS: "En cours", TRAITEE: "Traitée", REJETEE: "Rejetée" };
const THEME_DONE: Record<ThemePreference, string> = { light: "Thème clair activé.", dark: "Thème sombre activé.", system: "Thème du système activé." };

const toOption = (group: string, i: StaticItem): Option => ({ key: `${group}|${i.id}`, label: i.label, detail: i.detail, icon: i.icon, href: i.href, theme: i.theme, storeId: i.id });

function readRecents(allowed: ReadonlySet<string>): string[] {
  try {
    return parseRecents(localStorage.getItem(RECENTS_KEY), allowed);
  } catch {
    return [];
  }
}

function saveRecent(id: string, allowed: ReadonlySet<string>) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(addRecent(readRecents(allowed), id)));
  } catch {
    // stockage indisponible : pas de récents
  }
}

async function fetchResults(q: string, signal: AbortSignal): Promise<SearchResults> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal, headers: { accept: "application/json" } });
  const body = (await res.json().catch(() => null)) as (SearchResults & { error?: { message?: string } }) | null;
  if (res.status === 401) throw new Error("Votre session a expiré. Reconnectez-vous pour relancer la recherche.");
  if (!res.ok || !body) throw new Error(body?.error?.message ?? "La recherche n'a pas abouti. Vérifiez votre connexion puis réessayez.");
  return body;
}

export function CommandPaletteDialog({ role, onClose }: { role: Role; onClose: () => void }) {
  const router = useRouter();
  const uid = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pilotage = role !== "ADMIN";
  const pages = useMemo(() => pageItems(role), [role]);
  const allowed = useMemo(() => new Set([...pages, ...ACTION_ITEMS].map((i) => i.id)), [pages]);
  const [recents] = useState(() => readRecents(allowed));
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [remote, setRemote] = useState<Remote | null>(null);
  const [retry, setRetry] = useState(0);

  const term = query.trim();
  const wantsRemote = term.length >= 2;
  const current = wantsRemote && remote?.q === term ? remote : null;
  const loading = wantsRemote && !current;

  useLayoutEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    }
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!wantsRemote) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetchResults(term, ctrl.signal)
        .then((data) => setRemote({ q: term, status: "ok", data }))
        .catch((err: unknown) => {
          if (!ctrl.signal.aborted) setRemote({ q: term, status: "error", message: err instanceof Error ? err.message : "La recherche n'a pas abouti." });
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [term, wantsRemote, retry]);

  const groups = useMemo<Group[]>(() => {
    if (!term) {
      const byId = new Map([...pages, ...ACTION_ITEMS].map((i) => [i.id, i]));
      const recent = recents.flatMap((id) => (byId.has(id) ? [toOption("recent", byId.get(id)!)] : []));
      return [
        { key: "recent", label: "Récents", options: recent },
        { key: "pages", label: "Pages", options: pages.map((i) => toOption("pages", i)) },
        { key: "actions", label: "Actions", options: ACTION_ITEMS.map((i) => toOption("actions", i)) },
      ];
    }
    // Pendant le chargement, les résultats précédents restent affichés (pas de clignotement à chaque frappe)
    const data = wantsRemote && remote?.status === "ok" ? remote.data : null;
    const employees: Option[] = (data?.employees ?? []).map((e) => ({
      key: `employees|${e.id}`,
      label: `${e.firstName} ${e.lastName}`,
      detail: [e.matricule, e.jobTitle, e.department].filter(Boolean).join(" · "),
      icon: "user",
      href: `/employees/${e.id}`,
    }));
    if (data?.moreEmployees)
      employees.push({ key: "employees|more", label: "Voir tous les collaborateurs correspondants", detail: `Liste filtrée sur « ${term} »`, icon: "users", href: `/employees?q=${encodeURIComponent(term)}` });
    const alerts: Option[] = (data?.alerts ?? []).map((a) => ({
      key: `alerts|${a.id}`,
      label: a.title,
      detail: `${SEVERITY[a.severity].label} · ${STATUS[a.status]}`,
      icon: "warning",
      iconTone: SEVERITY[a.severity].tone,
      href: `/alerts/${a.id}`,
    }));
    return [
      { key: "pages", label: "Pages", options: filterItems(pages, term).map((i) => toOption("pages", i)) },
      { key: "employees", label: "Collaborateurs", options: employees },
      { key: "alerts", label: "Alertes ouvertes", options: alerts },
      { key: "actions", label: "Actions", options: filterItems(ACTION_ITEMS, term).map((i) => toOption("actions", i)) },
    ];
  }, [term, pages, recents, remote, wantsRemote]);

  const visible = groups.filter((g) => g.options.length > 0);
  const flat = visible.flatMap((g) => g.options);
  const activeIndex = flat.length ? Math.max(0, flat.findIndex((o) => o.key === activeKey)) : -1;
  const active = activeIndex >= 0 ? flat[activeIndex] : null;
  const optionId = (key: string) => `${uid}-opt-${key.replace(/[^\w-]/g, "_")}`;
  const activeDomId = active ? optionId(active.key) : undefined;

  useEffect(() => {
    if (activeDomId) document.getElementById(activeDomId)?.scrollIntoView({ block: "nearest" });
  }, [activeDomId]);

  const activate = (o: Option) => {
    if (o.storeId) saveRecent(o.storeId, allowed);
    onClose();
    if (o.theme) {
      setTheme(o.theme);
      toast(THEME_DONE[o.theme], { id: "theme" });
    } else if (o.href) router.push(o.href);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      const next = (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length;
      setActiveKey(flat[next].key);
    } else if (e.key === "Enter" && e.target === inputRef.current) {
      e.preventDefault();
      if (active) activate(active);
    } else if (e.key === "Tab") {
      const list = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const error = current?.status === "error" ? current.message : null;
  const count = flat.length;
  const announce = loading ? "" : count === 0 ? "Aucun résultat." : `${count} résultat${count > 1 ? "s" : ""} disponible${count > 1 ? "s" : ""}.`;
  const what = pilotage ? "une page, un collaborateur, une alerte ou une action" : "une page, une alerte ou une action";
  let empty: string | null = null;
  if (!count && !loading && !error) empty = term.length < 2 ? "Aucun résultat · 2 caractères minimum" : `Aucun résultat pour « ${term} »`;

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={`${uid}-title`}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none animate-dialog-in overflow-hidden border-0 bg-surface p-0 text-fg shadow-pop backdrop:bg-nav/60 motion-reduce:animate-none sm:bottom-auto sm:top-[10vh] sm:mx-auto sm:h-auto sm:w-[min(40rem,calc(100vw-2rem))] sm:rounded-card sm:border sm:border-line"
    >
      <div className="flex h-full flex-col">
        <h2 id={`${uid}-title`} className="sr-only">
          Recherche rapide
        </h2>
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Icon name="search" className="h-5 w-5 text-fg-subtle" />
          <label htmlFor={`${uid}-input`} className="sr-only">
            Rechercher {what}
          </label>
          <input
            ref={inputRef}
            id={`${uid}-input`}
            type="text"
            role="combobox"
            aria-expanded={count > 0}
            aria-controls={`${uid}-list`}
            aria-autocomplete="list"
            aria-activedescendant={activeDomId}
            aria-describedby={`${uid}-help`}
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveKey(null);
            }}
            placeholder={pilotage ? "Page, collaborateur, matricule, alerte ou action…" : "Page, alerte ou action…"}
            className="h-11 min-w-0 flex-1 rounded-control bg-transparent px-1 text-base text-fg placeholder:text-fg-subtle"
          />
          {loading && <Spinner className="h-4 w-4 text-fg-subtle" />}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-control px-2.5 text-sm font-medium text-fg-muted transition-colors duration-150 hover:bg-surface-3 hover:text-fg active:translate-y-px"
          >
            <span className="sr-only">Fermer la recherche rapide</span>
            <span aria-hidden="true" className="sm:hidden">
              Fermer
            </span>
            <kbd aria-hidden="true" className="hidden rounded border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-xs sm:inline">
              Échap
            </kbd>
          </button>
        </div>

        <div
          id={`${uid}-list`}
          role="listbox"
          aria-label="Résultats de la recherche rapide"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:max-h-[min(28rem,60vh)]"
        >
          {visible.map((g) => (
            <div key={g.key} role="group" aria-labelledby={`${uid}-g-${g.key}`} className="pb-1">
              <div id={`${uid}-g-${g.key}`} aria-hidden="true" className="px-2.5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                {g.label}
              </div>
              {g.options.map((o) => {
                const isActive = o.key === active?.key;
                return (
                  <div
                    key={o.key}
                    id={optionId(o.key)}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => {
                      if (!isActive) setActiveKey(o.key);
                    }}
                    onClick={() => activate(o)}
                    className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-control px-2.5 py-1.5 text-sm transition-colors duration-150 ${isActive ? "bg-primary-soft" : "hover:bg-surface-3"}`}
                  >
                    <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-control bg-surface-2 ${o.iconTone ?? "text-fg-muted"}`}>
                      <Icon name={o.icon} className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-fg">{o.label}</span>
                      {o.detail && <span className="block truncate text-xs text-fg-muted">{o.detail}</span>}
                    </span>
                    {isActive && <Icon name="arrow-right" className="h-4 w-4 text-link" />}
                  </div>
                );
              })}
            </div>
          ))}
          {loading && !count && <p className="px-2.5 py-6 text-center text-sm text-fg-muted">Recherche en cours…</p>}
          {empty && <p className="px-2.5 py-6 text-center text-sm text-fg-muted">{empty}</p>}
        </div>

        {error && (
          <div className="mx-2 mb-2 flex flex-wrap items-center gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger">
            <Icon name="error" className="h-4 w-4" />
            <span className="min-w-0 flex-1">{error}</span>
            <button
              type="button"
              onClick={() => {
                setRemote(null);
                setRetry((n) => n + 1);
              }}
              className="inline-flex min-h-10 items-center rounded-control px-2.5 font-medium underline-offset-2 hover:underline"
            >
              Réessayer
            </button>
          </div>
        )}

        <p id={`${uid}-help`} className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs text-fg-subtle max-sm:sr-only">
          <span>
            <kbd className="font-sans font-medium">↑ ↓</kbd> parcourir<span className="sr-only">,</span>
          </span>
          <span>
            <kbd className="font-sans font-medium">Entrée</kbd> ouvrir<span className="sr-only">,</span>
          </span>
          <span>
            <kbd className="font-sans font-medium">Échap</kbd> fermer
          </span>
        </p>
        <p role="status" aria-live="polite" className="sr-only">
          {error ? `Erreur : ${error}` : announce}
        </p>
      </div>
    </dialog>
  );
}
