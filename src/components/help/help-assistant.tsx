"use client";

import Link from "next/link";
import { useEffect, useId, useReducer, useRef, useState, type FocusEvent, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { fieldCls } from "@/components/ui/classes";
import { Icon } from "@/components/ui/icons";
import { QUESTION_MAX, QUESTION_MIN, type AssistantAnswer, type AssistantSource } from "@/lib/rag/types";

// Assistant d'aide (docs/qa/CHANTIER_RAG.md) : une ligne repliée sous l'en-tête ; le panneau ne s'ouvre qu'après une
// question. Répond depuis la documentation et l'aide du rôle (POST /api/assistant), jamais depuis les données RH.

export type AssistantState =
  | { status: "idle" }
  | { status: "loading"; question: string }
  | { status: "done"; question: string; answer: AssistantAnswer }
  | { status: "error"; question: string; message: string };

export type AssistantEvent =
  | { type: "submit"; question: string }
  | { type: "success"; answer: AssistantAnswer }
  | { type: "failure"; message: string }
  | { type: "close" };

export function questionError(question: string): string | null {
  const q = question.trim();
  if (q.length < QUESTION_MIN) return `Votre question est trop courte. Saisissez au moins ${QUESTION_MIN} caractères.`;
  if (q.length > QUESTION_MAX) return `Votre question est trop longue. Limitez-la à ${QUESTION_MAX} caractères.`;
  return null;
}

export function assistantReducer(state: AssistantState, event: AssistantEvent): AssistantState {
  switch (event.type) {
    case "submit": {
      const question = event.question.trim();
      const message = questionError(question);
      return message ? { status: "error", question, message } : { status: "loading", question };
    }
    // Réponse arrivée après une fermeture : ignorée
    case "success":
      return state.status === "loading" ? { status: "done", question: state.question, answer: event.answer } : state;
    case "failure":
      return state.status === "loading" ? { status: "error", question: state.question, message: event.message } : state;
    case "close":
      return { status: "idle" };
  }
}

/** Message d'erreur : ce qui s'est passé + quoi faire. status null = serveur injoignable. */
export function assistantErrorMessage(status: number | null, serverMessage?: string | null): string {
  const server = typeof serverMessage === "string" && serverMessage.trim() ? serverMessage.trim() : null;
  if (status === null) return "L'assistant n'a pas pu être joint. Vérifiez votre connexion, puis réessayez.";
  if (status === 401) return "Votre session a expiré. Reconnectez-vous, puis posez de nouveau votre question.";
  // Refus explicite (question invalide, trop longue, quota, origine) : le serveur dit déjà quoi faire
  if (server && status >= 400 && status < 500) return server;
  if (status === 429) return "Vous avez posé beaucoup de questions en peu de temps. Patientez une minute, puis réessayez.";
  if (status === 400 || status === 413) return `Cette question n'a pas pu être traitée. Reformulez-la en ${QUESTION_MIN} à ${QUESTION_MAX} caractères.`;
  if (status === 403) return "Requête refusée. Rechargez la page, puis réessayez.";
  return "L'assistant est momentanément indisponible. Réessayez dans un instant ou ouvrez l'aide.";
}

const MODES: readonly AssistantAnswer["mode"][] = ["EXTRAIT", "IA", "AUCUN"];
// Liens internes seulement : « /aide#faq », jamais « //hote » ni « /\hote »
const isInternalSource = (s: unknown): s is AssistantSource =>
  !!s && typeof s === "object" && typeof (s as AssistantSource).title === "string" && typeof (s as AssistantSource).href === "string" && /^\/(?![/\\])/.test((s as AssistantSource).href);

/** Corps de réponse de POST /api/assistant validé ; null si la forme est inattendue. */
export function parseAssistantAnswer(body: unknown): AssistantAnswer | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!MODES.includes(b.mode as AssistantAnswer["mode"]) || typeof b.answer !== "string") return null;
  const sources = Array.isArray(b.sources) ? b.sources.filter(isInternalSource).map((s) => ({ title: s.title, href: s.href })) : [];
  const notice = typeof b.notice === "string" && b.notice.trim() ? b.notice : undefined;
  return { mode: b.mode as AssistantAnswer["mode"], answer: b.answer, sources, ...(notice ? { notice } : {}) };
}

class AssistantRequestError extends Error {}

async function askAssistant(question: string, signal: AbortSignal): Promise<AssistantAnswer> {
  let res: Response;
  try {
    res = await fetch("/api/assistant", {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ question }),
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new AssistantRequestError(assistantErrorMessage(null));
  }
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!res.ok) throw new AssistantRequestError(assistantErrorMessage(res.status, body?.error?.message));
  const answer = parseAssistantAnswer(body);
  if (!answer) throw new AssistantRequestError(assistantErrorMessage(500));
  return answer;
}

const NO_ANSWER = "L'aide ne couvre pas cette question. Reformulez-la avec d'autres mots, ou parcourez l'aide.";

