import { checkActivationToken } from "@/lib/dal/admin";
import { ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui";
import { AuthCard, AuthShell } from "@/components/auth/auth-shell";
import { ActivationForm } from "./activation-form";

export const metadata = { title: "Activation du compte — People Analytics AJIR", referrer: "no-referrer" };

export default async function ActivationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const account = token ? checkActivationToken(token) : null;

  return (
    <AuthShell>
      {account ? (
        <AuthCard
          title="Activation du compte"
          intro={
            <>
              Choisissez le mot de passe du compte <span className="font-medium text-fg">{account.login}</span>. Vous l&apos;utiliserez ensuite avec cet
              identifiant pour vous connecter.
            </>
          }
        >
          <ActivationForm token={token} login={account.login} />
        </AuthCard>
      ) : (
        <AuthCard title="Activation du compte">
          <div className="mt-3 space-y-4 text-sm">
            <Notice role="alert" tone="error">
              Ce lien d&apos;activation est invalide, expiré ou déjà utilisé.
            </Notice>
            <p className="text-fg-muted">
              Un lien est valable 7 jours et ne sert qu&apos;une fois. Demandez-en un nouveau à l&apos;administrateur de l&apos;outil, ou connectez-vous si vous avez
              déjà choisi votre mot de passe.
            </p>
            <ButtonLink href="/login" variant="primary" size="lg" fullWidth>
              Aller à la page de connexion
            </ButtonLink>
          </div>
        </AuthCard>
      )}
    </AuthShell>
  );
}
