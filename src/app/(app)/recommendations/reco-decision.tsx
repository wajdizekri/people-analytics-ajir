"use client";

import { useActionState } from "react";
import { ConfirmButton, fieldCls } from "@/components/ui";
import { toast } from "@/components/ui/toast";

type State = { ok?: string; error?: string };
type Action = (state: State, form: FormData) => Promise<State>;

const labelCls = "block text-sm font-medium text-fg";

// Décision sur une recommandation : « Marquer comme réalisée » (date, avis et commentaire dans la confirmation) ou « Rejeter »
// (motif obligatoire). Deux formulaires distincts : chaque boîte de confirmation n'envoie que ses propres champs.
// Résultat notifié dès la réponse du serveur : la ligne peut disparaître de la liste filtrée (un effet n'aurait pas lieu).
export function RecoDecision({
  recommendationId,
  open,
  today,
  who,
  what,
  action,
}: {
  recommendationId: number;
  open: boolean;
  today: string;
  who: string;
  what?: string;
  action: Action;
}) {
  // pending commun aux deux formulaires : pendant l'envoi d'une décision, l'autre bouton est désactivé (pas de double décision)
  const [state, dispatch, pending] = useActionState<State, FormData>(async (prev, form) => {
    const res = await action(prev, form);
    const description = what ? `${what} · ${who}` : who;
    if (res.ok) toast.success(res.ok, { description });
    else if (res.error) toast.error("Décision non enregistrée", { description: res.error });
    return res;
  }, {});
  const id = `reco-${recommendationId}`;

  if (!open)
    return state.ok ? (
      <p className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {state.ok}
      </p>
    ) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={dispatch}>
          <input type="hidden" name="recommendationId" value={recommendationId} />
          <ConfirmButton
            variant="primary"
            size="sm"
            icon="check"
            disabled={pending}
            name="decision"
            value="REALISEE"
            title="Marquer cette recommandation comme réalisée ?"
            confirmLabel="Confirmer la réalisation"
            pendingLabel="Enregistrement…"
            consequence={
              <>
                Une intervention datée sera enregistrée pour <strong>{who}</strong>. Elle sert à mesurer l&apos;avant / après sur la page Interventions.
              </>
            }
            fields={
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${id}-date`} className={labelCls}>
                    Date de réalisation
                  </label>
                  <input id={`${id}-date`} type="date" name="date" defaultValue={today} max={today} required className={`${fieldCls} mt-1`} />
                </div>
                <div>
                  <label htmlFor={`${id}-avis`} className={labelCls}>
                    Recommandation pertinente ? <span className="font-normal text-fg-muted">(facultatif)</span>
                  </label>
                  <select id={`${id}-avis`} name="feedback" defaultValue="" className={`${fieldCls} mt-1`}>
                    <option value="">Non renseigné</option>
                    <option value="PERTINENTE">Oui, pertinente</option>
                    <option value="NON_PERTINENTE">Non, pas pertinente</option>
                  </select>
                </div>
              </div>
            }
            reason={{ name: "comment", label: "Commentaire", required: false }}
          >
            Marquer comme réalisée
          </ConfirmButton>
        </form>
        <form action={dispatch}>
          <input type="hidden" name="recommendationId" value={recommendationId} />
          <ConfirmButton
            variant="danger"
            size="sm"
            icon="x"
            disabled={pending}
            name="decision"
            value="REJETEE"
            title="Rejeter cette recommandation ?"
            confirmLabel="Confirmer le rejet"
            pendingLabel="Enregistrement…"
            consequence={
              <>
                La recommandation{what ? ` « ${what} »` : ""} pour <strong>{who}</strong> sera classée « Rejetée », sans intervention enregistrée. La décision est définitive et
                tracée dans le journal d&apos;audit.
              </>
            }
            reason={{ name: "comment", label: "Motif du rejet", required: true, minLength: 3, hint: "Exemple : situation déjà traitée, action non adaptée à ce collaborateur." }}
          >
            Rejeter la recommandation
          </ConfirmButton>
        </form>
      </div>
      {state.error && <p className="mt-2 text-sm text-danger">{state.error}</p>}
    </div>
  );
}
