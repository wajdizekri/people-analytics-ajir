# Audit G — Couverture fonctionnelle et fonctionnalités manquantes

Date : 04/10/2026. Agent G, audit produit en lecture seule.

## Périmètre

Section 4 du prompt (audit fonctionnel) et partie B du rapport (fonctionnalités manquantes). Domaines : gestion des accès, People Analytics, Predictive Analytics, application RH. Référence : sujet v2 (`Sujet_PFE_People_Analytics_AJIR_v2.pdf`, MoSCoW p. 4), `PLAN_PFE.md`, `docs/CONVENTIONS.md`. Le dossier `wt\` (chantier IA en cours) n'est pas audité : seul `docs/qa/CHANTIER_IA.md` est cité.

## Méthode

Lecture du sujet (10 pages), du plan et des conventions, puis vérification dans le code : schéma `src/db/schema.ts`, import `src/lib/import/**`, DAL `src/lib/dal/**`, pages `src/app/(app)/**`, menu `src/components/layout/sidebar.tsx`. Aucune exécution (ni serveur, ni test). Chaque état cite un fichier et une ligne. Une donnée absente de l'export AJIR et non exigée par le sujet n'est pas comptée comme défaut.

Légende : ✅ complète, ⚠️ partielle, ❌ absente, 🔄 existe mais améliorable.

## 1. Tableau fonctionnel

### Gestion des accès

| Domaine | Fonctionnalité | État | Preuve | Exigence du sujet |
|---|---|---|---|---|
| Accès | Authentification : login, verrouillage progressif, message générique, sessions opaques avec expiration glissante, déconnexion | ✅ | `src/lib/auth/login.ts:16-22`, `session.ts:11-15`, `app/login/actions.ts` (destroySession) | Must M3 |
| Accès | Rôles ADMIN / RH / MANAGER | ✅ | `schema.ts:378`, `dal/context.ts:81-85` (PILOTAGE_ROLES, isGlobal, homePath) | Must M3 |
| Accès | Permissions côté serveur, périmètre hiérarchique récursif, 403 audité / 404 | ✅ | `dal/context.ts:87-124`, `dal/employees.ts:598-616` | Must M3 |
| Accès | Accès différencié : DTO manager en liste blanche, menu et accueil par rôle | ✅ | `dal/employees.ts:540-593`, `dal/dashboard.ts:417`, `sidebar.tsx:17-73` | Must M3 |
| Accès | Administration des comptes : création, désactivation (sessions révoquées), déverrouillage, lien d'activation 7 jours | ✅ | `dal/admin.ts:113-184`. Pas de changement de rôle dans l'UI : le rôle vient de `users.csv` (`import/users.ts:56`), choix cohérent avec « AJIR reste la référence » | Must M3, M1 |
| Accès | Mon compte : changement de mot de passe, révocation des autres sessions | ✅ | `dal/account.ts:66,87` | Must M3 |
| Accès | Export audité du droit d'accès, opposition | ✅ | `dal/privacy.ts:239,328`, page `/confidentialite` | Must M3 |

### People Analytics

| Domaine | Fonctionnalité | État | Preuve | Exigence du sujet |
|---|---|---|---|---|
| People | Effectif (CDI et CDD, hors stages et SIVP) | ✅ | `dashboard/page.tsx:393-402`, `aggregates/index.ts:7,159` | Must M4 |
| People | Entrées, sorties, turnover glissant 12 mois total et volontaire | ✅ | `dashboard/page.tsx:372-413` | Must M4 |
| People | Départements : filtre, comparaison, risque Élevé et lift par département | ✅ | `dashboard/page.tsx:551,610`, `dal/dashboard.ts:85-87` | Must M4 |
| People | Masse salariale (RH seule) | ✅ | `dashboard/page.tsx:427-444` ; absente du DTO manager (`dal/dashboard.ts:417`) | Must M4 |
| People | Âge | 🔄 | Filtre seulement (`dal/employees.ts:17-22,88-93`). Aucune répartition affichée | Filtre (PLAN M4) ; exclu du modèle, gardé pour l'équité (sujet p. 7) |
| People | Ancienneté | ✅ | Filtre (`dal/employees.ts:23-29`), fiche (`tenureMonths`), courbes de rétention (`dal/retention.ts:11-12`) | Filtre (PLAN M4), variable du modèle |
| People | Contrats | ✅ | Filtre, contrat courant et « Fin de CDD prévue » sur la fiche (`employee-detail.tsx:168`), rétention par premier contrat | Must M6 (fin de CDD affichée) |
| People | Absentéisme hors santé | ✅ | Page `/absenteeism`, KPI `dashboard/page.tsx:382-392` | Must M4, M8 |
| People | Retards | ⚠️ | Variable `late_count_3m` (`shared/features.json:26`), visible dans la phrase chiffrée d'un facteur RH. `agg_kpi_monthly.late_count` est calculé mais lu par aucune DAL ni page | Variable du modèle (sujet p. 7), pas un KPI |
| People | Congés | ⚠️ | Catégorie `CONGE_ANNUEL` importée (`schema.ts:93`), listée dans la fiche RH (`dal/employees.ts:417-423`), exclue de l'absentéisme. Pas de solde : absent de l'export | Non exigé |
| People | Formations | ✅ | Page `/formations`, KPI formations obligatoires (`dashboard/page.tsx:414-426`), fiche | Must M4 |
| People | Compétences | ❌ | Aucune table ni colonne ; absent du contrat d'export (`CONVENTIONS.md:63-75`) | Non exigé : présenté comme hors périmètre, pas comme défaut |
| People | Évaluations | ✅ | Table `evaluation` (`schema.ts:141-151`), import `evaluations.csv` (`import/index.ts:25`), 10 dernières sur la fiche (`dal/employees.ts:438-440`), variables `last_eval_score`, `eval_delta`, `eval_missing` | Variable du modèle (sujet p. 7) |
| People | Filtres période, département, contrat, âge, ancienneté ; drill-down KPI → liste → fiche | ✅ | `dal/dashboard.ts:46-58`, `dashboard/page.tsx:231,360` | Must M4 |
| People | Comparaison N / N−1 | 🔄 | Variation début / fin de la période choisie (`dashboard/page.tsx:346`), mois / mois précédent dans la synthèse. Pas de comparaison annuelle | PLAN M4 seulement ; sujet muet |

### Predictive Analytics

| Domaine | Fonctionnalité | État | Preuve | Exigence du sujet |
|---|---|---|---|---|
| Prédictif | Score de risque à 6 mois calibré ; score à règles B0 en repli (démarrage à froid) | ✅ | `schema.ts:275` (`prob6`), `scoring/cold-start.ts`, `CONVENTIONS.md:129` | Must M5, M6 |
| Prédictif | Niveau de risque fixé par la capacité RH | ✅ | `settings.ts:5,7` (`capacity_rate`, `medium_lift`), `CONVENTIONS.md:131` | Sujet p. 8 |
| Prédictif | Facteurs explicatifs par groupe, rendus selon le rôle, mention « facteurs associés » | ✅ | `schema.ts:285-300`, `dal/employees.ts:516-555`, `employee-detail.tsx:481` | Must M6, sujet p. 8 |
| Prédictif | Historique des scores (12 mois) | ✅ | `dal/employees.ts:462-474` | PLAN M6 |
| Prédictif | Horizons 3 et 12 mois | ❌ | Seule `prob6` existe (`schema.ts:275`) | Could : pas un défaut |
| Prédictif | Anomalies collectives d'absentéisme corrigées du calendrier tunisien | ✅ | `anomalies/index.ts:22,69,300` | Must M8 |
| Prédictif | Signal individuel RH « à vérifier » (Bradford) | ✅ | `anomalies/index.ts:365`, `absenteeism/page.tsx:391-395` ; masqué au manager (`dal/alerts.ts:74`) | Must M8 |
| Prédictif | Contrôle qualité de l'import (25 règles, score bloquant) | ✅ | `import/rules.ts:5-31`, `settings.ts:9` | Must M1 |
| Prédictif | Recommandations turnover : groupe actionnable du top 3, entretien si Élevé, statut | ⚠️ | `engine/recommendations.ts:61-70`. Catalogue codé en dur (`engine/recommendations.ts:7-13`), aucun réglage dans `settings.ts` | Must M7 ; sujet p. 8 : « catalogue paramétrable » |
| Prédictif | Recommandation réalisée → intervention datée | ✅ | `dal/recommendations.ts:189` | Must M7 |
| Prédictif | Retour « pertinente / non pertinente » | ✅ | `schema.ts:311`, `dal/recommendations.ts:203-208` | Should |
| Prédictif | What-if RH (salaire, heures sup, formation, promotion, coût annuel) | ✅ | `dal/whatif.ts:16-19,42` | Should |
| Prédictif | Backtesting (« aurait signalé X… », délai moyen avant démission) | ✅ | `backtesting/page.tsx:269,424` | Should |
| Prédictif | Transparence : fiche du modèle, fiabilité, équité, suivi mensuel | ✅ | `transparency/page.tsx:1027,1039,1048` | Should |
| Prédictif | Prévision d'absentéisme à 3 mois | ✅ | `dal/ai-absenteeism.ts:53`, `absenteeism/page.tsx:218` | Could (sujet p. 4) ; classée Won't dans `PLAN_PFE.md:218` |
| Prédictif | Dérive des données (PSI) | ✅ | Page `/derive` (`derive/page.tsx:163`) | Could du PLAN ; absente du sujet v2 |

### Application RH

| Domaine | Fonctionnalité | État | Preuve | Exigence du sujet |
|---|---|---|---|---|
| Application | Tableau de bord RH et manager | ✅ | `dashboard/page.tsx:341-452` | Must M4 |
| Application | Collaborateurs : liste filtrable, recherche, tri par risque par défaut | ✅ | `dal/employees.ts:164-172` | Must M4 (liste du drill-down) |
| Application | Fiche collaborateur en trois zones | ✅ | `employees/[id]/page.tsx:83-87` (Faits, Estimation, Suggestions) | Must M6 |
| Application | Écran « prédictions » | 🔄 | Pas d'écran dédié : la liste Collaborateurs triée par risque en tient lieu. L'entrée « Rétention » (`sidebar.tsx:42`) désigne la rétention des embauchés (`retention/page.tsx:15`), pas les prédictions | Sujet p. 3 (RH : « prédictions ») |
| Application | Alertes : 4 types, workflow, commentaire obligatoire au rejet, routage par rôle, dédoublonnage | ✅ | `schema.ts:349-350`, `dal/alerts.ts:50-62,68-83`, `engine/alerts.ts:17-21` | Must M7 |
| Application | Administration : console, paramètres, audit, santé des données, import par l'interface | ✅ | `sidebar.tsx:49-63`, `data-health/admin-controls.tsx:112,158`, `api/imports/route.ts:37` | Must M1, M3 |
| Application | Intégration AJIR : liens profonds, jeton signé | ✅ | `src/app/go/tableau-de-bord`, `src/app/go/collaborateur/[matricule]`, `api/ajir/launch/route.ts` | Must M1 ; jeton : Should |
| Application | Recommandations par thème (absentéisme, effectifs, formation, charge) | 🔄 | 4 flux, 4 pages (`absenteeism/page.tsx:329`, `previsions/page.tsx:168`, `formations/page.tsx:309`, `charge/page.tsx:456`). La page « Recommandations » ne lit que le turnover (`recommendations/page.tsx:8,63`) | Hors sujet (ajout) |
| Application | Navigation | 🔄 | 20 entrées pour la RH, 12 pour le manager. Manager : « Mon équipe » et « Mes équipes » côte à côte (`sidebar.tsx:29-30`) | — |
| Application | Export PDF de la fiche | ❌ | Bouton d'impression seulement sur la synthèse (`synthese/page.tsx:123`) | Could : pas un défaut |

**Décompte (48 lignes) : ✅ 37 · ⚠️ 3 · ❌ 3 · 🔄 5.** Les trois ❌ ne sont pas exigés : compétences, horizons 3 et 12 mois (Could), export PDF (Could). Tous les Must et tous les Should du sujet sont présents.

## 2. Fonctionnalités manquantes ou à corriger

Triées par priorité.

| Fonctionnalité | État | Priorité | Pourquoi | Solution |
|---|---|---|---|---|
| Recommandations par thème dispersées | 🔄 | P1 · moyen | Cinq flux de recommandations, une seule page « Recommandations » qui n'en montre qu'un (`recommendations/page.tsx:63`). La RH ne voit pas tout ce qui attend sa décision. Question probable du jury : « où sont toutes les recommandations ? » | Onglet « Par thème » dans `/recommendations` : liste des `insight_recommendation` proposées, lien vers la page d'origine. À défaut (effort faible), renommer la page « Recommandations de rétention » |
| Catalogue de recommandations non paramétrable | ⚠️ | P1 · faible | Le sujet (p. 8) exige un « catalogue paramétrable ». `ACTION_BY_GROUP` est une constante (`engine/recommendations.ts:7-11`) ; rien dans `settings.ts` | Clé `app_setting` (JSON groupe → action, activée oui/non) lue par `actionsFor`, réglable dans Paramètres. Minimum : écrire dans le rapport « catalogue modifiable par configuration » et le montrer |
| « Mon équipe » et « Mes équipes » dans le menu manager | 🔄 | P1 · faible | Deux entrées quasi homonymes, deux contenus différents (liste de personnes, indicateurs par équipe : `sidebar.tsx:29-30`). Confusion en démo manager | Renommer, par exemple « Mes collaborateurs » et « Indicateurs d'équipe » |
| Chiffre d'effectif du script de démo | à vérifier | P1 · faible | `DEMO.md:66` annonce « effectif 1 168 » au tableau de bord. Même définition (CDI + CDD) : 1 069 au 31/08/2026 (`RESULTATS_IA_EFFECTIFS.md:15`). 1 168 = actifs tous contrats (`RESULTATS_IA_CHARGE.md:151`). Risque d'annoncer un chiffre faux en direct | Relire le KPI à l'écran, corriger `DEMO.md`, expliquer l'écart KPI / liste « tous contrats » (stages, SIVP) |
| Accès aux prédictions peu visible ; « Rétention » ambigu | 🔄 | P2 · faible | Le cœur prédictif passe par « Collaborateurs ». « Rétention » peut être lu comme « risque de départ » alors que la page décrit le maintien des embauchés | Renommer l'entrée « Rétention des embauchés » (libellé déjà utilisé : `dashboard/page.tsx:375`). En démo, dire que la liste est triée par risque par défaut |
| Alerte turnover à chaque retour en Élevé | 🔄 | P3 · faible | Le plan prévoit « non signalé depuis 90 jours » (`PLAN_PFE.md:191`). Le code teste seulement le run précédent (`engine/recommendations.ts:92-116`) : un salarié qui oscille relance une alerte | Ignorer un salarié ayant une alerte TURNOVER de moins de 90 jours, ou documenter le choix |
| Retards non restitués | ⚠️ | P3 · faible | `late_count` agrégé mais jamais lu ; non exigé comme KPI | Ne rien ajouter. Le citer comme variable du modèle (facteur « Temps de travail ») |
| Composition de l'effectif (âge, ancienneté, contrat) | 🔄 | P3 · moyen | Filtres seulement, aucune répartition. Non exigé par le sujet (M4) | Seulement si l'encadrant le demande : une carte RH dans le tableau de bord existant, masquée côté manager sous 5 personnes. Pas de nouvelle page |
| Comparaison N / N−1 | 🔄 | P3 · faible | Prévue par `PLAN_PFE.md:177`, absente du sujet v2 | Laisser. Décrire dans le rapport la variation sur la période choisie |
| Prévision d'absentéisme : Won't dans le plan, Could dans le sujet | doc | P3 · faible | `PLAN_PFE.md:218` contredit le sujet (p. 4). Le rapport suit le sujet (`docs/rapport/04-analyse-specification.md:129`) | Aligner le plan, ou citer l'écart comme évolution du périmètre |
| Could absents : horizons 3 et 12 mois, export PDF, interface arabe, SQLCipher, LightGBM en production | ❌ | P3 | Non exigés (Could) | À citer en perspectives. Ne pas développer avant la soutenance |
| Compétences | ❌ | — | Ni table, ni export AJIR, ni exigence. Le libellé manager « Développement des compétences » (`features.json:10`) désigne formation et évaluation | Rien à faire. Réponse au jury : « hors export AJIR » |

Aucun P0 : aucun Must ni Should du sujet ne manque.

## 3. Fonctionnalités en trop ou hors sujet

Menu RH actuel : 20 entrées (`sidebar.tsx:17-73`). Les écrans ci-dessous ne sont exigés ni en Must, ni en Should. Ils sont en général bien faits, mais ils diluent le message « People Analytics et turnover prédictif ».

| Fonctionnalité | Lien avec le sujet | Constat | Recommandation | Priorité |
|---|---|---|---|---|
| Prévisions effectifs (`/previsions`, RH) | Aucun (ni Must, ni Should, ni Could) | Projection de l'effectif et de la masse salariale, scénarios, recommandations budgétaires (`previsions/page.tsx:180-181`) | Masquer du menu pour la soutenance, ou présenter en perspective | P2 · faible |
| Charge de travail (`/charge`) | Aucun comme écran (les heures sup sont une variable du modèle) | Recoupe le signal HEURES_SUP de `/equipes` (`dal/teams.ts:157,165`) ; ajoute un 5e flux de recommandations | Fusionner dans Équipes, ou masquer | P2 · moyen |
| Synthèse du mois | Aucun | Reprend les chiffres clés du tableau de bord (`synthese/page.tsx:176-185`) : deux entrées « vue d'ensemble » | Un seul point d'entrée : le bloc « À traiter en priorité » en haut du tableau de bord, ou la synthèse comme accueil sans KPI en double | P2 · moyen |
| Interventions séparée de Recommandations | M7 (même cycle) | Deux pages RH pour un seul workflow | Onglet de `/recommendations` | P2 · faible |
| Fiche : 9 blocs au lieu de 3 zones | M6 | En-tête, résumé, quoi de neuf, faits, estimation, parcours, suggestions, avant / après, what-if (`employees/[id]/page.tsx:79-91`). « Quoi de neuf » et « Parcours » recoupent « Faits » | Replier « Parcours » et « Quoi de neuf » par défaut (à voir avec l'audit UX) | P2 · faible |
| Organigramme | Aucun | Mêmes mesures qu'Équipes : effectif, risque, absentéisme (`dal/org-chart.ts:14`) | Onglet d'Équipes, ou masquer | P3 · faible |
| Dérive des données (menu) | Could du plan, absente du sujet | Déjà liée depuis Transparence (`BACKLOG_INTEGRATION.md:67`) | Retirer du menu, garder le lien | P3 · faible |
| Risque individuel de retard de formation | Aucun | Second score individuel ; le manager voit le niveau (`CONVENTIONS.md:138`) | Garder, le justifier dans l'AIPD, ne pas le mettre en avant en démo | P3 |
| Connexion 3D | Aucun | Scène three / React Three Fiber décorative sur `/login` (`components/auth/constellation.tsx:12`) | Garder la version SVG statique (`constellation-static.tsx`) | P3 · faible |
| Chantier IA en cours (`wt\`, non vérifié) | Variable | Cinq fonctions de plus prévues (`CHANTIER_IA.md:34-38`). CAUSAL (appariement par score de propension) frôle la « lecture causale » ; SYNTHESE avec IA générative frôle le Won't « assistant LLM » (sujet p. 4) | Trier avant la fusion : priorité à LEVIER (prolonge le what-if, Should) et CONFORME (fiabilise l'existant). IA générative désactivée par défaut | P1 · décision |

Menu RH cible (14 entrées) : Tableau de bord, Alertes · Collaborateurs, Équipes, Recommandations · Absentéisme, Formations, Rétention des embauchés · Santé des données, Transparence, Vérification a posteriori, Droit d'accès · Aide, Mon compte. Le code des écrans masqués reste en place.

## Notes proposées

| Dimension | Note | Justification |
|---|---|---|
| Fonctionnalités | 8/10 | Tous les Must et Should du sujet sont présents et vérifiés dans le code ; points perdus pour la dispersion (5 flux de recommandations, 20 entrées de menu RH), le catalogue non paramétrable et quelques libellés ambigus |
