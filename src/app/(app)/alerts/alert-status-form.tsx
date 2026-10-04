"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button, ConfirmButton, fieldCls } from "@/components/ui";
import { announce } from "@/components/admin/notify";
import type { AlertStatus } from "@/lib/dal/alerts";
import { updateAlertAction, type AlertActionState } from "./actions";

const DONE: Partial<Record<AlertStatus, { label: string; next: string }>> = {
  EN_COURS: { label: "Alerte prise en charge.", next: "Marquez-la comme traitée ou rejetez-la une fois la situation examinée." },
  TRAITEE: { label: "Alerte marquée comme traitée.", next: "Elle est clôturée et reste consultable dans la liste." },
  REJETEE: { label: "Alerte rejetée.", next: "Elle est clôturée avec votre commentaire et reste consultable dans la liste." },
};

// Envoi manuel (pas de réinitialisation du formulaire par React 19) : le commentaire saisi est conservé après un refus du serveur.
// Le bouton cliqué (ou celui de la confirmation) porte le nouveau statut.
export function AlertStatusForm({ id, next }: { id: number; next: AlertStatus[] }) {
  const [comment, setComment] = useState("");
  const [last, setLast] = useState<AlertStatus | null>(null);
  const [state, dispatch, pending] = useActionState<AlertActionState, FormData>(async (prev, form) => {
    const res = await updateAlertAction(prev, form);
    if (res.ok) setComment("");
    // Toast émis ici : le formulaire disparaît quand l'alerte est clôturée ; les erreurs restent aussi sous les boutons
    const done = DONE[form.get("status") as AlertStatus];
    return announce(res, {
      success: done?.label ?? "Alerte mise à jour.",
      successDescription: done?.next,
      error: "Alerte non mise à jour",
      errorDescription: res.commentError ? "Vérifiez le commentaire de suivi." : "Le motif est indiqué sous les boutons.",
    });
  }, {});
  const canReject = comment.trim().length >= 3;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const form = new FormData(e.currentTarget, submitter);
    setLast((form.get("status") as AlertStatus | null) ?? null);
    startTransition(() => dispatch(form));
  }

  return (
    <form onSubmit={submit} aria-label="Suivi de l'alerte" className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <div>
        <label htmlFor="alert-comment" className="block text-sm font-medium text-fg">
          Commentaire de suivi{" "}
          {next.includes("REJETEE") && <span className="font-normal text-fg-muted">(facultatif ; obligatoire pour un rejet)</span>}
        </label>
        <p id="alert-comment-help" className="mt-0.5 text-xs text-fg-muted">
          Ce que vous avez fait ou décidé. Il est visible des personnes qui suivent cette alerte.
        </p>
        <textarea
          id="alert-comment"
          name="comment"
          rows={3}
          maxLength={1000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          aria-invalid={!!state.commentError}
          aria-describedby={`alert-comment-help${state.commentError ? " alert-comment-error" : ""}`}
          className={`${fieldCls} mt-1.5 py-2 focus:outline-none focus:ring-2 focus:ring-primary/25${state.commentError ? " border-danger" : ""}`}
        />
        {state.commentError && (
          <p id="alert-comment-error" role="alert" className="mt-1 text-sm text-danger">
            {state.commentError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {next.includes("EN_COURS") && (
          <Button type="submit" name="status" value="EN_COURS" variant="primary" icon="play" pending={pending && last === "EN_COURS"} pendingLabel="Enregistrement…" disabled={pending} fullWidth>
            Prendre en charge l&apos;alerte
          </Button>
        )}
        {next.includes("TRAITEE") && (
          <ConfirmButton
            name="status"
            value="TRAITEE"
            variant="primary"
            icon="check"
            disabled={pending}
            pending={pending && last === "TRAITEE"}
            pendingLabel="Enregistrement…"
            title="Marquer cette alerte comme traitée ?"
            confirmLabel="Confirmer le traitement"
            className="w-full"
            consequence={
              <>
                <p>L&apos;alerte sera clôturée et ne pourra plus être modifiée.</p>
                <p>Votre commentaire, la date et votre identifiant sont enregistrés dans son suivi.</p>
              </>
            }
          >
            Marquer comme traitée
          </ConfirmButton>
        )}
        {next.includes("REJETEE") && (
          <>
            <ConfirmButton
              name="status"
              value="REJETEE"
              variant="danger"
              icon="x"
              disabled={pending || !canReject}
              pending={pending && last === "REJETEE"}
              pendingLabel="Enregistrement…"
              title="Rejeter cette alerte ?"
              confirmLabel="Confirmer le rejet"
              className="w-full"
              consequence={
                <>
                  <p>Rejeter signifie que l&apos;alerte ne demande pas d&apos;action (faux signal, situation déjà connue).</p>
                  <p>Elle sera clôturée avec votre commentaire et ne pourra plus être modifiée.</p>
                </>
              }
            >
              Rejeter l&apos;alerte
            </ConfirmButton>
            {!canReject && <p className="text-xs text-fg-muted">Pour rejeter, expliquez pourquoi dans le commentaire (3 caractères au moins).</p>}
          </>
        )}
      </div>

      <div aria-live="polite">
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
