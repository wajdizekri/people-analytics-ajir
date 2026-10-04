import type { ReactNode } from "react";
import { Card, EmptyState, Notice, SectionHeader, fmt, tableCls } from "@/components/ui";
import { VisualCard } from "@/components/charts/pbi";
import { TermTip } from "@/components/help";
import type { Role } from "@/db/schema";
import type { DepartureProfilesDto } from "@/lib/dal/typology";
import type { ProfileAggregate } from "@/lib/ai/typology/aggregate";
import { STABILITY_TEXT, departuresText, monthsLabel, profilesChart, shareText } from "./profiles-chart";
import { ReadingNotes } from "./sections";

const SECTION_ID = "profils-departs";
const DESCRIPTION = "Familles de démissions et d'abandons de poste qui se ressemblent, d'après les données professionnelles du mois précédant le départ.";

function Frame({ role, children }: { role: Role; children: ReactNode }) {
  return (
    <section aria-labelledby={SECTION_ID} className="mt-8 space-y-4">
      <SectionHeader id={SECTION_ID} title="Profils de départs" description={DESCRIPTION} tip={<TermTip term="profilDepart" role={role} />} />
      {children}
    </section>
  );
}

function ProfileCard({ p, minGroup }: { p: ProfileAggregate; minGroup: number }) {
  return (
    <Card
      title={p.label}
      headingLevel={3}
      className="h-full"
      description={p.masked ? `Effectif non affiché : moins de ${minGroup} départs` : `${departuresText(p.departures ?? 0)} · ${shareText(p.share)} des départs classés`}
    >
      {!p.masked && (
        <p className="text-sm text-fg-muted">
          Ancienneté médiane au départ : <span className="font-semibold tabular-nums text-fg">{monthsLabel(p.medianTenureMonths)}</span>
        </p>
      )}
      <p className="mt-3 text-[13px] font-semibold text-fg">Ce qui distingue ce profil</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed text-fg-muted">
        {p.traits.map((t) => (
          <li key={t.text}>{t.text}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-fg-subtle">Stabilité du profil : {STABILITY_TEXT(p.stability).toLowerCase()}</p>
    </Card>
  );
}

function DepartmentTable({ data }: { data: DepartureProfilesDto }) {
  const labelOf = new Map(data.profiles.map((p) => [p.id, p.label]));
  return (
    <section aria-labelledby="profils-departements" className="min-w-0">
      <SectionHeader
        id="profils-departements"
        level={3}
        title="Profil le plus fréquent par département"
        description={`Départements d'au moins ${data.minGroupSize} départs classés ; profil cité s'il réunit au moins ${data.minGroupSize} départs.`}
      />
      <div className={`${tableCls.wrap} rounded-card border border-line bg-surface`}>
        <table className={tableCls.table}>
          <caption className="sr-only">Profil de départ le plus fréquent par département</caption>
          <thead className={tableCls.thead}>
            <tr>
              <th scope="col" className={tableCls.th}>
                Département
              </th>
              <th scope="col" className={`${tableCls.th} ${tableCls.num}`}>
                Départs classés
              </th>
              <th scope="col" className={tableCls.th}>
                Profil le plus fréquent
              </th>
              <th scope="col" className={`${tableCls.th} ${tableCls.num}`}>
                Part dans le département
              </th>
            </tr>
          </thead>
          <tbody>
            {data.departments.map((d) => (
              <tr key={d.department} className={tableCls.tr}>
                <th scope="row" className={`${tableCls.td} font-normal`}>
                  {d.department}
                </th>
                <td className={`${tableCls.td} ${tableCls.num}`}>{fmt.int(d.departures)}</td>
                <td className={tableCls.td}>{d.topProfileId != null ? labelOf.get(d.topProfileId) : <span className="text-fg-subtle">Aucun profil dominant</span>}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{shareText(d.topShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.otherDepartments > 0 && (
        <p className="mt-2 text-xs text-fg-muted">
          {departuresText(data.otherDepartments)} dans des départements de moins de {data.minGroupSize} départs classés, non détaillés.
        </p>
      )}
    </section>
  );
}

// Section « Profils de départs » de la page Rétention (RH seule) : parts par profil, une carte par profil, détail par
// département, encarts « Comment lire » et « Limites ». Lecture descriptive, non causale ; aucun collaborateur n'est nommé.
export function DepartureProfiles({ data, role }: { data: DepartureProfilesDto; role: Role }) {
  if (data.status === "MODELE_ABSENT")
    return (
      <Frame role={role}>
        <EmptyState title="Profils de départs non disponibles" icon="users" compact>
          Le modèle de profils n&apos;est pas installé sur ce serveur. L&apos;administrateur de l&apos;outil peut l&apos;ajouter lors d&apos;une mise à jour.
        </EmptyState>
      </Frame>
    );
  if (data.status === "MODELE_INVALIDE")
    return (
      <Frame role={role}>
        <Notice tone="warning">
          Le modèle de profils de départs n&apos;a pas passé le contrôle de cohérence. Les profils ne sont pas affichés ; prévenez l&apos;administrateur de l&apos;outil.
        </Notice>
      </Frame>
    );
  if (data.status === "TROP_PEU")
    return (
      <Frame role={role}>
        <EmptyState title="Trop peu de départs volontaires pour décrire des profils" icon="users" compact>
          {departuresText(data.classified)} classé{data.classified > 1 ? "s" : ""} à ce jour ; il en faut au moins {data.minDepartures}. Les profils apparaîtront avec
          l&apos;historique.
        </EmptyState>
      </Frame>
    );

  const shown = data.profiles.filter((p) => !p.masked && p.share != null);
  const top = [...shown].sort((a, b) => (b.share ?? 0) - (a.share ?? 0))[0];
  const cards = [...data.profiles].sort((a, b) => Number(a.masked) - Number(b.masked) || (b.share ?? 0) - (a.share ?? 0));
  const period = data.firstExit && data.lastExit ? `départs du ${fmt.date(data.firstExit)} au ${fmt.date(data.lastExit)}` : `données au ${fmt.date(data.referenceDate)}`;
  return (
    <Frame role={role}>
      {data.maskedProfiles > 0 && (
        <Notice>
          {data.maskedProfiles > 1 ? `${data.maskedProfiles} profils ne sont pas chiffrés` : "1 profil n'est pas chiffré"} : moins de {data.minGroupSize} départs, ou chiffre
          déductible par différence avec le total.
        </Notice>
      )}
      {top && (
        <VisualCard
          id="profils-parts"
          headingLevel={3}
          title={`Profil le plus fréquent : « ${top.label} », ${shareText(top.share)} des départs classés`}
          chart={profilesChart(data.profiles)}
          measure="Part des départs volontaires classés"
          unit="%"
          scope="Toute l'entreprise"
          period={period}
          footnote={
            <>
              {departuresText(data.classified)} classés sur {fmt.int(data.total)} départs volontaires ; {fmt.int(data.unclassified)} non classés. Profils construits hors ligne
              par la méthode des k-moyennes ({fmt.model(data.model?.version)}).
            </>
          }
        />
      )}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Description de chaque profil de départ">
        {cards.map((p) => (
          <li key={p.id} className="min-w-0">
            <ProfileCard p={p} minGroup={data.minGroupSize} />
          </li>
        ))}
      </ul>
      {data.departments.length > 0 && <DepartmentTable data={data} />}
      <ReadingNotes
        headingLevel={3}
        helpHref="/aide#glossaire"
        reading={[
          "Chaque profil regroupe des départs volontaires qui se ressemblent sur leurs données professionnelles du mois précédant la démission.",
          "Les traits disent ce qui distingue le profil de l'ensemble des départs : ce sont des facteurs associés, pas des causes.",
          "Aucun collaborateur n'est étiqueté : le rattachement à un profil sert seulement à compter.",
          "Les profils décrivent les départs passés ; ils ne prédisent pas qui partira.",
          "Stabilité : le profil se retrouve-t-il quand on refait le regroupement sur des échantillons tirés au hasard ?",
        ]}
        limits={[
          "Estimation descriptive et non causale, construite hors ligne sur l'historique des départs.",
          "Sexe, âge, situation familiale, gouvernorat et données de santé ne sont jamais utilisés.",
          `Un profil de moins de ${data.minGroupSize} départs n'est pas chiffré. À l'entraînement, chaque profil réunit au moins ${data.model?.minProfileSize ?? data.minGroupSize} départs.`,
          `${departuresText(data.unclassified)} non classé${data.unclassified > 1 ? "s" : ""} : aucune donnée le mois précédant la démission (arrivée récente, contrat non suivi) ou opposition au traitement.`,
          "Département et famille de métier : derniers connus avant le départ.",
          "Données simulées : les profils illustrent la méthode, pas une entreprise réelle.",
        ]}
      />
    </Frame>
  );
}
