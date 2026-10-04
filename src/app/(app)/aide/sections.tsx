import Link from "next/link";
import type { ReactNode } from "react";
import type { Role } from "@/db/schema";
import type { HelpSettings } from "@/lib/dal/help";
import { FAQ, FAQ_TOPICS, GLOSSARY, KPIS, ROLE_LABEL, ROLE_SCOPE, SCREENS, START, factorGroups, forRole, type FaqTopic, type SectionId } from "@/lib/help/content";
import { TERMS, type TermId } from "@/lib/help/terms";
import { Definition, DefinitionList, LevelExplainer, formatCapacity } from "@/components/help";
import { ButtonLink, Icon, Notice, fmt } from "@/components/ui";

type P = { role: Role; s: HelpSettings };

const link = "text-link underline underline-offset-2";
const num = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 mt-5 text-sm font-semibold text-heading first:mt-0">{children}</h3>;
}

function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
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
    <>
      <p>Les écrans ci-dessous sont ceux de votre rôle ; le menu donne le même accès. Chaque écran commence par un encart « À quoi sert cette page ».</p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
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
    </>
  );
}

function Risk({ role, s }: P) {
  const staff = role !== "MANAGER";
  const k = Math.max(1, Math.round(1000 * s.capacityRate));
  const groups = factorGroups(role);
  return (
    <>
      <H3>Ce que l&apos;application estime</H3>
      <p>
        Chaque mois, l&apos;application estime pour chaque collaborateur évalué le risque qu&apos;il quitte volontairement l&apos;entreprise (démission ou abandon de poste)
        dans les 6 mois suivants. Les autres départs (fin de CDD, retraite, licenciement, mutation) ne sont pas visés.
      </p>
      {staff && (
        <p className="mt-2">
          Selon le modèle en service, l&apos;estimation est une <strong>probabilité à 6 mois</strong> (en %) ou un <strong>score à règles</strong> (en points).
          {s.modelKind === "B0" && " Le modèle actuel est un score à règles : ses points servent à classer les collaborateurs, ils ne se lisent pas comme un pourcentage."}
          {s.modelKind && s.modelKind !== "B0" && " Le modèle actuel donne une probabilité à 6 mois."}
          {!s.modelKind && " Aucun modèle n'est en service pour le moment."}
          {role === "RH" && " Le manager ne voit jamais ce chiffre : seulement le niveau de risque."}
        </p>
      )}

      <H3>Les niveaux de risque</H3>
      <LevelExplainer capacityRate={s.capacityRate} mediumLift={s.mediumLift} role={role} />

      <H3>La capacité d&apos;entretiens RH</H3>
      <p>
        Le niveau Élevé ne dépend pas d&apos;un seuil fixe mais du nombre d&apos;entretiens que la RH peut mener chaque mois. Avec une capacité de{" "}
        {formatCapacity(s.capacityRate)} et 1 000 collaborateurs évalués, {fmt.int(k)} au plus sont classés Élevé. Si plusieurs collaborateurs ont exactement la même
        estimation à la limite, aucun d&apos;eux n&apos;est classé Élevé : le nombre réel peut donc être inférieur.
        {role === "ADMIN" && (
          <>
            {" "}
            La capacité et le seuil du niveau Moyen se règlent dans{" "}
            <Link href="/admin/settings" className={link}>
              Paramètres
            </Link>
            .
          </>
        )}
      </p>

      {staff && (
        <>
          <H3>Le lift</H3>
          <p>
            Le lift compare l&apos;estimation d&apos;un collaborateur à la moyenne des collaborateurs évalués : un lift de 3 signifie un risque 3 fois plus élevé que la
            moyenne. Le niveau Moyen correspond à un lift d&apos;au moins {num(s.mediumLift)}. Le « lift à la capacité » de l&apos;écran Transparence mesure, sur le passé,
            combien de fois plus les collaborateurs classés Élevé ont réellement démissionné.
          </p>
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
      <p>
        Pour chaque collaborateur évalué, l&apos;application indique les familles de facteurs qui pèsent le plus dans l&apos;estimation. Un facteur associé va souvent de
        pair avec les départs, sans en être la cause démontrée : de nombreuses heures supplémentaires peuvent accompagner un départ sans l&apos;expliquer. Seul un échange
        permet de comprendre la situation.
      </p>
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
      {role === "MANAGER" && (
        <p className="mt-2 text-fg-muted">
          La catégorie Rémunération n&apos;apparaît pas quand le calcul repose sur un score à règles. Les absences individuelles ne vous sont jamais présentées.
        </p>
      )}

      <H3>Ce qui n&apos;est jamais utilisé</H3>
      <p>
        Les absences pour maladie et maternité, le sexe, l&apos;âge, la situation familiale et le gouvernorat ne sont pas des variables du calcul. L&apos;âge sert
        seulement à exclure les collaborateurs proches de la retraite ; sexe et âge servent à vérifier l&apos;équité du calcul
        {staff ? " (rapport d'équité de l'écran Transparence)" : ""}.
      </p>

      {role === "MANAGER" && (
        <div className="mt-3">
          <Notice>Vous voyez le niveau de risque et les catégories de facteurs de vos collaborateurs, jamais un pourcentage ni un salaire.</Notice>
        </div>
      )}
      {role === "ADMIN" && (
        <div className="mt-3">
          <Notice>Vous ne voyez aucune estimation individuelle. Vous réglez la règle de décision et suivez le modèle dans l&apos;écran Transparence du modèle.</Notice>
        </div>
      )}
    </>
  );
}

function Dashboard({ role }: P) {
  return (
    <>
      <p>
        Le tableau de bord résume la situation sur la période choisie (3 à 24 derniers mois) pour{" "}
        {role === "RH" ? "la population filtrée : département, contrat, tranche d'âge, ancienneté." : "votre hiérarchie, éventuellement limitée à un département."}
      </p>
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
      <p>
        Chaque semaine, le taux de chaque équipe ou département d&apos;au moins 5 personnes est comparé au taux attendu. Le taux attendu part du niveau habituel du groupe
        sur les 26 semaines précédentes, ajusté au calendrier : Ramadan, jours fériés et ponts, séance unique. Une anomalie est signalée quand le taux dépasse nettement
        l&apos;attendu deux semaines de suite.
      </p>
      <p className="mt-2">Une anomalie est un signal à comprendre (pic saisonnier, événement d&apos;équipe, erreur de saisie), pas un constat de faute.</p>

      {role === "RH" && (
        <>
          <H3>Les signaux individuels à vérifier</H3>
          <p>
            {TERMS.bradford.text}
            {s.bradfordThreshold != null && ` Seuil actuel : ${fmt.int(s.bradfordThreshold)}.`}
          </p>
          <p className="mt-2">
            Ces signaux sont réservés à la RH et ne sont jamais transmis au manager. Vérifiez-les avant toute démarche : une absence autorisée mal enregistrée dans AJIR
            peut suffire à déclencher un signal.
          </p>
        </>
      )}
      <p className="mt-3 text-fg-muted">Les absences pour maladie et maternité ne comptent jamais, ni dans les taux ni dans les signaux.</p>
    </>
  );
}

function Recommendations({ role }: P) {
  return (
    <>
      <H3>D&apos;où viennent les recommandations</H3>
      <p>Pour chaque collaborateur au niveau Élevé ou Moyen, l&apos;application propose des actions liées aux facteurs qui pèsent le plus dans son estimation :</p>
      <Bullets
        items={[
          "Entretien de rétention : pour tout collaborateur au niveau Élevé.",
          ...(role === "RH" ? ["Revue de la rémunération : quand la rémunération fait partie des principaux facteurs (réservée à la RH)."] : []),
          "Revue de la charge de travail : quand le temps de travail fait partie des principaux facteurs.",
          "Plan de formation et de développement : quand la formation ou l'évaluation fait partie des principaux facteurs.",
        ]}
      />
      <p className="mt-2">Une recommandation est une aide à la décision, jamais une obligation.</p>

      {role === "MANAGER" ? (
        <p className="mt-2">
          Vous voyez les recommandations de vos collaborateurs dans leur fiche, zone Suggestions, sans pouvoir les modifier. La RH les traite et peut vous solliciter
          pour un échange.
        </p>
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
      <p>Une alerte signale un événement à examiner. Vous ne voyez que les alertes de votre périmètre.</p>
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
      <p>
        Chaque mois, l&apos;export AJIR (un dossier de fichiers CSV) est importé. Chaque ligne passe 24 contrôles avant d&apos;être utilisée. La date « Données AJIR au »
        affichée en haut des écrans correspond au dernier pointage importé.
      </p>
      <H3>Les trois effets d&apos;un contrôle</H3>
      <p>{TERMS.gravite.text}</p>
      <p className="mt-2 text-fg-muted">
        Exemples : date invalide, doublon, matricule inconnu, salaire de base sous le SMIG hors stage et SIVP, pointage dans le futur (rejets) ; grade inconnu, manager
        introuvable (corrections) ; pointage sans heure de sortie, paie manquante (avertissements).
      </p>
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
      {role === "ADMIN" ? (
        <p className="mt-3">
          Vous téléversez un export et relancez le calcul mensuel depuis{" "}
          <Link href="/data-health" className={link}>
            Santé des données
          </Link>
          . Le seuil qualité se règle dans{" "}
          <Link href="/admin/settings" className={link}>
            Paramètres
          </Link>
          .
        </p>
      ) : (
        <p className="mt-3">L&apos;administrateur téléverse les exports et relance le calcul ; vous suivez le résultat dans Santé des données.</p>
      )}
    </>
  );
}

function Model({ role }: P) {
  return (
    <>
      <p>
        L&apos;écran Transparence du modèle présente la méthode de calcul en service, ses performances mesurées sur des périodes passées, le rapport d&apos;équité et les
        paramètres de décision. Chaque indicateur porte un badge « Dans la cible » ou « Hors cible », selon des cibles fixées avant l&apos;entraînement.
      </p>
      <H3>Indicateurs de performance</H3>
      <TermDefinitions ids={["auc", "liftCapacite", "observePrevu", "penteCalibration", "equite", "variables"]} />
      <p className="mt-2 text-fg-muted">
        Statuts d&apos;un modèle : Candidat (enregistré, pas utilisé), Champion (en service), Retiré. La mise en service d&apos;un nouveau modèle se fait hors de
        l&apos;interface, par une procédure vérifiée et tracée.
      </p>
      {role === "RH" && (
        <>
          <H3>Vérification a posteriori</H3>
          <p>
            {TERMS.backtest.text} Elle ne mesure pas l&apos;effet des actions menées entre-temps. Si la date choisie a servi à l&apos;entraînement du modèle, un message
            signale que le résultat est optimiste.
          </p>
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
      <p>
        Les consultations sensibles sont enregistrées dans un journal qui ne peut être ni modifié ni effacé : ouverture d&apos;une fiche, consultation d&apos;un salaire ou
        d&apos;une estimation, export, simulation, changement de paramètre, accès refusé.
        {role === "ADMIN" && (
          <>
            {" "}
            Vous le consultez dans{" "}
            <Link href="/admin/audit" className={link}>
              Journal d&apos;audit
            </Link>
            .
          </>
        )}
      </p>
      <H3>Cadre légal et droits des collaborateurs</H3>
      <p>
        Le traitement est encadré par la loi organique n° 2004-63 du 27 juillet 2004 relative à la protection des données à caractère personnel. L&apos;entreprise en est
        responsable ; l&apos;autorité de contrôle est l&apos;INPDP. Un collaborateur peut demander à connaître les données qui le concernent, et s&apos;opposer au calcul de
        son risque : il n&apos;est alors plus évalué.
      </p>
      <p className="mt-2">
        {role === "RH" ? (
          <>
            Vous traitez ces demandes depuis l&apos;écran{" "}
            <Link href="/confidentialite" className={link}>
              Droit d&apos;accès
            </Link>
            .
          </>
        ) : (
          "Transmettez toute demande de ce type à la RH."
        )}
      </p>
    </>
  );
}

function Start({ role }: P) {
  return (
    <>
      <p>Trois étapes pour votre rôle ({ROLE_LABEL[role]}), dans l&apos;ordre où vous les ferez chaque mois après l&apos;import AJIR.</p>
      <ol className="mt-3 grid gap-3 md:grid-cols-3">
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
    </>
  );
}

function Faq({ role }: P) {
  const items = forRole(FAQ, role);
  const topics = (Object.keys(FAQ_TOPICS) as FaqTopic[]).filter((t) => items.some((f) => f.topic === t));
  return (
    <>
      <p className="text-fg-muted">Cliquez sur une question pour afficher la réponse.</p>
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
