# Chapitre 5 — Conception

Ce chapitre présente l'architecture du module, justifie les choix techniques en renvoyant aux fiches de décision (ADR), décrit le modèle de données et les principaux traitements, puis la conception de la sécurité. Les diagrammes UML détaillés sont maintenus avec le code dans [docs/architecture/](../architecture/) ; ce chapitre en donne la lecture et les raisons.

## 5.1 Architecture générale

### 5.1.1 Principe

L'architecture découle d'une contrainte et d'une règle. La contrainte vient du client : un seul serveur, la stack React + Next.js + SQLite, aucune administration de base de données. La règle est d'architecture : **Python sert uniquement hors ligne ; en production, tout s'exécute en Node.js**.

Le système se découpe en deux mondes (figure 5.1) :

- **en production**, sur le serveur du client, deux processus Node.js partagent un même fichier SQLite :
  - le **service web** Next.js sert les pages et l'API. Il authentifie, autorise et lit la base par une couche d'accès aux données unique, qui renvoie des objets de transfert (DTO) propres à chaque rôle. Il n'écrit que de petites mutations : statut d'une alerte, décision sur une recommandation, paramètres, comptes ;
  - le **worker** est le seul écrivain des calculs de masse. Il exécute la file de jobs, le calcul mensuel planifié et la reprise après arrêt ;
- **hors ligne**, sur un poste d'ArabSoft ou de l'étudiant, Python sert au simulateur, à l'entraînement et à l'évaluation. Il ne produit que deux artefacts : des fichiers CSV au format AJIR et des bundles de modèles en JSON.

