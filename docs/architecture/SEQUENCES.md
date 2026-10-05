# Diagrammes de séquence

Cinq scénarios, tracés d'après le code (état au 29/09/2026). Chaque participant renvoie à un fichier réel ; les requêtes SQL sont résumées. Conventions : `BEGIN IMMEDIATE` = transaction better-sqlite3 `.immediate()` qui prend le verrou d'écriture dès le début ; « audit » = insertion dans `audit_log` (table en ajout seul).

| # | Scénario | Fichiers principaux |
|---|---|---|
| 1 | Connexion et contrôle d'accès par rôle | [src/proxy.ts](../../src/proxy.ts), [src/app/login/actions.ts](../../src/app/login/actions.ts), [src/lib/auth/](../../src/lib/auth/), [src/lib/dal/context.ts](../../src/lib/dal/context.ts) |
| 2 | Import d'un export AJIR avec contrôle qualité | [src/app/api/imports/route.ts](../../src/app/api/imports/route.ts), [src/lib/dal/imports.ts](../../src/lib/dal/imports.ts), [src/lib/import/](../../src/lib/import/), [src/worker/run.ts](../../src/worker/run.ts) |
| 3 | Batch mensuel : variables → scoring → publication → alertes | [src/lib/jobs/handlers.ts](../../src/lib/jobs/handlers.ts), [src/lib/features/](../../src/lib/features/), [src/lib/scoring/score.ts](../../src/lib/scoring/score.ts), [src/lib/engine/](../../src/lib/engine/), [src/lib/anomalies/index.ts](../../src/lib/anomalies/index.ts) |
| 4 | Consultation d'une fiche par un manager, y compris refus hors périmètre | [src/app/(app)/employees/[id]/page.tsx](../../src/app/%28app%29/employees/[id]/page.tsx), [src/lib/dal/employees.ts](../../src/lib/dal/employees.ts) |
| 5 | What-if (Should, en cours de livraison) | [src/app/api/employees/[id]/what-if/route.ts](../../src/app/api/employees/[id]/what-if/route.ts), [src/lib/dal/whatif.ts](../../src/lib/dal/whatif.ts), [src/lib/whatif/index.ts](../../src/lib/whatif/index.ts) |

## 1. Connexion et contrôle d'accès par rôle

```mermaid
sequenceDiagram
  autonumber
  actor U as Utilisateur
  participant B as Navigateur
  participant P as proxy.ts
  participant A as loginAction (Server Action)
  participant AU as lib/auth (login, session)
  participant PG as Page protégée (layout + page)
  participant DAL as lib/dal
  participant DB as SQLite

  U->>B: ouvre /employees
  B->>P: GET /employees sans cookie pa_session
  P-->>B: redirection vers /login (sur /api/* : 401 JSON NON_AUTHENTIFIE)
  U->>B: saisit identifiant et mot de passe
  B->>A: POST Server Action (Origin contrôlé nativement par Next.js)
  A->>A: validation zod du formulaire
  A->>AU: login(identifiant, mot de passe)
  AU->>DB: SELECT id, password_hash, active FROM app_user WHERE login = ?
  alt compte inconnu, inactif ou sans mot de passe
    AU->>DB: audit auth.login REFUSE (inconnu_ou_inactif)
    AU-->>A: message générique
  else compte actif
    AU->>DB: BEGIN IMMEDIATE : failed_attempts + 1, verrou si 5e échec ou plus
    alt compte déjà verrouillé
      AU->>DB: audit auth.login REFUSE (verrouille)
      AU-->>A: compte temporairement verrouillé
    else tentative réservée
      AU->>AU: vérification argon2id (m = 19 Mio, t = 2, p = 1)
      alt mot de passe faux
        AU->>DB: audit auth.login REFUSE (mot_de_passe)
        AU-->>A: message générique
      else mot de passe correct
        AU->>DB: remise à zéro de failed_attempts et locked_until
        AU->>DB: INSERT session (id = SHA-256 du jeton, expires_at = maintenant + 10 h, ip, user_agent)
        AU-->>B: Set-Cookie pa_session = jeton (httpOnly, SameSite=Lax, Secure en production)
        AU->>DB: audit auth.login OK
        A-->>B: redirection vers / puis homePath(rôle) : /admin ou /dashboard
      end
    end
  end

  B->>P: GET /employees avec cookie
  P->>PG: laisse passer (contrôle optimiste de la seule présence du cookie)
  PG->>DAL: pageContext(PILOTAGE_ROLES)
  DAL->>DB: SELECT session JOIN app_user WHERE session.id = SHA-256(jeton)
  alt session inconnue, expirée ou compte désactivé
    DAL-->>B: redirection /login
  else rôle hors liste (ADMIN sur une page de pilotage)
    DAL-->>B: redirection /interdit
  else RH ou MANAGER
    PG->>DAL: listEmployees(ctx, filtres validés par zod)
    DAL->>DB: SELECT … WHERE scopeFilter(ctx) (RH 1=1, MANAGER CTE récursive sur manager_id)
    DAL-->>PG: DTO du rôle (RH : estimation, MANAGER : niveau seul)
    PG-->>B: HTML + payload RSC construits uniquement à partir du DTO
  end
```

