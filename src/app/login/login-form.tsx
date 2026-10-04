"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Notice } from "@/components/ui";
import { authFieldCls, PasswordField } from "@/components/auth/password-field";
import { loginAction, type LoginState } from "./actions";

// Encart « Mot de passe oublié » de la page (id repris dans page.tsx)
const HELP_ID = "aide-mot-de-passe";

// Ouvre l'encart d'aide sous la carte et y place le focus (sans JavaScript : simple ancre)
function openHelp(e: MouseEvent<HTMLAnchorElement>) {
  const details = document.getElementById(HELP_ID);
  if (!(details instanceof HTMLDetailsElement)) return;
  e.preventDefault();
  details.open = true;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  details.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  details.querySelector("summary")?.focus({ preventScroll: true });
}

export function LoginForm({ next }: { next?: string | null }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  // Contrôlé : l'identifiant reste saisi après un échec (le formulaire est réinitialisé par l'action)
  const [login, setLogin] = useState("");
  const loginRef = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);
  const [missing, setMissing] = useState<{ login?: string; password?: string }>({});
  const invalid = !!state.error;
  const loginInvalid = invalid || !!missing.login;

  // Après un échec, le mot de passe est vidé : le curseur y revient pour une nouvelle saisie
  useEffect(() => {
    if (state.error) password.current?.focus();
  }, [state]);

  // Champ vide : message de l'application sous le champ (et non la bulle du navigateur), curseur dans le premier à remplir
  const validate = (e: FormEvent<HTMLFormElement>) => {
    const next = {
      login: login.trim() ? undefined : "Saisissez votre identifiant.",
      password: password.current?.value ? undefined : "Saisissez votre mot de passe.",
    };
    setMissing(next);
    if (next.login || next.password) {
      e.preventDefault();
      (next.login ? loginRef : password).current?.focus();
    }
  };

  return (
    <form action={action} onSubmit={validate} noValidate className="space-y-4" aria-busy={pending || undefined}>
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <label htmlFor="login" className="block text-sm font-medium text-fg">
          Identifiant
        </label>
        <p id="login-hint" className="text-xs text-fg-subtle">
          Communiqué par l&apos;administrateur de l&apos;outil, par exemple prenom.nom.
        </p>
        <input
          ref={loginRef}
          id="login"
          name="login"
          autoComplete="username"
          required
          autoCapitalize="none"
          spellCheck={false}
          value={login}
          onChange={(e) => {
            setLogin(e.target.value);
            if (missing.login) setMissing((m) => ({ ...m, login: undefined }));
          }}
          aria-invalid={loginInvalid || undefined}
          aria-describedby={["login-hint", missing.login && "login-erreur", invalid && "login-error"].filter(Boolean).join(" ")}
          className={`mt-1 ${authFieldCls(loginInvalid)}`}
        />
        {missing.login && (
          <p id="login-erreur" className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger">
            <Icon name="error" className="mt-0.5 h-4 w-4" />
            {missing.login}
          </p>
        )}
      </div>
      <PasswordField
        ref={password}
        id="password"
        name="password"
        label="Mot de passe"
        autoComplete="current-password"
        invalid={invalid}
        error={missing.password}
        onChange={() => {
          if (missing.password) setMissing((m) => ({ ...m, password: undefined }));
        }}
        describedBy={invalid ? "login-error" : undefined}
        labelAside={
          <a href={`#${HELP_ID}`} onClick={openHelp} className="rounded-sm py-0.5 text-sm text-link underline-offset-4 hover:underline">
            Mot de passe oublié ?
          </a>
        }
      />
      <div>
        <div aria-live="assertive">
          {state.error && (
            <Notice id="login-error" tone="error" className="mb-4">
              {state.error}
            </Notice>
          )}
        </div>
        <Button type="submit" variant="primary" size="lg" fullWidth pending={pending} pendingLabel="Connexion…">
          Se connecter
        </Button>
      </div>
    </form>
  );
}
