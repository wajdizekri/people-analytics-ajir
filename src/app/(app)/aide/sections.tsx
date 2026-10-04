import Link from "next/link";
import type { ReactNode } from "react";
import type { Role } from "@/db/schema";
import type { HelpSettings } from "@/lib/dal/help";
import { FAQ, FAQ_TOPICS, GLOSSARY, KPIS, ROLE_SCOPE, SCREENS, START, factorGroups, forRole, type FaqTopic, type SectionId } from "@/lib/help/content";
import { TERMS, type TermId } from "@/lib/help/terms";
import { Definition, DefinitionList, LevelExplainer, formatCapacity } from "@/components/help";
import { ButtonLink, Icon, Notice, fmt } from "@/components/ui";

type P = { role: Role; s: HelpSettings };

const link = "text-link underline underline-offset-2";
const num = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-5 text-sm font-semibold text-heading first:mt-0">{children}</h3>;
}

function Bullets({ items, className = "" }: { items: ReactNode[]; className?: string }) {
  return (
    <ul className={`list-disc space-y-1 pl-5 ${className}`}>
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

// Détail secondaire replié par défaut
function Fold({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="group mt-2 rounded-control border border-line">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-1.5 font-medium text-fg transition-colors duration-150 hover:bg-surface-3 group-open:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <Icon name="chevron-right" className="h-4 w-4 text-link transition-transform duration-200 group-open:rotate-90" />
        {title}
      </summary>
      <div className="px-3 pb-3 pl-9 pt-1 text-fg-muted">{children}</div>
    </details>
  );
}

function TermDefinitions({ ids }: { ids: TermId[] }) {
  return (
    <DefinitionList>
      {ids.map((id) => (
        <Definition key={id} term={TERMS[id].label}>
          {TERMS[id].text}
        </Definition>
      ))}
    </DefinitionList>
  );
}

function Screens({ role }: P) {
  const items = forRole(SCREENS, role);
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.href}>
          <dt>
            <Link href={i.href} className={`font-medium ${link}`}>
              {i.labels?.[role] ?? i.label}
            </Link>
          </dt>
          <dd className="text-fg-muted">{i.purpose}</dd>
        </div>
      ))}
    </dl>
  );
}