Points de conception :

- Le proxy ([src/proxy.ts](../../src/proxy.ts)) ne lit pas la base : il ne fait que rediriger tôt les visiteurs sans cookie. L'autorisation réelle est refaite à chaque rendu par `pageContext` / `requireContext`, puis par la DAL (voir [ADR-007](../adr/007-couche-acces-donnees-au-lieu-rls.md)).
- Un refus de rôle au niveau page (`/interdit`) ou route (`requireContext(roles)` → 403) n'est pas journalisé ; les refus décidés dans la DAL (`ensureRole`, `ensurePilotage`, `canSeeEmployee`, visibilité des alertes) le sont.
- Le cookie ne contient qu'un jeton aléatoire ; la base n'en garde que l'empreinte (voir [ADR-012](../adr/012-sessions-opaques-plutot-que-jwt.md)).

## 2. Import d'un export AJIR avec contrôle qualité

```mermaid
sequenceDiagram
  autonumber
  actor ADM as Administrateur
  participant B as Navigateur (AdminControls)
  participant R as POST /api/imports (withApi)
  participant DI as lib/dal/imports
  participant FS as data/inbox
  participant DB as SQLite
  participant W as Worker (boucle 5 s)
  participant IMP as lib/import (runImport)
  actor RH as Responsable RH

  ADM->>B: sélectionne les CSV de l'export AJIR
  B->>R: multipart, champ files
  R->>R: contrôle Origin = Host (CSRF), Content-Length au plus 9 Mo
  R->>DI: requireContext(ADMIN) puis saveUploadedExport(ctx, fichiers)
  DI->>DI: ensureRole ADMIN, noms dans la liste du contrat, pas de doublon, en-tête avec séparateur point-virgule
  DI->>DB: un job IMPORT déjà en file ou en cours ?
  alt oui
    DI-->>R: 409 IMPORT_EN_COURS
  else non
    DI->>FS: écrit data/inbox/horodatage/*.csv
    DI->>DB: BEGIN IMMEDIATE : INSERT app_job (IMPORT, EN_FILE)
    DI->>DB: audit job.enqueue et import.upload
    DI-->>R: jobId
    R-->>B: 202 Accepted
  end

  W->>DB: claimNextJob : BEGIN IMMEDIATE, EN_FILE vers EN_COURS, heartbeat
  W->>IMP: runImport(sqlite, dossier, userId)
  IMP->>DB: INSERT import_batch (EN_COURS)
  loop pour chaque fichier, dans l'ordre départements, salariés, contrats, sorties, carrière, paie, absences, formations, évaluations, pointages
    IMP->>FS: lecture en flux (csv-parse, séparateur point-virgule, BOM toléré)
    IMP->>IMP: zod par ligne puis règles métier (SMIG, fin avant début, hors emploi, doublons…)
    IMP->>DB: lots de 5 000 lignes par transaction (upsert) et rejets motivés dans import_rejection
  end
  IMP->>DB: rattachement aux managers, rupture des cycles hiérarchiques
  IMP->>DB: data_end_date = dernier pointage accepté (jamais en recul), statut ACTIF ou SORTI
  IMP->>DB: contrôles PAIE_INCOMPLETE et VARIATION_VOLUME
  IMP->>DB: synchronisation users.csv (comptes créés, réactivés, désactivés, sessions révoquées)
  IMP->>IMP: score = moyenne par fichier (lignes OK / lignes) × (1 - actifs sans paie / actifs)
  IMP->>DB: transaction : UPDATE import_batch (OK, BLOQUE ou ECHEC, report_json), alerte DONNEES si rejets (dedup import:id), audit import.run
  IMP-->>W: résultat du lot
  alt lot OK ou BLOQUE
    W->>DB: rebuildAfterImport : buildCalendar (plage des faits importés + 1 an) puis refreshAggregates
    W->>DB: job TERMINE
  else lot ECHEC
    W->>DB: job ECHEC avec le motif, alerte SYSTEME, rien reconstruit
  end

  RH->>B: ouvre Santé des données
  B->>DI: getDataHealth(ctx) et getImportDetail(ctx, id)
  DI->>DB: dernier import, rejets par règle et par fichier, run courant, heartbeat, jobs
  DI-->>B: DTO santé des données (scoring bloqué si dernier import BLOQUE)
```

