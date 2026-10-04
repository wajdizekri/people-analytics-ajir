# Chapitre 5 — Conception

Ce chapitre présente l'architecture du module, justifie les choix techniques en renvoyant aux fiches de décision (ADR), décrit le modèle de données et les principaux traitements, puis la conception de la sécurité. Il intègre les ajouts du 02 au 04/10/2026 : design system de l'interface, pages d'exploration, fonctions d'analyse et assistant d'aide. Les diagrammes UML détaillés sont maintenus avec le code dans [docs/architecture/](../architecture/) ; ce chapitre en donne la lecture et les raisons.

## 5.1 Architecture générale

### 5.1.1 Principe

L'architecture découle d'une contrainte et d'une règle. La contrainte vient du client : un seul serveur, la stack React + Next.js + SQLite, aucune administration de base de données. La règle est d'architecture : **Python sert uniquement hors ligne ; en production, tout s'exécute en Node.js**.

Le système se découpe en deux mondes (figure 5.1) :

- **en production**, sur le serveur du client, deux processus Node.js partagent un même fichier SQLite :
  - le **service web** Next.js sert les pages et l'API. Il authentifie, autorise et lit la base par une couche d'accès aux données unique, qui renvoie des objets de transfert (DTO) propres à chaque rôle. Il n'écrit que de petites mutations : statut d'une alerte, décision sur une recommandation, paramètres, comptes ;
  - le **worker** est le seul écrivain des calculs de masse. Il exécute la file de jobs, le calcul mensuel planifié et la reprise après arrêt ;
- **hors ligne**, sur un poste d'ArabSoft ou de l'étudiant, Python sert au simulateur, à l'entraînement et à l'évaluation. Il ne produit que deux artefacts : des fichiers CSV au format AJIR et des bundles de modèles en JSON.

Depuis le 04/10/2026, une sortie **facultative** s'ajoute à ces deux mondes : deux fonctions peuvent appeler une API d'IA générative depuis le service web (sections 5.4.5 et 5.4.6). Cet appel n'a lieu que si l'exploitant définit une clé dédiée. Par défaut, aucun flux ne sort du serveur et l'architecture reste celle du cahier des charges ([ADR-014](../adr/014-ia-generative-facultative-hors-donnees-rh.md)).

*Figure 5.1 — Architecture logique : production (AJIR → worker → SQLite ↔ Next.js → navigateur), chaîne hors ligne (simulateur → entraînement → bundle JSON vérifié) et flux sortant facultatif, désactivé par défaut, vers l'API d'IA générative. Source : cahier des charges v2, section 5 (« Vue d'ensemble »), [README.md](../../README.md) et ADR-014.*

### 5.1.2 Couches logicielles

Le code TypeScript est organisé en couches aux dépendances orientées (tableau 5.1). Les modules de calcul (`lib/features`, `lib/scoring`, `lib/anomalies`, puis `lib/matching` et `lib/retention`) ne connaissent ni Next.js ni les sessions. Ils sont donc partagés par le worker, les commandes en ligne et les tests, et le même code produit les variables du batch, du backtest, du *what-if* et de la recherche du meilleur levier.

*Tableau 5.1 — Couches et responsabilités (d'après [docs/CONVENTIONS.md](../CONVENTIONS.md)).*

| Couche | Dossier | Responsabilité |
|---|---|---|
| Présentation | `src/app/(app)/`, `src/components/` | Pages (Server Components), formulaires (Server Actions), graphiques ECharts ; composants communs du design system (`ui/`, `ux/`, `charts/`, section 5.1.4) ; ne reçoit que des DTO |
| API | `src/app/api/` | Route Handlers JSON enveloppés par `withApi` : contrôle d'origine, erreurs homogènes 400/401/403/404/409 |
| Accès aux données et autorisation | `src/lib/dal/` | Seule couche qui lit la base pour l'interface ; chaque fonction reçoit un `AccessContext` et renvoie le DTO du rôle |
| Authentification et audit | `src/lib/auth/`, `src/lib/audit.ts` | Mots de passe argon2id, sessions opaques, verrouillage ; journal en ajout seul |
| Métier et calcul | `src/lib/import/`, `calendar/`, `aggregates/`, `features/`, `scoring/`, `engine/`, `anomalies/`, `whatif/`, `jobs/`, `ai/`, `matching/`, `retention/`, `drift/` | Import et qualité, calendrier tunisien, agrégats, variables, scoring et explication, recommandations et alertes, anomalies, simulation et recherche du meilleur levier, file de jobs ; IA par sujet, typologie, synthèse rédigée et fourchettes conformes ; comparaison appariée ; rétention ; dérive |
| Aide et assistant | `src/lib/help/`, `src/lib/rag/` | Contenus d'aide et glossaire par rôle ; corpus documentaire, index plein texte en mémoire, réponse de l'assistant (section 5.4.6) |
| Processus de fond | `src/worker/` | Boucle de la file, cron mensuel, heartbeat, reprise |
| Persistance | `src/db/`, `drizzle/` | Schéma Drizzle unique, connexion SQLite (WAL), migrations SQL dont les triggers d'audit et la vue des étiquettes |
| Contrat partagé | `shared/features.json` | Ordre, groupes, imputation, libellés et règles B0 des variables, lus par TypeScript et par Python |
| Hors ligne | `ml/sim/`, `ml/train/`, `ml/<sujet>/` | Simulateur, entraînement, évaluation, calibration conforme, références des jeux golden (Python) |

### 5.1.3 Architecture physique

Le diagramme de déploiement (figure 5.2) est détaillé dans [docs/architecture/DEPLOIEMENT.md](../architecture/DEPLOIEMENT.md). Un reverse proxy TLS du client (Caddy, ou IIS avec ARR, et un certificat de la PKI interne) termine HTTPS et relaie vers le service web en local. HTTPS est obligatoire, car le cookie de session est marqué `Secure`. Les services web et worker s'exécutent sous Node.js 24. Le dossier `data/` contient la base (`app.db` et ses fichiers WAL), les exports déposés (`inbox/`) et les sauvegardes. Les dossiers `models/<sujet>/<version>/` contiennent les bundles de modèles : risque de démission, absentéisme, charge de travail, effectifs et masse salariale, formations, typologie des départs. Le corpus de l'assistant d'aide (`src/lib/rag/corpus.json`) est livré avec le code ; son index est reconstruit en mémoire par le service web.

*Figure 5.2 — Diagramme de déploiement on-premise (source : [DEPLOIEMENT.md](../architecture/DEPLOIEMENT.md), section « Diagramme de déploiement »).*

### 5.1.4 Interface : design system et composants communs

La couche de présentation a été reprise du 02 au 04/10/2026 autour d'un **design system**. Il est documenté dans [docs/qa/DESIGN_SYSTEM.md](../qa/DESIGN_SYSTEM.md) (jetons, thème, mouvement, retours) et complété par [docs/qa/CHARTE_UI.md](../qa/CHARTE_UI.md) (structure d'écran, boutons, textes, visuels). Ce travail ne modifie ni la logique métier ni la base ; seules deux routes d'API sont ajoutées, pour l'export et la recherche ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md)). Quatre choix le structurent.

