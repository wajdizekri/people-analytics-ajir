# Chapitre 8 — Réalisation et validation

Ce chapitre présente le module réalisé, écran par écran et rôle par rôle, puis la validation : tests unitaires et d'intégration, tests de bout en bout, sécurité, performance et robustesse, accessibilité, évaluation de la détection d'anomalies et déploiement.

## 8.1 Environnement et état de réalisation

Le module est développé en TypeScript strict sur Node.js 24 : Next.js 16.3 (App Router), React 19, better-sqlite3 et Drizzle ORM, zod 4, Tailwind CSS 4, Apache ECharts 6, croner, pino. Le volet hors ligne utilise Python 3.13 (numpy, pandas, scipy, scikit-learn, LightGBM, holidays, pytest). Le code, les migrations, le simulateur, les scripts d'exploitation et la documentation sont réunis dans un seul dépôt ([README.md](../../README.md)).

Le tableau 8.1 récapitule l'état des modules du cahier des charges à la date de rédaction.

*Tableau 8.1 — État de réalisation des modules (d'après le code et [docs/qa/BACKLOG_INTEGRATION.md](../qa/BACKLOG_INTEGRATION.md)).*

| Module | État | Écarts |
|---|---|---|
| M1 Données et intégration AJIR | Réalisé (import, contrôles qualité, lien profond `/go/collaborateur/<matricule>`, import depuis l'interface avec calendrier et agrégats reconstruits) | Périmètre manager selon la hiérarchie du dernier import, pas à date |
| M2 Simulateur RH | Réalisé (2 scénarios, 3 tailles) | Calage non validé sur des statistiques réelles |
| M3 Accès, sécurité, audit | Réalisé (y compris export audité du droit d'accès, opposition, refus à l'entrée des pages journalisés) | — |
| M4 Tableau de bord exécutif | Réalisé | — |
| M5 Moteur de prédiction | Réalisé : champion `logreg-v1-20260930` promu le 30/09/2026, repli automatique sur B0 sous 30 démissions observées (démarrage à froid), registre et retour arrière du calcul publié | Porte de promotion sur backtest client non automatisée |
| M6 Fiche collaborateur | Réalisé (trois zones) | — |
| M7 Alertes et recommandations | Réalisé | État « Obsolète » des objets d'un run annulé non implémenté ; quand un mois est recalculé avec un autre modèle, les recommandations et alertes du calcul remplacé qui ne sont pas reproposées sont rejetées avec un commentaire par une commande auditée (`npm run runs -- supersede`) |
| M8 Absentéisme | Réalisé (collectif robuste, Bradford individuel, prévision à 3 mois) | — |
| *Should* : what-if, backtesting, Transparence | Réalisés | — |
| *Should* : jeton AJIR, retour sur recommandations | Réalisés (jeton HMAC-SHA256 à usage unique, retour « pertinente / non pertinente ») | — |
| Au-delà du cahier : IA par sujet | Réalisé : absentéisme, effectifs et masse salariale, formations, charge de travail (chapitre 7, section 7.12) ; pages de pilotage Synthèse, Équipes, Interventions, Dérive | Résultats sur données simulées seulement |

> **À COMPLÉTER (stagiaire)** : indiquer la version ou le commit de référence du rendu.

## 8.2 Écrans par rôle

La navigation est organisée par rôle : chaque utilisateur ne voit que les entrées auxquelles il a droit, et une URL saisie à la main hors de son rôle le redirige vers une page « Accès interdit ». Les écrans sont décrits ci-dessous ; les figures correspondantes sont des captures à prendre sur la base de démonstration ([docs/DEMO.md](../DEMO.md), comptes `admin`, `rh.demo` et `mgr.M10451`).

### 8.2.1 Écrans communs

- **Connexion** (figure 8.1) : identifiant et mot de passe, message d'erreur identique pour un identifiant inconnu et un mot de passe faux, verrouillage progressif annoncé.
- **Activation de compte** : un compte créé par la synchronisation AJIR ou par l'administrateur s'active par un lien à usage unique, valable 7 jours, qui fixe le mot de passe.
- **Mon compte** : informations du compte, nombre de sessions ouvertes, changement de mot de passe (qui ferme les autres sessions).
- **Alertes** (figure 8.2) : liste filtrable par type, statut et sévérité, détail, transitions Nouvelle → En cours → Traitée ou Rejetée avec commentaire. Chaque rôle ne voit que les alertes de son audience et de son périmètre.

### 8.2.2 Responsable RH

- **Tableau de bord** (figure 8.3) : indicateurs de la période choisie (3 à 24 mois), notamment effectif, entrées, sorties, turnover glissant sur 12 mois total et volontaire, absentéisme hors santé non planifié, formations obligatoires réalisées et masse salariale. S'y ajoutent les séries mensuelles, l'absentéisme par département, et les niveaux de risque du calcul publié par département avec la part non évaluée et le lift moyen. Les filtres portent sur le département, le contrat, l'âge, l'ancienneté et le niveau. Un clic sur un département ou un niveau ouvre la liste filtrée : c'est le passage « indicateur → liste → fiche ».
- **Collaborateurs** (figure 8.4) : liste paginée et triable (matricule, nom, poste, département, contrat, ancienneté, niveau de risque, probabilité à 6 mois ou score à règles, lift), avec les mêmes filtres.
- **Fiche collaborateur** (figure 8.5), en trois zones :
  - *Observations* : contrat et fin de CDD prévue, carrière, paie sur 12 mois, absences hors santé par catégorie, total des jours d'absence pour santé sur 12 mois (fait observé, jamais utilisé dans un calcul), formations, évaluations ;
  - *Estimation* : niveau de risque avec libellé, probabilité à 6 mois (ou « score à règles » en points avec B0), rang, lift, version du modèle, date du calcul, facteurs associés par groupe avec phrase chiffrée, historique des 12 derniers calculs, rappel qu'une prédiction est une estimation ;
  - *Suggestions* : recommandations avec le groupe qui les déclenche, à marquer réalisées (avec une date, ce qui crée une intervention) ou rejetées (avec un commentaire), et un retour « pertinente / non pertinente ».

  Le panneau *what-if* (figure 7.4) complète la fiche RH.
- **Recommandations** : toutes les recommandations ouvertes, par action et par salarié.
- **Absentéisme** (figure 8.6) : taux hebdomadaires d'absence hors santé non planifiée par département ou par équipe, avec le taux attendu corrigé du calendrier. Viennent ensuite les anomalies collectives détectées (période, écart, classe de semaine prise en compte) et les signaux individuels « à vérifier » (facteur de Bradford), réservés à la RH.
- **Backtesting** (figure 8.7) : pour une date passée dont le suivi à 6 mois est complet, les salariés classés Élevé ou Moyen confrontés aux démissions observées ensuite (dates strictement postérieures à l'origine). On y lit par exemple combien de démissions le modèle aurait signalées, et combien de mois à l'avance, avec un bandeau quand la date a été vue à l'entraînement.
- **Synthèse du mois** : constats du mois en phrases (passages en risque élevé, évolutions, alertes), point d'entrée du pilotage.
- **Équipes** : tableau de bord par équipe et carte des équipes (surface proportionnelle à l'effectif, couleur selon la tension).
- **Formations** : formations obligatoires, taux de réalisation, échéances à venir, retards, formations à risque de dépasser l'échéance (niveau et facteurs) et relances proposées.
- **Charge de travail** : heures supplémentaires par ETP des départements et des équipes, 12 mois observés et 3 mois prévus avec fourchette, équipes en tension, surcharges individuelles soutenues (lecture auditée), recommandations.
- **Prévisions des effectifs et de la masse salariale** : projection à 12 mois par département avec intervalle à 80 %, scénario modifiable (rythme d'embauche, hausse de janvier, budget) recalculé côté serveur sans écriture, décomposition des sorties, effectif par grade, recommandations RH ; mention « projection indicative ».
- **Interventions** : taux de réalisation par type d'action et niveau de risque avant / après, sans prétention causale.
- **Droit d'accès** : recherche d'un salarié, enregistrement d'une demande d'accès, d'opposition ou de rectification, export des données détenues, registre des demandes.
- **Santé des données**, **Transparence du modèle** et **Dérive des données**, partagées avec l'administrateur (ci-dessous).

### 8.2.3 Manager

Le manager dispose des mêmes écrans de pilotage, restreints à sa hiérarchie et épurés de toute donnée sensible :

- **Tableau de bord** : indicateurs de son équipe sans masse salariale ni lift ; les filtres contrat, âge et ancienneté sont ignorés et signalés ; les taux et les nombres de sorties sont masqués sous 5 personnes (ADR-011) ;
- **Mon équipe** : ses collaborateurs avec le niveau de risque seul ;
- **Fiche** : observations sans rémunération ni détail d'absences, niveau de risque avec **catégories** de facteurs (sans chiffre), historique des niveaux, recommandations en lecture hors révision salariale (figure 8.8, à comparer à la figure 8.5) ;
- **Absentéisme** : séries de ses équipes, petits groupes masqués, anomalies collectives, prévision de son équipe directe si elle compte au moins 5 personnes, aucun signal individuel ;
- **Synthèse**, **Équipes**, **Formations** (niveau de risque sans probabilité) et **Charge de travail** (équipes d'au moins 5 personnes, recommandations collectives), restreints à sa hiérarchie ; ni prévisions d'effectifs, ni interventions, ni droit d'accès.

### 8.2.4 Administrateur

- **Console d'administration** (figure 8.9) : connexions réussies et échouées par jour, comptes actifs par rôle, refus d'accès par action, jobs par type et par statut, derniers refus, sans aucune donnée RH nominative.
- **Utilisateurs et accès** : création, désactivation, changement de rôle, régénération d'un lien d'activation.
- **Paramètres** : capacité RH (part classée Élevé), seuil de lift Moyen, seuils de démarrage à froid, seuil de qualité, SMIG et son barème daté, seuil de Bradford, seuils des recommandations d'absentéisme et de la surcharge de travail, durées de rétention, budgets annuels de masse salariale ; chaque modification est auditée et s'applique au calcul suivant.
- **Journal d'audit** (figure 8.10) : filtres par utilisateur, action (par préfixe), résultat (OK, REFUSÉ, ÉCHEC) et période.
- **Santé des données** (figure 6.1) : dépôt d'un export, lots, score de qualité, rejets motivés, relance du calcul.
- **Transparence du modèle** (figure 8.11) : champion, type, version du jeu de variables, règles ou coefficients, métriques et calibration, rapport d'équité (lignes sous l'effectif minimal masquées), statut du golden, historique des versions, règle de décision et état du démarrage à froid (modèle réellement utilisé par le calcul publié, nombre de démissions observées, probabilité indicative).
- **Dérive des données** : indice de stabilité de population (PSI) de chaque variable entre la période d'entraînement du champion et le dernier mois, calibration récente, conseil de réentraînement.

## 8.3 Stratégie de test

La validation combine plusieurs niveaux (tableau 8.2). Les tests TypeScript s'exécutent avec Vitest sur de vraies bases SQLite temporaires, construites par les mêmes migrations que la production ; le module `server-only` y est remplacé par un module vide. Les tests de bout en bout pilotent un navigateur avec Playwright.

*Tableau 8.2 — Niveaux de test.*

| Niveau | Outil | Portée | Emplacement |
|---|---|---|---|
| Unitaire et propriétés | Vitest, fast-check | Calendrier, import et règles, agrégats, variables (anti-fuite, masquage santé, cohérence des modes de calcul), scoring (golden, niveaux, ex-æquo, explication), anomalies, jobs, worker | `src/lib/**/*.test.ts`, [tests/unit/](../../tests/unit/) |
| Intégration DAL et pages | Vitest | Périmètre manager, DTO par rôle, petits groupes, pages rendues sans données sensibles, API | [tests/pilotage/](../../tests/pilotage/), [tests/ui-admin/](../../tests/ui-admin/), [tests/whatif/](../../tests/whatif/) |
| Sécurité | Vitest | Matrice d'autorisation par route et par rôle, attaques (injection, CSRF, énumération, contournement) | [tests/security/](../../tests/security/) |
| Exploitation | Vitest | Sauvegarde et restauration | [tests/ops/](../../tests/ops/) |
| Bout en bout | Playwright | Authentification, tableaux de bord RH et manager, fiche, navigation par rôle, accessibilité (axe-core) | [tests/e2e/](../../tests/e2e/) |
| IA par sujet | Vitest | Parité Python / TypeScript sur les golden, étapes idempotentes, santé ignorée, périmètres et petits groupes, transitions et audit des recommandations | [tests/ai/](../../tests/ai/) |
| Protection des données et durcissement | Vitest | Opposition (scoring, variables, panel), export du droit d'accès, rétention, masquage des rejets ; sessions glissantes, limitation de débit, en-têtes, règle ESLint, audit des refus | [tests/privacy/](../../tests/privacy/), [tests/security-hardening/](../../tests/security-hardening/) |
| Hors ligne | pytest | Contrat et réalisme du simulateur ; protocole, métriques, modèles et bundle d'entraînement ; IA par sujet | [ml/sim/tests/](../../ml/sim/tests/), [ml/train/tests/](../../ml/train/tests/), `ml/<sujet>/tests/` |

## 8.4 Résultats des tests

### 8.4.1 Tests unitaires et d'intégration

Lors de la vérification finale du 30/09/2026, la suite Vitest compte **656 tests dans 79 fichiers : 655 réussis, 1 ignoré** (parité des variables de la charge de travail, conditionnée à la présence de la base d'entraînement hors dépôt), hors `tests/security`, qui attaque un serveur lancé à part et s'exécute par `npm run test:security`. Le vérificateur de types TypeScript et ESLint ne relèvent aucune erreur, et le build de production (`next build`) passe sans avertissement. Les tests Python comptent **67 tests** (`python -m pytest ml`), tous réussis. La couverture mesurée par V8 ([docs/qa/COUVERTURE.md](../qa/COUVERTURE.md)) dépasse largement le critère BNF-7 (≥ 70 %) sur les trois modules visés (tableau 8.2 bis).

*Tableau 8.2 bis — Couverture des modules critiques (instructions / branches, source : [COUVERTURE.md](../qa/COUVERTURE.md)).*

| Module | Instructions | Branches |
|---|---|---|
| `src/lib/features` | 99,6 % | 92,9 % |
| `src/lib/dal` | 97,8 % | 90,5 % |
| `src/lib/scoring` | 100 % | 98,5 % |

La campagne de couverture a mis au jour quatre défauts de faible gravité (cache du champion insensible à une altération de même longueur, audit contournable par `INSERT OR REPLACE`, redirection ouverte dans un lien d'alerte, minimum d'un salarié Élevé), corrigés ou arbitrés.

Parmi les propriétés vérifiées, quatre portent directement sur les exigences du cahier des charges :

- **anti-fuite** (BNF-13) : ajouter des lignes datées ou saisies après t ne modifie aucune variable ;
- **masquage de la santé** : un arrêt maladie laisse les variables identiques à celles d'une fenêtre sans ces jours ;
- **fidélité du scorer** (BNF-12) : le golden du bundle est reproduit, et un bundle altéré est refusé à l'enregistrement, à la promotion et au chargement ;
- **niveau indépendant du matricule** : des ex-æquo à la frontière de la capacité restent tous hors Élevé.

### 8.4.2 Autorisation et confidentialité

Une campagne de tests en boîte grise, au niveau HTTP, a été menée sur un serveur de production isolé (copie de la base de démonstration, port dédié). Elle est décrite dans [docs/qa/SECURITE_PERF.md](../qa/SECURITE_PERF.md). Elle compte une soixantaine de tests Vitest regroupant plus de 350 cas HTTP (rôles × routes × charges utiles), tous réussis.

La matrice d'autorisation observée est conforme à l'attendu pour les cinq profils testés (anonyme, administrateur, RH, manager dans son périmètre, manager hors périmètre) sur les treize routes de l'API (tableau 8.3).

*Tableau 8.3 — Extrait de la matrice d'autorisation observée (source : [SECURITE_PERF.md](../qa/SECURITE_PERF.md), § 3).*

| Route | Anonyme | Admin | RH | Manager (périmètre) | Manager (hors) |
|---|---|---|---|---|---|
| `GET /api/dashboard` | 401 | 403 | 200 | 200 | — |
| `GET /api/employees/[id]` | 401 | 403 | 200 | 200 | 403 (existe) / 404 (inexistant) |
| `POST /api/employees/[id]/what-if` | 401 | 403 | 200 / 409 | 403 | 403 |
| `GET /api/imports` | 401 | 200 | 200 | 403 | — |
| `GET /api/admin/users` | 401 | 200 | 403 | 403 | — |
| `POST /api/predictions/run` | 401 | 202 / 400 / 409 | 202 / 400 / 409 | 403 | — |

Côté pages, un utilisateur anonyme est redirigé vers la connexion, et un rôle non autorisé vers la page « Accès interdit ». Pour les pages dotées d'un état de chargement diffusé en flux (*streaming*), la réponse HTTP vaut 200 et la redirection est transportée dans le flux ; la réponse ne contient alors que la coque de chargement, sans aucune donnée métier. Ce comportement, classé informationnel, peut tromper un outil de supervision qui ne regarde que le code HTTP.

La détection de fuite parcourt récursivement toutes les réponses destinées au manager (`/api/employees`, `/api/employees/[id]`, `/api/dashboard`, `/api/alerts`). Elle y cherche les clés interdites, les valeurs connues de salaire, de probabilité, de lift et de masse salariale, les phrases chiffrées de facteurs, les noms hors périmètre et la mention « TND ». **Aucune fuite** n'a été trouvée (critère BNF-2), ni aucun montant ou probabilité dans les réponses destinées à l'administrateur. Deux points restent à arbitrer :

- la liste des comptes renvoie à l'administrateur le nom et le matricule du salarié lié à chaque compte, ce qui est nécessaire pour rattacher un manager mais s'écarte du principe « aucune donnée nominative » ;
- la différence entre 403 (salarié existant hors périmètre) et 404 (inexistant) révèle l'existence d'un identifiant. C'est un choix des conventions du projet, sans donnée nominative exposée.

Les treize routes privées de l'API figurant dans la matrice sont toutes testées pour les cinq profils ; les pages ajoutées ensuite (IA par sujet, pilotage, droit d'accès) sont couvertes par des tests de rôle au niveau de la DAL et des pages, et les refus à l'entrée d'une page ou d'une route sont désormais journalisés (`access.page`, `access.api`).

La campagne a été **rejouée le 30/09/2026 sur le build final** (copie fraîche de la base, modèle LOGREG) : **60 tests HTTP sur 60** réussis, 102 sur 102 avec les tests de durcissement. Les treize routes privées de l'API sont testées pour les cinq profils (**100 %** des routes de la matrice, critère BNF-1). Les 22 écrans ont en outre été ouverts dans un navigateur avec les trois comptes de démonstration (82 pages vues, texte affiché et flux de données du rendu serveur contrôlés) : aucune erreur 500 ; aucune donnée RH nominative pour l'administrateur hors des deux exceptions documentées ; ni salaire, ni probabilité, ni opposition, ni signal individuel d'absentéisme pour le manager. Les 22 réponses « 200 avec redirection diffusée » contrôlées ne contiennent aucune donnée. Cette vérification a conduit à corriger une fuite : l'opposition d'un collaborateur au traitement prédictif apparaissait dans les données « Quoi de neuf » et « Avant / après » transmises au manager, alors que seule la RH doit la connaître ; elle est retirée à la source, dans la couche d'accès aux données. Reste un point mineur à arbitrer : le parcours d'un collaborateur montre au manager le nom de ses anciens managers (information d'organigramme).

### 8.4.3 Sécurité applicative

Le rapport de sécurité ne relève **aucune vulnérabilité critique, élevée ni moyenne**. Les attaques testées sont les suivantes :

- **injection SQL** : 9 charges sur une douzaine de paramètres, sans erreur 500 ni message SQL divulgué ;
- **XSS stocké** dans les alertes : contenu échappé, liens dangereux neutralisés ;
- **CSRF** : 403 sur toute mutation portant une origine étrangère, aucune session émise par la connexion depuis une origine étrangère ;
- **fixation de session**, rejeu après déconnexion, jeton falsifié ;
- **énumération des comptes et verrouillage** ;
- **jeton d'activation** : format strict, usage unique, expiration ;
- **téléversement** : traversée de chemin, extension interdite, en-tête invalide, taille excessive.

Deux points faibles et quatre observations informationnelles avaient été relevés. Le premier était l'**absence d'en-têtes CSP et HSTS** sur le serveur Next.js testé sans reverse proxy (sévérité faible, CVSS indicatif 3,1) : ils sont désormais posés aussi par l'application (CSP toujours, HSTS en production), en plus du reverse proxy. Le second était la latence du tableau de bord sous charge (section 8.4.4).

La campagne a conduit à un **durcissement** livré ensuite :

- **sessions glissantes** : fermeture après 2 h d'inactivité, plafond de 10 h après la connexion, purge des sessions expirées ;
- **limitation de débit** des échecs de connexion et d'activation, par compte et par adresse IP quand celle-ci est fiable (`TRUST_PROXY=1` derrière le reverse proxy) ;
- **règle ESLint** interdisant l'accès direct à la base hors de la couche d'accès aux données, des moteurs, du worker et des scripts ;
- **journalisation des refus** décidés à l'entrée des pages et des routes ;
- `/api/health` en **503** quand la base ou le worker sont hors service ;
- **audit infalsifiable** : un trigger refuse l'écrasement d'une entrée existante ;
- **masquage** : l'administrateur ne voit que le matricule dans les rejets d'import (ni montant, ni valeur brute sensible, ni date ou catégorie d'absence).

La vérification finale a ajouté trois durcissements : limitation des essais du mot de passe actuel lors d'un changement de mot de passe, lecture bornée du corps d'un téléversement même sans en-tête de taille, et retour à la page demandée après une session expirée. `npm audit` ne relève **aucune vulnérabilité dans les dépendances de production** ; les quatre vulnérabilités modérées restantes concernent `drizzle-kit`, un outil de développement qui génère les migrations et n'est pas déployé ([SECURITE_PERF.md](../qa/SECURITE_PERF.md), § 9.4).

> **À COMPLÉTER (stagiaire)** : scan OWASP ZAP (critère BNF-7 : aucune alerte haute), outil non disponible sur le poste de développement.

### 8.4.4 Performance et robustesse

Les mesures de performance ont été faites sur le même serveur isolé, avec la base de démonstration (environ 2 445 salariés). La charge était de 20 utilisateurs virtuels pendant 60 secondes par point d'accès. Le tableau 8.4 donne la mesure finale, sur le build livré, après la mise en cache des agrégats du tableau de bord ; le tableau 8.4 bis rappelle la première mesure.

*Tableau 8.4 — Latences sous charge, 20 utilisateurs virtuels × 60 s, mesure finale du 30/09/2026 (source : [SECURITE_PERF.md](../qa/SECURITE_PERF.md), § 9.3).*

| Point d'accès | Requêtes | Erreurs | p50 | p95 | p99 |
|---|---|---|---|---|---|
| `GET /api/dashboard` | 16 512 | 0 | 71 ms | 103 ms | 136 ms |
| `GET /api/employees` | 8 209 | 0 | 143 ms | 193 ms | 215 ms |

Le critère BNF-3 (p95 < 500 ms) est **tenu** avec une large marge, et le tableau de bord sert 4,5 fois plus de requêtes qu'à la première mesure. La liste des collaborateurs, paginée, n'a pas eu besoin d'optimisation.

*Tableau 8.4 bis — Première mesure, avant la mise en cache (source : [SECURITE_PERF.md](../qa/SECURITE_PERF.md), § 6).*

| Point d'accès | Requêtes | Erreurs | p50 | p95 | p99 |
|---|---|---|---|---|---|
| `GET /api/dashboard` | 3 633 | 0 | 299 ms | 554 ms | 984 ms |
| `GET /api/employees` | 2 859 | 0 | 385 ms | 750 ms | 1 077 ms |

Une seconde mesure avait donné un p95 de 424 ms pour le tableau de bord et de 427 ms pour la liste : le critère était alors **à la limite**. Deux facteurs y contribuaient :

- **la charge de la machine** : d'autres compilations tournaient en parallèle pendant la première mesure (maximum de 1 581 ms contre 712 ms à la seconde) ;
- **un facteur structurel** : better-sqlite3 est synchrone, et vingt requêtes concurrentes qui exécutent chacune plusieurs requêtes d'agrégation se sérialisent sur l'unique fil d'exécution de Node.js.

En charge légère, la réponse était inférieure à 40 ms. La correction retenue est une mise en cache des agrégats en mémoire, indexée sur le périmètre, les filtres et la version des données (calcul publié, dernier import, recalcul des agrégats), qui ne changent qu'au calcul mensuel : c'est elle que mesure le tableau 8.4.

Le **calcul mensuel complet** (calendrier, agrégats, variables sur 72 mois, scoring, anomalies, alertes) a duré **1,06 minute** sur une copie isolée de la base lors de la première campagne ; lors de la vérification finale, le calcul du dernier mois a pris **16,8 s** sur une copie isolée. Sur la base de démonstration, après la promotion du modèle LOGREG, `npm run pipeline` a pris **14 s** le 30/09/2026 : agrégats 4,5 s, variables des 72 mois 7,9 s, scoring 0,2 s, anomalies 0,2 s, quatre étapes IA 1,0 s. Le critère BNF-4 (< 15 min) est largement tenu.

La **restauration** d'une sauvegarde de la base de démonstration (155 Mo) prend de 16 à 58 s de traitement selon la charge du poste, de 19 s à 1 min 30 lancement compris ([docs/EXPLOITATION.md](../EXPLOITATION.md), § 5) : le critère BNF-6 (< 5 min) est tenu. Pour la **reprise** (BNF-5), un job interrompu est remis en file une fois au redémarrage du worker puis passe en échec, un run en préparation orphelin passe en échec sans toucher au calcul publié, et un import interrompu est marqué en échec ; ces cas sont couverts par des tests automatisés, pas par une mesure d'arrêt réel sur le serveur cible.

### 8.4.5 Accessibilité et tests de bout en bout

Un audit d'accessibilité selon les WCAG 2.1 niveau AA, complété par les règles d'interface du projet, a d'abord été mené par relecture du code et calcul des contrastes ([docs/qa/ACCESSIBILITE.md](../qa/ACCESSIBILITE.md)). Il a conduit à corriger une cinquantaine de constats, parmi lesquels :

- un **lien d'évitement** vers le contenu ;
- un **menu mobile** accessible au clavier (focus déplacé à l'ouverture, fermeture par Échap), qui manquait sous la largeur tablette ;
- des **contrastes** insuffisants : titres de section, bordures de champs, textes secondaires, portés à au moins 4,5:1 pour le texte et 3:1 pour les composants ;
- des **erreurs de formulaire** reliées aux champs (`aria-invalid`, `aria-describedby`) et annoncées ;
- des **tableaux de données** en alternative à chaque graphique, avec légende et en-têtes de ligne ;
- des **confirmations** avant les actions irréversibles (rejet d'une recommandation, clôture d'une alerte, recalcul, changement de paramètre) ;
- un formatage des dates dans le fuseau `Africa/Tunis` pour éviter les décalages d'un jour.

La règle « une couleur de risque toujours accompagnée d'un libellé » et les états chargement, vide et erreur sont vérifiés. L'audit automatisé par **axe-core** (WCAG 2 A et AA), intégré à la suite de bout en bout, couvre ensuite **39 pages** des quatre profils, dont les écrans ajoutés en fin de projet : il ne relève **aucune violation** sur le build final. Quatre points restent ouverts, sans relever du niveau AA de WCAG 2.1 ou en attente d'un arbitrage de charte : variation favorable ou défavorable des indicateurs portée par la seule couleur pour un daltonien (elle est annoncée aux lecteurs d'écran), confirmations par la boîte de dialogue native du navigateur, focus non déplacé après une navigation, taille des petits boutons du tableau des comptes.

La campagne Playwright de bout en bout ([docs/qa/BUGS_E2E.md](../qa/BUGS_E2E.md)) compte **113 tests** sur un build isolé et une copie de la base. Une première campagne (93 tests) avait relevé 4 défauts fonctionnels (formulaires de rejet qui perdent le choix après un refus serveur, message de confirmation absent, dates de démission antérieures à l'origine dans le backtesting) et 11 violations d'accessibilité (contrastes de 4,3 à 4,47:1 pour 4,5:1 attendus, liste de définitions mal structurée dans la fiche), tous corrigés. La vérification finale du 30/09/2026 s'est faite en trois passes : la première a révélé une zone défilante inaccessible au clavier et trois tests devenus obsolètes ; l'audit axe étendu aux nouvelles pages a ensuite relevé 10 violations (contraste des notes de bas de page, zones défilantes), corrigées dans l'application. La dernière passe donne **113 tests réussis sur 113**, dont un contrôle de la politique de sécurité du contenu (CSP) dans le navigateur : aucune ressource bloquée sur les écrans des trois rôles. Sont couverts : authentification des trois rôles, menus et accès refusés, tableaux de bord, liste et fiche avec DTO par rôle, workflow des alertes, recommandation réalisée devenant une intervention, santé des données, transparence, backtesting, what-if et administration.

### 8.4.6 Test utilisateur

> **À COMPLÉTER (stagiaire)** : test scénarisé de 6 tâches (BNF-14 : ≥ 80 % de réussite, SUS indicatif) — participants (RH de clients AJIR ou consultants ArabSoft jouant des personas, limite à signaler), tâches, taux de réussite, temps, erreurs, score SUS. Aucun résultat de test utilisateur ne figure dans le dépôt.

## 8.5 Évaluation de la détection d'anomalies d'absentéisme

### 8.5.1 Méthode de détection

La détection collective ([src/lib/anomalies/index.ts](../../src/lib/anomalies/index.ts)) suit, pour chaque équipe et chaque département d'au moins 5 actifs, le taux hebdomadaire d'absence hors santé non planifiée. Pour chaque semaine, le taux attendu est la **médiane** des 26 semaines précédentes, chacune ramenée à une semaine normale par un facteur de classe calendaire, puis multipliée par le facteur de la semaine courante. Quatre classes sont distinguées : Ramadan, semaine avec férié ou pont, séance unique, normale. Chaque facteur est le rapport du taux de l'entreprise dans cette classe à son taux en semaine normale.

La dispersion est estimée de façon robuste par l'écart absolu médian (MAD), avec un plancher binomial pour les petits effectifs. Un signal est émis quand le score z robuste dépasse 3,5 **deux semaines de suite**. Le message chiffre l'écart (« +x points ») et nomme la classe de semaine prise en compte.

Le signal individuel utilise le facteur de Bradford (S² × D) sur 12 mois, hors santé, avec un seuil réglable (250 par défaut). Il est réservé à la RH et formulé « à vérifier avec le salarié, sans présumer de sa cause ».

### 8.5.2 Protocole d'évaluation

La détection a été évaluée contre la vérité terrain du simulateur ([docs/RESULTATS_ANOMALIES_QUALITE.md](../RESULTATS_ANOMALIES_QUALITE.md)). Le jeu principal est `mixte_medium_s1`, dans lequel 112 anomalies injectées sont évaluables : 31 pics d'équipe, 25 rotations d'équipe, 22 motifs lundi-vendredi, 11 motifs autour des ponts et 23 dérives. La rotation d'équipe est un type **réservé à l'évaluation**, jamais utilisé pour régler la méthode. Le jeu `mixte_medium_s2` sert de validation hors échantillon.

Une détection correspond à une anomalie si les périodes se chevauchent et si au moins un salarié touché appartient au groupe signalé. Comme cet appariement est permissif pour les anomalies longues, le rappel « dû au hasard » est estimé en décalant les détections de ±26 et ±52 semaines. La règle a été réimplémentée en Python sur les scores exportés par le code TypeScript : les deux donnent des détections identiques (64 sur 64).

### 8.5.3 Détection collective

*Tableau 8.5 — Rappel par type d'anomalie, réglage nominal (z > 3,5 deux semaines de suite), mode batch (source : [RESULTATS_ANOMALIES_QUALITE.md](../RESULTATS_ANOMALIES_QUALITE.md), § 3.1).*

| Type injecté | Événements | Détectés | Rappel | Délai médian |
|---|---|---|---|---|
| Pic d'équipe | 31 | 27 | 87,1 % | 16 j |
| Rotation d'équipe (réservé à l'évaluation) | 25 | 18 | 72,0 % | 18 j |
| Lundi-vendredi | 22 | 2 | 9,1 % | 80 j |
| Ponts | 11 | 0 | 0,0 % | — |
| Dérive | 23 | 1 | 4,3 % | 156 j |

Sur 66 mois, les 64 détections collectives comptent 48 vraies, soit une **précision de 75,0 %**, et **0,24 fausse détection par mois** pour environ 155 équipes suivies. Quatre des seize fausses détections coïncident avec la phase de pré-départ simulée d'un membre de l'équipe : un phénomène réel du simulateur, mais non étiqueté comme anomalie. Rejouée mois par mois comme le ferait le worker, la détection donne une précision de 75,9 % et 0,21 fausse détection par mois. Le délai opérationnel médian, jusqu'au calcul du 10 du mois suivant, est de 35 jours pour les pics et de 41 jours pour les rotations.

La méthode détecte les deux types **collectifs**, y compris la rotation qu'elle n'avait jamais vue. Elle ne détecte **pas** les trois types **individuels** (lundi-vendredi, ponts, dérive) : quelques jours d'absence d'une personne ne suffisent pas à faire franchir le seuil au taux d'une équipe. Leurs rares « détections » ne dépassent guère ce que le hasard produit. Le rapport montre aussi que 99,05 % des semaines d'équipe ont un attendu nul. Le score se réduit alors à un test binomial contre le plancher de 2 % : z > 3,5 revient à plus de 8,7 % d'absence, soit environ trois jours d'absence non planifiée dans la semaine pour une équipe de six à sept personnes, deux semaines de suite. C'est ce plancher, et non la médiane, qui fixe la sensibilité à l'échelle d'une équipe.

**La règle des deux semaines consécutives est ce qui rend la méthode exploitable.** À seuil égal (z = 3,5), exiger une seule semaine produit 7,91 fausses détections par mois et une précision de 18,8 %. En exiger deux divise les faux positifs par 33 (0,24 par mois). Le coût est de 13 points de rappel sur les pics, 28 sur les rotations, et 7 à 9 jours de délai. Exiger trois semaines coûte encore une semaine de délai (tableau 3.2 du rapport de résultats).

Les PR-AUC au niveau des événements, avec deux semaines consécutives et un seuil variable, valent 0,850 pour les pics, 0,687 pour les rotations et 0,512 toutes anomalies confondues.

### 8.5.4 Apport du calendrier tunisien

Les facteurs de classe estimés sur les données simulées sont proches de 1 : 1,086 pour le Ramadan, 0,983 pour les semaines avec férié ou pont, 0,819 pour la séance unique. Le simulateur module en effet peu l'absentéisme non planifié selon le calendrier. Au réglage nominal, retirer la correction ne change presque rien, car le plancher de 2 % domine la variance des petites équipes.

Pour mesurer l'apport de la correction quand l'effet existe, deux scénarios de stress ajoutent des absences d'un jour pendant le Ramadan et autour des fériés. Dans le scénario le plus marqué (Ramadan × 2, jours collés aux fériés × 3) avec un seuil abaissé à z = 3, la correction **évite 10 fausses détections sur 46**. Elle fait disparaître 10 des 11 fausses détections du Ramadan et 5 des 7 de l'Aïd, sans perdre aucune anomalie d'équipe (27 pics et 24 rotations détectés dans les deux cas). Le calendrier tunisien est donc une protection dont l'effet dépend de la force de la saisonnalité réelle. Il faudra le mesurer sur les données d'un client.

### 8.5.5 Signal individuel (Bradford)

Recalculé chaque mois comme le ferait le worker (66 calculs), le facteur de Bradford au seuil de 250 signale en moyenne 1,70 % des salariés par mois, avec une précision de 78,7 %. Il retrouve 77 % des motifs lundi-vendredi, 73 % des motifs autour des ponts et 74 % des dérives, mais tard : délai médian de 75, 198 et 163 jours. Il ne dit pas non plus de quel motif il s'agit, puisqu'il mesure un volume d'absences courtes. Il complète ainsi la détection collective sur les types qu'elle manque. Le tableau de sensibilité au seuil (100 à 600) figure dans le rapport de résultats (§ 5).

### 8.5.6 Une amélioration écartée pour raison éthique

Des tests individuels « typés » ont été prototypés en Python : un test binomial sur la part des absences courtes tombant un lundi ou un vendredi, ou collées à un pont. Ils sont nettement plus précis que Bradford. À rappel égal sur le motif lundi-vendredi (77 %), ils signalent environ trente fois moins de salariés, et ils nomment le motif. Nous avons pourtant choisi de **ne pas les porter en production**. Un signal individuel qui qualifie un motif du type « absences collées aux week-ends » s'apparente à une détection d'abus, que le cahier des charges exclut explicitement (*Won't* : détection de fraude). Il présume en outre d'une intention que les données ne permettent pas d'établir. Ce choix illustre la position du chapitre 9 : un gain de performance ne justifie pas à lui seul un traitement plus intrusif.

Une règle collective combinée (« z > 4 deux semaines ou z > 2,5 trois semaines ») a aussi été testée. Son gain, net sur la graine qui a servi à la choisir, se réduit sur la seconde graine à +4 points de rappel, sans baisse des faux positifs : il n'a pas été retenu.

### 8.5.7 Limites de l'évaluation

- Les taux mesurés dépendent des intensités d'anomalies choisies dans le simulateur : ils **classent** les méthodes plus qu'ils ne prédisent la production.
- La composition des équipes est **statique** : chaque salarié est rattaché à son manager actuel. Or 22 % des salariés touchés par une anomalie d'équipe ont aujourd'hui un autre manager qu'au moment de l'injection. Reconstruire la hiérarchie à date depuis les changements de manager corrigerait ce point.
- La détection lit toutes les absences importées, **sans appliquer la règle de visibilité à la date de saisie** : une absence saisie après le calcul mensuel manquerait à ce calcul en production.
- Les réglages ont été choisis sur la graine 1 : seuls les résultats de la graine 2 sont hors échantillon.

## 8.6 Déploiement

Le déploiement cible un serveur Windows du client, sans accès Internet, décrit dans le guide d'installation ([docs/INSTALLATION.md](../INSTALLATION.md)) et le manuel d'exploitation ([docs/EXPLOITATION.md](../EXPLOITATION.md)) :

1. installation de Node.js et d'un compte de service, copie de l'application avec ses modules natifs précompilés ;
2. fichier de configuration `.env` protégé par ACL ;
3. création de la base par les migrations et du premier administrateur ;
4. premier import de l'historique AJIR et premier calcul ;
5. enregistrement des services web et worker (WinSW) ;
6. ouverture du pare-feu ;
7. reverse proxy HTTPS (Caddy) avec le certificat de la PKI interne ;
8. sauvegarde quotidienne planifiée ;
9. vérification finale par `/api/health`.

Les fichiers de déploiement sont fournis dans [deploy/](../../deploy/) : définitions des services WinSW (web, worker, proxy), configuration Caddy avec en-têtes de sécurité, modèle de fichier `.env` et script de sauvegarde planifiée. Le manuel d'exploitation couvre le calendrier mensuel, l'import, la surveillance du calcul, la conduite à tenir en cas d'import bloqué, de worker arrêté ou de modèle refusé au chargement. Il traite aussi de la sauvegarde et de la restauration, de la rotation des journaux, de la rétention et du réentraînement par un consultant.

Le guide couvre aussi l'enregistrement des modèles livrés (turnover et IA par sujet), la règle de démarrage à froid, la purge mensuelle de rétention (`npm run retention`) et un contrôle global de l'installation (`npm run check-install`).

> **À COMPLÉTER (stagiaire)** — durée d'installation mesurée en suivant le guide sur un serveur sans Internet (objectif du plan : < 30 min), problèmes rencontrés. D'après le backlog d'intégration ([docs/qa/BACKLOG_INTEGRATION.md](../qa/BACKLOG_INTEGRATION.md)), la configuration Caddy et les services WinSW sur un vrai Windows Server n'ont pas encore été validés faute d'environnement cible ; la CSP a été validée dans Chromium par la suite de bout en bout, et `npm run check-install` ne relève aucun échec sur le poste de développement (6 avertissements liés à l'environnement : `.env`, variables de production, worker non démarré).

## 8.7 Conclusion

Le module couvre les huit modules *Must*, les *Should* et quatre IA par sujet au-delà du cahier des charges, avec des écarts identifiés et tracés. La validation s'appuie d'abord sur des tests automatisés qui vérifient les propriétés critiques (anti-fuite, masquage de la santé, fidélité du scorer, cloisonnement des rôles). Les critères chiffrés de performance, de robustesse et d'utilisabilité sont confrontés aux mesures de la section 8.4.
