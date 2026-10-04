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
              Compte <span className="font-medium text-fg">{account.login}</span>
            </>
          }
        >
          <ActivationForm token={token} login={account.login} />
        </AuthCard>
      ) : (
        <AuthCard title="Activation du compte">
          <div className="space-y-4 text-sm">
            <Notice role="alert" tone="error">
              Lien d&apos;activation invalide, expiré ou déjà utilisé.
            </Notice>
            <ButtonLink href="/login" variant="primary" size="lg" fullWidth>
              Aller à la page de connexion
            </ButtonLink>
          </div>
        </AuthCard>
      )}
    </AuthShell>
  );
}