function Risk({ role, s }: P) {
  const staff = role !== "MANAGER";
  const k = Math.max(1, Math.round(1000 * s.capacityRate));
  const groups = factorGroups(role);
  const model = s.modelKind === "B0" ? "Modèle actuel : score à règles. Ses points classent les collaborateurs ; ce n'est pas un pourcentage." : s.modelKind ? "Modèle actuel : probabilité à 6 mois." : "Aucun modèle en service pour le moment.";
  return (
    <>
      <H3>Ce que l&apos;application estime</H3>
      <Bullets
        items={[
          "Le risque de départ volontaire (démission, abandon de poste) dans les 6 mois.",
          "Calcul mensuel, pour chaque collaborateur évalué.",
          "Hors champ : fin de CDD, retraite, licenciement, mutation.",
          ...(staff
            ? [
                <>
                  Forme : <strong>probabilité à 6 mois</strong> (en %) ou <strong>score à règles</strong> (en points), selon le modèle en service.
                </>,
                model,
              ]
            : []),
          ...(role === "RH" ? ["Le manager ne voit jamais ce chiffre, seulement le niveau de risque."] : []),
        ]}
      />

      <H3>Les niveaux de risque</H3>
      <LevelExplainer capacityRate={s.capacityRate} mediumLift={s.mediumLift} role={role} />

      <H3>La capacité d&apos;entretiens RH</H3>
      <Bullets
        items={[
          "Le niveau Élevé dépend du nombre d'entretiens que la RH peut mener chaque mois, pas d'un seuil fixe.",
          <>
            Capacité de {formatCapacity(s.capacityRate)} : sur 1 000 collaborateurs évalués, {fmt.int(k)} au plus sont classés Élevé.
          </>,
          "Ex æquo à la limite : aucun n'est classé Élevé ; le nombre réel peut donc être inférieur.",
          ...(role === "ADMIN"
            ? [
                <>
                  Réglage de la capacité et du seuil Moyen :{" "}
                  <Link href="/admin/settings" className={link}>
                    Paramètres
                  </Link>
                </>,
              ]
            : []),
        ]}
      />

      {staff && (
        <>
          <H3>Le lift</H3>
          <Bullets
            items={[
              "Estimation d'un collaborateur rapportée à la moyenne des évalués : un lift de 3 signifie un risque 3 fois plus élevé que la moyenne.",
              `Niveau Moyen : lift d'au moins ${num(s.mediumLift)}.`,
              "« Lift à la capacité » (écran Transparence) : combien de fois plus les collaborateurs classés Élevé ont réellement démissionné, sur le passé.",
            ]}
          />
        </>
      )}

      <H3>Pourquoi ce n&apos;est pas une certitude</H3>
      <Bullets
        items={[
          "Un départ dépend de nombreux éléments absents des données : offre extérieure, projet personnel, relation de travail.",
          "L'estimation repose sur ce qui a été observé dans le passé. Elle signale une exposition, elle ne prévoit pas une décision.",
          "Même au niveau Élevé, la plupart des collaborateurs restent. À l'inverse, des départs surviennent au niveau Faible.",
          "Le niveau de risque ne doit jamais fonder seul une décision sur une personne : il invite à un échange.",
          ...(role === "RH" ? ["La vérification a posteriori montre, pour une date passée, combien de collaborateurs de chaque niveau ont réellement démissionné ensuite."] : []),
        ]}
      />

      <H3>Facteurs associés, pas causes</H3>
      <Bullets
        items={[
          "Pour chaque collaborateur évalué : les familles de facteurs qui pèsent le plus dans l'estimation.",
          "Un facteur associé va souvent de pair avec les départs, sans en être la cause démontrée.",
          "Seul un échange permet de comprendre la situation.",
          ...(role === "MANAGER" ? ["Catégorie Rémunération absente quand le calcul repose sur un score à règles.", "Absences individuelles : jamais présentées au manager."] : []),
        ]}
      />
      <ul className="mt-2 space-y-1.5">
        {groups.map((g) => (
          <li key={g.code}>
            <span className="font-medium text-fg">{g.label}</span> : {g.summary}.
            {g.variables.length > 0 && (
              <details className="mt-0.5">
                <summary className={`cursor-pointer text-xs ${link}`}>
                  Variables utilisées<span className="sr-only"> : {g.label}</span>
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-fg-muted">
                  {g.variables.map((v) => (
                    <li key={v.name}>{v.text}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
      </ul>

      <H3>Ce qui n&apos;est jamais utilisé</H3>
      <Bullets
        items={[
          "Absences pour maladie et maternité.",
          "Sexe, âge, situation familiale, gouvernorat.",
          "Âge : seulement pour exclure les collaborateurs proches de la retraite.",
          `Sexe et âge : seulement pour vérifier l'équité du calcul${staff ? " (rapport d'équité, écran Transparence)" : ""}.`,
        ]}
      />

      {role === "MANAGER" && (
        <div className="mt-3">
          <Notice>Visible : niveau de risque et catégories de facteurs. Jamais un pourcentage ni un salaire.</Notice>
        </div>
      )}
      {role === "ADMIN" && (
        <div className="mt-3">
          <Notice>Aucune estimation individuelle visible. Règle de décision et suivi du modèle : écran Transparence du modèle.</Notice>
        </div>
      )}
    </>
  );
}

function Dashboard({ role }: P) {
  return (
    <>
      <Bullets
        items={[
          "Période : 3 à 24 derniers mois, au choix.",
          role === "RH" ? "Population filtrable : département, contrat, tranche d'âge, ancienneté." : "Périmètre : votre hiérarchie, éventuellement limitée à un département.",
        ]}
      />
      <H3>Repères de lecture</H3>
      <Bullets
        items={[
          "La période est rappelée au-dessus des indicateurs, par exemple « mars 2025 – août 2026 (18 mois) ».",
          "La variation compare le premier et le dernier mois de la période ; pour un taux, elle est en points (pt).",
          "La flèche indique le sens de l'évolution ; le vert signale une évolution favorable, le rouge une évolution défavorable.",
          "Un clic sur un indicateur ou sur un nombre ouvre la liste des collaborateurs concernés.",
          "« — » signifie que la valeur n'est pas disponible : historique insuffisant ou groupe trop petit.",
          "Le filtre Niveau de risque s'applique au bloc risque et à la liste, pas aux indicateurs d'effectif.",
          "Le bouton « ? » à côté d'un indicateur en rappelle la définition.",
        ]}
      />
      <H3>Les indicateurs</H3>
      <DefinitionList>
        {forRole(KPIS, role).map((k) => (
          <Definition key={k.id} term={k.label} formula={k.formula} scope={k.scope} exclusions={k.exclusions} unit={k.unit} period={k.period}>
            {k.definition}
          </Definition>
        ))}
      </DefinitionList>
      {role === "MANAGER" && (
        <div className="mt-3">
          <Notice tone="amber">{TERMS.petitsGroupes.text} Les indicateurs sont calculés hors rémunération.</Notice>
        </div>
      )}
    </>
  );
}

function Absenteeism({ role, s }: P) {
  return (
    <>
      <H3>Le taux d&apos;absence</H3>
      <DefinitionList>
        <Definition
          term="Taux d'absence hors santé non planifié"
          formula="Jours d'absence comptés divisés par les jours ouvrés de présence de chaque collaborateur du groupe."
          scope={role === "RH" ? "Par département ou par équipe ; 8 courbes au plus (les taux les plus élevés)." : "Vos équipes ; un taux n'est affiché que pour un groupe d'au moins 5 personnes."}
          exclusions="Maladie, maternité et congés annuels. Sont comptés : absence injustifiée, congé sans solde, autre absence."
          unit="%"
          period="Par semaine (26 dernières semaines) ou par mois (12 derniers mois), au choix."
        >
          Part du temps de travail perdue en absences non prévues, pour chaque groupe.
        </Definition>
      </DefinitionList>

      <H3>Les anomalies collectives</H3>
      <Bullets
        items={[
          "Chaque semaine, chaque équipe ou département d'au moins 5 personnes est comparé à son taux attendu.",
          "Taux attendu : niveau habituel des 26 semaines précédentes, ajusté au calendrier (Ramadan, jours fériés et ponts, séance unique).",
          "Anomalie : taux nettement au-dessus de l'attendu deux semaines de suite.",
          "Un signal à comprendre (pic saisonnier, événement d'équipe, erreur de saisie), pas un constat de faute.",
          "Maladie et maternité ne comptent jamais, ni dans les taux ni dans les signaux.",
        ]}
      />

      {role === "RH" && (
        <>
          <H3>Les signaux individuels à vérifier</H3>
          <p>
            {TERMS.bradford.text}
            {s.bradfordThreshold != null && ` Seuil actuel : ${fmt.int(s.bradfordThreshold)}.`}
          </p>
          <Bullets
            className="mt-2"
            items={[
              "Réservés à la RH, jamais transmis au manager.",
              "À vérifier avant toute démarche : une absence autorisée mal enregistrée dans AJIR peut suffire à déclencher un signal.",
            ]}
          />
        </>
      )}
    </>
  );
}

function Recommendations({ role }: P) {
  return (
    <>
      <H3>D&apos;où viennent les recommandations</H3>
      <Bullets
        items={[
          "Entretien de rétention : pour tout collaborateur au niveau Élevé.",
          ...(role === "RH" ? ["Revue de la rémunération : quand la rémunération fait partie des principaux facteurs (réservée à la RH)."] : []),
          "Revue de la charge de travail : quand le temps de travail fait partie des principaux facteurs.",
          "Plan de formation et de développement : quand la formation ou l'évaluation fait partie des principaux facteurs.",
          "Une aide à la décision, jamais une obligation.",
        ]}
      />

      {role === "MANAGER" ? (
        <>
          <H3>Dans la fiche collaborateur</H3>
          <Bullets items={["Zone Suggestions, en lecture seule.", "Traitement par la RH, qui peut vous solliciter pour un échange."]} />
        </>
      ) : (
        <>
          <H3>Traiter une recommandation</H3>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Ouvrez la fiche du collaborateur, zone Suggestions, ou l&apos;écran Recommandations.</li>
            <li>Marquez-la réalisée, avec la date de l&apos;intervention, ou rejetée, avec un commentaire obligatoire.</li>
            <li>Indiquez ensuite si elle était pertinente : ce retour sert à améliorer les propositions.</li>
          </ol>
          <H3>Suivre l&apos;adoption</H3>
          <DefinitionList>
            <Definition term="Taux d'adoption" formula="Recommandations réalisées divisées par les recommandations décidées (réalisées ou rejetées)." unit="%">
              Part des recommandations décidées qui ont été mises en œuvre.
            </Definition>
            <Definition term="Jugées pertinentes" formula="Retours « Pertinente » divisés par le nombre de retours donnés." unit="%">
              Avis de la RH sur la qualité des propositions.
            </Definition>
            <Definition term="Interventions enregistrées" unit="nombre">
              Actions réalisées et datées. L&apos;application en garde la trace ; elle ne mesure pas leur effet sur les départs.
            </Definition>
          </DefinitionList>
        </>
      )}
    </>
  );
}

function Alerts({ role }: P) {
  const types = [
    { label: "Turnover", text: "un collaborateur de votre périmètre passe au niveau Élevé.", roles: ["RH", "MANAGER"] as Role[] },
    {
      label: "Absentéisme",
      text: role === "RH" ? "anomalie collective ou signal individuel à vérifier." : "anomalie collective dans une de vos équipes.",
      roles: ["RH", "MANAGER"] as Role[],
    },
    { label: "Données", text: "import bloqué ou problème de qualité des données.", roles: ["RH", "ADMIN"] as Role[] },
    { label: "Système", text: "service de calcul arrêté ou traitement en échec.", roles: ["ADMIN"] as Role[] },
  ];
  return (
    <>
      <H3>Types d&apos;alertes</H3>
      <Bullets
        items={forRole(types, role).map((t) => (
          <>
            <span className="font-medium text-fg">{t.label}</span> : {t.text}
          </>
        ))}
      />
      <H3>Gravité et suivi</H3>
      <Bullets
        items={[
          "Seules les alertes de votre périmètre sont visibles.",
          "Gravité : Information, Attention ou Critique.",
          "Statut : Nouvelle, puis En cours, puis Traitée ou Rejetée. Un commentaire explique la décision.",
          ...(role === "ADMIN" ? [] : ["Une alerte Turnover est une estimation à confirmer lors d'un échange, pas une annonce de départ."]),
        ]}
      />
    </>
  );
}

function DataQuality({ role, s }: P) {
  const threshold = s.qualityThreshold != null ? fmt.pct(s.qualityThreshold, 0) : "—";
  return (
    <>
      <Bullets
        items={["Import mensuel de l'export AJIR (un dossier de fichiers CSV).", "24 contrôles par ligne avant utilisation.", "« Données AJIR au » : date du dernier pointage importé."]}
      />
      <H3>Les trois effets d&apos;un contrôle</H3>
      <p>{TERMS.gravite.text}</p>
      <Fold title="Exemples de contrôles">
        <ul className="list-disc space-y-1 pl-5">
          <li>Rejets : date invalide, doublon, matricule inconnu, salaire de base sous le SMIG hors stage et SIVP, pointage dans le futur.</li>
          <li>Corrections : grade inconnu, manager introuvable.</li>
          <li>Avertissements : pointage sans heure de sortie, paie manquante.</li>
        </ul>
      </Fold>
      <H3>Le score qualité et le blocage</H3>
      <DefinitionList>
        <Definition
          term="Score qualité"
          formula="Part des lignes acceptées (moyenne sur les fichiers) × complétude de la paie (part des collaborateurs actifs ayant une paie le dernier mois importé)."
          unit="%"
          period="Un score par import."
        >
          Mesure la fiabilité d&apos;un import. Seuil actuel : {threshold}. En dessous, l&apos;import est « Bloqué » : aucun nouveau calcul n&apos;est publié et les écrans
          gardent le dernier calcul.
        </Definition>
        <Definition term="Fraîcheur des données" unit="jours">
          {TERMS.fraicheur.text}
        </Definition>
        <Definition term="Service de calcul (worker)">
          {TERMS.worker.text} Il est « Actif » s&apos;il a donné signe de vie depuis moins de 2 minutes, « En retard » jusqu&apos;à 10 minutes, « Arrêté » au-delà.
        </Definition>
      </DefinitionList>
      <H3>Qui fait quoi</H3>
      {role === "ADMIN" ? (
        <Bullets
          items={[
            <>
              Téléversement d&apos;un export et relance du calcul :{" "}
              <Link href="/data-health" className={link}>
                Santé des données
              </Link>
            </>,
            <>
              Seuil qualité :{" "}
              <Link href="/admin/settings" className={link}>
                Paramètres
              </Link>
            </>,
          ]}
        />
      ) : (
        <Bullets items={["Imports et relance du calcul : l'administrateur.", "Suivi du résultat : écran Santé des données."]} />
      )}
    </>
  );
}

function Model({ role }: P) {
  return (
    <>
      <Bullets
        items={[
          "Écran Transparence du modèle : méthode de calcul en service, performances mesurées sur des périodes passées, rapport d'équité, paramètres de décision.",
          "Badge « Dans la cible » ou « Hors cible » : selon des cibles fixées avant l'entraînement.",
        ]}
      />
      <H3>Indicateurs de performance</H3>
      <TermDefinitions ids={["auc", "liftCapacite", "observePrevu", "penteCalibration", "equite", "variables"]} />
      <H3>Statuts d&apos;un modèle</H3>
      <Bullets
        items={["Candidat : enregistré, pas utilisé.", "Champion : en service.", "Retiré : plus utilisé.", "Mise en service : hors de l'interface, par une procédure vérifiée et tracée."]}
      />
      {role === "RH" && (
        <>
          <H3>Vérification a posteriori</H3>
          <p>{TERMS.backtest.text}</p>
          <Bullets
            className="mt-2"
            items={["Ne mesure pas l'effet des actions menées entre-temps.", "Date ayant servi à l'entraînement du modèle : résultat signalé comme optimiste."]}
          />
          <div className="mt-2">
            <TermDefinitions ids={["dateOrigine", "tauxBase", "precision", "rappel"]} />
          </div>
        </>
      )}
    </>
  );
}

function Privacy({ role }: P) {
  const scope = ROLE_SCOPE[role];
  return (
    <>
      <H3>Principes</H3>
      <Bullets
        items={[
          "Les données viennent d'AJIR et servent uniquement à l'aide à la décision RH.",
          "Chaque rôle a son périmètre, vérifié par le serveur à chaque écran : l'administrateur gère l'outil sans voir de données RH, le manager ne voit que sa hiérarchie.",
          "Les absences pour maladie et maternité ne servent jamais à estimer un risque ni à créer un signal individuel.",
          "Pour protéger l'anonymat, aucun indicateur n'est montré au manager pour un groupe de moins de 5 personnes.",
        ]}
      />
      <H3>Ce que votre rôle voit</H3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-medium text-fg">Vous voyez</p>
          <Bullets items={scope.sees} />
        </div>
        <div>
          <p className="font-medium text-fg">Vous ne voyez pas</p>
          <Bullets items={scope.neverSees} />
        </div>
      </div>
      <H3>Traçabilité</H3>
      <Bullets
        items={[
          "Journal des consultations sensibles : ni modifiable, ni effaçable.",
          "Actions tracées : ouverture d'une fiche, consultation d'un salaire ou d'une estimation, export, simulation, changement de paramètre, accès refusé.",
          ...(role === "ADMIN"
            ? [
                <>
                  Consultation :{" "}
                  <Link href="/admin/audit" className={link}>
                    Journal d&apos;audit
                  </Link>
                </>,
              ]
            : []),
        ]}
      />
      <H3>Cadre légal et droits des collaborateurs</H3>
      <Bullets
        items={[
          "Loi organique n° 2004-63 du 27 juillet 2004 relative à la protection des données à caractère personnel.",
          "Responsable du traitement : l'entreprise. Autorité de contrôle : INPDP.",
          "Droit d'accès : connaître les données qui le concernent.",
          "Droit d'opposition au calcul de son risque : il n'est alors plus évalué.",
          role === "RH" ? (
            <>
              Traitement des demandes :{" "}
              <Link href="/confidentialite" className={link}>
                Droit d&apos;accès
              </Link>
            </>
          ) : (
            "Demandes à transmettre à la RH."
          ),
        ]}
      />
    </>
  );
}

function Start({ role }: P) {
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {START[role].map((step, i) => (
        <li key={step.href} className="flex flex-col rounded-control border border-line bg-surface-2 p-4">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-fg">
              {i + 1}
            </span>
            <span className="font-semibold text-heading">
              <span className="sr-only">Étape {i + 1} : </span>
              {step.title}
            </span>
          </span>
          <span className="mt-2 flex-1 text-fg-muted">{step.text}</span>
          <ButtonLink href={step.href} variant="secondary" iconEnd="arrow-right" className="mt-3 self-start">
            {step.cta}
          </ButtonLink>
        </li>
      ))}
    </ol>
  );
}

function Faq({ role }: P) {
  const items = forRole(FAQ, role);
  const topics = (Object.keys(FAQ_TOPICS) as FaqTopic[]).filter((t) => items.some((f) => f.topic === t));
  return (
    <>
      {topics.map((topic) => (
        <div key={topic}>
          <H3>{FAQ_TOPICS[topic]}</H3>
          <div className="divide-y divide-line overflow-hidden rounded-control border border-line">
            {items
              .filter((f) => f.topic === topic)
              .map((f, i) => (
                <details key={i} className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-fg transition-colors duration-150 hover:bg-surface-3 group-open:bg-surface-2 [&::-webkit-details-marker]:hidden">
                    <Icon name="chevron-right" className="h-4 w-4 text-link transition-transform duration-200 group-open:rotate-90" />
                    {f.q}
                  </summary>
                  <p className="px-3 pb-3 pl-8 text-fg-muted">{f.a}</p>
                </details>
              ))}
          </div>
        </div>
      ))}
    </>
  );
}

function Glossary({ role }: P) {
  const entries = forRole(GLOSSARY, role).sort((a, b) => a.term.localeCompare(b.term, "fr"));
  return (
    <DefinitionList>
      {entries.map((g) => (
        <Definition key={g.term} term={g.term}>
          {g.definition}
        </Definition>
      ))}
    </DefinitionList>
  );
}

export const SECTION_BODY: Record<SectionId, (p: P) => ReactNode> = {
  commencer: Start,
  ecrans: Screens,
  risque: Risk,
  "tableau-de-bord": Dashboard,
  absenteisme: Absenteeism,
  recommandations: Recommendations,
  alertes: Alerts,
  "qualite-donnees": DataQuality,
  modele: Model,
  confidentialite: Privacy,
  faq: Faq,
  glossaire: Glossary,
};