*Figure 5.1 — Architecture logique : production (AJIR → worker → SQLite ↔ Next.js → navigateur) et chaîne hors ligne (simulateur → entraînement → bundle JSON vérifié). Source : cahier des charges v2, section 5 (« Vue d'ensemble ») et [README.md](../../README.md).*

### 5.1.2 Couches logicielles

Le code TypeScript est organisé en couches aux dépendances orientées (tableau 5.1). Les modules de calcul (`lib/features`, `lib/scoring`, `lib/anomalies`) ne connaissent ni Next.js ni les sessions. Ils sont donc partagés par le worker, les commandes en ligne et les tests, et le même code produit les variables du batch, du backtest et du *what-if*.

*Tableau 5.1 — Couches et responsabilités (d'après [docs/CONVENTIONS.md](../CONVENTIONS.md)).*

| Couche | Dossier | Responsabilité |
|---|---|---|
| Présentation | `src/app/(app)/`, `src/components/` | Pages (Server Components), formulaires (Server Actions), graphiques ECharts ; ne reçoit que des DTO |
| API | `src/app/api/` | Route Handlers JSON enveloppés par `withApi` : contrôle d'origine, erreurs homogènes 400/401/403/404/409 |
| Accès aux données et autorisation | `src/lib/dal/` | Seule couche qui lit la base pour l'interface ; chaque fonction reçoit un `AccessContext` et renvoie le DTO du rôle |
| Authentification et audit | `src/lib/auth/`, `src/lib/audit.ts` | Mots de passe argon2id, sessions opaques, verrouillage ; journal en ajout seul |
| Métier et calcul | `src/lib/import/`, `calendar/`, `aggregates/`, `features/`, `scoring/`, `engine/`, `anomalies/`, `whatif/`, `jobs/` | Import et qualité, calendrier tunisien, agrégats, variables, scoring et explication, recommandations et alertes, anomalies, simulation, file de jobs |
| Processus de fond | `src/worker/` | Boucle de la file, cron mensuel, heartbeat, reprise |
| Persistance | `src/db/`, `drizzle/` | Schéma Drizzle unique, connexion SQLite (WAL), migrations SQL dont les triggers d'audit et la vue des étiquettes |
| Contrat partagé | `shared/features.json` | Ordre, groupes, imputation, libellés et règles B0 des variables, lus par TypeScript et par Python |
| Hors ligne | `ml/sim/`, `ml/train/` | Simulateur, entraînement, évaluation (Python) |

### 5.1.3 Architecture physique

Le diagramme de déploiement (figure 5.2) est détaillé dans [docs/architecture/DEPLOIEMENT.md](../architecture/DEPLOIEMENT.md). Un reverse proxy TLS du client (Caddy, ou IIS avec ARR, et un certificat de la PKI interne) termine HTTPS et relaie vers le service web en local. HTTPS est obligatoire, car le cookie de session est marqué `Secure`. Les services web et worker s'exécutent sous Node.js 24. Le dossier `data/` contient la base (`app.db` et ses fichiers WAL), les exports déposés (`inbox/`) et les sauvegardes. Le dossier `models/turnover/<version>/` contient les bundles de modèles.

*Figure 5.2 — Diagramme de déploiement on-premise (source : [DEPLOIEMENT.md](../architecture/DEPLOIEMENT.md), section « Diagramme de déploiement »).*

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

Deux écarts avec les briques listées au cahier des charges sont assumés. Les composants shadcn/ui, TanStack Table et React Hook Form n'ont pas été retenus : des composants maison légers et les Server Actions natives suffisent. Le worker est un processus séparé du service web, alors que le sujet initial demandait d'éviter les microservices : il partage le dépôt, le code et le fichier SQLite, sans API réseau entre les deux. Son but est de sortir un calcul long du cycle des requêtes HTTP.

## 5.3 Modèle de données

### 5.3.1 Organisation

La base compte 28 tables et une vue, réparties en cinq familles (tableau 5.3). Le schéma Drizzle ([src/db/schema.ts](../../src/db/schema.ts)) en est la seule définition ; les migrations SQL ([drizzle/](../../drizzle/)) y ajoutent les triggers et la vue. Le diagramme entité-association et le diagramme de classes sont dans [docs/architecture/MODELE_DONNEES.md](../architecture/MODELE_DONNEES.md), la signification des colonnes dans le dictionnaire de données ([docs/DICTIONNAIRE.md](../DICTIONNAIRE.md)).

*Tableau 5.3 — Familles de tables.*

| Famille | Tables | Écrivain |
|---|---|---|
| Sources AJIR | `department`, `employee`, `contract`, `exit_event`, `career_event`, `attendance_daily`, `absence_episode`, `payroll_monthly`, `training`, `evaluation` | Import |
| Calendrier et imports | `dim_date`, `import_batch`, `import_rejection` | Import, construction du calendrier |
| Agrégats | `agg_kpi_monthly` | Worker ou commande en ligne |
| Couche ML, résultats et objets métier | `feature_snapshot`, `model_version`, `scoring_run`, `prediction`, `prediction_factor`, `recommendation`, `intervention`, `anomaly`, `alert` ; vue `v_label_panel` | Worker ; Next.js ne modifie que des statuts et crée les interventions |
| Application | `app_user`, `session`, `audit_log`, `app_job`, `app_setting` | Next.js et worker |

*Figure 5.3 — Diagramme entité-association (source : [MODELE_DONNEES.md](../architecture/MODELE_DONNEES.md), section 1).*

### 5.3.2 Choix de modélisation

- **Deux dates par fait.** Les tables sources qui le permettent portent une date d'événement et une date de saisie (`recorded_at`). C'est la base de la règle de visibilité (ADR-005) : `exit_event`, `career_event`, `absence_episode`, `payroll_monthly` et `evaluation`.
- **Dates en texte ISO.** SQLite n'a pas de type date. Le format `YYYY-MM-DD` (ou `YYYY-MM` pour un mois) se compare correctement comme une chaîne et reste lisible dans un export.
- **Agrégats pré-calculés** à la place des vues matérialisées absentes de SQLite. La table `agg_kpi_monthly` stocke par mois et par département des mesures additives (effectif, entrées, sorties, jours d'absence hors santé et de santé, jours ouvrables, retards, heures supplémentaires, masse salariale, formations). Elle est recalculée dans des tables temporaires puis remplacée en une transaction courte.
- **Résultats rattachés à un run.** Les tables `prediction` et `prediction_factor` portent l'identifiant du calcul. L'interface ne lit que le run désigné par le pointeur `app_setting.current_run_id` (ADR-008).
- **Variables figées.** La table `feature_snapshot` stocke, pour chaque salarié éligible et chaque fin de mois, le vecteur des 25 variables dans l'ordre de `shared/features.json`, avec la version du jeu de variables (`fsv`) et un indicateur d'historique partiel. Entraînement, backtest et production lisent les mêmes vecteurs.
- **Une seule définition des étiquettes.** La vue `v_label_panel` calcule `y6` (démission ou abandon dans les 6 mois) et `followup_complete` (horizon clos avant la fin des données). Python et le backtest la lisent sans la redéfinir.
- **Invariants portés par la base.** Un index unique partiel garantit un seul modèle champion (`model_one_champion`) et un seul job actif par type et par cible (`job_one_active`). Une clé unique de déduplication empêche de créer deux fois la même alerte (`alert.dedup_key`). Deux triggers interdisent toute modification ou suppression dans `audit_log`.
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
| Ré-identification par agrégats | Masquage sous 5 personnes et masquage secondaire côté manager | ADR-011 |
| Injection SQL | Requêtes paramétrées uniquement (paramètres nommés), jamais de concaténation de valeurs utilisateur | [docs/CONVENTIONS.md](../CONVENTIONS.md) |
| Entrées malformées | Validation zod de toutes les requêtes, corps et formulaires ; liste fermée de fichiers et taille bornée à l'import | [src/lib/dal/](../../src/lib/dal/) |
| Fuite d'information par les erreurs | Réponses `{ error: { code, message, correlationId } }` sans détail interne ; détail dans les journaux pino | [src/lib/api.ts](../../src/lib/api.ts) |
| Répudiation | Audit en ajout seul (triggers `BEFORE UPDATE/DELETE`) des écritures, des lectures sensibles et des refus | [drizzle/0001_audit_triggers.sql](../../drizzle/0001_audit_triggers.sql) |
| Clickjacking, script injecté, rétrogradation HTTP | En-têtes `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` posés par Next.js ; HSTS et CSP posés par le reverse proxy | [next.config.ts](../../next.config.ts), [deploy/caddy/Caddyfile](../../deploy/caddy/Caddyfile) |
| Perte ou corruption de données | Sauvegarde à chaud `VACUUM INTO`, contrôle d'intégrité et manifeste sha256, restauration à froid vérifiée | [scripts/backup.ts](../../scripts/backup.ts), [scripts/restore.ts](../../scripts/restore.ts) |
| Modèle altéré | Empreinte sha256 du bundle et rejeu du golden à l'enregistrement, à la promotion et au chargement ; champion invalide → scoring suspendu et alerte Système | ADR-002 |

Le principe central est que **l'autorisation ne repose jamais sur ce que l'interface affiche**. Le proxy Next.js ne vérifie que la présence du cookie ; c'est un contrôle optimiste, qui redirige tôt vers la page de connexion. La décision réelle est prise dans la couche d'accès aux données, avant que la donnée n'atteigne une page ou une réponse JSON. Un manager ne reçoit donc jamais, même masqué, un salaire, une probabilité, un lift, une phrase chiffrée de facteur ou un signal d'absentéisme individuel.

## 5.6 Intégration avec AJIR

Le contrat d'intégration est volontairement minimal et formulé **côté module**, pour ne pas dépendre de développements d'ArabSoft :

- **données** : un export CSV versionné, mensuel après la paie, déposé par l'administrateur dans l'interface ou copié dans un dossier ; son format est décrit au chapitre 6 ;
- **comptes et hiérarchie** : le fichier `users.csv` de l'export crée, réactive ou désactive les comptes et fixe leur rôle ; un compte créé s'active par un lien à usage unique valable 7 jours ; la hiérarchie des managers vient de `employees.csv` ;
- **point d'entrée** : des URL stables (`/dashboard`, `/employees/{id}`) peuvent être ajoutées au menu d'AJIR. L'ouverture sans ressaisie du mot de passe par jeton signé est un *Should* non réalisé (chapitre 10).

## 5.7 Conclusion

La conception compense les limites de SQLite par des décisions explicites. La couche d'accès aux données remplace la sécurité par ligne, le pointeur de publication remplace une transaction longue, les tables d'agrégats remplacent les vues matérialisées et le worker unique évite les conflits d'écriture. Le contrat de variables partagé et le jeu golden relient les deux mondes, Python hors ligne et TypeScript en production, sans divergence possible non détectée. Le chapitre suivant décrit les données qui alimentent cette architecture.
