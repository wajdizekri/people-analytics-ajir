"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Button, ConfirmButton, EmptyState, StatusBadge, type StatusTone } from "@/components/ui";
import { toastResult, type ActionResult } from "@/components/ui/toast";

// Liste des recommandations de /absenteeism, /charge et /formations : « À traiter » d'abord (cartes triées par priorité),
// boutons verbe + objet, rejet confirmé dans une boîte de dialogue avec motif. Le toast part à la réponse du serveur
// (toastResult, comme withActionToast) : il survit au changement de groupe de la recommandation après l'enregistrement.

export type RecoStatus = "PROPOSEE" | "REALISEE" | "REJETEE";
export type RecoActionState = { ok?: string; error?: string; commentError?: string };
export type RecoAction = (state: RecoActionState, form: FormData) => Promise<RecoActionState>;

export type RecoItem = {
  id: number;
  status: RecoStatus;
  priority: number;
  title: string;
  rationale: string;
  scopeLabel: string;
  target: string | null;
  createdOn: string;
  updatedOn: string | null;
  comment: string | null;
  allowed: RecoStatus[];
};

type Outcome = { result: ActionResult; title: string };

const STATUS: Record<RecoStatus, { label: string; tone: StatusTone }> = {
  PROPOSEE: { label: "En attente de décision", tone: "info" },
  REALISEE: { label: "Réalisée", tone: "success" },
  REJETEE: { label: "Rejetée", tone: "neutral" },
};
const PRIORITY: Record<number, { label: string; tone: StatusTone; bar: string }> = {
  1: { label: "Priorité haute", tone: "danger", bar: "border-l-danger" },
  2: { label: "Priorité moyenne", tone: "warning", bar: "border-l-warning" },
  3: { label: "Priorité basse", tone: "neutral", bar: "border-l-line-strong" },
};
const DONE: Record<RecoStatus, string> = {
  REALISEE: "Recommandation marquée comme réalisée",
  REJETEE: "Recommandation rejetée",
  PROPOSEE: "Recommandation remise en attente de décision",
};

