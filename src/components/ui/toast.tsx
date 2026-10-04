"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

// Notifications éphémères (docs/qa/DESIGN_SYSTEM.md § 5) : toast.success|error|info(message, { description }).
// Un seul <Toaster /> (layout racine). File d'attente : 3 visibles, les suivantes attendent. Fermeture auto (5 s, 8 s pour
// une erreur) en pause au survol ou au focus, et manuelle. Erreurs annoncées en assertive, le reste en polite.

export type ToastTone = "success" | "error" | "info";
export type ToastOptions = { description?: ReactNode; /** ms ; 0 = reste affichée jusqu'à fermeture. */ duration?: number; id?: string };
type ToastItem = { id: string; v: number; tone: ToastTone; message: ReactNode; description?: ReactNode; duration: number; closing: boolean };

const DURATION: Record<ToastTone, number> = { success: 5000, info: 5000, error: 8000 };
const MAX_VISIBLE = 3;
const EXIT_MS = 200;

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(tone: ToastTone, message: ReactNode, opts: ToastOptions = {}) {
  const id = opts.id ?? `toast-${++seq}`;
  // v : version ; une notification remplacée (même id) repart avec sa propre durée et est annoncée à nouveau
  const item: ToastItem = { id, v: ++seq, tone, message, description: opts.description, duration: opts.duration ?? DURATION[tone], closing: false };
  items = items.some((t) => t.id === id) ? items.map((t) => (t.id === id ? item : t)) : [...items, item];
  emit();
  return id;
}

function dismiss(id?: string) {
  const targets = items.filter((t) => (id === undefined || t.id === id) && !t.closing);
  if (!targets.length) return;
  items = items.map((t) => (targets.includes(t) ? { ...t, closing: true } : t));
  emit();
  setTimeout(() => {
    // par version : une notification remplacée entre-temps (même id) reste affichée
    items = items.filter((t) => !targets.some((x) => x.id === t.id && x.v === t.v));
    emit();
  }, EXIT_MS);
}

/** toast("…") = info ; toast.success / error / info(message, { description, duration, id }) ; toast.dismiss(id?). Renvoie l'id. */
export const toast = Object.assign((message: ReactNode, opts?: ToastOptions) => push("info", message, opts), {
  success: (message: ReactNode, opts?: ToastOptions) => push("success", message, opts),
  error: (message: ReactNode, opts?: ToastOptions) => push("error", message, opts),
  info: (message: ReactNode, opts?: ToastOptions) => push("info", message, opts),
  dismiss,
});

const EMPTY: ToastItem[] = [];
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

const TONE: Record<ToastTone, { icon: IconName; bar: string; iconCls: string; prefix: string }> = {
  success: { icon: "success", bar: "border-l-success", iconCls: "text-success", prefix: "Succès" },
  error: { icon: "error", bar: "border-l-danger", iconCls: "text-danger", prefix: "Erreur" },
  info: { icon: "info", bar: "border-l-info", iconCls: "text-info", prefix: "Information" },
};

/** Zone des notifications : à monter une seule fois (src/app/layout.tsx). */
export function Toaster() {
  const all = useSyncExternalStore(subscribe, () => items, () => EMPTY);
  const [paused, setPaused] = useState(false);
  const visible = all.slice(0, MAX_VISIBLE);
  const urgent = visible.filter((t) => t.tone === "error");
  const polite = visible.filter((t) => t.tone !== "error");
  const list = "flex flex-col gap-2";
  return (
    <div
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col gap-2 sm:left-auto sm:right-6 sm:bottom-6 sm:w-96"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      <ol aria-live="assertive" aria-label="Notifications urgentes" className={list}>
        {urgent.map((t) => (
          <ToastView key={`${t.id}:${t.v}`} item={t} paused={paused} />
        ))}
      </ol>
      <ol aria-live="polite" aria-label="Notifications" className={list}>
        {polite.map((t) => (
          <ToastView key={`${t.id}:${t.v}`} item={t} paused={paused} />
        ))}
      </ol>
      {all.length > MAX_VISIBLE && (
        <p className="pointer-events-auto self-end rounded-full bg-surface px-2.5 py-0.5 text-xs text-fg-muted shadow-pop ring-1 ring-line">
          {all.length - MAX_VISIBLE} autre{all.length - MAX_VISIBLE > 1 ? "s" : ""} en attente
        </p>
      )}
    </div>
  );
}