- **Jetons sémantiques.** Les couleurs sont des variables CSS (`--pa-*`, [src/app/globals.css](../../src/app/globals.css)) exposées à Tailwind sous des noms d'usage : fond de page, surface, texte principal, texte secondaire, bordure, action principale, statuts (danger, attention, succès, information). Un composant ne fixe jamais une couleur : il désigne un rôle, que chaque thème traduit. Les contrastes WCAG 2.2 AA de chaque paire texte/fond sont calculés dans les deux thèmes et figés par un test de non-régression.
- **Thème clair, sombre ou système, sans flash.** Un court script en ligne, exécuté avant le premier affichage, pose l'attribut `data-theme` sur la racine du document d'après le choix enregistré dans le navigateur ; par défaut, la préférence du système s'applique. La page s'affiche ainsi d'emblée dans le bon thème. Les graphiques ECharts sont remappés à l'affichage vers une palette sombre dédiée, et l'interface repasse en clair le temps d'une impression. Le même mécanisme mémorise le menu réduit en rail d'icônes.
- **Composants communs.** `@/components/ui` regroupe les briques de chaque écran : boutons (dont la confirmation des actions destructives et l'état « en cours »), notifications annoncées aux lecteurs d'écran, squelettes de chargement à la forme de la page, états vides « quoi, pourquoi, action », tableau de données, en-tête de page, cartes d'indicateurs. `@/components/ux` ajoute la navigation : fil d'Ariane avec retour vers l'écran d'origine (limité à une liste d'origines connues), sommaire des pages longues, palette Ctrl+K. Leur API est additive : aucun export n'est renommé ni retiré, si bien que les écrans existants continuent de fonctionner pendant la migration.
- **Kit de visuels « style Power BI ».** `src/components/charts/` fournit un gabarit de carte (titre qui dit le message, sous-titre avec la mesure, l'unité, le périmètre et la période), des constructeurs de graphiques aux marques communes et une palette catégorielle de six teintes vérifiée pour les daltonismes. Chaque graphique a une alternative accessible, le tableau « Voir les données ».

Les écrans affichent désormais leur seul titre : l'encart « À quoi sert cette page » a été retiré de toute l'application, l'explication passant par l'aide, les bulles de définition et l'assistant d'aide (section 5.4.6). La page de connexion ajoute une scène 3D décorative (three, React Three Fiber). Elle n'est chargée qu'une fois la page au repos, avec un repli SVG fixe sur écran étroit, sur appareil modeste ou quand l'utilisateur demande un mouvement réduit ; le formulaire ne l'attend jamais.

### 5.1.5 Pages et composants ajoutés

Les écrans ajoutés ou enrichis depuis le 30/09/2026 réutilisent ces composants et la couche d'accès aux données ; leurs droits par rôle sont ceux du tableau 4.2 ([BRANCHEMENTS_4E.md](../qa/BRANCHEMENTS_4E.md)).

- **Filtrage croisé** ([src/components/charts/drill.ts](../../src/components/charts/drill.ts)) : un clic sur une barre, une part ou une équipe du tableau de bord, de l'absentéisme ou des équipes ouvre la page cible avec l'un de ses filtres existants (département, niveau, équipe). Le lien est construit sur le schéma de validation de la page cible et n'est posé que sur un groupe déjà affiché au rôle. Le filtre passe donc par l'URL : il est partageable, conservé par le bouton « Précédent » et contrôlé par le serveur comme une saisie.
- **Palette Ctrl+K** ([src/components/ux/command-palette.tsx](../../src/components/ux/command-palette.tsx)) : dialogue de recherche disponible sur tous les écrans. Son contenu (pages, actions, collaborateurs, alertes) est décidé par le serveur selon le rôle (`GET /api/search`, [src/lib/dal/search.ts](../../src/lib/dal/search.ts)) ; l'ADMIN n'y trouve ni collaborateur ni alerte RH.
- **Rétention des embauchés** (`/retention`) : courbes de maintien par cohorte d'embauche, département, premier contrat ou famille de métier, estimées par Kaplan-Meier dans un module de calcul pur ([src/lib/retention/](../../src/lib/retention/)). Une courbe s'arrête dès que moins de cinq personnes restent suivies.
- **Organigramme** (`/organigramme`) : arbre de l'entreprise pour la RH, sous-arbre du manager pour celui-ci, coloré selon une mesure choisie, avec une vue en liste ([src/lib/dal/org-chart.ts](../../src/lib/dal/org-chart.ts)).
- **Export CSV et impression** : `GET /api/export/[kind]` renvoie les colonnes autorisées au rôle et chaque export est audité ; une feuille de style d'impression commune s'applique à toutes les pages.
- **Fonctions d'analyse et assistant** : intégrés à des pages existantes, sans nouvelle entrée de menu (sections 5.4.5 et 5.4.6).

## 5.2 Choix techniques et leur justification

Chaque choix structurant a fait l'objet d'une fiche de décision : contexte, décision, alternatives rejetées, conséquences. Le tableau 5.2 en donne la synthèse.

*Tableau 5.2 — Décisions d'architecture.*

| ADR | Décision | Alternative principale rejetée | Raison |
|---|---|---|---|
| [001](../adr/001-stack-react-nextjs-sqlite.md) | React 19 + Next.js 16 (App Router) + SQLite (better-sqlite3, Drizzle), TypeScript strict, zod, Tailwind, ECharts, croner, pino | PostgreSQL, second backend | Contrainte client : un serveur, aucune administration de base |
| [002](../adr/002-python-hors-ligne-modele-json-execute-en-typescript.md) | Python hors ligne ; modèle exporté en JSON et exécuté en TypeScript ; jeu golden rejoué à 10⁻⁹ près | Service d'inférence Python | Python en production exclu ; divergence silencieuse contrôlée par le golden |
| [003](../adr/003-regression-logistique-en-production-lightgbm-comparateur.md) | B0 (règles) en repli, régression logistique calibrée visée en production, LightGBM comparateur hors ligne | LightGBM en production | Explication exacte, stabilité sur petits effectifs, exécution triviale en TypeScript |
| [004](../adr/004-cible-demission-6-mois-risques-concurrents.md) | Cible : démission ou abandon dans ]t, t + 6 mois] ; autres sorties comptées « non-démission » | Toute sortie comme événement | Le modèle apprendrait les fins de CDD et la retraite, sans levier RH |
| [005](../adr/005-visibilite-as-of-par-date-de-saisie.md) | Une donnée n'est visible à t que si son événement **et** sa saisie sont ≤ t | Date d'événement seule | Fuite temporelle qui surestime la performance (question Q1) |
| [006](../adr/006-niveaux-de-risque-par-capacite-rh.md) | Niveau ÉLEVÉ = au plus 2 % de l'effectif scoré (capacité RH), ex-æquo jamais départagés par l'identifiant | Seuil fixe de probabilité | Classe vide ou instable vu la rareté des démissions |
| [007](../adr/007-couche-acces-donnees-au-lieu-rls.md) | Couche d'accès aux données unique, DTO par rôle en liste blanche, séparation des tâches ADMIN/RH | Autorisation dans le proxy ou dans les composants | SQLite sans sécurité par ligne ; une donnée non affichée fuirait dans le payload des Server Components |
| [008](../adr/008-publication-atomique-par-pointeur.md) | Run en STAGING écrit par lots, puis bascule du pointeur `current_run_id` dans une transaction | Une seule transaction pour tout le run | Verrou d'écriture long ; l'interface ne voit jamais un calcul partiel |
| [009](../adr/009-exclusion-des-donnees-de-sante.md) | Maladie et maternité exclues de toute variable, y compris par masquage des jours dans les pointages | Utiliser toutes les absences | Donnée sensible ; biais de santé et de sexe |
| [010](../adr/010-simulateur-verite-terrain-non-circulaire.md) | Simulateur au format AJIR, départs sans hasard logit, vérité terrain et oracle | Jeu public seul, seed aléatoire | Prouver la méthode sans données client, sans circularité |
| [011](../adr/011-gardes-petites-populations-cote-manager.md) | Taux et sorties masqués sous 5 personnes côté manager, masquage secondaire contre la déduction par différence | Aucun masquage | Ré-identification triviale dans une petite équipe |
| [012](../adr/012-sessions-opaques-plutot-que-jwt.md) | Sessions opaques en base (empreinte SHA-256), argon2id, verrouillage progressif | JWT (Auth.js en mode identifiants) | Révocation immédiate impossible sans liste noire |
| [013](../adr/013-worker-separe-et-file-de-jobs-sqlite.md) | Worker Node séparé, file de jobs dans SQLite, un seul job actif par type et par cible | Calcul dans un Route Handler ; Redis et BullMQ | Requête longue et verrou d'écriture tenu pendant la navigation ; pas de service supplémentaire à superviser |
| [014](../adr/014-ia-generative-facultative-hors-donnees-rh.md) | Synthèse et assistant sans LLM par défaut ; reformulation par IA générative facultative, inactive sans clé dédiée, jamais sur des données individuelles | Assistant conversationnel sur les données ; LLM local | Contraire au cahier des charges et à la couche d'accès par rôle ; serveur cible sous-dimensionné |

Deux écarts avec les briques listées au cahier des charges sont assumés. Les composants shadcn/ui, TanStack Table et React Hook Form n'ont pas été retenus : des composants maison légers et les Server Actions natives suffisent. Le worker est un processus séparé du service web, alors que le sujet initial demandait d'éviter les microservices : il partage le dépôt, le code et le fichier SQLite, sans API réseau entre les deux. Son but est de sortir un calcul long du cycle des requêtes HTTP.

Du 02 au 04/10/2026, la règle a été de ne pas étendre la pile. La seule dépendance nouvelle est la scène 3D de la page de connexion (three et React Three Fiber, [LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md)). L'index de l'assistant utilise le module plein texte FTS5 de SQLite, déjà fourni par better-sqlite3, et l'appel facultatif à l'API d'IA générative passe par `fetch`, sans bibliothèque cliente.

## 5.3 Modèle de données

### 5.3.1 Organisation

La base compte 34 tables et une vue, réparties en six familles (tableau 5.3). Le schéma Drizzle ([src/db/schema.ts](../../src/db/schema.ts)) en est la seule définition ; les migrations SQL ([drizzle/](../../drizzle/)) y ajoutent les triggers et la vue. Le diagramme entité-association et le diagramme de classes sont dans [docs/architecture/MODELE_DONNEES.md](../architecture/MODELE_DONNEES.md), la signification des colonnes dans le dictionnaire de données ([docs/DICTIONNAIRE.md](../DICTIONNAIRE.md)).

*Tableau 5.3 — Familles de tables.*

| Famille | Tables | Écrivain |
|---|---|---|
| Sources AJIR | `department`, `employee`, `contract`, `exit_event`, `career_event`, `attendance_daily`, `absence_episode`, `payroll_monthly`, `training`, `evaluation` | Import |
| Calendrier et imports | `dim_date`, `import_batch`, `import_rejection` | Import, construction du calendrier |
| Agrégats | `agg_kpi_monthly` | Worker ou commande en ligne |
| Couche ML, résultats et objets métier | `feature_snapshot`, `model_version`, `scoring_run`, `prediction`, `prediction_factor`, `recommendation`, `intervention`, `anomaly`, `alert` ; vue `v_label_panel` | Worker ; Next.js ne modifie que des statuts et crée les interventions |
| IA par sujet | `topic_model`, `forecast`, `training_risk`, `insight_recommendation` | Worker (étapes du calcul mensuel) ; registre par commande en ligne ; Next.js ne modifie que le statut des recommandations |
| Application | `app_user`, `session`, `audit_log`, `app_job`, `app_setting`, `employee_opposition`, `privacy_request` | Next.js et worker |

*Figure 5.3 — Diagramme entité-association (source : [MODELE_DONNEES.md](../architecture/MODELE_DONNEES.md), section 1).*

Les six tables des IA par sujet et de la protection des données (migrations `0004_ai_topics.sql` et `0005_privacy.sql`) sont postérieures au diagramme de la figure 5.3, qui en compte 28. Aucune migration n'a été ajoutée du 02 au 04/10/2026 : les fonctions de cette période calculent à l'affichage ou en mémoire, ou lisent des bundles versionnés (sections 5.4.5 et 5.4.6).

### 5.3.2 Choix de modélisation

- **Deux dates par fait.** Les tables sources qui le permettent portent une date d'événement et une date de saisie (`recorded_at`). C'est la base de la règle de visibilité (ADR-005) : `exit_event`, `career_event`, `absence_episode`, `payroll_monthly` et `evaluation`.
- **Dates en texte ISO.** SQLite n'a pas de type date. Le format `YYYY-MM-DD` (ou `YYYY-MM` pour un mois) se compare correctement comme une chaîne et reste lisible dans un export.
- **Agrégats pré-calculés** à la place des vues matérialisées absentes de SQLite. La table `agg_kpi_monthly` stocke par mois et par département des mesures additives (effectif, entrées, sorties, jours d'absence hors santé et de santé, jours ouvrables, retards, heures supplémentaires, masse salariale, formations). Elle est recalculée dans des tables temporaires puis remplacée en une transaction courte.
- **Résultats rattachés à un run.** Les tables `prediction` et `prediction_factor` portent l'identifiant du calcul. L'interface ne lit que le run désigné par le pointeur `app_setting.current_run_id` (ADR-008).
- **Variables figées.** La table `feature_snapshot` stocke, pour chaque salarié éligible et chaque fin de mois, le vecteur des 25 variables dans l'ordre de `shared/features.json`, avec la version du jeu de variables (`fsv`) et un indicateur d'historique partiel. Entraînement, backtest et production lisent les mêmes vecteurs.
- **Une seule définition des étiquettes.** La vue `v_label_panel` calcule `y6` (démission ou abandon dans les 6 mois) et `followup_complete` (horizon clos avant la fin des données). Python et le backtest la lisent sans la redéfinir.
- **Invariants portés par la base.** Un index unique partiel garantit un seul modèle champion (`model_one_champion`) et un seul job actif par type et par cible (`job_one_active`). Une clé unique de déduplication empêche de créer deux fois la même alerte (`alert.dedup_key`). Trois triggers interdisent toute modification, suppression ou réinsertion par remplacement dans `audit_log`.
- **Références logiques sans clé étrangère** pour les tables de résultats et d'application : un réimport des sources ne doit pas être bloqué par une prédiction ou une alerte ancienne. Les tables sources, elles, déclarent leurs clés étrangères, contrôlées (`foreign_keys = ON`).

### 5.3.3 Réglages SQLite

La connexion ([src/db/client.ts](../../src/db/client.ts)) active le journal WAL (lectures concurrentes d'un écrivain), un délai d'attente de 5 s sur verrou (`busy_timeout`), `synchronous = NORMAL` et les clés étrangères. Les écritures du worker se font dans des transactions `BEGIN IMMEDIATE` courtes, par lots, pour ne jamais bloquer longtemps le service web.

## 5.4 Traitements

### 5.4.1 Flux principal

Le sujet initial décrivait le flux de prédiction en dix étapes : données RH → contrôle qualité → variables → calcul du modèle → score → niveau de risque → facteurs → recommandations → alerte → API. Nous l'avons conservé, en le rendant **mensuel, versionné et atomique**. Chaque mois, un job `BATCH_MENSUEL` enchaîne rafraîchissement des agrégats, calcul des variables, scoring, publication, effets métier et détection d'anomalies. Le diagramme de séquence correspondant est la figure 5.4.

### 5.4.2 Diagrammes de séquence

Cinq scénarios sont tracés d'après le code dans [docs/architecture/SEQUENCES.md](../architecture/SEQUENCES.md) :

1. **Connexion et contrôle d'accès par rôle** (figure 5.5) : proxy optimiste (présence du cookie), Server Action de connexion, réservation de la tentative, vérification argon2id, création de la session, redirection selon le rôle.
2. **Import d'un export AJIR** (figure 5.6) : dépôt par l'administrateur, contrôles de forme, mise en file, traitement par le worker, score de qualité, alerte Données, audit.
3. **Calcul mensuel** (figure 5.4) : cron, file de jobs, agrégats, variables, scoring en STAGING par lots de 500, bascule du pointeur, recommandations et alertes idempotentes, anomalies ; reprise en cas d'échec ou d'arrêt.
4. **Consultation d'une fiche par un manager** (figure 5.7) : existence (404), puis périmètre hiérarchique (403 journalisé), puis DTO manager en liste blanche.
5. **Simulation *what-if*** (figure 5.8) : sources du seul salarié rechargées, leviers appliqués en mémoire, variables recalculées par les mêmes fonctions que le calcul mensuel, replacement dans la population du mois, rien n'est écrit hormis l'audit.

*Figures 5.4 à 5.8 — Diagrammes de séquence (source : [SEQUENCES.md](../architecture/SEQUENCES.md), sections 1 à 5).*

### 5.4.3 Cycles de vie

Cinq objets ont un cycle de vie explicite, décrit par des diagrammes d'états dans [docs/architecture/ETATS.md](../architecture/ETATS.md) (figure 5.9) :

- **alerte** : Nouvelle → En cours → Traitée, ou Rejetée avec un commentaire d'au moins 3 caractères ; toute transition inverse est refusée (409) ;
- **recommandation** : Proposée → Réalisée (création d'une intervention datée) ou Rejetée ;
- **run de scoring** : STAGING → PUBLIE, ou ECHEC ; un run orphelin de plus de 10 minutes passe en échec ;
- **job** : EN_FILE → EN_COURS → TERMINE ou ECHEC ; un job sans heartbeat depuis 10 minutes est remis en file une fois ;
- **lot d'import** : EN_COURS → OK, BLOQUE (qualité sous le seuil) ou ECHEC.

*Figure 5.9 — Diagrammes d'états (source : [ETATS.md](../architecture/ETATS.md)).*

### 5.4.4 Publication atomique et reprise

La publication mérite une attention particulière : c'est elle qui garantit que l'interface ne montre jamais un calcul à moitié écrit (ADR-008). Le run est d'abord créé en STAGING. Les prédictions et les facteurs sont ensuite écrits par lots de 500 salariés, chacun dans une transaction courte. Une dernière transaction passe enfin le run en PUBLIE et déplace le pointeur. Tant que cette transaction n'a pas eu lieu, toutes les lectures désignent le run précédent. Les recommandations et les alertes sont créées après la bascule, par une procédure idempotente : un rejeu ne crée pas de doublon.

Si le worker est arrêté en plein calcul, la reprise est automatique. Au redémarrage, puis toutes les minutes, la fonction `recoverStale` remet en file, une seule fois, un job sans heartbeat depuis 10 minutes, et marque en échec le run orphelin. Le worker gère aussi un arrêt propre : au premier signal, il laisse finir le job en cours ; au second, il sort immédiatement.

### 5.4.5 Fonctions d'analyse ajoutées le 04/10/2026

Cinq fonctions d'analyse ont été ajoutées le 04/10/2026 ([CHANTIER_IA.md](../qa/CHANTIER_IA.md)). Leurs méthodes et leurs résultats sont présentés au chapitre 7 (sections 7.13 à 7.17) ; cette section n'en décrit que la place dans l'architecture. Trois règles de conception leur sont communes : réutiliser le code de production plutôt que dupliquer un calcul, n'écrire en base que le journal d'audit, et s'intégrer à une page existante sans nouvelle entrée de menu.

- **Recherche du meilleur levier** ([src/lib/whatif/search.ts](../../src/lib/whatif/search.ts), route `POST /api/employees/[id]/what-if/search`, RH seule). Elle parcourt une grille bornée de combinaisons de leviers par ampleur croissante et retient les plus petites qui font baisser le niveau de risque. Il n'y a pas de second modèle : chaque essai passe par les fonctions du *what-if* (variables, score, placement dans la population du mois). Chaque levier n'agit que sur une famille de sources (paie et carrière, pointages, formations) ; les variables d'une combinaison se composent donc à partir de quelques dizaines de recalculs, au lieu d'un recalcul par combinaison. Chaque piste retenue est ensuite recalculée en entier : la carte affiche exactement ce que donnera la simulation ([RESULTATS_IA_LEVIER.md](../RESULTATS_IA_LEVIER.md)). Le bouton « Appliquer à la simulation » ne fait que pré-remplir le formulaire.
- **Comparaison appariée des interventions** ([src/lib/matching/](../../src/lib/matching/), [src/lib/dal/intervention-impact.ts](../../src/lib/dal/intervention-impact.ts), page `/interventions`, RH seule). La bibliothèque est pure, sans accès à la base : score de propension, appariement, diagnostics d'équilibre, bootstrap. La couche d'accès construit les unités à la fin du mois qui précède l'action, avec la règle de visibilité (ADR-005), et ne renvoie que des agrégats. Une implémentation Python de référence fournit le jeu golden rejoué par les tests ([RESULTATS_IA_INTERVENTIONS.md](../RESULTATS_IA_INTERVENTIONS.md)). Sous 20 suivis comparables, aucun chiffre n'est affiché : c'est le cas sur la base de démonstration, qui ne compte qu'une intervention.
- **Typologie des départs** ([src/lib/ai/typology/](../../src/lib/ai/typology/), section « Profils de départs » de `/retention`, RH seule). Le regroupement est appris hors ligne en Python, exporté en bundle JSON et rejoué en TypeScript avec contrôle golden, comme le modèle de risque (ADR-002). La sélection des départs est écrite une seule fois et exécutée telle quelle par les deux langages. Le registre des modèles ne pouvant accueillir un nouveau sujet sans migration, le bundle est chargé par version fixée ; l'affectation est calculée à l'affichage puis gardée en cache ([RESULTATS_IA_TYPOLOGIE.md](../RESULTATS_IA_TYPOLOGIE.md)). Aucun salarié n'est étiqueté : l'affectation sert seulement à compter. La stabilité de la partition n'est que moyenne (section 7.15).
- **Synthèse rédigée** ([src/lib/ai/narrative/](../../src/lib/ai/narrative/), encadré de `/synthese`, RH et manager). Des gabarits déterministes produisent les phrases à partir du DTO du rôle. La reformulation facultative est rendue dans un `Suspense` dont l'affichage d'attente est la version par gabarits : la page n'attend jamais l'API ([RESULTATS_IA_SYNTHESE.md](../RESULTATS_IA_SYNTHESE.md)).
- **Fourchettes conformes** ([src/lib/ai/conformal.ts](../../src/lib/ai/conformal.ts), sous les prévisions de `/absenteeism`, `/charge` et `/previsions`). La calibration est faite hors ligne et écrite dans une **nouvelle version** de chaque bundle de prévision, sous un champ additif. L'inférence TypeScript utilise ce champ s'il existe et retombe sinon exactement sur les bornes de la version précédente. Une ligne sous chaque prévision donne la couverture mesurée sur la période de test, lue dans le bundle du modèle qui a produit la prévision ; elle dit explicitement quand la couverture reste sous la cible ([RESULTATS_IA_CONFORME.md](../RESULTATS_IA_CONFORME.md)). Ces nouvelles versions restent à enregistrer et à promouvoir sur la base de démonstration (au 04/10/2026).

Ces fonctions héritent des gardes existantes : contrôle du rôle dans la couche d'accès, opposition au traitement respectée dès qu'une donnée individuelle est utilisée, audit de chaque appel, vocabulaire « facteurs associés » et mention « estimation non causale ».

### 5.4.6 Assistant d'aide

L'assistant d'aide répond à une question sur l'usage ou la méthode de l'outil, par exemple « comment est calculé le niveau de risque ? ». Il s'appuie sur la documentation et l'aide seulement, jamais sur les données des collaborateurs ([RESULTATS_ASSISTANT.md](../RESULTATS_ASSISTANT.md), [src/lib/rag/](../../src/lib/rag/)). Sa chaîne compte quatre étapes (figure 5.10).

1. **Corpus préparé hors ligne.** La commande `npm run rag:index` découpe en passages les contenus du centre d'aide, le glossaire et une sélection de documents. Elle écrit `src/lib/rag/corpus.json`, avec une empreinte des sources. Chaque passage porte la liste des rôles autorisés, reprise de l'entrée d'aide dont il provient. Le corpus ne contient aucune donnée de salarié ni aucun chiffre issu de la base.
2. **Index plein texte en mémoire.** Au premier appel, le service web charge le corpus dans une base SQLite FTS5 en mémoire, reconstruite quand le corpus change. La question est réduite à des mots : aucune syntaxe de requête FTS5 n'est transmise, les mots vides sont retirés et des synonymes métier ajoutés. Le classement utilise bm25, avec un poids renforcé pour le titre du passage.
3. **Filtrage par rôle avant classement.** Le rôle vient de la session, jamais du corps de la requête. Le filtre est appliqué dans la requête FTS5 elle-même : un passage d'un autre rôle n'est jamais lu et ne peut donc pas évincer un passage autorisé de la liste des résultats. Le service refiltre ensuite les passages trouvés. L'ADMIN ne lit ainsi aucun passage de méthodologie ou de pilotage RH, et le manager aucun passage réservé à la RH.
4. **Réponse extraite ou reformulée.** Par défaut, et seul mode sans Internet, la réponse est un extrait du meilleur passage, accompagné de ses sources. Si une clé dédiée est définie, l'extrait peut être reformulé par une API d'IA générative à partir des seuls passages trouvés. Le texte est vérifié avant affichage : citations des passages fournis seulement, aucun nombre absent des passages, longueur bornée ; sinon, l'extrait s'affiche. Sans passage pertinent, l'assistant répond que l'aide ne couvre pas la question, plutôt que d'inventer.

Le service est exposé par `POST /api/assistant` ([src/app/api/assistant/route.ts](../../src/app/api/assistant/route.ts)) : session exigée pour les trois rôles, corps borné à 2 ko, question validée (3 à 300 caractères), **limite d'usage** de 30 questions par compte sur 15 minutes, refus 429 au-delà. Chaque question est auditée (`assistant.ask`) avec sa longueur, le nombre de passages trouvés et le mode de réponse, **jamais son texte**. Côté interface, le composant `HelpAssistant` est placé sous le titre du tableau de bord (RH, manager) et de la console (ADMIN). Il est replié par défaut sur une ligne ; la réponse s'affiche en texte brut, et seuls des liens internes sont proposés comme sources.

*Figure 5.10 — Chaîne de l'assistant d'aide : corpus préparé hors ligne (`npm run rag:index`) → index FTS5 en mémoire, filtré par le rôle de la session → réponse extraite (défaut) ou reformulée et vérifiée (option) → `POST /api/assistant` → panneau de réponse (source : [RESULTATS_ASSISTANT.md](../RESULTATS_ASSISTANT.md), section « Architecture »).*

La recherche est lexicale, non sémantique : une question formulée loin du vocabulaire de l'aide peut rester sans réponse, ce que l'enrichissement des synonymes atténue sans le supprimer. L'index et le cache des réponses sont propres au processus du service web et sont reconstruits au premier appel après un redémarrage.

## 5.5 Conception de la sécurité

La sécurité est conçue selon le niveau 1 de l'OWASP ASVS (*Application Security Verification Standard*), fixé par le cahier des charges. La version 5.0.0, publiée en mai 2025, a renuméroté les exigences de la version 4.0.3 : toute vérification doit préciser la version de référence (OWASP Foundation, 2025). Le tableau 5.4 associe chaque menace à sa parade.

*Tableau 5.4 — Menaces et parades.*

| Menace | Parade | Référence |
|---|---|---|
| Vol de mot de passe en base | Hachage argon2id (Biryukov et al., 2016) avec m = 19 456 Kio, t = 2, p = 1, minimum recommandé par l'OWASP (OWASP Foundation, s.d.) ; politique : au moins 10 caractères, lettres et chiffres | [src/lib/auth/password.ts](../../src/lib/auth/password.ts) |
| Force brute | Tentative réservée dans une transaction avant vérification ; verrouillage progressif de 1 à 64 minutes à partir du 5e échec ; message identique pour identifiant inconnu et mot de passe faux | [src/lib/auth/login.ts](../../src/lib/auth/login.ts) |
| Vol ou rejeu de session | Jeton aléatoire de 32 octets dans un cookie `httpOnly`, `SameSite=Lax`, `Secure` ; seule son empreinte SHA-256 est stockée ; expiration à 10 h ; révocation par suppression de la ligne | ADR-012, [src/lib/auth/session.ts](../../src/lib/auth/session.ts) |
| Falsification de requête (CSRF) | `SameSite=Lax` ; contrôle d'origine natif des Server Actions ; contrôle `Origin`/`Host` des Route Handlers mutants | [src/lib/api.ts](../../src/lib/api.ts) |
| Accès hors rôle ou hors périmètre | Gardes d'entrée (`pageContext`, `requireContext`) puis contrôles dans la couche d'accès (`canSeeEmployee`, `scopeFilter` par CTE récursive sur la hiérarchie) ; 403 journalisé | ADR-007, [src/lib/dal/context.ts](../../src/lib/dal/context.ts) |
| Fuite par le payload des Server Components | DTO par rôle en liste blanche construits dans la couche d'accès, jamais d'objet de base transmis à une page | ADR-007 |
| Ré-identification par agrégats | Masquage sous 5 personnes et masquage secondaire côté manager ; mêmes gardes sur la rétention et l'organigramme ; typologie réservée à la RH, avec le même masquage appliqué aussi à la RH ; comparaison appariée sans aucun chiffre sous 20 suivis | ADR-011, [src/lib/dal/typology.ts](../../src/lib/dal/typology.ts), [src/lib/dal/intervention-impact.ts](../../src/lib/dal/intervention-impact.ts) |
| Injection SQL | Requêtes paramétrées uniquement (paramètres nommés), jamais de concaténation de valeurs utilisateur ; pour l'assistant, question réduite à des mots avant la requête FTS5 | [docs/CONVENTIONS.md](../CONVENTIONS.md), [src/lib/rag/index.ts](../../src/lib/rag/index.ts) |
| Entrées malformées | Validation zod de toutes les requêtes, corps et formulaires ; liste fermée de fichiers et taille bornée à l'import | [src/lib/dal/](../../src/lib/dal/) |
| Fuite d'information par les erreurs | Réponses `{ error: { code, message, correlationId } }` sans détail interne ; détail dans les journaux pino | [src/lib/api.ts](../../src/lib/api.ts) |
| Répudiation | Audit en ajout seul (triggers `BEFORE UPDATE/DELETE`, et refus d'une insertion qui remplacerait une ligne existante) des écritures, des lectures sensibles et des refus | [drizzle/0001_audit_triggers.sql](../../drizzle/0001_audit_triggers.sql), [drizzle/0006_audit_hardening.sql](../../drizzle/0006_audit_hardening.sql) |
| Clickjacking, script injecté, rétrogradation HTTP | En-têtes posés par Next.js : `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, politique de sécurité du contenu (CSP, dont `connect-src 'self'`), `Permissions-Policy`, `Cross-Origin-Opener-Policy`, HSTS en production ; même politique au reverse proxy | [next.config.ts](../../next.config.ts), [deploy/caddy/Caddyfile](../../deploy/caddy/Caddyfile), [SECURITE_PERF.md](../qa/SECURITE_PERF.md) § 8 |
| Perte ou corruption de données | Sauvegarde à chaud `VACUUM INTO`, contrôle d'intégrité et manifeste sha256, restauration à froid vérifiée | [scripts/backup.ts](../../scripts/backup.ts), [scripts/restore.ts](../../scripts/restore.ts) |
| Modèle altéré | Empreinte sha256 du bundle et rejeu du golden à l'enregistrement, à la promotion et au chargement ; champion invalide → scoring suspendu et alerte Système | ADR-002 |
| Fuite de données vers un service d'IA générative | Option inactive sans clé dédiée (la clé générique `ANTHROPIC_API_KEY` n'active rien) ; appel depuis le serveur seulement, la CSP du navigateur restant inchangée ; assistant : question et extraits de documentation seulement, question non transmise si elle contient un matricule ou une adresse électronique ; synthèse : liste blanche typée d'agrégats non nominatifs | ADR-014, [src/lib/rag/answer.ts](../../src/lib/rag/answer.ts), [src/lib/ai/narrative/payload.ts](../../src/lib/ai/narrative/payload.ts) |
| Injection de consigne, texte généré trompeur | Question traitée comme une donnée par la consigne système ; texte vérifié (nombres présents dans l'entrée, citations existantes, vocabulaire causal refusé), repli automatique sur la version sans IA ; réponse affichée en texte brut, liens internes seulement | [RESULTATS_ASSISTANT.md](../RESULTATS_ASSISTANT.md), [RESULTATS_IA_SYNTHESE.md](../RESULTATS_IA_SYNTHESE.md) |
| Lecture d'un passage d'aide hors rôle | Rôle lu dans la session ; filtre dans la requête FTS5, avant classement ; second filtre dans le service | [src/lib/dal/assistant.ts](../../src/lib/dal/assistant.ts) |
| Usage abusif de l'assistant | Corps borné à 2 ko ; 30 questions par compte sur 15 minutes, refus 429 au-delà ; audit sans le texte de la question | [src/lib/auth/rate-limit.ts](../../src/lib/auth/rate-limit.ts) |

Les fonctions du 04/10/2026 ajoutent deux surfaces d'attaque : un flux sortant facultatif et une entrée en texte libre. Les quatre dernières lignes du tableau 5.4 en donnent les parades.

Le principe central est que **l'autorisation ne repose jamais sur ce que l'interface affiche**. Le proxy Next.js ne vérifie que la présence du cookie ; c'est un contrôle optimiste, qui redirige tôt vers la page de connexion. La décision réelle est prise dans la couche d'accès aux données, avant que la donnée n'atteigne une page ou une réponse JSON. Un manager ne reçoit donc jamais, même masqué, un salaire, une probabilité, un lift, une phrase chiffrée de facteur ou un signal d'absentéisme individuel.

## 5.6 Intégration avec AJIR

Le contrat d'intégration est volontairement minimal et formulé **côté module**, pour ne pas dépendre de développements d'ArabSoft :

- **données** : un export CSV versionné, mensuel après la paie, déposé par l'administrateur dans l'interface ou copié dans un dossier ; son format est décrit au chapitre 6 ;
- **comptes et hiérarchie** : le fichier `users.csv` de l'export crée, réactive ou désactive les comptes et fixe leur rôle ; un compte créé s'active par un lien à usage unique valable 7 jours ; la hiérarchie des managers vient de `employees.csv` ;
- **point d'entrée** : des liens stables (`/go/tableau-de-bord`, `/go/collaborateur/<matricule>`) peuvent être ajoutés au menu d'AJIR ; ils passent par la connexion habituelle et par le contrôle de périmètre. L'ouverture sans ressaisie du mot de passe, *Should* du cahier des charges, est réalisée par un jeton signé (HMAC-SHA256, valable 60 secondes, à usage unique) ; elle reste désactivée tant que le secret partagé n'est pas configuré ([docs/INTEGRATION_AJIR.md](../INTEGRATION_AJIR.md)). Reste à développer côté ArabSoft l'entrée de menu et la génération du jeton (chapitre 10).

## 5.7 Conclusion

La conception compense les limites de SQLite par des décisions explicites. La couche d'accès aux données remplace la sécurité par ligne, le pointeur de publication remplace une transaction longue, les tables d'agrégats remplacent les vues matérialisées et le worker unique évite les conflits d'écriture. Le contrat de variables partagé et le jeu golden relient les deux mondes, Python hors ligne et TypeScript en production, sans divergence possible non détectée. Les ajouts du 02 au 04/10/2026 suivent la même ligne : aucune migration, une seule dépendance nouvelle et purement décorative, des composants communs à API additive, la réutilisation de la couche d'accès et du moteur de simulation, et un seul flux sortant, facultatif et désactivé par défaut. Le chapitre suivant décrit les données qui alimentent cette architecture.
