# Couverture de tests — variables, DAL, scoring

Date : 2026-09-30. Mesure : `npx vitest run --coverage --coverage.include=src/lib/**` (V8, `@vitest/coverage-v8`). Critère d'acceptation : **≥ 70 %** sur `src/lib/features`, `src/lib/dal` et `src/lib/scoring`.

## 1. Résumé

- Critère **atteint et largement dépassé** sur les trois modules, pour les instructions comme pour les branches : features 99,6 % / 92,9 %, DAL 97,8 % / 90,5 %, scoring 100 % / 98,5 % (instructions / branches).
- **187 tests ajoutés** dans 16 fichiers `tests/unit/*.test.ts` (dont 4 `it.fails` qui documentent des bugs), sans modifier aucun fichier source. Chaque fichier travaille sur sa propre base SQLite temporaire (`os.tmpdir()` + migrations `drizzle/`), jamais sur `data/app.db`.
- **4 bugs trouvés** (sévérité faible), décrits au §5, et 3 points à arbitrer (§6).
- La mesure globale inclut les tests écrits en parallèle par d'autres contributeurs ; `tests/security/*` (60 tests) échoue hors campagne car il attend un serveur de test démarré sur le port 3300. Ces échecs ne concernent pas la couverture mesurée ici (`--coverage.reportOnFailure`).

## 2. Avant / après par module

Instructions / branches / fonctions / lignes, en %. « Avant » = première mesure de la session ; « Sans tests/unit » = état final sans les tests ajoutés ici (inclut donc les tests ajoutés entre-temps par les autres contributeurs) ; « Après » = état final complet.

| Module `src/lib/` | Avant | Sans tests/unit | Après |
|---|---|---|---|
| **features** | 96,4 / 83,9 / 97,4 / 99,0 | 96,4 / 84,2 / 97,4 / 99,0 | **99,6 / 92,9 / 98,7 / 100** |
| **dal** | 85,7 / 70,3 / 89,3 / 87,7 | 90,0 / 74,1 / 92,9 / 92,1 | **97,8 / 90,5 / 99,0 / 98,6** |
| **scoring** | 90,3 / 76,2 / 96,9 / 94,9 | 90,3 / 76,2 / 96,9 / 94,9 | **100 / 98,5 / 100 / 100** |
| auth | 56,1 / 46,3 / 53,3 / 58,3 | 60,6 / 48,8 / 60,0 / 63,3 | 100 / 100 / 100 / 100 |
| jobs | 82,2 / 66,9 / 79,3 / 89,6 | 82,2 / 66,9 / 79,3 / 89,6 | 98,1 / 90,9 / 93,1 / 100 |
| import | 94,4 / 83,3 / 95,8 / 98,0 | 94,4 / 83,3 / 95,8 / 98,0 | 98,5 / 89,6 / 97,9 / 99,4 |
| engine | 92,3 / 77,5 / 88,9 / 95,5 | 92,3 / 77,5 / 88,9 / 95,5 | 100 / 95,0 / 100 / 100 |
| racine (`api.ts`, `audit.ts`, `settings.ts`) | 93,3 / 96,8 / 100 / 92,9 | 93,3 / 96,8 / 100 / 92,9 | 100 / 100 / 100 / 100 |
| aggregates, calendar, anomalies, whatif | non ciblés ; état final (instr. / branches) : 100 / 95,2 ; 100 / 98,7 ; 97,8 / 87,0 ; 95,0 / 82,1 | | |
| **Total `src/lib`** | **90,2 / 76,9 / 91,8 / 93,0** | 91,9 / 78,3 / 93,6 / 94,6 | **98,4 / 91,6 / 98,8 / 99,3** |