/** Panneau de réponse (réponse, sources, mention, ou erreur) avec le bouton de fermeture. */
export function AssistantPanel({ state, onClose }: { state: AssistantState; onClose: () => void }) {
  const sourcesId = useId();
  if (state.status !== "done" && state.status !== "error") return null;
  const answer = state.status === "done" ? state.answer : null;
  // Réponse reformulée : « [n] » du texte renvoie à la n-ième source
  const numbered = !!answer && /\[\d+/.test(answer.answer);
  return (
    <div className="mt-2 flex animate-fade-in items-start gap-2 rounded-card border border-line bg-surface p-3 text-sm text-fg shadow-card motion-reduce:animate-none sm:p-4">
      <div className="min-w-0 flex-1 space-y-3 break-words">
        {state.status === "error" && (
          <p className="flex items-start gap-2 text-danger">
            <Icon name="error" className="mt-0.5 h-4 w-4" />
            <span className="min-w-0">{state.message}</span>
          </p>
        )}
        {answer && <p className="whitespace-pre-line leading-relaxed">{answer.mode === "AUCUN" ? answer.answer.trim() || NO_ANSWER : answer.answer}</p>}
        {answer && answer.sources.length > 0 && (
          <div>
            <p id={sourcesId} className="text-xs font-semibold text-fg-muted">
              Sources
            </p>
            <ol aria-labelledby={sourcesId} className="mt-1.5 flex flex-wrap gap-2">
              {answer.sources.map((s, i) => (
                <li key={`${s.href}-${i}`} className="max-w-full">
                  <Link
                    href={s.href}
                    className="inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-left text-[13px] font-medium text-link transition-colors duration-150 hover:border-primary hover:bg-primary-soft active:translate-y-px"
                  >
                    {numbered ? <span className="tabular-nums text-fg-muted">[{i + 1}]</span> : <Icon name="arrow-right" className="h-3.5 w-3.5" />}
                    <span className="min-w-0">{s.title}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        )}
        {answer?.mode === "AUCUN" && (
          <ButtonLink href="/aide" size="sm" icon="help">
            Ouvrir l&apos;aide
          </ButtonLink>
        )}
        {answer?.notice && <p className="text-xs text-fg-subtle">{answer.notice}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="-mr-1 -mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-fg-subtle transition-colors duration-150 hover:bg-surface-3 hover:text-fg active:bg-surface-3"
      >
        <Icon name="x" />
        <span className="sr-only">Fermer la réponse</span>
      </button>
    </div>
  );
}

/**
 * Champ « Poser une question… » + bouton « Demander », replié par défaut. `examples` : questions proposées quand le
 * champ a le focus et est vide (ASSISTANT_EXAMPLES[role] de @/lib/help/content).
 */
export function HelpAssistant({ examples = [], className = "" }: { examples?: string[]; className?: string }) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [state, dispatch] = useReducer(assistantReducer, { status: "idle" });
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const loading = state.status === "loading";
  const open = state.status === "done" || state.status === "error";

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = (question: string) => {
    if (loading) return;
    const event = { type: "submit", question } as const;
    dispatch(event);
    if (assistantReducer(state, event).status !== "loading") return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    askAssistant(question.trim(), ctrl.signal)
      .then((answer) => dispatch({ type: "success", answer }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        dispatch({ type: "failure", message: err instanceof AssistantRequestError ? err.message : assistantErrorMessage(null) });
      });
  };

  const close = () => {
    abortRef.current?.abort();
    dispatch({ type: "close" });
    inputRef.current?.focus();
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    ask(value);
  };

  // Écoute sur le document : pendant l'envoi le bouton est désactivé et le focus peut sortir du composant
  useEffect(() => {
    if (!open && !loading) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      abortRef.current?.abort();
      dispatch({ type: "close" });
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, loading]);

  const onBlur = (e: FocusEvent<HTMLFormElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
  };

  const showExamples = focused && !value.trim() && !loading && examples.length > 0;

  return (
    <div className={`w-full min-w-0 ${className}`}>
      <form role="search" aria-labelledby={`${uid}-label`} onSubmit={onSubmit} onFocus={() => setFocused(true)} onBlur={onBlur}>
        <label id={`${uid}-label`} htmlFor={`${uid}-input`} className="sr-only">
          Poser une question à l&apos;assistant d&apos;aide
        </label>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Icon name="help" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
            <input
              ref={inputRef}
              id={`${uid}-input`}
              type="text"
              enterKeyHint="search"
              autoComplete="off"
              maxLength={QUESTION_MAX}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Poser une question…"
              className={`${fieldCls} pl-9`}
            />
          </div>
          <Button type="submit" icon="send" pending={loading} pendingLabel="Recherche…" className="shrink-0">
            Demander
          </Button>
        </div>
        {showExamples && (
          <div role="group" aria-label="Exemples de questions" className="mt-2 flex flex-wrap gap-2">
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setValue(ex);
                  ask(ex);
                  inputRef.current?.focus();
                }}
                className="inline-flex min-h-10 max-w-full items-center rounded-full border border-line bg-surface-2 px-3 py-1.5 text-left text-[13px] text-fg-muted transition-colors duration-150 hover:border-line-strong hover:bg-surface-3 hover:text-fg active:translate-y-px"
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </form>
      <div aria-live="polite">
        {loading && <span className="sr-only">Recherche en cours…</span>}
        {open && <AssistantPanel state={state} onClose={close} />}
      </div>
    </div>
  );
}
