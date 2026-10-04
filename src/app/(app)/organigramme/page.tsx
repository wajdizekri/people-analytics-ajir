import { headers } from "next/headers";
import { ButtonLink, EmptyState, Notice, PageHeader, fmt } from "@/components/ui";
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
  const figures = [
    { label: "Responsables d'équipe", value: stats.managers },
    { label: "Niveaux hiérarchiques", value: stats.depth },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Collaborateurs"
        title="Organigramme"
        subtitle={
          rh
            ? `Un nœud = un responsable d'équipe. Moins de ${MIN_GROUP_SIZE} personnes : « petit effectif », taux peu fiable.`
            : `Un nœud = un responsable d'équipe. Hors rémunération ; aucun taux sous ${MIN_GROUP_SIZE} personnes.`
        }
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
      <div className="mb-4 space-y-3 empty:hidden">
        {ignored.length > 0 && <Notice tone="warning">Paramètre ignoré : {ignored.join(", ")}</Notice>}
        {!dto.runAsOf && <Notice tone="info">Risque de départ non calculé</Notice>}
        {rh && fixes > 0 && (
          <Notice tone="info" title={`${fmt.int(fixes)} rattachement${fixes > 1 ? "s" : ""} corrigé${fixes > 1 ? "s" : ""} à l'affichage`}>
            Manager sorti ou absent de l&apos;import{stats.cycles > 0 ? ` · boucle hiérarchique (${fmt.int(stats.cycles)})` : ""} · à corriger dans AJIR
          </Notice>
        )}
      </div>
      {stats.people === 0 ? (
        <EmptyState title="Aucun collaborateur actif rattaché" headingLevel={2} />
      ) : (
        <>
          <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {figures.map((f) => (
              <div key={f.label} className="flex items-baseline gap-1.5">
                <dt className="text-fg-muted">{f.label}</dt>
                <dd className="font-semibold tabular-nums text-heading">{fmt.int(f.value)}</dd>
              </div>
            ))}
          </dl>
          <OrgChartView dto={dto} colorBy={q.couleur} />
        </>
      )}
    </>
  );
}
