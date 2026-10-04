"use client";

import { useActionState } from "react";
import { ConfirmButton, SubmitButton } from "@/components/ui";
import { toast } from "@/components/ui/toast";

export type WorkforceRecoState = { ok?: boolean; error?: string; commentError?: string };
type Status = "PROPOSEE" | "REALISEE" | "REJETEE";
type Action = (state: WorkforceRecoState, form: FormData) => Promise<WorkforceRecoState>;

const DONE: Record<Status, string> = {
  REALISEE: "Recommandation marquée comme réalisée",
  REJETEE: "Recommandation rejetée",
  PROPOSEE: "Recommandation remise en attente de décision",
};

// Décision sur une recommandation RH (effectifs, masse salariale) : réaliser en un clic, rejeter avec un motif obligatoire
// (confirmation), remettre en attente une décision prise. Le statut reste modifiable : aucune décision n'est définitive.
// Le résultat est notifié dès la réponse du serveur (la carte change de liste et est remontée : un effet n'aurait pas lieu).
export function WorkforceRecoStatusForm({ id, title, status, action }: { id: number; title?: string; status: Status; action: Action }) {
  const [state, formAction] = useActionState<WorkforceRecoState, FormData>(async (prev, form) => {
    const res = await action(prev, form);
    const next = form.get("status") as Status;
    if (res.ok) toast.success(DONE[next] ?? "Décision enregistrée", { description: title });
    else if (res.error || res.commentError) toast.error("Décision non enregistrée", { description: res.commentError ?? res.error });
    return res;
  }, {});
  const message = (state.error || state.commentError) && <p className="text-sm text-danger">{state.commentError ?? state.error}</p>;

  if (status !== "PROPOSEE")
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={formAction}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="status" value="PROPOSEE" />
          <SubmitButton variant="tertiary" size="sm" icon="refresh" pendingLabel="Enregistrement…">
            Remettre en attente de décision
          </SubmitButton>
        </form>
        {message}
      </div>
    );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="REALISEE" />
        <SubmitButton variant="primary" size="sm" icon="check" pendingLabel="Enregistrement…">
          Marquer comme réalisée
        </SubmitButton>
      </form>
      <form action={formAction}>
        <input type="hidden" name="id" value={id} />
        <ConfirmButton
          variant="danger"
          size="sm"
          icon="x"
          name="status"
          value="REJETEE"
          title="Rejeter cette recommandation ?"
          confirmLabel="Confirmer le rejet"
          pendingLabel="Enregistrement…"
          consequence="Elle sera classée « Rejetée » avec votre motif. Vous pourrez la remettre en attente plus tard."
          reason={{ name: "comment", label: "Motif du rejet", required: true, minLength: 3 }}
        >
          Rejeter la recommandation
        </ConfirmButton>
      </form>
      {message}
    </div>
  );
}
