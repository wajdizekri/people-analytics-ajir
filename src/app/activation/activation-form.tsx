"use client";

import { useActionState, useRef, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Notice } from "@/components/ui";
import { PasswordField } from "@/components/auth/password-field";
import { hasLength, hasMix, newPasswordErrors, type NewPasswordErrors } from "@/components/auth/password-rules";
import { activateAction, type ActivationState } from "./actions";

function Rule({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={`flex items-center gap-1.5 transition-colors duration-200 ${ok ? "text-success" : "text-fg-muted"}`}>
      {ok ? <Icon name="check" className="h-3.5 w-3.5" /> : <span aria-hidden="true" className="inline-block h-3.5 w-3.5 text-center leading-[14px]">•</span>}
      {children}
      <span className="sr-only">{ok ? " : respecté" : " : pas encore respecté"}</span>
    </li>
  );
}

export function ActivationForm({ token, login }: { token: string; login: string }) {
  const [state, action, pending] = useActionState<ActivationState, FormData>(activateAction, {});
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<NewPasswordErrors>({});
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  if (state.ok) {
    return (
      <div className="space-y-4">
        <Notice role="status" tone="success">
          Mot de passe enregistré pour {state.login}. Ce lien ne peut plus servir : connectez-vous désormais avec votre identifiant et ce mot de passe.
        </Notice>
        <ButtonLink href="/login" variant="primary" size="lg" fullWidth>
          Se connecter
        </ButtonLink>
      </div>
    );
  }

  // Règles vérifiées avant l'envoi : erreur sous le champ concerné, curseur placé dans le premier champ à corriger
  const validate = (e: FormEvent<HTMLFormElement>) => {
    const next = newPasswordErrors(password, confirm);
    setErrors(next);
    if (next.password || next.confirm) {
      e.preventDefault();
      (next.password ? passwordRef : confirmRef).current?.focus();
    }
  };
  const error = state.error ? " activation-error" : "";

  return (
    <form action={action} onSubmit={validate} noValidate className="space-y-4" aria-busy={pending || undefined}>
      <input type="hidden" name="token" value={token} />
      <input type="text" name="username" autoComplete="username" value={login} readOnly hidden />
      <PasswordField
        ref={passwordRef}
        id="password"
        name="password"
        label="Nouveau mot de passe"
        autoComplete="new-password"
        toggleLabel="Afficher le nouveau mot de passe"
        minLength={10}
        maxLength={200}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
        }}
        error={errors.password}
        describedBy={`password-help${error}`}
      >
        <ul id="password-help" className="mt-1.5 space-y-0.5 text-xs">
          <Rule ok={hasLength(password)}>Au moins 10 caractères</Rule>
          <Rule ok={hasMix(password)}>Des lettres et des chiffres</Rule>
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
          if (errors.confirm) setErrors((x) => ({ ...x, confirm: undefined }));
        }}
        error={errors.confirm}
        describedBy={`confirm-help${error}`}
      >
        <ul id="confirm-help" className="mt-1.5 text-xs">
          <Rule ok={confirm.length > 0 && confirm === password}>Identique au nouveau mot de passe</Rule>
        </ul>
      </PasswordField>
      <div>
        <div aria-live="assertive">
          {state.error && (
            <Notice id="activation-error" tone="error" className="mb-4">
              {state.error}
            </Notice>
          )}
        </div>
        <Button type="submit" variant="primary" size="lg" fullWidth pending={pending} pendingLabel="Enregistrement…">
          Définir le mot de passe
        </Button>
      </div>
    </form>
  );
}
