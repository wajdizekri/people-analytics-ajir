"use client";

import { useActionState, useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
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
  const password = useRef<HTMLInputElement>(null);
  const invalid = !!state.error;

  // Après un échec, le mot de passe est vidé : le curseur y revient pour une nouvelle saisie
  useEffect(() => {
    if (state.error) password.current?.focus();
  }, [state]);

  return (
    <form action={action} className="space-y-4" aria-busy={pending || undefined}>
      {next && <input type="hidden" name="next" value={next} />}
      <div>
        <label htmlFor="login" className="block text-sm font-medium text-fg">
          Identifiant
        </label>
        <p id="login-hint" className="text-xs text-fg-subtle">
          Communiqué par l&apos;administrateur de l&apos;outil, par exemple prenom.nom.
        </p>
        <input
          id="login"
          name="login"
          autoComplete="username"
          required
          autoCapitalize="none"
          spellCheck={false}
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "login-hint login-error" : "login-hint"}
          className={`mt-1 ${authFieldCls(invalid)}`}
        />
      </div>
      <PasswordField
        ref={password}
        id="password"
        name="password"
        label="Mot de passe"
        autoComplete="current-password"
        invalid={invalid}
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