Alternatives :

- **Score sous `quality_threshold`** (0,95 par défaut) : statut `BLOQUE`, alerte DONNEES CRITIQUE ; `requestScoring`, `requestRecompute` (409 `SCORING_BLOQUE`) et `scoreMonth` refusent de calculer. Les lignes valides sont néanmoins déjà écrites dans les tables sources (l'import n'est pas transactionnel de bout en bout : c'est le calcul qui est bloqué, pas l'écriture).
- **Fichier obligatoire absent ou en-tête invalide** : exception, statut `ECHEC`.
- **Import en ligne de commande** ([scripts/import.ts](../../scripts/import.ts)) : même `runImport`, suivi de `buildCalendar` et `refreshAggregates`, comme le job `IMPORT` du worker (`rebuildAfterImport`, [src/lib/jobs/handlers.ts](../../src/lib/jobs/handlers.ts)), qui ne reconstruit rien si le lot est en `ECHEC`.
- **Worker arrêté pendant l'import** : `recoverStale` ([src/lib/jobs/index.ts](../../src/lib/jobs/index.ts)) passe en `ECHEC` (audité, « Import interrompu ») le lot `import_batch` resté `EN_COURS` pour ce job, puis remet le job en file une fois (seconde interruption : job `ECHEC`). Couvert par [tests/features/import-job.test.ts](../../tests/features/import-job.test.ts).

## 3. Batch mensuel : variables → scoring → publication → alertes