function RecoActions({
  item,
  action,
  rejectNeedsComment,
  onResult,
}: {
  item: RecoItem;
  action: RecoAction;
  rejectNeedsComment: boolean;
  onResult: (o: Outcome) => void;
}) {
  const [sent, setSent] = useState<RecoStatus | null>(null);
  // Le résultat est remonté à la liste dès la réponse : la recommandation peut changer de groupe (et ce composant être remplacé) au rafraîchissement.
  const run: RecoAction = async (prev, form) => {
    let res: RecoActionState;
    try {
      res = await action(prev, form);
    } catch {
      res = { error: "L'enregistrement n'a pas abouti (serveur injoignable). Vérifiez la connexion puis réessayez." };
    }
    const to = form.get("status") as RecoStatus;
    const result: ActionResult = res.error
      ? { error: res.error }
      : res.commentError
        ? { error: `Motif du rejet : ${res.commentError}` }
        : { ok: res.ok ? DONE[to] : null };
    toastResult(result, { description: item.title });
    onResult({ result, title: `« ${item.title} »` });
    return res;
  };
  const [state, dispatch, pending] = useActionState<RecoActionState, FormData>(run, {});

  function send(status: RecoStatus, comment?: string) {
    const form = new FormData();
    form.set("id", String(item.id));
    form.set("status", status);
    if (comment?.trim()) form.set("comment", comment.trim());
    setSent(status);
    startTransition(() => dispatch(form));
  }

  if (!item.allowed.length) return null;
  const error = state.error ?? state.commentError;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {item.allowed.includes("REALISEE") && (
          <Button
            size="sm"
            icon="check"
            pending={pending && sent === "REALISEE"}
            pendingLabel="Enregistrement…"
            disabled={pending}
            onClick={() => send("REALISEE")}
          >
            Marquer comme réalisée
          </Button>
        )}
        {item.allowed.includes("REJETEE") && (
          <ConfirmButton
            size="sm"
            variant="danger"
            title="Rejeter cette recommandation ?"
            consequence="Elle passera dans « Déjà traitées » avec le statut Rejetée. La décision est enregistrée et tracée ; vous pourrez la remettre en attente de décision."
            confirmLabel="Confirmer le rejet"
            reason={{ name: "comment", label: "Motif du rejet", required: rejectNeedsComment, minLength: rejectNeedsComment ? 3 : 0 }}
            pending={pending && sent === "REJETEE"}
            pendingLabel="Enregistrement…"
            disabled={pending}
            onConfirm={(motif) => send("REJETEE", motif)}
          >
            Rejeter la recommandation
          </ConfirmButton>
        )}
        {item.allowed.includes("PROPOSEE") && (
          <Button
            size="sm"
            variant="tertiary"
            icon="refresh"
            pending={pending && sent === "PROPOSEE"}
            pendingLabel="Enregistrement…"
            disabled={pending}
            onClick={() => send("PROPOSEE")}
          >
            Remettre en attente de décision
          </Button>
        )}
      </div>
      {/* Rappel persistant près des boutons ; l'annonce est faite par le toast d'erreur */}
      {error && <p className="mt-1.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

function Item({
  item,
  action,
  rejectNeedsComment,
  onResult,
}: {
  item: RecoItem;
  action: RecoAction;
  rejectNeedsComment: boolean;
  onResult: (o: Outcome) => void;
}) {
  const p = PRIORITY[item.priority] ?? PRIORITY[3];
  const s = STATUS[item.status];
  const todo = item.status === "PROPOSEE";
  return (
    <li
      className={`rounded-control border border-l-4 border-line p-3 transition-shadow duration-200 hover:shadow-card sm:p-4 ${
        todo ? `bg-surface ${p.bar}` : "border-l-line-strong bg-surface-2"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {todo ? <StatusBadge tone={p.tone}>{p.label}</StatusBadge> : <StatusBadge tone={s.tone}>{s.label}</StatusBadge>}
        <span className="text-xs text-fg-muted">
          {item.scopeLabel}
          {item.target ? ` · ${item.target}` : ""}
        </span>
      </div>
      <h3 className="mt-1.5 text-sm font-semibold leading-snug text-fg">{item.title}</h3>
      <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{item.rationale}</p>
      <p className="mt-1 text-xs text-fg-subtle">
        Proposée le {item.createdOn}
        {item.updatedOn ? ` · ${todo ? "remise en attente de décision" : s.label.toLowerCase()} le ${item.updatedOn}` : ""}
        {item.comment ? ` · Commentaire : ${item.comment}` : ""}
      </p>
      <RecoActions item={item} action={action} rejectNeedsComment={rejectNeedsComment} onResult={onResult} />
    </li>
  );
}

export function RecoBoard({
  items,
  action,
  rejectNeedsComment = true,
  emptyTitle,
  emptyText,
  initialVisible = 5,
}: {
  items: RecoItem[];
  action: RecoAction;
  rejectNeedsComment?: boolean;
  emptyTitle: string;
  emptyText?: string;
  initialVisible?: number;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const todo = items.filter((i) => i.status === "PROPOSEE").sort((a, b) => a.priority - b.priority || b.id - a.id);
  const done = items.filter((i) => i.status !== "PROPOSEE");
  const visible = showAll ? todo : todo.slice(0, initialVisible);
  const hidden = todo.length - visible.length;
  const high = todo.filter((i) => i.priority === 1).length;

  // Après un changement de statut, la carte change de groupe et son bouton disparaît : le focus revient en tête de liste
  useEffect(() => {
    if (outcome?.result?.ok) root.current?.focus({ preventScroll: true });
  }, [outcome]);

  return (
    <div ref={root} tabIndex={-1} role="group" aria-label="Recommandations">
      {todo.length === 0 ? (
        <EmptyState title={emptyTitle} compact>
          {emptyText}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-fg-muted">
            <strong className="font-semibold text-fg">{todo.length}</strong> à traiter
            {high ? (
              <>
                , dont <strong className="font-semibold text-danger">{high}</strong> en priorité haute
              </>
            ) : null}
            .
          </p>
          <ul className="mt-3 space-y-3">
            {visible.map((i) => (
              <Item key={i.id} item={i} action={action} rejectNeedsComment={rejectNeedsComment} onResult={setOutcome} />
            ))}
          </ul>
          {hidden > 0 && (
            <Button size="sm" variant="secondary" iconEnd="chevron-down" onClick={() => setShowAll(true)} className="mt-3">
              Afficher les {hidden} autres recommandations à traiter
            </Button>
          )}
        </>
      )}
      {done.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <Button
            size="sm"
            variant="tertiary"
            iconEnd={showDone ? "chevron-up" : "chevron-down"}
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
          >
            {showDone ? "Masquer" : "Afficher"} les recommandations déjà traitées ({done.length})
          </Button>
          {showDone && (
            <ul className="mt-3 space-y-3">
              {done.map((i) => (
                <Item key={i.id} item={i} action={action} rejectNeedsComment={rejectNeedsComment} onResult={setOutcome} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
