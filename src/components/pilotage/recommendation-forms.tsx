"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button, ConfirmButton, FormActions, buttonCls, fieldCls, toast, useActionToast } from "@/components/ui";

type State = { ok?: string; error?: string };
type Action = (state: State, form: FormData) => Promise<State>;

const inputCls = `mt-1 py-2 ${fieldCls}`;
const labelCls = "block text-xs font-medium text-fg-muted";
const choiceCls =
  "flex min-h-10 cursor-pointer items-center gap-2 rounded-control bg-surface px-3 py-1.5 text-sm text-fg ring-1 ring-inset ring-line-strong transition-colors hover:bg-surface-3 has-checked:bg-primary-soft has-checked:font-medium has-checked:text-link has-checked:ring-primary";
// Message d'erreur sous le formulaire : relié au champ (aria-describedby) ; l'annonce est faite par le toast
const errorCls = "text-sm font-medium text-danger";

// Envoi sans réinitialisation automatique du formulaire (React 19 la fait pour <form action>) :
// champs contrôlés, le choix et le commentaire restent saisis après un refus du serveur.
export function DecideForm({ recommendationId, action, today }: { recommendationId: number; action: Action; today: string }) {
  const [state, dispatch, pending] = useActionState<State, FormData>(action, {});
  const [decision, setDecision] = useState<"REALISEE" | "REJETEE">("REALISEE");
  const [date, setDate] = useState(today);
  const [feedback, setFeedback] = useState("");
  const [comment, setComment] = useState("");
  const id = `reco-${recommendationId}`;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => dispatch(form));
  }

  // Le rejet passe par ConfirmButton (conséquence rappelée), qui soumet le formulaire à la confirmation
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-control bg-surface-2 p-3.5 ring-1 ring-inset ring-line">
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <fieldset>
        <legend className={labelCls}>Décision</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {(["REALISEE", "REJETEE"] as const).map((d) => (
            <label key={d} className={choiceCls}>
              <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="accent-primary" />
              {d === "REALISEE" ? "Réalisée" : "Rejetée"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        {decision === "REALISEE" && (
          <div>
            <label htmlFor={`${id}-date`} className={labelCls}>
              Date de réalisation
            </label>
            <input id={`${id}-date`} type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} max={today} required className={inputCls} />
          </div>
        )}
        <div>
          <label htmlFor={`${id}-feedback`} className={labelCls}>
            Pertinence (facultatif)
          </label>
          <select id={`${id}-feedback`} name="feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} className={inputCls}>
            <option value="">Non renseignée</option>
            <option value="PERTINENTE">Pertinente</option>
            <option value="NON_PERTINENTE">Non pertinente</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-comment`} className={labelCls}>
          Commentaire {decision === "REJETEE" ? "(obligatoire)" : "(facultatif)"}
        </label>
        <textarea
          id={`${id}-comment`}
          name="comment"
          rows={2}
          maxLength={1000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          required={decision === "REJETEE"}
          minLength={decision === "REJETEE" ? 3 : undefined}
          aria-invalid={!!state.error || undefined}
          aria-describedby={state.error ? `${id}-error` : undefined}
          className={inputCls}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {decision === "REJETEE" ? (
          <ConfirmButton
            variant="danger"
            icon="x"
            pending={pending}
            pendingLabel="Enregistrement…"
            title="Rejeter cette recommandation ?"
            consequence="Elle sera close sans action. La décision et son motif sont enregistrés et tracés dans le journal."
            confirmLabel="Confirmer le rejet"
          >
            Rejeter la recommandation
          </ConfirmButton>
        ) : (
          <Button type="submit" variant="primary" icon="check" pending={pending} pendingLabel="Enregistrement…">
            Enregistrer la réalisation
          </Button>
        )}
        {state.error && (
          <p id={`${id}-error`} className={errorCls}>
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

// Deux actions explicites sur la fiche : « Marquer comme réalisée » et « Rejeter avec motif ».
// Chaque choix ouvre un court formulaire ; le rejet passe par une confirmation qui rappelle sa conséquence.
export function DecisionButtons({ recommendationId, action, today }: { recommendationId: number; action: Action; today: string }) {
  const [state, dispatch, pending] = useActionState<State, FormData>(action, {});
  const [mode, setMode] = useState<"REALISEE" | "REJETEE" | null>(null);
  const [date, setDate] = useState(today);
  const [feedback, setFeedback] = useState("");
  const [comment, setComment] = useState("");
  const id = `reco-${recommendationId}`;

  if (!mode)
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" icon="check" onClick={() => setMode("REALISEE")}>
          Marquer comme réalisée
        </Button>
        <Button variant="secondary" icon="x" onClick={() => setMode("REJETEE")}>
          Rejeter avec motif
        </Button>
      </div>
    );

  const reject = mode === "REJETEE";
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(() => dispatch(form));
  }
  const errorProps = { "aria-invalid": !!state.error || undefined, "aria-describedby": state.error ? `${id}-error` : undefined };
  return (
    <form
      onSubmit={submit}
      aria-labelledby={`${id}-titre`}
      className={`mt-3 space-y-3 rounded-control border-l-4 p-3.5 ring-1 ring-inset ring-line animate-pop-in ${
        reject ? "border-l-danger bg-danger-soft" : "border-l-success bg-success-soft"
      }`}
    >
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <input type="hidden" name="decision" value={mode} />
      <div>
        <p id={`${id}-titre`} className="text-sm font-semibold text-fg">
          {reject ? "Rejeter cette recommandation" : "Marquer cette recommandation comme réalisée"}
        </p>
      </div>
      {reject ? (
        <div>
          <label htmlFor={`${id}-motif`} className={labelCls}>
            Motif du rejet (obligatoire)
          </label>
          <textarea
            id={`${id}-motif`}
            name="comment"
            rows={2}
            maxLength={1000}
            required
            minLength={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Par exemple : entretien déjà mené le mois dernier"
            {...errorProps}
            className={inputCls}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${id}-date`} className={labelCls}>
              Date de réalisation
            </label>
            <input id={`${id}-date`} type="date" name="date" value={date} onChange={(e) => setDate(e.target.value)} max={today} required className={inputCls} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${id}-comment`} className={labelCls}>
              Commentaire (facultatif)
            </label>
            <textarea id={`${id}-comment`} name="comment" rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} {...errorProps} className={inputCls} />
          </div>
        </div>
      )}
      <div>
        <label htmlFor={`${id}-feedback`} className={labelCls}>
          Recommandation pertinente ? (facultatif)
        </label>
        <select id={`${id}-feedback`} name="feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} className={`${inputCls} sm:max-w-60`}>
          <option value="">Non renseigné</option>
          <option value="PERTINENTE">Oui, pertinente</option>
          <option value="NON_PERTINENTE">Non, pas pertinente</option>
        </select>
      </div>
      <FormActions
        divider={false}
        className="mt-3!"
        status={
          state.error && (
            <p id={`${id}-error`} className={errorCls}>
              {state.error}
            </p>
          )
        }
      >
        <Button variant="tertiary" onClick={() => setMode(null)} disabled={pending}>
          Annuler
        </Button>
        {reject ? (
          <ConfirmButton
            variant="danger"
            icon="x"
            disabled={pending}
            pending={pending}
            pendingLabel="Enregistrement…"
            title="Rejeter cette recommandation ?"
            consequence="Elle sera close sans action. La décision et son motif sont enregistrés et tracés dans le journal."
            confirmLabel="Confirmer le rejet"
          >
            Rejeter la recommandation
          </ConfirmButton>
        ) : (
          <Button type="submit" variant="primary" icon="check" pending={pending} pendingLabel="Enregistrement…">
            Enregistrer la réalisation
          </Button>
        )}
      </FormActions>
    </form>
  );
}

export function FeedbackForm({ recommendationId, action, current }: { recommendationId: number; action: Action; current: string | null }) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, {});
  useActionToast(state);
  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <input type="hidden" name="recommendationId" value={recommendationId} />
      <span className="text-xs font-semibold text-fg-muted">Pertinence :</span>
      {(["PERTINENTE", "NON_PERTINENTE"] as const).map((f) => (
        <button
          key={f}
          type="submit"
          name="feedback"
          value={f}
          disabled={pending}
          aria-pressed={current === f}
          className={`inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-xs ring-1 ring-inset transition-colors active:translate-y-px disabled:opacity-60 ${
            current === f ? "bg-primary-soft font-medium text-link ring-primary" : "bg-surface text-fg-muted ring-line-strong hover:bg-surface-3 hover:text-fg"
          }`}
        >
          {current === f && (
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          )}
          {f === "PERTINENTE" ? "Pertinente" : "Non pertinente"}
        </button>
      ))}
      {state.error && <p className={errorCls}>{state.error}</p>}
    </form>
  );
}

const DECIDED_HINT: Record<string, string> = {
  REALISEE: "Le suivi apparaîtra dans « Avant / après intervention ».",
  REJETEE: "La décision et son motif sont tracés dans le journal.",
};

// Décision puis retour de pertinence, pour une recommandation. Le toast est émis ici, à la réponse du serveur :
// la revalidation remplace aussitôt le formulaire de décision par celui du retour (son propre état disparaît).
export function RecommendationActions({
  recommendationId,
  status,
  feedback,
  decideAction,
  feedbackAction,
  today,
  summary = "Traiter cette recommandation",
  showFeedback = true,
  mode = "form",
}: {
  recommendationId: number;
  status: string;
  feedback: string | null;
  decideAction: Action;
  feedbackAction?: Action;
  today: string;
  summary?: string;
  showFeedback?: boolean;
  // buttons : deux actions explicites (fiche collaborateur) ; form : formulaire dépliable (liste des recommandations)
  mode?: "form" | "buttons";
}) {
  const decide: Action = async (prev, form) => {
    const res = await decideAction(prev, form);
    if (res.ok) toast.success(res.ok, { description: DECIDED_HINT[String(form.get("decision"))] });
    else if (res.error) toast.error(res.error);
    return res;
  };
  return status === "PROPOSEE" && mode === "buttons" ? (
    <DecisionButtons recommendationId={recommendationId} action={decide} today={today} />
  ) : status === "PROPOSEE" ? (
    <details className="group mt-3">
      <summary className={`${buttonCls.secondary} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        {summary}
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <DecideForm recommendationId={recommendationId} action={decide} today={today} />
    </details>
  ) : (
    showFeedback && feedbackAction && <FeedbackForm recommendationId={recommendationId} action={feedbackAction} current={feedback} />
  );
}