```mermaid
sequenceDiagram
  autonumber
  participant C as croner (0 2 10 * *, Africa/Tunis)
  participant W as Worker (run.ts)
  participant J as lib/jobs
  participant H as runMonthlyBatch (handlers.ts)
  participant AG as lib/aggregates
  participant F as lib/features
  participant S as lib/scoring (scoreMonth)
  participant E as lib/engine
  participant AN as lib/anomalies
  participant DB as SQLite

  C->>W: déclenchement le 10 à 02:00
  W->>DB: scheduledBatchMonth : dernier mois complet de data_end_date, non encore publié
  W->>J: enqueueJob(BATCH_MENSUEL, mois) : un seul job actif par type et cible
  W->>J: claimNextJob (BEGIN IMMEDIATE, EN_FILE vers EN_COURS)
  J->>H: runJob
  H->>DB: assertMonthCovered : fin du mois inférieure ou égale à data_end_date
  H->>AG: refreshAggregates()
  AG->>DB: tables temporaires, puis une transaction DELETE + INSERT agg_kpi_monthly
  H->>W: heartbeat (au plus toutes les 15 s)
  H->>F: backfillFeatures(mois, mois)
  F->>DB: loadDataset (sources en mémoire) puis computeMonth (éligibilité, 25 variables as-of)
  F->>DB: BEGIN IMMEDIATE : DELETE puis INSERT feature_snapshot (as_of, fsv)
  H->>S: scoreMonth(fin du mois, force)
  S->>DB: dernier import BLOQUE ? fin de mois au-delà de data_end_date ? (sinon refus)
  S->>DB: ensureChampion : champion valide (golden rejoué) ou B0 enregistré et promu
  S->>S: rankAndLevel : score, rang, lift = score / moyenne, niveau (plafond capacity_rate), explain par groupe
  alt run déjà PUBLIE pour (mois, modèle)
    S->>DB: une transaction : réécriture des prédictions, remappage des recommandations, pointeur
  else nouveau run
    S->>DB: INSERT scoring_run STAGING
    loop lots de 500 salariés
      S->>DB: BEGIN IMMEDIATE : INSERT prediction et prediction_factor
    end
    S->>DB: BEGIN IMMEDIATE : scoring_run PUBLIE et current_run_id = run (publication atomique)
  end
  S->>DB: audit scoring.publish
  S->>E: applyPublicationEffects(run)
  E->>DB: BEGIN IMMEDIATE : recommandations (groupe actionnable en hausse dans le top 3, ENTRETIEN si ÉLEVÉ), alertes TURNOVER des nouveaux ÉLEVÉ (dedup)
  H->>AN: detectAnomalies(semaines du mois)
  AN->>DB: BEGIN IMMEDIATE : anomalies collectives (z robuste > 3,5 deux semaines) et Bradford, alertes ABSENTEISME
  H-->>J: résumé
  J->>DB: job TERMINE

  alt exception pendant l'écriture du run
    S->>DB: scoring_run ECHEC, alerte SYSTEME (dedup scoring:mois:run), audit ECHEC
    J->>DB: job ECHEC et alerte SYSTEME (dedup job:id)
  else worker tué en plein calcul
    W->>DB: au redémarrage, recoverStale : job sans heartbeat depuis 10 min remis EN_FILE (une fois), run STAGING orphelin ECHEC
  end
```

Invariant : tant que la dernière transaction n'a pas eu lieu, `current_run_id` désigne le run précédent ; toutes les lectures de l'interface passent par `getPublishedRun()` qui n'accepte qu'un run `PUBLIE` pointé ([ADR-008](../adr/008-publication-atomique-par-pointeur.md)). Les recommandations et alertes sont créées après la publication, hors de la transaction de bascule, et sont idempotentes (clés de déduplication), si bien qu'un rejeu ne crée pas de doublon.

Variantes de déclenchement : `npm run pipeline` ([scripts/pipeline.ts](../../scripts/pipeline.ts)) exécute les mêmes étapes en ligne de commande (avec `--backtest` : un run par mois, seul le dernier publié) ; `POST /api/predictions/run` (RH, ADMIN) met en file un job `SCORING` ; le bouton « Recalculer » de *Santé des données* (ADMIN) met en file un `BATCH_MENSUEL`.

## 4. Consultation d'une fiche par un manager, y compris refus hors périmètre

