"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon, SubmitButton } from "@/components/ui";
import { PasswordField } from "@/components/auth/password-field";
import { hasLength, hasMix, newPasswordErrors } from "@/components/auth/password-rules";
import { announce } from "@/components/admin/notify";
import { changePasswordAction, type PasswordState } from "./actions";

const sessionsClosed = (n?: number) => (n ? `${n} autre${n > 1 ? "s" : ""} session${n > 1 ? "s ont" : " a"} été fermée${n > 1 ? "s" : ""} par sécurité.` : undefined);

type Field = "current" | "password" | "confirm";
const FIELDS: Field[] = ["current", "password", "confirm"];

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? "text-success" : "text-fg-muted"}`}>
      <Icon name={ok ? "success" : "info"} className="h-3.5 w-3.5" />
      {children}
      <span className="sr-only">{ok ? " : respecté" : " : pas encore respecté"}</span>
    </li>
  );
}

export function PasswordForm({ login, otherSessions }: { login: string; otherSessions: number }) {
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const currentRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  // Les champs sont vidés après chaque envoi, réussi ou non (pas de mot de passe laissé à l'écran)
  const [state, action] = useActionState<PasswordState, FormData>(async (prev, fd) => {
    const res = await changePasswordAction(prev, fd);
    setPwd("");
    setConfirm("");
    return announce(res, {
      success: "Mot de passe modifié",
      successDescription: sessionsClosed(res.revoked),
      error: "Mot de passe non modifié",
      errorDescription: "Le motif est indiqué sous le formulaire.",
    });
  }, {});

  // Refus du serveur (mot de passe actuel incorrect, trop d'essais) : formulaire vidé, curseur dans le premier champ
  useEffect(() => {
    if (state.error) currentRef.current?.focus();
  }, [state, currentRef]);

  // Règles vérifiées avant l'envoi : une saisie à corriger ne vide plus le formulaire
  const validate = (e: FormEvent<HTMLFormElement>) => {
    const current = String(new FormData(e.currentTarget).get("current") ?? "");
    const next: Partial<Record<Field, string>> = { ...newPasswordErrors(pwd, confirm) };
    if (!current) next.current = "Saisissez votre mot de passe actuel.";
    else if (!next.password && pwd === current) next.password = "Le nouveau mot de passe doit être différent de l'actuel : choisissez-en un autre.";
    setErrors(next);
    const first = FIELDS.find((k) => next[k]);
    if (first) {
      e.preventDefault();
      ({ current: currentRef, password: passwordRef, confirm: confirmRef })[first].current?.focus();
    }
  };
  const clear = (k: Field) => errors[k] && setErrors((x) => ({ ...x, [k]: undefined }));
  const serverError = state.error ? "password-error" : undefined;

  return (
    <form action={action} onSubmit={validate} noValidate className="max-w-md">
      <input type="text" name="username" autoComplete="username" value={login} readOnly hidden />
      <div className="space-y-4">
        <PasswordField
          ref={currentRef}
          id="current"
          name="current"
          label="Mot de passe actuel"
          autoComplete="current-password"
          toggleLabel="Afficher le mot de passe actuel"
          maxLength={200}
          onChange={() => clear("current")}
          invalid={!!state.error}
          error={errors.current}
          describedBy={serverError}
        />
        <PasswordField
          ref={passwordRef}
          id="password"
          name="password"
          label="Nouveau mot de passe"
          autoComplete="new-password"
          toggleLabel="Afficher le nouveau mot de passe"
          minLength={10}
          maxLength={200}
          value={pwd}
          onChange={(e) => {
            setPwd(e.target.value);
            clear("password");
          }}
          error={errors.password}
          describedBy="password-help"
        >
          <ul id="password-help" className="mt-1.5 space-y-0.5 text-xs">
            <Check ok={hasLength(pwd)}>Au moins 10 caractères</Check>
            <Check ok={hasMix(pwd)}>Des lettres et des chiffres</Check>
          </ul>
        </PasswordField>
        <PasswordField
          ref={confirmRef}
          id="confirm"
          name="confirm"
          label="Confirmation du mot de passe"
          autoComplete="new-password"
          toggleLabel="Afficher la confirmation du mot de passe"
          maxLength={200}
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            clear("confirm");
          }}
          error={errors.confirm}
          describedBy="confirm-help"
        >
          <ul id="confirm-help" className="mt-1.5 text-xs">
            <Check ok={confirm.length > 0 && confirm === pwd}>Les deux saisies sont identiques</Check>
          </ul>
        </PasswordField>
      </div>

      <div aria-live="polite" className="mt-4">
        {state.error && (
          <p id="password-error" role="alert" className="flex items-start gap-1.5 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            <Icon name="error" className="mt-0.5 h-4 w-4" />
            {state.error}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
        <SubmitButton variant="primary" icon="lock" pendingLabel="Enregistrement…">
          Changer mon mot de passe
        </SubmitButton>
        {otherSessions > 0 && (
          <p className="text-xs text-fg-muted">
            {otherSessions > 1 ? `${otherSessions} autres sessions seront fermées` : "1 autre session sera fermée"}
          </p>
        )}
      </div>
    </form>
  );
}
