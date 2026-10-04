import { headers } from "next/headers";
import { ButtonLink, EmptyState, KpiTile, Notice, PageHeader, fmt } from "@/components/ui";
import { PageIntro } from "@/components/help";
import { OrgChartView } from "@/components/org-chart/org-chart-view";
import { formatDate, formatMonth } from "@/components/pilotage/labels";
import { clientIp } from "@/lib/auth/session";
import { pageContext } from "@/lib/dal/context";
import { parseQuery } from "@/lib/dal/employees";
import { getOrgChart, orgChartQuerySchema } from "@/lib/dal/org-chart";
import { MIN_GROUP_SIZE } from "@/lib/dal/pilotage-metrics";

export const metadata = { title: "Organigramme — People Analytics AJIR" };

export default async function OrgChartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(["RH", "MANAGER"]);
  const { data: q, ignored } = parseQuery(orgChartQuerySchema, await searchParams, "lenient");
  const dto = getOrgChart(ctx, { source: "page", ip: clientIp(await headers()) });
  const rh = dto.view === "RH";
  const { stats } = dto;
  const fixes = stats.reattached + stats.cycles + stats.flattened;
  const window = `${formatMonth(dto.window.from.slice(0, 7))} – ${formatMonth(dto.window.to.slice(0, 7))}`;

  return (
    <>
      <PageHeader
        eyebrow="Collaborateurs"
        title="Organigramme"
        subtitle={rh ? "La hiérarchie de l'entreprise, équipe par équipe, avec l'effectif, le risque de départ et l'absentéisme." : "Votre hiérarchie, équipe par équipe, avec l'effectif, le risque de départ et l'absentéisme, hors rémunération."}
        scope={`${rh ? "Toute l'entreprise" : "Votre hiérarchie"} : ${fmt.int(stats.people)} collaborateur${stats.people > 1 ? "s" : ""} actif${stats.people > 1 ? "s" : ""}`}
        period={`Données au ${formatDate(dto.referenceDate)} · absentéisme sur ${window}${dto.runAsOf ? ` · risque calculé au ${formatDate(dto.runAsOf)}` : ""}`}
        actions={
          stats.people > 0 ? (
            <ButtonLink href="/equipes" variant="secondary" icon="users">
              {rh ? "Voir les équipes" : "Voir mes équipes"}
            </ButtonLink>
          ) : undefined
        }
      />
      <PageIntro
        points={[
          "Chaque nœud est un responsable d'équipe ; ses collaborateurs sans équipe sont comptés dans son effectif.",
          "La couleur suit l'indicateur choisi ; sa valeur figure dans l'infobulle, la légende et le panneau de détail.",
          rh
            ? `Un groupe de moins de ${MIN_GROUP_SIZE} personnes est signalé « petit effectif » : ses taux sont peu fiables.`
            : `Aucun taux n'est affiché sur un groupe de moins de ${MIN_GROUP_SIZE} personnes, ni quand il permettrait de le déduire.`,
        ]}
      >
        Visualiser qui encadre qui, et repérer les équipes où le risque de départ ou l&apos;absentéisme se concentre.
      </PageIntro>
      <div className="mb-4 space-y-3">
        {ignored.length > 0 && <Notice tone="warning">Paramètre d&apos;adresse non reconnu, ignoré : {ignored.join(", ")}. L&apos;organigramme est coloré selon l&apos;effectif.</Notice>}
        {!dto.runAsOf && <Notice tone="info">Aucun calcul de risque n&apos;est publié : la part de collaborateurs en risque élevé ou moyen n&apos;est pas disponible.</Notice>}
        {rh && fixes > 0 && (
          <Notice tone="info">
            {fmt.int(fixes)} rattachement{fixes > 1 ? "s" : ""} corrigé{fixes > 1 ? "s" : ""} à l&apos;affichage : manager sorti ou absent de l&apos;import (collaborateur placé sous le plus proche
            responsable actif, sinon à la racine){stats.cycles > 0 ? `, boucle dans la hiérarchie (${fmt.int(stats.cycles)})` : ""}. À corriger dans AJIR.
          </Notice>
        )}
      </div>
      {stats.people === 0 ? (
        <EmptyState title="Aucun collaborateur actif rattaché" headingLevel={2}>
          {rh
            ? "Aucun collaborateur actif à la date de référence. Importez un export AJIR pour construire l'organigramme."
            : "Aucun collaborateur actif ne vous est rattaché dans le dernier import AJIR. Si c'est une erreur, contactez la RH."}
        </EmptyState>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            <KpiTile label="Collaborateurs actifs" value={fmt.int(stats.people)} period={`Au ${formatDate(dto.referenceDate)}`} />
            <KpiTile label="Responsables d'équipe" value={fmt.int(stats.managers)} hint="Personnes ayant au moins un collaborateur actif rattaché" />
            <KpiTile label="Niveaux hiérarchiques" value={fmt.int(stats.depth)} hint={rh ? "Sous la racine « Entreprise »" : "Sous vous"} />
          </div>
          <OrgChartView dto={dto} colorBy={q.couleur} />
        </>
      )}
    </>
  );
}