```mermaid
sequenceDiagram
  autonumber
  actor M as Manager (mgr.M10451)
  participant B as Navigateur
  participant P as proxy.ts
  participant PG as /employees/[id] (Server Component)
  participant CTX as dal/context
  participant EMP as dal/employees
  participant DB as SQLite
  actor ADM as Administrateur

  M->>B: clique un collaborateur de son équipe (/employees/412)
  B->>P: GET /employees/412 avec cookie
  P->>PG: présence du cookie vérifiée
  PG->>CTX: pageContext(PILOTAGE_ROLES)
  CTX->>DB: lecture de la session
  CTX-->>PG: ctx = MANAGER, employeeId = racine de sa hiérarchie
  PG->>EMP: getEmployeeDetail(ctx, 412, source page, ip)
  EMP->>DB: SELECT 1 FROM employee WHERE id = 412
  EMP->>CTX: canSeeEmployee(ctx, 412)
  CTX->>DB: WITH RECURSIVE team : 412 dans la hiérarchie ?
  CTX-->>EMP: oui
  EMP->>DB: loadDetail : identité, contrat, paie, absences hors santé, formations, évaluations, carrière
  EMP->>DB: run pointé par current_run_id (PUBLIE) : prédiction, 5 facteurs, historique 12 mois, recommandations
  EMP->>DB: audit employee.view OK (view MANAGER, salary false, score true)
  EMP->>EMP: toManagerDetailDto : liste blanche (niveau, catégories visibles, pas de salaire, probabilité, lift, phrase chiffrée, absences, augmentations, revue salariale)
  EMP-->>PG: EmployeeDetailManager
  PG-->>B: trois zones : Observations, Estimation (niveau et catégories), Suggestions

  M->>B: saisit /employees/79 (hors de son équipe)
  B->>P: GET /employees/79
  P->>PG: présence du cookie vérifiée
  PG->>EMP: getEmployeeDetail(ctx, 79)
  EMP->>DB: le salarié 79 existe
  EMP->>CTX: canSeeEmployee(ctx, 79)
  CTX-->>EMP: non
  EMP->>DB: audit employee.view REFUSE (source page, ip)
  EMP-->>PG: HttpError 403
  PG-->>B: redirect /interdit (307, la fiche n'a pas de loading.tsx au-dessus)

  M->>B: appelle GET /api/employees/79
  B->>EMP: withApi, requireContext, getEmployeeDetail
  EMP->>DB: audit employee.view REFUSE (source api)
  EMP-->>B: 403 JSON (error.code INTERDIT, message, correlationId)

  ADM->>B: ouvre Journal d'audit, filtre outcome REFUSE
  B->>DB: listAudit (ADMIN seulement)
  DB-->>ADM: tentatives employee.view REFUSE du manager, avec date et IP
```

