import { redirect } from "next/navigation";
import { getContext, homePath } from "@/lib/dal/context";
import { Notice } from "@/components/ui";
import { AuthCard, AuthHelp, AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "./login-form";
import { nextAllowedFor, safeNextPath } from "./next-path";

export const metadata = { title: "Connexion — People Analytics AJIR" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Page demandée avant connexion (lien profond AJIR, session expirée) : y revenir si le rôle y a accès
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  const ctx = await getContext();
  if (ctx) redirect(next && nextAllowedFor(ctx.role, next) ? next : homePath(ctx.role));
  return (
    <AuthShell interactive>
      <AuthCard title="Connexion">
        {next && (
          <Notice role="status" tone="info" className="mb-4">
            Connexion requise pour ouvrir la page demandée
          </Notice>
        )}
        <LoginForm next={next} />
      </AuthCard>

      <div className="mt-4 space-y-2">
        <AuthHelp id="aide-mot-de-passe" summary="Mot de passe oublié ou compte verrouillé ?">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium text-fg">Mot de passe oublié :</span> nouveau lien d&apos;activation auprès de l&apos;administrateur (valable 7 jours)
            </li>
            <li>
              <span className="font-medium text-fg">Compte verrouillé :</span> blocage de quelques minutes après 5 essais ; déverrouillage par l&apos;administrateur
            </li>
          </ul>
        </AuthHelp>
        <AuthHelp summary="Première connexion ?">
          <ul className="list-disc space-y-1 pl-5">
            <li>Lien d&apos;activation transmis par l&apos;administrateur</li>
            <li>Sans lien : demande de création de compte à l&apos;administrateur</li>
          </ul>
        </AuthHelp>
      </div>
    </AuthShell>
  );
}