Détail des fichiers les plus progressés (instructions / branches, sans tests/unit → après) : `auth/session.ts` 24 / 5 → 100 / 100 ; `jobs/handlers.ts` 74 / 61 → 97 / 90 ; `dal/imports.ts` 85 / 59 → 99 / 97 ; `dal/model.ts` 86 / 67 → 100 / 98 ; `scoring/registry.ts` 85 / 70 → 100 / 99 ; `scoring/model.ts` 91 / 74 → 100 / 98 ; `dal/absenteeism.ts` 92 / 70 → 99 / 91 ; `dal/employees.ts` 92 / 79 → 99,5 / 97 ; `features/calendar.ts` 79 / 76 → 97 / 97 ; `features/dates.ts` 94 / 63 → 100 / 100.

## 3. Tests ajoutés

| Fichier | Tests | Contenu |
|---|---|---|
| [scoring-model.test.ts](../../tests/unit/scoring-model.test.ts) | 14 | contrôles structurels (fsv, variable inconnue, dimensions), `predict` LOGREG (σ nul, calibration absente/Platt, sigmoïde aux extrêmes), opérateurs B0, `explain` (cumul par variable, ex-æquo par ordre de groupe, profil moyen), golden, phrases |
| [scoring-registry.test.ts](../../tests/unit/scoring-registry.test.ts) | 12 | chemins portables, idempotence, golden absent/vide/malformé, sha256 des fichiers, promotion refusée et auditée ECHEC, rollback, champion invalide (alerte dédupliquée), **repli B0** sans dossier de bundle, cache (bug B2) |
| [scoring-score.test.ts](../../tests/unit/scoring-score.test.ts) | 14 | niveaux (population vide, ex-æquo, plafond — bug B1, facteurs ≤ 6), coupure normalisée, aucun éligible, run non publié repris puis publié, run ECHEC remplacé, snapshots réutilisés, **run déclaré orphelin pendant l'écriture → publication refusée**, paramètres invalides → défauts |
| [features-branches.test.ts](../../tests/unit/features-branches.test.ts) | 20 | éligibilité (CDD sans terme, STAGE, contrat futur, 60 ans pile, naissance inconnue, démission sans date posée, sortie saisie après t), état as-of du grade/manager, augmentations illisibles, compa-ratio (médianes, paie saisie après t), formation en retard jugée à t, week-end, jours de maladie, < 5 arrivées, sans pointage, backfill > 24 mois, calendrier |
| [dal-employees.test.ts](../../tests/unit/dal-employees.test.ts) | 21 | périmètre récursif, `scopeFilter`/`canSeeEmployee` par rôle, `requireContext`/`pageContext` (401/403/redirections), liste (échappement LIKE, filtres, tris, pagination), **DTO manager vs RH** (facteurs ABSENCES/REMUNERATION B0 retirés, revue salariale et augmentations masquées), historique, états AUCUN_RUN / NON_EVALUE, 404 avant 403, `getMe`, `parseQuery` |
| [dal-pilotage.test.ts](../../tests/unit/dal-pilotage.test.ts) | 9 | absentéisme RH (8 séries max, « Sans département », signaux individuels, anomalies), **gardes des petits groupes manager** (masquage secondaire, total < 5), tableau de bord (agrégats vs détail, filtres décrits, lift masqué en B0, filtres manager retirés) |
| [dal-recos-alerts.test.ts](../../tests/unit/dal-recos-alerts.test.ts) | 14 | KPI d'adoption, filtres, décision (409, intervention datée, retour conservé), 403 manager sans révéler l'existence, visibilité des alertes par rôle, liens internes (bug B4), transitions |
| [dal-imports.test.ts](../../tests/unit/dal-imports.test.ts) | 15 | détail d'import (rapport vs rejets, rapport illisible), état du worker et alerte PERIME dédupliquée, santé des données, **refus du scoring si import bloqué**, mois non couvert/antérieur, file de jobs, téléversement (413/422/409, collision de dossier, nettoyage si la mise en file échoue), `/api/health` |
| [dal-model.test.ts](../../tests/unit/dal-model.test.ts) | 9 | `readBundle` (hors projet, format), lecture tolérante des métriques, transparence LGBM/LOGREG/B0, `championStatus` |
| [dal-admin.test.ts](../../tests/unit/dal-admin.test.ts) | 12 | comptes (409/422, normalisation), dernier ADMIN protégé, déverrouillage, activation (politique, **consommation atomique sur deux appels simultanés**, compte désactivé), paramètres, console, journal |
| [auth-session.test.ts](../../tests/unit/auth-session.test.ts) | 10 | sessions opaques (SHA-256, cookie, Secure en production), **sessions expirées, jeton forgé, compte désactivé, révocation**, connexion (message générique), **verrouillage progressif** 1→4→64 min |
| [audit-api.test.ts](../../tests/unit/audit-api.test.ts) | 7 | **audit append-only** (UPDATE/DELETE refusés, en transaction et en masse ; bug B3), `withApi` (400/409/500 sans fuite, contrôle d'origine) |
| [jobs-handlers.test.ts](../../tests/unit/jobs-handlers.test.ts) | 10 | file (cible NULL, libération, heartbeat), **reprise** (heartbeat absent, délai paramétrable), chaque type de job (paramètres, erreurs sans données), batch mensuel |
| [jobs-modules.test.ts](../../tests/unit/jobs-modules.test.ts) | 1 | module d'un contributeur en erreur : l'erreur remonte |
| [import-rules.test.ts](../../tests/unit/import-rules.test.ts) | 7 | plafond de détail des rejets, motifs de rejet de schéma, doublons/matricules inconnus des fichiers optionnels, auto-rattachement, en-têtes invalides, synchronisation des comptes (réactivation, jeton valide conservé, ADMIN protégé) |
| [engine-metrics.test.ts](../../tests/unit/engine-metrics.test.ts) | 12 | dates, calculs purs de pilotage (masquage, prorata, turnover glissant), effets de publication (actions, alertes, ÉLEVÉ déjà connu), déduplication des alertes |

Fixtures : [tests/fixtures/unit/dal-world.ts](../../tests/fixtures/unit/dal-world.ts) (hiérarchie DG > MGR > équipe + sous-équipe, 6 comptes, runs publiés maîtrisés), deux bundles de test dans `tests/fixtures/unit/`.

## 4. Zones non couvertes restantes

- **`dal/backtest.ts` (80 / 60), `dal/whatif.ts` (85 / 68), module `whatif`** : modifiés en parallèle par un autre contributeur ; non ciblés pour ne pas figer un comportement en cours d'écriture.
- **`dal/data-monitoring.ts`, `dal/monitoring.ts`, `dal/account.ts`** (branches 68–82 %) : fichiers apparus pendant la session (autres contributeurs), couverts par leurs propres tests.
- **Branches de concurrence** : `alerts.ts` (CONFLIT si l'alerte change entre lecture et écriture), `recommendations.ts` (DEJA_TRAITEE concurrent), `imports.ts` (`alreadyQueued` après un contrôle préalable identique). Non reproductibles en séquentiel ; la consommation atomique du jeton d'activation et la reprise d'un run orphelin ont en revanche été testées.
- **Branches défensives inaccessibles** : `recommendations.ts` (`canSeeEmployee` après `requireGlobal`, toujours vrai pour la RH), `employees.ts` (sortie de boucle du mode tolérant, seulement avec un schéma à `refine` racine), `registry.ts` (`errors` toujours présent), `features/calendar.ts` (ligne `dim_date` hors plage demandée).
- **`features/compute.ts`** : branche du mode naïf sur les sorties (option naïve en cours de modification par un autre contributeur).
- **`jobs/handlers.ts` — module introuvable** : Vitest enveloppe l'erreur d'un mock, le cas « module absent → null » n'est pas simulable proprement ; seul « module en erreur → erreur remontée » est testé.
- **`anomalies`** (87 % de branches) : hors périmètre prioritaire, options modifiées en parallèle.

## 5. Bugs trouvés

> Mise à jour du 30/09/2026 : B1 corrigé (`k = max(1, ⌊n × taux⌋)`, le `it.fails` est devenu un test vert) ; points du § 6 arbitrés : minimum d'un ÉLEVÉ conservé sous 1/taux scorés (ADR-006), job IMPORT marqué ECHEC quand l'import échoue, contribution de groupe nulle non retenue comme facteur. Tests : `tests/features/`.

Aucune source n'a été corrigée ; chaque bug est couvert par un test `it.fails` (passe tant que le bug existe, échouera une fois corrigé).

| # | Fichier | Scénario | Attendu | Obtenu | Test |
|---|---|---|---|---|---|
| B1 | [src/lib/scoring/score.ts](../../src/lib/scoring/score.ts) `rankAndLevel` | 75 salariés scorés, `capacity_rate` = 0,02 (capacité 1,5 entretien) | au plus 1 ÉLEVÉ : la capacité est « un plafond » (CONVENTIONS.md) | 2 ÉLEVÉ : `k = Math.round(n × taux)` arrondit au plus proche | [scoring-score.test.ts](../../tests/unit/scoring-score.test.ts) |
| B2 | [src/lib/scoring/registry.ts](../../src/lib/scoring/registry.ts) `loadChampionState` | champion chargé, puis `manifest_json` altéré à longueur égale (`fsv` « v1 » → « v0 ») | champion refusé (contrôle fsv, alerte SYSTEME) | l'ancien modèle reste servi par le processus : la clé du cache est `id:longueur du manifeste` | [scoring-registry.test.ts](../../tests/unit/scoring-registry.test.ts) |
| B3 | [drizzle/0001_audit_triggers.sql](../../drizzle/0001_audit_triggers.sql) | `INSERT OR REPLACE INTO audit_log (id, …) VALUES (1, 'falsifie', …)` | refus « audit_log est en ajout seul » | l'entrée 1 est réécrite : la suppression implicite du REPLACE ne déclenche pas le trigger DELETE (`recursive_triggers` désactivé par défaut) | [audit-api.test.ts](../../tests/unit/audit-api.test.ts) |
| B4 | [src/lib/dal/alerts.ts](../../src/lib/dal/alerts.ts) `toDTO` | alerte dont `link` = `/\evil.example/login` | lien neutralisé (`null`) | lien conservé ; `new URL("/\evil.example/login", base).host` = `evil.example` (redirection ouverte côté navigateur) | [dal-recos-alerts.test.ts](../../tests/unit/dal-recos-alerts.test.ts) |

Sévérité : faible pour les quatre. B2, B3 et B4 supposent une écriture directe en base ou un lien non produit par le serveur aujourd'hui ; ce sont des garde-fous qui ne tiennent pas leur promesse. Correctifs suggérés :
- B1 : `Math.floor` au lieu de `Math.round` (voir aussi §6 pour le minimum de 1).
- B2 : clé de cache = SHA-256 (ou texte complet) du manifeste.
- B3 : trigger `BEFORE INSERT ON audit_log WHEN EXISTS (SELECT 1 FROM audit_log WHERE id = NEW.id)` levant la même erreur, ou `PRAGMA recursive_triggers = ON` dans `openSqlite`.
- B4 : refuser aussi les liens commençant par `/\`, ou comparer `new URL(link, base).origin` à l'origine de l'application.

## 6. Points à arbitrer (comportements testés tels quels)

- **Minimum d'un ÉLEVÉ** : `Math.max(1, …)` classe 1 salarié ÉLEVÉ même quand la capacité est < 1 (moins de 50 scorés à 2 %). Voulu pour les petites populations ? Si oui, le préciser dans CONVENTIONS.md.
- **Job IMPORT « TERMINE » alors que l'import est en ÉCHEC** (dossier absent, fichier obligatoire manquant) : l'échec n'apparaît que sur le lot d'import et l'alerte DONNEES, pas dans l'état du job.
- **Contribution de groupe exactement nulle** : `explain` la marque « BAISSE » (cas du profil moyen) ; sans effet sur les recommandations (seules les HAUSSE comptent).
