"use client";

import { useActionState, useState } from "react";
import { ConfirmButton, SubmitButton, fieldCls, toast } from "@/components/ui";
import { announce } from "@/components/admin/notify";

type State = { ok?: string; error?: string };
type Action = (state: State, form: FormData) => Promise<State>;
type RequestType = "ACCES" | "OPPOSITION" | "RECTIFICATION";

const inputCls = `${fieldCls} mt-1 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/25`;
const choiceCls =
  "flex min-h-10 cursor-pointer items-start gap-2 rounded-control bg-surface px-3 py-2 text-sm text-fg ring-1 ring-inset ring-line-strong transition-colors duration-150 hover:bg-surface-3 has-checked:bg-primary-soft has-checked:ring-2 has-checked:ring-primary has-disabled:cursor-not-allowed has-disabled:opacity-60";

// Succès annoncé par un toast (le formulaire disparaît souvent après l'action) ; l'erreur reste aussi près des champs
function Feedback({ state }: { state: State }) {
  return (
    <div aria-live="polite">
      {state.error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}
const WHY = "Le motif est indiqué sous le formulaire.";

const TYPES: { value: RequestType; label: string; hint: string }[] = [
  { value: "ACCES", label: "Accès à ses données", hint: "Le collaborateur reçoit une copie de toutes les données le concernant, sous un mois." },
  {
    value: "OPPOSITION",
    label: "Opposition au calcul du risque",
    hint: "Effet immédiat : plus d'estimation, de simulation « et si ? », de recommandation ni d'alerte de risque pour lui.",
  },
  { value: "RECTIFICATION", label: "Rectification d'une donnée", hint: "La correction se fait dans AJIR ; l'outil garde la trace de la demande." },
];

export function RequestForm({ employeeId, opposed, action }: { employeeId: number; opposed: boolean; action: Action }) {
  const [state, formAction] = useActionState<State, FormData>(
    async (prev, form) => announce(await action(prev, form), { error: "Demande non enregistrée", errorDescription: WHY }),
    {},
  );
  const [type, setType] = useState<RequestType>("ACCES");
  const noteId = `privacy-note-${employeeId}`;
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <fieldset>
        <legend className="text-sm font-medium text-fg">Que demande le collaborateur ?</legend>
        <div className="mt-2 grid gap-2">
          {TYPES.map((t) => {
            const disabled = t.value === "OPPOSITION" && opposed;
            return (
              <label key={t.value} className={choiceCls}>
                <input type="radio" name="type" value={t.value} checked={type === t.value} disabled={disabled} onChange={() => setType(t.value)} className="mt-0.5 accent-primary" />
                <span>
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-xs text-fg-muted">{disabled ? "Déjà en vigueur pour ce collaborateur." : t.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div>
        <label htmlFor={noteId} className="block text-sm font-medium text-fg">
          {type === "RECTIFICATION" ? (
            <>
              Donnée à corriger et valeur attendue <span className="text-danger">(obligatoire)</span>
            </>
          ) : (
            <>
              Précisions : date et mode de réception, motif invoqué <span className="font-normal text-fg-muted">(facultatif)</span>
            </>
          )}
        </label>
        <textarea id={noteId} name="note" rows={3} maxLength={1000} required={type === "RECTIFICATION"} minLength={type === "RECTIFICATION" ? 3 : undefined} className={inputCls} />
      </div>
      <Feedback state={state} />
      {type === "OPPOSITION" ? (
        <ConfirmButton
          variant="danger"
          icon="ban"
          title="Enregistrer l'opposition au calcul du risque ?"
          confirmLabel="Enregistrer l'opposition"
          pendingLabel="Enregistrement…"
          consequence={
            <>
              <p>Le calcul du risque est suspendu immédiatement pour ce collaborateur.</p>
              <p>Ses estimations, facteurs, variables calculées, recommandations ouvertes et alertes de risque sont supprimés. L&apos;opération est tracée ; l&apos;opposition pourra être levée.</p>
            </>
          }
        >
          Enregistrer l&apos;opposition
        </ConfirmButton>
      ) : (
        <SubmitButton icon="save" pendingLabel="Enregistrement…">
          Enregistrer la demande
        </SubmitButton>
      )}
    </form>
  );
}

export function CloseRequestForm({ requestId, type, action }: { requestId: number; type: RequestType; action: Action }) {
  const [state, formAction] = useActionState<State, FormData>(
    async (prev, form) => announce(await action(prev, form), { error: `Demande n° ${requestId} non clôturée`, errorDescription: WHY }),
    {},
  );
  const [status, setStatus] = useState<"TRAITEE" | "REFUSEE">("TRAITEE");
  const refusing = status === "REFUSEE";
  const noteId = `close-note-${requestId}`;
  const treatedLabel = type === "ACCES" ? "Traitée : copie remise" : type === "OPPOSITION" ? "Traitée : opposition maintenue" : "Traitée : corrigée dans AJIR";
  const liftOnRefusal = type === "OPPOSITION" && refusing;
  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-control bg-surface-2 p-3 ring-1 ring-inset ring-line">
      <input type="hidden" name="requestId" value={requestId} />
      <fieldset>
        <legend className="text-sm font-medium text-fg">Réponse apportée à la demande n° {requestId}</legend>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <label className={choiceCls}>
            <input type="radio" name="status" value="TRAITEE" checked={!refusing} onChange={() => setStatus("TRAITEE")} className="mt-0.5 accent-primary" />
            {treatedLabel}
          </label>
          <label className={choiceCls}>
            <input type="radio" name="status" value="REFUSEE" checked={refusing} onChange={() => setStatus("REFUSEE")} className="mt-0.5 accent-primary" />
            Refusée
          </label>
        </div>
      </fieldset>
      <label htmlFor={noteId} className="block text-xs font-medium text-fg">
        {refusing ? "Motif du refus (obligatoire)" : "Commentaire de clôture (facultatif)"}
      </label>
      <textarea id={noteId} name="note" rows={2} maxLength={1000} required={refusing} minLength={refusing ? 3 : undefined} className={inputCls} />
      <Feedback state={state} />
      <ConfirmButton
        variant={refusing ? "danger" : "secondary"}
        icon="check"
        title={liftOnRefusal ? "Refuser l'opposition ?" : `Clôturer la demande n° ${requestId} ?`}
        confirmLabel={liftOnRefusal ? "Refuser et lever l'opposition" : "Clôturer la demande"}
        pendingLabel="Enregistrement…"
        consequence={
          liftOnRefusal ? (
            <p>La suspension est levée : le collaborateur sera de nouveau évalué au prochain calcul. La décision et son motif sont tracés.</p>
          ) : (
            <p>La demande sera clôturée avec cette réponse et ne pourra plus être modifiée. La clôture est tracée.</p>
          )
        }
      >
        Clôturer la demande
      </ConfirmButton>
    </form>
  );
}

export function LiftOppositionForm({ employeeId, action }: { employeeId: number; action: Action }) {
  const [state, formAction] = useActionState<State, FormData>(
    async (prev, form) => announce(await action(prev, form), { error: "Opposition non levée", errorDescription: WHY }),
    {},
  );
  const noteId = `lift-note-${employeeId}`;
  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <label htmlFor={noteId} className="block text-sm font-medium text-fg">
        Pourquoi lever l&apos;opposition ? <span className="text-danger">(obligatoire)</span>
      </label>
      <textarea id={noteId} name="note" rows={2} maxLength={1000} required minLength={3} placeholder="Ex. : retrait écrit du collaborateur reçu le …" className={inputCls} />
      <Feedback state={state} />
      <ConfirmButton
        variant="secondary"
        icon="unlock"
        title="Lever l'opposition ?"
        confirmLabel="Lever l'opposition"
        pendingLabel="Enregistrement…"
        consequence={<p>Le collaborateur sera de nouveau évalué au prochain calcul mensuel. La levée et son motif sont tracés.</p>}
      >
        Lever l&apos;opposition
      </ConfirmButton>
    </form>
  );
}

// Téléchargement par la route API authentifiée (auditée privacy.export), après confirmation
export function ExportLinks({ requestId }: { requestId: number }) {
  const download = (format: "zip" | "json") => () => {
    const a = document.createElement("a");
    a.href = `/api/privacy/requests/${requestId}/export?format=${format}`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast.info(`Téléchargement de la copie lancé (${format === "zip" ? "CSV zippé" : "JSON"})`, {
      description: `Demande n° ${requestId}. Remettez la copie au seul collaborateur concerné ; le téléchargement est tracé.`,
    });
  };
  const consequence = (
    <>
      <p>La copie contient sa rémunération et les catégories de ses absences, santé comprise.</p>
      <p>Remettez-la au seul collaborateur concerné, sans en garder de copie. Le téléchargement est tracé.</p>
    </>
  );
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmButton variant="primary" icon="download" title="Télécharger la copie complète de ses données ?" confirmLabel="Télécharger" consequence={consequence} onConfirm={download("zip")}>
        Télécharger la copie (CSV zippé)
      </ConfirmButton>
      <ConfirmButton variant="secondary" icon="download" title="Télécharger la copie complète de ses données ?" confirmLabel="Télécharger" consequence={consequence} onConfirm={download("json")}>
        Télécharger la copie (JSON)
      </ConfirmButton>
    </div>
  );
}
