import type { Role } from "@/db/schema";
import { pageContext } from "@/lib/dal/context";
import { getPowerBiConfig, getPowerBiReport } from "@/lib/dal/powerbi";
import { ButtonLink, PageHeader, StatusBadge } from "@/components/ui";
import { PowerBiConfigForm } from "./config-form";
import { ReportFrame, ReportPlaceholder } from "./report-frame";

export const metadata = { title: "Power BI — People Analytics AJIR" };

const SCOPE: Record<Role, string> = { RH: "Toute l'entreprise", MANAGER: "Votre périmètre, filtré par Power BI", ADMIN: "Rapport administrateur" };
const TITLE: Record<Role, string> = { RH: "Rapport RH", MANAGER: "Rapport manager", ADMIN: "Rapport administrateur" };

export default async function PowerBiPage() {
  const ctx = await pageContext();
  const report = getPowerBiReport(ctx);
  const config = ctx.role === "ADMIN" ? getPowerBiConfig(ctx) : null;

  return (
    <>
      <PageHeader
        title="Power BI"
        subtitle="Rapport Power BI affiché dans l'outil. Connexion avec le compte Microsoft professionnel si Power BI la demande ; chaque utilisateur ne voit que les données que lui ouvre la sécurité au niveau des lignes (RLS) du rapport."
        scope={SCOPE[ctx.role]}
        badge={report.url ? <StatusBadge tone="success">Connecté</StatusBadge> : <StatusBadge tone="neutral">À configurer</StatusBadge>}
      />
      {report.url ? (
        <ReportFrame src={report.url} title={TITLE[ctx.role]} />
      ) : (
        <ReportPlaceholder
          action={
            config ? (
              <ButtonLink href="#liens" variant="primary" icon="link">
                Ajouter un lien
              </ButtonLink>
            ) : (
              <p className="text-sm text-fg-muted">Lien à ajouter par l&apos;administrateur de l&apos;outil</p>
            )
          }
        />
      )}
      {config && <PowerBiConfigForm rows={config} />}
    </>
  );
}