Alternatives : identifiant inexistant → 404 (`notFound()` sur la page, `INTROUVABLE` sur l'API) sans audit ; identifiant non numérique → 404 ; la fiche de son propre salarié racine n'est pas dans le périmètre (la CTE exclut le manager lui-même) → 403 ; un ADMIN est refusé de la même façon (séparation des tâches).

## 5. What-if (Should, en cours de livraison)

Le what-if est livré en parallèle par un autre contributeur ; ce diagramme suit le code présent au moment de la rédaction ([src/lib/dal/whatif.ts](../../src/lib/dal/whatif.ts), [src/lib/whatif/index.ts](../../src/lib/whatif/index.ts), [src/components/pilotage/what-if-panel.tsx](../../src/components/pilotage/what-if-panel.tsx)) et devra être relu une fois le module stabilisé.

```mermaid
sequenceDiagram
  autonumber
  actor RH as Responsable RH
  participant B as Navigateur (WhatIfPanel)
  participant R as POST /api/employees/[id]/what-if (withApi)
  participant D as dal/whatif (runWhatIf)
  participant WI as lib/whatif (simulate)
  participant F as lib/features
  participant S as lib/scoring
  participant DB as SQLite

  RH->>B: règle les leviers (+8 % salaire, -10 h sup par mois, formation, promotion)
  B->>R: JSON salaryPct, overtimeCutH, trainingHours, promotion, chargeRatePct
  R->>R: contrôle d'origine, requireContext()
  R->>D: runWhatIf(ctx, id, corps)
  D->>D: rôle RH ? sinon audit whatif.run REFUSE et 403
  D->>DB: salarié existe ? (404) et canSeeEmployee
  D->>D: zod strict (bornes 30 %, 40 h, 200 h)
  D->>DB: run publié et prédiction stockée du salarié (sinon 409)
  D->>S: loadRunModel : bundle du modèle du run, relu depuis manifest_json
  D->>WI: simulate(modèle, salarié, date du run, leviers)
  WI->>F: loadEmployeeDataset puis computeMonth : variables avant
  WI->>WI: applyLevers en mémoire (paie et AUGMENTATION, PROMOTION, heures sup des 3 derniers mois, formation terminée)
  WI->>F: computeMonth : variables après, mêmes fonctions que le batch
  WI->>DB: readSnapshots du mois : population des autres salariés
  WI->>S: rankAndLevel et explain : rang, lift, niveau et contributions avant et après
  WI-->>D: écarts, coût annuel = delta mensuel × 12 × (1 + taux de charges)
  D->>DB: audit whatif.run OK (leviers, modèle, date)
  D-->>R: WhatIfDto avec la mention « Estimation non causale »
  R-->>B: 200, aucune écriture hors audit
```

Écarts avec le cahier des charges et le plan : la réponse ne contient pas de « courbe » à 3, 6 et 12 mois (le modèle ne prédit que l'horizon 6 mois) ; la latence visée de 300 ms n'a pas été mesurée.

## Descriptions textuelles des cas d'utilisation illustrés

Les cas ci-dessous sont ceux que ces séquences détaillent ; la liste complète figure dans [CAS_UTILISATION.md](CAS_UTILISATION.md).

### UC-01 — S'authentifier (séquence 1)

- **Acteurs** : Administrateur, Responsable RH, Manager.
- **Préconditions** : compte actif avec mot de passe ; HTTPS en production.
- **Scénario nominal** : redirection vers `/login` par le proxy ; saisie ; validation zod ; réservation de la tentative (`BEGIN IMMEDIATE`) ; vérification argon2id ; session opaque (cookie httpOnly, empreinte SHA-256 en base, 10 h) ; audit `auth.login` OK ; redirection vers `/admin` ou `/dashboard`.
- **Alternatives** : compte inconnu ou inactif (message générique, REFUSE) ; mot de passe faux (compteur, verrouillage progressif dès le 5e échec) ; compte verrouillé ; page hors rôle → `/interdit` ; API hors rôle → 403.

### UC-02 — Importer un export AJIR avec contrôle qualité (séquence 2)

- **Acteurs** : Administrateur, Worker, AJIR.
- **Préconditions** : export conforme au contrat CSV ; aucun import en cours.
- **Scénario nominal** : téléversement (contrôles d'origine, de rôle, de noms, de taille, d'en-tête) ; dépôt dans `data/inbox` ; job `IMPORT` ; traitement en flux avec rejets motivés ; hiérarchie, fin des données, statuts, contrôles de complétude et de volume ; synchronisation des comptes ; score qualité ; statut, alerte DONNEES, audit.
- **Alternatives** : score sous le seuil (BLOQUE, scoring suspendu) ; fichier obligatoire manquant (ECHEC) ; refus immédiat d'un dépôt non conforme ; import CLI avec calendrier et agrégats.

### UC-03 — Exécuter le batch mensuel (séquence 3)

- **Acteurs** : Worker ; Administrateur (relance) ; RH ou Administrateur (scoring via l'API).
- **Préconditions** : dernier import non BLOQUE ; mois couvert par les données ; champion valide.
- **Scénario nominal** : cron → job → agrégats → variables → run STAGING par lots → publication atomique du pointeur → recommandations et alertes TURNOVER idempotentes → anomalies d'absentéisme → job TERMINE.
- **Alternatives** : échec d'écriture (run ECHEC, alerte SYSTEME, pointeur inchangé) ; worker tué (reprise unique puis ECHEC) ; rien à faire (mois déjà publié ou non importé).

### UC-05 — Consulter une fiche collaborateur (séquence 4)

- **Acteurs** : Responsable RH, Manager.
- **Préconditions** : session valide, salarié existant.
- **Scénario nominal** : garde de page ; existence ; périmètre ; chargement des observations, de l'estimation publiée et des recommandations ; audit `employee.view` OK ; DTO du rôle ; affichage en trois zones.
- **Alternatives** : hors périmètre (REFUSE journalisé, `/interdit` ou 403 JSON) ; inexistant (404) ; non évalué ou aucun run ; champion B0 (score à règles) ; Administrateur refusé.

### UC-08 — Simuler un what-if (séquence 5, Should)

- **Acteur** : Responsable RH.
- **Préconditions** : run publié ; salarié évalué ; bundle du modèle lisible.
- **Scénario nominal** : réglage des leviers ; validation stricte ; recalcul des variables avant/après en mémoire à la date du run ; placement dans la population du mois ; contributions par groupe ; coût annuel en TND ; mention non causale ; audit `whatif.run`.
- **Alternatives** : aucun run ou salarié non évalué (409) ; levier inapplicable (422, audit ECHEC) ; rôle non RH (403 journalisé) ; sources modifiées depuis le calcul (note d'avertissement).
