"use client";

import { useActionState, useState } from "react";
import { createUserAction, type CreateUserState } from "@/app/(app)/admin/users/actions";
import { Button, useActionToast } from "@/components/ui";
import { ActivationLinkBox } from "./activation-link-box";
import { fieldCls, labelCls } from "./admin-ui";

const ROLE_HELP: Record<string, string> = {
  RH: "Voit toute l'entreprise, rémunérations comprises.",
  MANAGER: "Voit seulement son équipe, sans salaires ni probabilités.",
  ADMIN: "Administre l'outil, sans accès aux données RH.",
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <p id={id} className="mt-1 text-xs font-medium text-danger">{message}</p> : null;
}

export function UserCreateForm() {
  const [state, action, pending] = useActionState<CreateUserState, FormData>(createUserAction, {});
  const [role, setRole] = useState("RH");
  const fe = state.fieldErrors ?? {};
  // Résultat annoncé par un toast ; le détail (champ en erreur, lien d'activation à copier) reste sous le formulaire
  useActionToast(state, {
    error: "Compte non créé",
    description: state.link ? "Copiez le lien d'activation affiché sous le formulaire : il ne sera montré qu'une fois." : "Le motif est indiqué sous le formulaire.",
  });

  return (
    <div>
      <form action={action} className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:items-start" aria-label="Créer un compte">
        <div>
          <label htmlFor="nu-login" className={labelCls}>Identifiant</label>
          <input id="nu-login" name="login" defaultValue={state.values?.login} required minLength={3} maxLength={50} autoComplete="off"
            placeholder="ex. prenom.nom" className={fieldCls(!!fe.login)}
            aria-invalid={!!fe.login} aria-describedby={fe.login ? "nu-login-err" : "nu-login-help"} />
          {fe.login ? (
            <FieldError id="nu-login-err" message={fe.login} />
          ) : (
            <p id="nu-login-help" className="mt-1 text-xs text-fg-muted">De 3 à 50 caractères : lettres, chiffres, point, tiret.</p>
          )}
        </div>
        <div>
          <label htmlFor="nu-role" className={labelCls}>Rôle</label>
          <select id="nu-role" name="role" value={role} onChange={(e) => setRole(e.target.value)} className={fieldCls(!!fe.role)}
            aria-invalid={!!fe.role} aria-describedby={fe.role ? "nu-role-err" : "nu-role-help"}>
            <option value="RH">Responsable RH</option>
            <option value="MANAGER">Manager</option>
            <option value="ADMIN">Administrateur</option>
          </select>
          {fe.role ? (
            <FieldError id="nu-role-err" message={fe.role} />
          ) : (
            <p id="nu-role-help" className="mt-1 text-xs text-fg-muted">{ROLE_HELP[role]}</p>
          )}
        </div>
        <div>
          <label htmlFor="nu-matricule" className={labelCls}>
            Matricule du collaborateur{" "}
            {role === "MANAGER" ? <span className="font-semibold text-danger">(obligatoire)</span> : <span className="font-normal text-fg-subtle">(facultatif)</span>}
          </label>
          <input id="nu-matricule" name="matricule" defaultValue={state.values?.matricule} required={role === "MANAGER"} maxLength={50}
            placeholder="ex. M10005" className={`${fieldCls(!!fe.matricule)} font-mono`}
            aria-invalid={!!fe.matricule} aria-describedby={fe.matricule ? "nu-matricule-err" : "nu-matricule-help"} />
          {fe.matricule ? (
            <FieldError id="nu-matricule-err" message={fe.matricule} />
          ) : (
            <p id="nu-matricule-help" className="mt-1 text-xs text-fg-muted">
              {role === "MANAGER" ? "Le manager verra les collaborateurs placés sous ce matricule." : "Matricule AJIR de la personne, si elle figure parmi les collaborateurs."}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="nu-email" className={labelCls}>E-mail <span className="font-normal text-fg-subtle">(facultatif)</span></label>
          <input id="nu-email" name="email" defaultValue={state.values?.email} type="email" maxLength={200}
            placeholder="prenom.nom@entreprise.tn" className={fieldCls(!!fe.email)}
            aria-invalid={!!fe.email} aria-describedby={fe.email ? "nu-email-err" : undefined} />
          {fe.email ? (
            <FieldError id="nu-email-err" message={fe.email} />
          ) : (
            <p className="mt-1 text-xs text-fg-muted">Pour vous souvenir à qui transmettre le lien.</p>
          )}
        </div>
        <div className="lg:pt-6">
          <Button type="submit" variant="primary" icon="plus" pending={pending} pendingLabel="Création…" className="w-full lg:w-auto">
            Créer le compte
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {state.error && <p role="alert" className="mt-3 text-sm font-medium text-danger">{state.error}</p>}
        {!state.error && Object.keys(fe).length > 0 && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger">
            Compte non créé : corrigez {Object.keys(fe).length > 1 ? "les champs signalés en rouge" : "le champ signalé en rouge"}, puis cliquez de nouveau sur « Créer le compte ».
          </p>
        )}
      </div>
      {/* Hors de la zone annoncée : le toast signale le lien, la boîte reste à copier */}
      {state.link && <ActivationLinkBox {...state.link} />}
    </div>
  );
}
