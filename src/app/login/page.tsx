import { redirect } from "next/navigation";
import { getContext, homePath } from "@/lib/dal/context";
import { Notice } from "@/components/ui";
import { AuthCard, AuthHelp, AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "./login-form";
import { nextAllowedFor, safeNextPath } from "./next-path";

export const metadata = { title: "Connexion — People Analytics AJIR" };

const PURPOSE =
  "Suivez les indicateurs RH de votre périmètre et repérez les collaborateurs à rencontrer en priorité, à partir des données AJIR mises à jour chaque mois.";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Page demandée avant connexion (lien profond AJIR, session expirée) : y revenir si le rôle y a accès
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  const ctx = await getContext();
  if (ctx) redirect(next && nextAllowedFor(ctx.role, next) ? next : homePath(ctx.role));
  return (
    <AuthShell interactive>
      <AuthCard title="Connexion à People Analytics" intro={PURPOSE}>
        {next && (
          <Notice role="status" tone="info" className="mb-4">
            Connectez-vous pour ouvrir la page demandée. Une session se ferme après 2 heures sans activité.
          </Notice>
        )}
        <LoginForm next={next} />
      </AuthCard>

      <div className="mt-4 space-y-2">
        <AuthHelp id="aide-mot-de-passe" summary="Mot de passe oublié ou compte verrouillé ?">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-medium text-fg">Mot de passe oublié :</span> demandez à l&apos;administrateur de l&apos;outil un nouveau lien
              d&apos;activation. Il est valable 7 jours et vous permet de choisir un nouveau mot de passe.
            </li>
            <li>
              <span className="font-medium text-fg">Compte verrouillé :</span> après 5 essais infructueux, le compte est bloqué quelques minutes.
              Patientez, ou demandez à l&apos;administrateur de le déverrouiller.
            </li>
          </ul>
        </AuthHelp>
        <AuthHelp summary="Première connexion ?">
          <p>
            Ouvrez le lien d&apos;activation transmis par l&apos;administrateur de l&apos;outil pour choisir votre mot de passe, puis revenez sur cette page.
            Sans lien, demandez-lui de créer votre compte.
          </p>
        </AuthHelp>
        <p className="px-1 text-xs text-fg-subtle">
          Une fois connecté, le menu <span className="font-medium text-fg-muted">Aide</span> explique chaque écran, chaque indicateur et le vocabulaire utilisé.
        </p>
      </div>
    </AuthShell>
  );
}
