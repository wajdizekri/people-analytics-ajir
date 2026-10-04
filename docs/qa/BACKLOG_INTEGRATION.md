# Backlog de l'intégration finale

Points remontés par les agents, à traiter lors de l'intégration finale (après promotion du modèle LOGREG).

## What-if / backtesting
- [FAIT] Après promotion du champion LOGREG, relancer le scoring : le what-if utilise le modèle du run publié (run 73 au 31/08/2026, LOGREG, 30/09).
- [FAIT] Vérifier que le bundle LOGREG renseigne train_from / train_to (bandeau « période vue à l'entraînement ») : train_from / train_to présents dans le bundle (2020-09-30 → 2026-02-28).
- [FAIT] Mettre à jour README.md et docs/DEMO.md (what-if, backtesting, rôle ADMIN sans données RH) : parcours de 12 min sur les 3 rôles et les nouvelles pages, chiffres du run LOGREG.

## Exploitation (agent déploiement)
- [FAIT] Ajouter les scripts npm : "backup", "restore", "check-install" (+ "runs", "retention", "test:security").
- [FAIT] Passer tsx en dependencies (le worker et les scripts en ont besoin en production ; npm ci --omit=dev casserait l'installation).
- [FAIT en partie] CSP dans le navigateur : validée par l'E2E sur le build de production (Chromium, toutes les entrées du menu des 3 rôles, aucune violation remontée dans la console : navigation.spec.ts). Reste non validé faute d'environnement cible : `caddy validate` et les services WinSW sur un vrai Windows Server (à faire par le stagiaire sur le serveur de recette).
- [FAIT] Pas d'outil de purge de rétention (audit 12 mois, prédictions 24 mois) : scripts/retention.ts (npm run retention), documenté dans EXPLOITATION.md § 7 et INSTALLATION.md § 3.10 bis ; durées toujours « à valider » avec le client.

## Accessibilité (agent a11y, voir docs/qa/ACCESSIBILITE.md)
- [FAIT] Audit axe-core (Playwright) sur le build final : 39 pages (anonyme, RH, manager, admin, nouvelles pages comprises), voir docs/qa/BUGS_E2E.md.
- [FAIT] Fiche et what-if : zones en slate-400 et champs border-slate-300 (contraste) dans employee-detail.tsx et what-if-panel.tsx ; idem /compte/password-form.tsx ; titres de page sans « AJIR ».
- [FAIT] src/app/not-found.tsx en français (test tests/help/help.test.ts « page 404 », page contrôlée par axe).
- [FAIT en partie] Couleur neutre des graphiques (STATUS_COLORS.neutre, src/components/charts/pbi.tsx) : #94a3b8 (2,6:1) → #7c8aa0 (3,5:1, critère 1.4.11). Non fait : variation favorable/défavorable des KpiCard portée par la couleur pour un daltonien (déjà annoncée aux lecteurs d'écran ; sens et signe lisibles) : arbitrage de charte graphique (mot visible ou pictogramme), laissé au stagiaire.
- [CONSIGNE respectée] Ne pas réécrire alerts/page.tsx en entier (découpage Suspense pour garder les vrais 403/404).

## Anomalies (agent évaluation, voir docs/RESULTATS_ANOMALIES_QUALITE.md)
- [CONSIGNE respectée] Ne PAS porter en production les tests individuels « lundi/vendredi » et « ponts » prototypés en Python : ils s'apparentent à la détection d'abus/fraude, placée en Won't dans le cahier des charges. Les citer dans le rapport comme piste évaluée et écartée pour raisons éthiques.
- [FAIT] Règle de paie « brut > 2 × base » : avertissement PAIE_BRUT_INCOHERENT (import), évaluée sur les deux graines (RESULTATS_ANOMALIES_QUALITE.md § 6).
- data/eval-*.db et data/eval-out* (~1,3 Go) : reproductibilité de l'évaluation, supprimables. Non fait : suppression = action destructive, à décider par le stagiaire (les résultats sont consignés dans RESULTATS_ANOMALIES_QUALITE.md).

## Sécurité et performance (agent sécurité, voir docs/qa/SECURITE_PERF.md)
- [FAIT] Ajouter Content-Security-Policy et HSTS dans next.config.ts (en plus de Caddy), compatibles Next (unsafe-inline tant qu'il n'y a pas de nonce).
- [FAIT] Dashboard p95 424-554 ms sous 20 utilisateurs : cache mémoire par (périmètre, filtres, version des données : run publié, dernier import, recalcul des agrégats) dans dal/dashboard.ts (≈ 1 ms en cache contre 7-20 ms, sans index ni migration) ; calcul détaillé (filtres contrat/âge/ancienneté) 0,65-3 s → 0,25-0,4 s à froid. Remesuré le 30/09 sur le build final (scripts/perf.ts, 20 utilisateurs × 60 s) : p95 = 103 ms, 16 512 requêtes, 0 erreur (SECURITE_PERF.md § 9.3).
- [FAIT] /api/employees : p95 = 193 ms sous 20 utilisateurs (8 209 requêtes, 0 erreur) sur le build final ; sous le critère de 500 ms sans modification (requête paginée à 25 lignes) : aucune optimisation nécessaire.
- [FAIT] /api/health : 503 si la base est inaccessible ou le worker hors service (PERIME), corps limité à 4 états (SECURITE_PERF.md § 8, tests/security-hardening/health.test.ts).
- [FAIT] Pages hors rôle en 200 avec redirection diffusée : vérifié le 30/09 (SECURITE_PERF.md § 9.2) ; comportement inchangé pour les pages à loading.tsx, fiche et détail d'alerte hors périmètre en 307 ; les 22 réponses 200 hors rôle contrôlées ne contiennent aucune donnée et redirigent vers /interdit. Accepté (informationnel).

## Coordination
- [FAIT] Une autre session Claude de l'utilisateur (aziz-pfe-fa) a refait les visuels « style Power BI » (src/components/charts/pbi.tsx) et la matrice de rôles (ADMIN sans données RH). Ne pas les écraser ; vérifier la cohérence (erreur tsc vue au passage : export headcountTurnoverOption manquant dans dashboard/page.tsx). Vérifié : tsc à 0, kit pbi.tsx et matrice de rôles intacts.

## Écarts relevés par la documentation de conception
- [FAIT] Must : export audité des données d'un salarié (droit d'accès) : écran /confidentialite, GET /api/privacy/requests/[id]/export (JSON ou ZIP, audité).
- [FAIT] Must : lien profond depuis AJIR, /go/collaborateur/<matricule> (404 inconnu, 403 audité hors périmètre) et /go/tableau-de-bord (docs/INTEGRATION_AJIR.md).
- [FAIT] Should : ouverture depuis AJIR par jeton signé, GET /api/ajir/launch (HMAC-SHA256, 60 s, usage unique, AJIR_LAUNCH_SECRET).
- [FAIT] Page de connexion : mémoriser la destination d'un lien profond ouvert sans session (paramètre `next`, chemin interne seulement, rôle vérifié ; posé par src/proxy.ts et /go/collaborateur). Session expirée avec cookie encore présent : `pageContext` redirige vers /login?next=<chemin> (ROUTE_HEADER, safeNextPath), voir « Campagne E2E » ci-dessous.
- [FAIT] Refus de rôle au niveau page/route (pageContext, requireContext) audités `access.page` / `access.api` (SECURITE_PERF.md § 8 point 3).
- [FAIT] Règle ESLint `no-restricted-imports` sur `@/db/client` hors src/lib, src/db, src/worker, scripts et tests (SECURITE_PERF.md § 8 point 6).
- [FAIT] ADMIN : montants masqués dans les rejets d'import (maskRejectionMessage), matricule conservé.
- [FAIT] Sessions glissantes (2 h d'inactivité, 10 h au plus) et purge des sessions expirées (SECURITE_PERF.md § 8 point 4).
- [FAIT] Import lancé depuis l'UI (job IMPORT) : calendrier et agrégats reconstruits après un import OK ou BLOQUE ; import ECHEC = job ECHEC.
- [FAIT] Worker tué pendant un import : le lot EN_COURS du job interrompu passe ECHEC à la reprise (audité import.run).
- [FAIT] Jours ouvrés : entrées/sorties en cours de mois proratisées à l'identique dans les agrégats et le calcul détaillé. Ponts : écart conservé et documenté (ouvrés pour les KPI, non ouvrés pour les variables et anomalies ; aligner imposerait un réentraînement).
- [FAIT] Retour arrière du calcul publié : scripts/run.ts list | rollback <runId> (audité scoring.rollback). Script npm suggéré : "runs": "tsx scripts/run.ts".
- [FAIT] Limites à documenter : périmètre manager selon la hiérarchie du dernier import (pas à date) ; interventions non exploitées au réentraînement (rapport ch. 8 et 10, ARCHITECTURE.md § 10).

## Couverture (voir docs/qa/COUVERTURE.md) — bugs faibles
- [FAIT] B1 scoring/score.ts : k = max(1, ⌊n × capacity_rate⌋) (75 × 2 % → 1) ; minimum de 1 conservé sous 1/taux scorés (arbitrage ADR-006).
- [FAIT] B2 scoring/registry.ts : cache du champion indexé sur la longueur du manifeste (manifeste altéré à longueur égale non détecté).
- [FAIT] B3 audit : INSERT OR REPLACE contourne le trigger append-only (ajouter un trigger BEFORE INSERT refusant un id existant, ou une contrainte).
- [FAIT] B4 dal/alerts.ts : lien d'alerte « /\evil.example » = redirection ouverte (n'accepter que des chemins internes normalisés).
- [FAIT] Arbitrés : job IMPORT en ECHEC si l'import est en ECHEC ; contribution de groupe nulle non retenue comme facteur (ni hausse ni baisse).

## Rapport PFE (docs/rapport)
- [FAIT] SMIG daté : barème smig_schedule (JSON) appliqué selon le mois de paie, 528,320 TND jusqu'au 31/12/2025 puis 554,736 TND (valeurs à confirmer) ; smig_monthly = repli. [FAIT] Barème exposé dans l'écran Paramètres (éditeur par périodes, validation zod).
- [FAIT] Droits non outillés : accès (export) et opposition (art. 42) → tables privacy_request et employee_opposition ajoutées (migration 0005).

## Session aziz-pfe-0c (fermée sans rien livrer : aucune page, DAL ni composant sur disque au 30/09 soir)
- [FAIT] Reprise confiée à un agent « idées 0c » de la session aziz-pfe-56 : pages synthese, equipes, interventions, derive + composants de fiche (quoi de neuf, parcours, avant/après intervention).
- [FAIT] Pages synthese, interventions, equipes, derive + src/lib/dal/{changes,journey,insights,team-status,drift,intervention-impact,indicators,data-quality}.ts, src/lib/drift/*, composants pilotage/monitoring : à elle, ne pas créer de doublons.
- [FAIT] Menu (4 entrées) et fiche (Quoi de neuf, Parcours, Avant / après) branchés selon docs/qa/BRANCHEMENTS_INSIGHTS.md. Branchements à intégrer à la fin : [FAIT] lien Transparence → Dérive des données. Non faits, faute de spécification (les lignes annoncées n'ont jamais été envoyées) et parce qu'ils ajouteraient un comportement non demandé : hook dérive dans runMonthlyBatch (la dérive est calculée à la volée à l'ouverture de /derive), bandeau dans le dashboard, domaines qualité dans data-health. Entrées de menu : faites par la session restyle (sidebar).
- [CONSIGNE respectée] Pas de migration 0007 (la dérive PSI est calculée à la volée).

## Tests (intégration finale)
- [FAIT] tests/security/* échouent sans serveur sur :3300 : les exclure de `npm test` quand SEC_BASE_URL n'est pas défini (vitest.config.ts), et ajouter un script "test:security".
- [FAIT] tests/unit/audit-api.test.ts : 2 échecs observés à 17:37 (SQLITE_CORRUPT simulé), probablement liés au durcissement de l'audit en cours : repassé vert le 30/09 (l'erreur SQLITE_CORRUPT journalisée est simulée par le test).
- [FAIT] La session restyle (aziz-pfe-fa) a un `npm run dev` sur :3000 : toujours lancé le 30/09 à 21 h, mais Next 16 isole `next dev` dans `.next/dev` ; le build final (`.next`) et les builds isolés (`.next-e2e`, `.next-sec`) ont tourné sans conflit. Ce serveur n'a pas été arrêté (lancé par une autre session).

## Ergonomie (voir docs/qa/ERGONOMIE.md, section « À appliquer après le restyle »)
- [FAIT] Priorité 1 (gravité 3) : retour depuis la fiche vers la liste filtrée (paramètre `retour` + safeReturn de src/components/ux/breadcrumb.tsx), depuis la liste, les recommandations, le backtesting, l'absentéisme et les alertes.
- [FAIT] Filtres manager : distinguer « filtre non disponible pour votre rôle » d'une vraie erreur de saisie (filters.tsx) ; filtres actifs retirables, « Réinitialiser » seulement si un filtre est actif, pagination Première / Dernière.
- [FAIT] Recommandations : décision depuis la liste, tuile « en attente » cliquable.
- [FAIT] Compteur d'alertes du bandeau plafonné à 500 : fonction de comptage dans la DAL (countAlerts), aussi utilisée par la pagination de /alerts. Recherche d'un collaborateur dans l'en-tête (RH, manager).
- [FAIT] tsc : tests/help/help.test.ts ligne 73 (drapeau de regex es2018) — agent aide (npx tsc --noEmit : 0 erreur le 30/09).

## Modèle turnover (voir docs/RESULTATS_ML.md)
- [FAIT] Promouvoir logreg-v1-20260930 (CANDIDAT dans app.db, parité 1,1e-16) puis relancer le pipeline (le what-if suit le run publié) : verify OK (golden 200 lignes, 1,1e-16), promu, run 73.
- [FAIT] Règle de démarrage à froid : B0 seul sous 30 démissions observées ; LOGREG candidat au-delà, promu seulement si le backtest client montre AUC non inférieure à B0 (marge à trancher, -0,02 proposée), lift ≥ B0 et O/E dans [0,8 ; 1,25] ; probabilité « indicative » sous 150 démissions. Paramètres min_events_for_model / indicative_until_events, repli B0 dans scoreMonth (src/lib/scoring/cold-start.ts), `coldStart` et `publishedRun` exposés par getTransparency (dal/model.ts) : affichage du message à brancher sur la page Transparence (UI). La porte de promotion sur backtest client reste une décision humaine.
- [CONSIGNE] Recalibration (Platt hors échantillon) à chaque réentraînement ; modèle calibré à 6 mois seulement (procédure de réentraînement, rien à coder).
- [CONSIGNE respectée] LightGBM : ne pas industrialiser.
- [FAIT] tests/pilotage/pages.test.ts : vert dans la suite complète (79 fichiers, 30/09 21 h ; un processus par fichier).

## Clarté et aide (voir docs/qa/CLARTE.md)
- [FAIT] 31 corrections de libellés à appliquer dans les fichiers du restyle (fichier:ligne listés), dont « Sévérité » → « Gravité » ; adapter tests/pilotage/pages.test.ts:65 et tests/e2e/dashboard-rh.spec.ts:54. Reste hors périmètre écrans : src/lib/engine/recommendations.ts:105 et 107.
- [FAIT] Relire les descriptions génériques des écrans Formations, Charge de travail, Prévisions et Droit d'accès dans src/lib/help/content.ts (SCREENS) une fois ces pages livrées.
- [FAIT] Renommage de « Backtesting » : menu « Vérification a posteriori », titre « Vérification a posteriori (backtesting) », URL /backtesting inchangée. Reste : libellé du plan des écrans dans src/lib/help/content.ts.
- [FAIT] tests/e2e/data-model.spec.ts relancé dans la campagne finale : vert.

## IA effectifs et masse salariale (voir docs/RESULTATS_IA_EFFECTIFS.md)
- [FAIT] Enregistrer et promouvoir sur app.db : npm run topic-model -- register EFFECTIF models/workforce/effectif-v1-20260930 ; register MASSE_SALARIALE models/workforce/masse-v1-20260930 ; promote des deux.
- [FAIT] Ajouter le paramètre budget_masse_salariale_<AAAA> à l'écran Paramètres admin (fichier du restyle) pour activer les recommandations budgétaires. (Documenté dans DEFAULT_SETTINGS, sans valeur par défaut ; reste l'écran.)
- [FAIT] Effectif : le naïf fait mieux que le modèle (MAPE 0,53 % contre 0,74 %) : à assumer dans le rapport (ch. 7, § 7.12.2).
- [FAIT] Vérifier que npm run db:migrate passe une fois 0006_audit_hardening.sql rempli par l'agent sécurité (7 migrations appliquées sur app.db).

## Sécurité — suites (voir docs/qa/SECURITE_PERF.md § 8)
- [FAIT] deploy/env.example et docs/architecture/DEPLOIEMENT.md : ajouter TRUST_PROXY=1 (derrière Caddy) et APP_URL (liens d'activation).
- [FAIT] tests/security/authz.test.ts : /api/health accepté en 200 ou 503 (même code pour tous les rôles).
- [FAIT] Mettre à jour ARCHITECTURE.md (l. 161, 226, 268, 277) et ADR-012 (l. 33) : sessions glissantes (2 h d'inactivité, 10 h max), purge, règle ESLint, limitation de débit.
- [FAIT] dal/account.ts changeOwnPassword : 5 échecs du mot de passe actuel par compte et par 15 min (RATE_RULES.passwordChange), refus audité `user.password_change` REFUSE `limite` ; test tests/security-hardening/sessions.test.ts.
- [FAIT] Téléversement : corps lu par morceaux et abandonné au-delà du plafond (9 Mo + 64 Ko), Content-Length absent ou mensonger → 413 (src/app/api/imports/route.ts) ; test tests/ui-admin/api.test.ts.

## IA formations (voir docs/RESULTATS_IA_FORMATION.md)
- [FAIT] Enregistrer et promouvoir sur app.db : npm run topic-model -- register FORMATION models/training/formation-logreg-v1-20260930 puis promote.
- [FAIT] tsc : 3 erreurs dans tests/ai/workforce/roles.test.ts (agent effectifs) à corriger (0 erreur le 30/09).
- [FAIT] Limite à documenter : date d'affectation absente de l'export AJIR (formation « connue » à 120 jours de l'échéance) : rapport ch. 7, § 7.12.3.

## Confidentialité — suites (voir docs/conformite/)
- [FAIT] Fiche salarié (restyle) : afficher getOppositionFlag(ctx, id) de src/lib/dal/privacy.ts pour la RH (« Opposition au traitement prédictif ») au lieu de « Non évalué ».
- [FAIT] Panneau what-if (restyle) : afficher le message de l'erreur 409 OPPOSITION.
- [FAIT] backfillFeatures et scripts/export-panel.ts : exclure les salariés opposés avant tout réentraînement (excludeOpposed de src/lib/privacy/opposition.ts ; tests opposition-scoring et scoring-cold-start).
- [FAIT] Rapport ch. 9 (tableau 9.1, § 9.7) : accès et opposition désormais réalisés, livrables rédigés dans docs/conformite/ ; EXPLOITATION.md § 7 : citer scripts/retention.ts.
- [FAIT] Ajouter retention_inbox_days et retention_prediction_months à DEFAULT_SETTINGS.
- [FAIT] tsc : erreurs dans src/lib/ai/absenteeism/recommendations.ts (agent absentéisme en cours) : 0 erreur le 30/09.

## Restyle ArabSoft terminé (session aziz-pfe-fa/8d)
- [FAIT] Les fichiers du restyle sont libérés : appliquer les recommandations en attente (ERGONOMIE.md « À appliquer après le restyle », 31 libellés de CLARTE.md, opposition sur la fiche, erreur 409 dans le what-if, budget dans les Paramètres).
- [FAIT] /dashboard déborde horizontalement à 390 px (482 px) à cause d'une carte graphique : `min-w-0` sur VisualCard, Card, KpiCard et KpiTile (éléments de grille). À revérifier au navigateur.
- [INFO] PageHeader accepte une prop `eyebrow` ; thème global (sky = bleu ArabSoft, jetons brand-*, bg-canvas).
- [FAIT] tests/features/import-job.test.ts : vert dans la suite complète (30/09 21 h) ; instabilité sous forte charge non reproduite.

## IA charge de travail (voir docs/RESULTATS_IA_CHARGE.md)
- [FAIT] Enregistrer et promouvoir sur app.db : npm run topic-model -- register CHARGE_TRAVAIL models/workload/workload-ridge-v1-20260930 puis promote.
- [FAIT] Ajouter workload_ot_threshold_h et workload_ot_months à DEFAULT_SETTINGS et à l'écran Paramètres. ([FAIT] pour DEFAULT_SETTINGS ; reste l'écran.)
- [FAIT] Documenter l'usage « horizon 0 = observé » de la table forecast (CONVENTIONS, DICTIONNAIRE) ; compléter ml/README.md et DICTIONNAIRE.md pour les 4 IA par sujet.

## IA absentéisme (voir docs/RESULTATS_IA_ABSENTEISME.md)
- [FAIT] Enregistrer et promouvoir sur app.db : npm run topic-model -- register ABSENTEISME models/absenteeism/abs-ridge-v1-20260930 puis promote.
- [FAIT] Ajouter les seuils abs_reco_* à DEFAULT_SETTINGS / écran Paramètres. ([FAIT] pour DEFAULT_SETTINGS ; reste l'écran.)
- [INFO] Rattachement équipe « à l'époque » (prévision) vs « actuel » (graphiques du haut) : écart documenté sous le tableau, rien à faire.

## Campagne E2E (voir docs/qa/BUGS_E2E.md)
- [FAIT] E2E-06 : le backtesting ne compte que des démissions strictement postérieures à l'origine (src/lib/dal/backtest.ts, backtestEvent) : date de démission si connue ; démission connue posée avant l'origine mais saisie après = salarié exclu du backtest ; date de démission inconnue et sortie - 1 mois antérieure à l'origine = date de sortie. Test tests/unit/dal-backtest.test.ts.
- [FAIT] Arbitrage ADMIN / Santé des données : matricule conservé, dates, catégories, durées et autres valeurs d'absence masquées pour l'ADMIN dans les rejets de absences.csv (src/lib/privacy/mask.ts, maskRejectionMessage(message, file)) ; la RH garde le détail. Documenté dans CONVENTIONS.md et docs/conformite/registre-traitements.md. Tests tests/privacy/mask.test.ts.
- [FAIT] Manifeste du modèle : train_from / train_to ajoutés (optionnels) aux schémas zod des bundles (src/lib/scoring/model.ts) ; un réenregistrement des mêmes fichiers complète un manifeste ancien ; manifeste de logreg-v1-20260930 complété sur app.db. Vérifié sur une copie de app.db : Dérive en référence « BUNDLE » 2020-09-30 → 2026-02-28 (66 mois, 65 067 lignes), Backtesting trainFrom/trainTo renseignés, aucune démission datée avant l'origine (7 affichées au 28/02/2026).
- [FAIT] Confidentialité : getEmployeeNews (dal/synthesis.ts) et getEmployeeInterventionEffects (dal/interventions.ts) ne révèlent plus l'opposition au MANAGER (pas d'élément OPPOSITION, `opposed` toujours false) ; test tests/insights/insights.test.ts.
- [FAIT] pageContext : session expirée avec cookie présent → /login?next=<chemin> (ROUTE_HEADER posé par src/proxy.ts, validé par safeNextPath) ; test tests/unit/page-context-next.test.ts.
- [FAIT] Libellés de l'alerte TURNOVER (engine/recommendations.ts, CLARTE.md l. 104-105) : « Niveau de risque Élevé au … », « C'est une estimation, pas une certitude : à confirmer lors d'un échange. » (alertes déjà créées inchangées, sauf les 2 recalculées ci-dessous).
- [FAIT] « Backtesting » → « Vérification a posteriori » dans tous les textes visibles (aide, plan des écrans, glossaire, erreurs et chargement de la page, Mon compte) ; titre de page « Vérification a posteriori (backtesting) » et glossaire « (en anglais : backtesting) » gardés comme glose ; URL /backtesting inchangée.
- [FAIT] data/app.db : recommandations du run B0 (72) restées PROPOSEE à côté de celles du run LOGREG (73), même mois. `npm run runs -- supersede --apply --user 1` (src/lib/engine/recommendations.ts, supersedeSameMonthEffects, simulation par défaut) : 110 passées REJETEE « Remplacée : recalcul avec le modèle entraîné », 17 reproposées par LOGREG rattachées à sa prédiction, 2 alertes TURNOVER sans objet (salariés Faible au run 73) REJETEE, 2 alertes encore valables mises à jour avec les facteurs du LOGREG ; audité `scoring.supersede` (audit_log 275 et 276, admin). Contrôle : 0 recommandation ouverte hors run courant, 0 alerte TURNOVER ouverte pour un salarié non Élevé. Sauvegardes avant écriture : data/backups/2026-09-30_202247 et 2026-09-30_210623. Test tests/unit/engine-metrics.test.ts. Étape ajoutée à la reconstruction de la base (DEMO.md).
- [FAIT] Commentaire de src/lib/dal/drift.ts (lecture du bundle sur disque = repli pour un manifeste antérieur à train_from / train_to dans le schéma).

## Session aziz-pfe-4e (5 fonctionnalités : export CSV/impression, filtrage croisé, palette Ctrl+K, rétention Kaplan-Meier, organigramme)
- Nouveaux fichiers à elle ; besoins sur le cœur dans DEMANDES_COMPOSANTS.md [aziz-pfe-4e] ; insertions dans les 7 pages décrites dans docs/qa/BRANCHEMENTS_4E.md.
- À la fin de la vague design system : prévenir aziz-pfe-4e (elle branche et vérifie) ou appliquer BRANCHEMENTS_4E.md soi-même si elle est fermée.
- Déjà faits par elle : 2 entrées de menu + icônes (sidebar.tsx), liste du menu manager dans tests/components/ui.test.ts, 2 libellés dans admin/audit-labels.ts.