function ToastView({ item, paused }: { item: ToastItem; paused: boolean }) {
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);
  useEffect(() => {
    if (!item.duration || paused || item.closing) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismiss(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(1000, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, item.duration, item.closing, item.id]);

  const s = TONE[item.tone];
  return (
    <li
      onKeyDown={(e) => {
        if (e.key === "Escape") dismiss(item.id);
      }}
      className={`pointer-events-auto flex items-start gap-3 rounded-card border border-l-4 border-line bg-surface p-3 pr-2 text-sm text-fg shadow-pop ${s.bar} ${
        item.closing ? "animate-toast-out" : "animate-toast-in"
      }`}
    >
      <Icon name={s.icon} className={`mt-0.5 h-5 w-5 ${s.iconCls}`} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-snug">
          <span className="sr-only">{s.prefix} : </span>
          {item.message}
        </p>
        {item.description && <div className="mt-0.5 leading-snug text-fg-muted">{item.description}</div>}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        className="-my-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-fg-subtle transition-colors duration-150 hover:bg-surface-3 hover:text-fg active:bg-surface-3"
      >
        <Icon name="x" />
        <span className="sr-only">Fermer la notification</span>
      </button>
    </li>
  );
}

/** Résultat courant d'une Server Action : { ok?: string | boolean; error?: string; … } (forme utilisée par les actions du projet). */
export type ActionResult = { ok?: string | boolean | null; error?: string | null; commentError?: string | null; fieldErrors?: Record<string, string> | null } | null | undefined;

export type ActionToastOptions = { success?: ReactNode; error?: ReactNode; description?: ReactNode; successDescription?: ReactNode; errorDescription?: ReactNode };

/** Toast correspondant à un résultat d'action : `ok` texte = message affiché, `error` (ou erreurs de champ) = toast d'erreur. */
export function toastResult(state: ActionResult, { success, error, description, successDescription, errorDescription }: ActionToastOptions = {}) {
  if (!state) return;
  const fieldError = state.commentError || (state.fieldErrors && Object.keys(state.fieldErrors).length > 0);
  const onError = { description: errorDescription ?? description };
  if (state.error) toast.error(error ?? state.error, onError);
  else if (fieldError) toast.error(error ?? "Vérifiez les champs signalés.", onError);
  else if (state.ok) toast.success(typeof state.ok === "string" ? state.ok : (success ?? "Modification enregistrée."), { description: successDescription ?? description });
}

/**
 * Transforme le résultat d'une Server Action (useActionState) en toast, une fois par nouveau résultat :
 * `useActionToast(state, { success: "Paramètres enregistrés." })`. Si le formulaire peut disparaître à la réponse
 * (changement de liste après refresh), préférer withActionToast.
 */
export function useActionToast(state: ActionResult, options: ActionToastOptions = {}) {
  const last = useRef(state);
  const opts = useRef(options);
  useEffect(() => {
    opts.current = options;
  });
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    toastResult(state, opts.current);
  }, [state]);
}

/**
 * Enrobe l'action passée à useActionState : le toast part à la réponse du serveur, même si le composant est démonté ensuite.
 * `const [state, dispatch] = useActionState(withActionToast(updateAction, { success: "Décision enregistrée." }), {});`
 */
export function withActionToast<S extends ActionResult, P>(action: (state: S, payload: P) => Promise<S>, options: ActionToastOptions = {}) {
  return async (state: S, payload: P): Promise<S> => {
    const result = await action(state, payload);
    toastResult(result, options);
    return result;
  };
}
