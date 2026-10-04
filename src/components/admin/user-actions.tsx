"use client";

import { useActionState } from "react";
import { activationLinkAction, setActiveAction, unlockAction, type UserActionState } from "@/app/(app)/admin/users/actions";
import { Button, ConfirmButton } from "@/components/ui";
import { ActivationLinkBox } from "./activation-link-box";
import { announce } from "./notify";

export function UserActions({
  id,
  login,
  active,
  hasPassword,
  locked,
  failedAttempts,
  isSelf,
}: {
  id: number;
  login: string;
  active: boolean;
  hasPassword: boolean;
  locked: boolean;
  failedAttempts: number;
  isSelf: boolean;
}) {
  // Toasts émis au retour de l'action : la ligne peut sortir du filtre affiché (compte déverrouillé, désactivé) ; le lien reste dans la ligne
  const why = "Motif dans la ligne du compte";
  const [toggle, toggleAction, togglePending] = useActionState<UserActionState, FormData>(
    async (prev, form) => announce(await setActiveAction(prev, form), { error: `Compte ${login} non modifié`, errorDescription: why }),
    {},
  );
  const [unlock, unlockFormAction, unlockPending] = useActionState<UserActionState, FormData>(
    async (prev, form) => announce(await unlockAction(prev, form), { error: `Compte ${login} non déverrouillé`, errorDescription: why }),
    {},
  );
  const [link, linkAction, linkPending] = useActionState<UserActionState, FormData>(async (prev, form) => {
    const res = await activationLinkAction(prev, form);
    announce(res.link ? { ok: `Lien généré pour ${res.link.login}.` } : res, {
      successDescription: "Lien dans la ligne du compte, affiché une seule fois",
      error: `Lien non généré pour ${login}`,
      errorDescription: why,
    });
    return res;
  }, {});
  const message = toggle.error ?? unlock.error ?? link.error;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-start gap-1.5 lg:flex-nowrap">
        {active && (locked || failedAttempts > 0) && (
          <form action={unlockFormAction}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" size="sm" icon="unlock" pending={unlockPending} pendingLabel="Déverrouillage…">
              {locked ? "Déverrouiller" : "Effacer les échecs"}
              <span className="sr-only"> {login}</span>
            </Button>
          </form>
        )}
        {active && (
          <form action={linkAction}>
            <input type="hidden" name="id" value={id} />
            <ConfirmButton
              variant="secondary"
              size="sm"
              icon="link"
              title={`Générer un lien d'activation pour ${login} ?`}
              confirmLabel="Générer le lien"
              pendingLabel="Génération…"
              consequence={
                <>
                  <p>
                    {hasPassword
                      ? "Ce compte a déjà un mot de passe : le lien permet d'en choisir un nouveau, par exemple en cas d'oubli. Le mot de passe actuel reste valable tant que le lien n'est pas utilisé."
                      : "Le lien permet à la personne de définir son mot de passe et d'accéder à l'outil."}
                  </p>
                  <p>Il est valable 7 jours et ne sert qu&apos;une fois. Un lien encore valide est remplacé.</p>
                </>
              }
            >
              {/* Même libellé dans tous les cas, comme l'aide et la page de connexion (« nouveau lien d'activation ») */}
              Générer un lien d&apos;activation
              <span className="sr-only"> pour {login}</span>
            </ConfirmButton>
          </form>
        )}
        {!isSelf && active && (
          <form action={toggleAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="active" value="0" />
            <ConfirmButton
              variant="danger"
              size="sm"
              icon="ban"
              className="border border-danger/40 bg-surface! text-danger! shadow-none! hover:bg-danger-soft!"
              title={`Désactiver le compte ${login} ?`}
              confirmLabel="Désactiver le compte"
              pendingLabel="Désactivation…"
              consequence={
                <>
                  <p>La personne ne pourra plus se connecter et ses sessions ouvertes seront fermées immédiatement.</p>
                  <p>Son historique est conservé : vous pourrez réactiver le compte à tout moment.</p>
                </>
              }
            >
              Désactiver
              <span className="sr-only"> le compte {login}</span>
            </ConfirmButton>
          </form>
        )}
        {!isSelf && !active && (
          <form action={toggleAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="active" value="1" />
            <Button type="submit" size="sm" icon="check" pending={togglePending} pendingLabel="Réactivation…">
              Réactiver
              <span className="sr-only"> le compte {login}</span>
            </Button>
          </form>
        )}
        {isSelf && <p className="py-2 text-xs text-fg-muted">Votre compte : non désactivable</p>}
      </div>
      <div aria-live="polite">
        {message && <p role="alert" className="text-xs font-medium text-danger">{message}</p>}
      </div>
      {link.link && !linkPending && <ActivationLinkBox {...link.link} />}
    </div>
  );
}
