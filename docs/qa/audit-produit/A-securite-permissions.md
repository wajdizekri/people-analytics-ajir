# Audit produit A : permissions et sécurité (sections 15 et 16)

Date : 04/10/2026. Agent A, lecture seule.

**Périmètre.** Les 15 routes `src/app/api/**/route.ts` et les 2 routes `/go/*`, les 26 pages de `src/app/(app)/**`, les 19 Server Actions (`"use server"`), `src/proxy.ts`, `src/lib/api.ts`, `src/lib/dal/*`, `next.config.ts`, la configuration de déploiement, `tests/security/` et `tests/security-hardening/`. Le dossier `wt/` (chantier IA) est hors périmètre.

**Méthode.** Point de départ : les constats de [SECURITE_PERF.md](../SECURITE_PERF.md) (campagne du 30/09), [CONVENTIONS.md](../../CONVENTIONS.md), ADR-011 et [REVUE_TRANSVERSE.md](../REVUE_TRANSVERSE.md) § Rôles. Ensuite, lecture de chaque garde (proxy, `pageContext`, `requireContext`, garde DAL) et de chaque DTO par rôle, puis comparaison avec les matrices de tests. Aucun serveur ni test n'a été lancé. Un point déjà listé n'est repris que s'il est toujours ouvert dans le code.

**Synthèse.** Aucune fuite exploitable trouvée : chaque nouvelle route ou action passe par une garde DAL et un DTO par rôle, et des tests unitaires ou de route existent. Les écarts portent sur trois points : des déductions côté manager (motif de sortie), des incohérences ADMIN à arbitrer, et une campagne HTTP non rejouée depuis le 30/09.

## 1. Matrice rôles × routes, pages et actions (état au 04/10)

Légende : « HTTP 30/09 » = couvert par `tests/security/authz.test.ts` ou `attacks.test.ts`. « Unitaire » = test DAL ou appel direct du handler, sans serveur. **Gras** = nouveau depuis le 30/09 ou absent de la campagne HTTP.

### Routes API

| Route | Garde | ADMIN | RH | MANAGER | Couverture |
|---|---|---|---|---|---|
| `GET /api/health` | aucune (exclue du proxy) | 200/503 | 200/503 | 200/503 | HTTP 30/09 |
| `GET /api/me` | `requireContext()` | oui | oui | oui | HTTP 30/09 |
| `GET /api/dashboard` | `requireContext()` + `ensurePilotage` | 403 | oui | périmètre, ADR-011 | HTTP 30/09 |
| `GET /api/employees`, `/[id]` | idem + `canSeeEmployee` | 403 | oui | périmètre, sans estimation | HTTP 30/09 |
| `POST /api/employees/[id]/what-if` | DAL (RH) | 403 | oui | 403 | HTTP 30/09 |
| `GET /api/alerts`, `PATCH /[id]` | `requireContext()` + `visibility()` | audience ADMIN | tout sauf ADMIN | audience MANAGER du périmètre | HTTP 30/09 |
| `GET /api/imports` / `POST` | `["ADMIN","RH"]` / `["ADMIN"]` | oui / oui | oui / 403 | 403 | HTTP 30/09 |
| `GET`, `POST /api/admin/users` | `["ADMIN"]` | oui | 403 | 403 | HTTP 30/09 |
| `POST /api/predictions/run` | `["ADMIN","RH"]` | oui | oui | 403 | HTTP 30/09 |
| **`GET /api/export/[kind]`** | `requireContext(EXPORT_ROLES)` + `exportList` | alertes seules | 3 listes | collaborateurs (8 colonnes), alertes | **Unitaire** (`tests/export/export.test.ts`), pas HTTP |
| **`GET /api/search`** | `requireContext` (3 rôles) + `scopeFilter` | 0 salarié, ses alertes | tout | périmètre | **Unitaire** (`tests/search/dal.test.ts`), pas HTTP |
| **`GET /api/privacy/requests/[id]/export`** | `requireContext()` + `ensureRh` | 403 | oui | 403 | **Unitaire** (`tests/privacy/privacy-dal.test.ts:236`), pas HTTP |
| **`GET /api/ajir/launch`** | public, HMAC + anti-rejeu | selon jeton | selon jeton | selon jeton | **Unitaire** (`tests/features/ajir-entry.test.ts`), pas HTTP |
| **`GET /go/tableau-de-bord`, `/go/collaborateur/[matricule]`** | `getContext` + `resolveEmployeeLink` | 403 audité | oui | périmètre, 403 audité | **Unitaire** (`ajir-entry.test.ts`), pas HTTP |

### Pages

| Pages | Garde | ADMIN | RH | MANAGER | Couverture |
|---|---|---|---|---|---|
| `/dashboard`, `/employees`, `/employees/[id]`, `/absenteeism` | `PILOTAGE_ROLES` | `/interdit` | oui | périmètre | HTTP 30/09 |
| **`/synthese`, `/equipes`, `/formations`, `/charge`** | `PILOTAGE_ROLES` | `/interdit` | oui | périmètre + gardes | Unitaire ; **absentes de la matrice HTTP** (`authz.test.ts:124-128`) |
| **`/organigramme`, `/retention`** (02/10) | `["RH","MANAGER"]` / `PILOTAGE_ROLES` | `/interdit` | oui | sous-arbre ; groupes < 5 masqués | Unitaire (`tests/org-chart`, `tests/retention`) ; **pas HTTP** |
| `/backtesting`, `/recommendations` | `["RH"]` | `/interdit` | oui | `/interdit` | HTTP 30/09 |
| **`/interventions`, `/previsions`, `/confidentialite`** | `["RH"]` + `ensureRole`/`ensureRh` | `/interdit` | oui | `/interdit` | Unitaire ; **pas HTTP** |
| `/transparency`, `/data-health` | `["ADMIN","RH"]` | oui | oui | `/interdit` | HTTP 30/09 |
| **`/derive`** (refonte du 04/10) | `["RH","ADMIN"]`, DTO `DriftAdmin` | sans taux de démission | oui | `/interdit` | Unitaire (`derive-pages.test.ts:72`) ; **pas HTTP** |
| `/admin/users`, `/admin/settings` (budgets, SMIG), `/admin/audit` | `["ADMIN"]` | oui | `/interdit` | `/interdit` | HTTP 30/09 (rôle seulement) |
| **`/admin`** (console) | `["ADMIN"]` | oui | `/interdit` | `/interdit` | **pas HTTP** |
| `/alerts`, `/compte` ; **`/alerts/[id]`, `/aide`** | `pageContext()` | oui | oui | oui | HTTP 30/09 pour les deux premières seulement |

### Server Actions (19)

| Actions | Garde réelle (DAL) | Couverture |
|---|---|---|
| `loginAction`, `logoutAction`, `activateAction` | publiques, limitation de débit | HTTP 30/09 (CSRF du login inclus) |
| `admin/users` (4 actions), `updateSettingsAction`, `recomputeAction` | `ensureRole(["ADMIN"])` | Unitaire ; **CSRF non testé** |
| `confidentialite` (3 actions) | `ensureRh` | Unitaire ; CSRF non testé |
| `decideRecommendationAction`, `feedbackRecommendationAction` | `requireGlobal` + `canSeeEmployee` | Unitaire |
| `updateAlertAction`, `changePasswordAction` | `visibility()` / compte propre | Unitaire |
| **`updateTrainingRecoAction`, `updateWorkloadRecoAction`, `updateAbsRecoAction`, `updateWorkforceRecoAction`** | `ensurePilotage` + règle manager propre au sujet / `ensureRh` | Unitaire (`tests/ai/*`) ; CSRF non testé |

**Vérifié conforme :**
- Les 26 pages appellent `pageContext` en tête.
- Les 19 actions passent par `getContext`, puis par une garde DAL et un `safeParse` zod.
- Les nouvelles routes valident leurs entrées : `kindSchema`, `searchQuerySchema`, `idSchema`/`querySchema`, regex HMAC et `TARGET_RE`.
- Export manager : colonnes sans estimation, `tri=probabilite` rabattu sur le risque (`employees.ts:254`).
- Recherche : aucun salarié pour l'ADMIN (`search.ts:27`).
- Organigramme : le manager ne voit pas son propre niveau (`org-chart.ts:277`), et les absences sont masquées en cascade (`orgMasks`).
- CSP et HSTS sont présents (`next.config.ts:6-40`) : le point faible du 29/09 est clos.

## 2. Écarts de permissions

| Problème | Risque | Priorité | Effort | Solution | Preuve |
|---|---|---|---|---|---|
| Rétention (Kaplan-Meier) côté manager : nombre de sorties observées affiché, effectif suivi mois par mois, bascule « Toutes sorties » / « Départs volontaires » | Dans une équipe d'au moins 5 embauches suivies, une marche de la courbe date une sortie identifiable. La bascule révèle si elle était volontaire. ADR-011 ne couvre que les groupes de moins de 5 | P2 | moyen | Côté manager : retirer `events` et `atRisk` du DTO et ne proposer que « Toutes sorties ». Sinon, consigner l'exception dans ADR-011 | `retention.ts:120`, `retention.ts:212` (seuil 5 sur la population seulement), `summary.ts:9-20` ; `retention/page.tsx:51-55` (bascule), `:167` (« N départs volontaires observés ») |
| Synthèse manager : « N sorties dont M départs volontaires » sur la fenêtre d'un mois | Avec une seule sortie, le motif du collaborateur parti se déduit. Or le Parcours le masque exprès au manager (« ni motif de sortie ») | P2 | faible | Côté manager : ne pas afficher la ventilation volontaire, ou la masquer si moins de 5 sorties | `synthesis.ts:135-138`, `:254` ; règle contraire : `synthesis.ts:570`, `:618` |
| ADMIN : `/transparency` montre des indicateurs de démission (taux de base, taux observé par groupe d'équité, démissions observées du démarrage à froid), alors que `/derive` les retire pour l'ADMIN | Séparation des tâches appliquée de façon incohérente : le jury peut relever la contradiction | P2 | faible | Arbitrer : masquer ces taux pour l'ADMIN comme dans `getDrift`, ou écrire l'exception « modèle » dans CONVENTIONS | `drift.ts:329` (« taux de démission retirés (indicateur RH) ») ; `model.ts:358-384` (aucune distinction de rôle) ; `transparency/page.tsx:319`, `:693` |
| Budget annuel de masse salariale saisi et vu par l'ADMIN dans Paramètres | La masse salariale est réservée à la RH (`ai-workforce.ts:12`) ; ici, c'est l'ADMIN qui fixe la cible utilisée par les recommandations RH | P2 | faible | Arbitrer : déplacer la saisie vers la RH (écran Prévisions), ou la documenter comme paramètre d'outil | `admin.ts:402-403`, `:456` (« montants d'entreprise »), `:488-489` |
| Recommandations IA : droits du manager différents selon le sujet | Un N+2 peut rejeter une recommandation formation ou charge adressée à son N-1, mais pas une recommandation absentéisme. Ce n'est pas une fuite, mais c'est difficile à expliquer | P3 | faible | Aligner sur une seule règle (équipe directe ou toute la hiérarchie) et figer les transitions autorisées | `ai-absenteeism.ts:108`, `:153` ; `ai-training.ts:209-211` ; `ai-workload.ts:282` |
| `/go/collaborateur/[matricule]` : 404 « Aucun collaborateur ne porte ce matricule » contre 403 hors périmètre | Oracle d'existence d'un matricule pour un manager ou l'ADMIN. Comportement analogue au §4.3 du 30/09, accepté par conception | P3 | faible | Accepter et documenter dans INTEGRATION_AJIR, ou renvoyer 403 uniforme hors pilotage | `go/collaborateur/[matricule]/route.ts:18-20`, `ajir.ts:19-22` |
| Constats du 30/09 toujours ouverts. Anciens managers nommés dans le Parcours du manager (§9.2, « Observation à arbitrer (Mineure) »). Nom et matricule des comptes liés dans `/api/admin/users` (§4.4). Nouveau : le journal d'audit ADMIN montre la cible `/go/collaborateur/<matricule>` | Exceptions nominatives côté ADMIN et manager, non arbitrées | P3 | faible | Trancher en une ligne dans CONVENTIONS (liste des exceptions acceptées) | `synthesis.ts:410-411` ; `admin.ts:92-94` ; `ajir.ts:83` |

## 3. Sécurité générale

| Problème | Risque | Priorité | Effort | Solution | Preuve |
|---|---|---|---|---|---|
| Campagne HTTP boîte grise non rejouée depuis le 30/09 : 5 points d'entrée et 13 pages hors matrice | Le « 60/60 » cité en soutenance ne couvre ni l'export, ni la recherche, ni l'organigramme, ni la rétention, ni l'ouverture AJIR, ni l'export du droit d'accès | P1 | moyen | Étendre les matrices (§ 4), puis rejouer `npm run test:security` sur un build isolé une fois la vérification finale d'ae terminée | `authz.test.ts:40-51` (10 routes), `:124-128` (12 pages) ; SECURITE_PERF § 9 |
| CSRF des Server Actions vérifié sur `/login` seulement | 18 actions mutantes reposent sur le contrôle d'origine de Next sans preuve par test (paramètres, rejeu de calcul, opposition, recommandations) | P2 | faible | Rejouer 3 ou 4 actions avec `Origin` étranger (cas 11 du § 4) | `attacks.test.ts:200-203` ; aucune clé `serverActions` dans `next.config.ts` |
| CSP et HSTS vérifiés dans la configuration, pas dans la réponse HTTP | Une régression dans `headers()` ou derrière Caddy passerait inaperçue | P3 | faible | Ajouter les deux en-têtes au test HTTP existant | `attacks.test.ts:357-364` (nosniff, XFO, Referrer seulement) ; `headers.test.ts:2` lit `next.config` |
| Journal d'erreur API : URL complète avec sa requête, sans masquage pino | Sur une 500, un nom recherché (`/api/search?q=`) ou un `login` et une `sig` AJIR peuvent finir dans les journaux | P3 | faible | Journaliser `req.nextUrl.pathname` seulement, ou ajouter `redact` à pino | `api.ts:44` ; `logger.ts:3` |
| `/api/ajir/launch` : chaque refus écrit une ligne d'audit, sans limitation de débit (si le secret est configuré) | Un anonyme peut remplir `audit_log`, qui est en ajout seul | P3 | faible | Réutiliser `rate-limit.ts` (clé IP fiable) avant `refuse()` | `ajir.ts:62-66` ; limitation actuelle : connexion et activation seulement (SECURITE_PERF § 8 n° 7) |
| CSP `script-src 'unsafe-inline'` | Défense en profondeur limitée contre un XSS résiduel. Compromis documenté (Next sans nonce) | P3 | élevé | Laisser en l'état pour la soutenance ; un nonce dans le proxy viendrait plus tard | `next.config.ts:3-9` |
| `tests/security/.fixtures.json` non exclu par `.gitignore` | Probablement versionné dans le dépôt GitHub : 115 Ko de valeurs de salaire et de probabilité, plus 2 434 noms (données simulées). À vérifier | P3 | faible | Ajouter le fichier à `.gitignore` ; il est régénéré par `gen-fixtures.cjs` | `.gitignore` (aucune entrée) ; `helpers.ts:28-31` |
| `APP_URL` annoncé comme servant au « contrôle d'origine », alors que `withApi` compare `x-forwarded-host`/`host`. Lien d'activation construit depuis les en-têtes si `APP_URL` manque (déjà listé au § 8, atténué par `check-install`) | Documentation trompeuse pour l'exploitant | P3 | faible | Corriger le commentaire de `env.example` | `deploy/env.example:15` ; `api.ts:27` ; `admin/users/actions.ts:23-28` ; `check-install.ts:85` |
| Mots de passe de démonstration en clair (`RhDemo2026pfe`, `MgrDemo2026pfe`), non détectés par `check-install` | Risque si `demo-passwords.ts` est lancé sur la base de production | P3 | faible | Contrôle `check-install` : ÉCHEC si l'audit contient `user.password.demo` | `scripts/demo-passwords.ts:5-6` ; `check-install.ts` (aucun contrôle) |

Vérifié conforme : aucun `.env` dans le dossier, `.env*` est ignoré, aucune clé en dur dans `src/`. Le secret AJIR fait au moins 32 caractères, la comparaison HMAC est en temps constant, avec fenêtre de 60 s et anti-rejeu en transaction. Les redirections sont bornées (`TARGET_RE`, `safeNextPath`). Les erreurs passent par `withApi` sans pile ni SQL. Les sessions sont inchangées depuis le durcissement du 30/09 (glissante 2 h, plafond 10 h, cookie `Secure` hors `INSECURE_COOKIES`, signalé en ÉCHEC par `check-install`).

## 4. Tests de sécurité manquants à ajouter

Ajouts dans `tests/security/` (campagne HTTP), sauf mention contraire :

1. **Export, matrice des rôles.** `GET /api/export/{employees,alerts,recommendations}` pour anonyme, ADMIN, RH et MANAGER. Codes attendus : 401 ; 403/200/403 ; 200/200/200 ; 200/200/403. `/api/export/inconnu` : 401 anonyme, 404 authentifié.
2. **Export MANAGER forcé.** Paramètres `tri=probabilite`, `manager=<id hors périmètre>`, `departement=<autre>`. Attendus : en-tête CSV à 8 colonnes ; `X-Export-Total` ≤ `inScopeCount` ; aucune valeur de `sensitiveNumbers`, aucun nom hors périmètre, pas de « TND ». Il faut un `scanLeaks` adapté au texte CSV.
3. **Recherche.** MANAGER avec `q=<nom hors périmètre>` : `employees` vide. ADMIN avec `q=<nom de salarié>` : `employees` vide, aucune alerte nominative. `q` = `%`, `_`, apostrophe : jamais de 500. `q` d'une lettre : 400.
4. **Export du droit d'accès.** Anonyme 401, ADMIN et MANAGER 403, RH 200 (zip et json). Id inexistant : 404. Demande d'un autre type que ACCES : 409. `format=xml` : 400.
5. **Ouverture AJIR.** Sans secret : 404 et aucun cookie. Jeton rejoué, `cible=//evil` ou `cible=/go/../admin` : 401 sans cookie. En-tête `Referrer-Policy: no-referrer` présent.
6. **Lien profond.** `/go/collaborateur/<matricule hors périmètre>` en MANAGER : 403, corps sans nom. En ADMIN : 403. En anonyme : redirection vers `/login?next=`.
7. **Matrice des pages.**
   - `/synthese`, `/equipes`, `/organigramme`, `/retention`, `/formations`, `/charge` : RH et MANAGER autorisés, ADMIN renvoyé vers `/interdit`.
   - `/interventions`, `/previsions`, `/confidentialite` : RH seule.
   - `/derive` : MANAGER renvoyé vers `/interdit`. `/admin` : ADMIN seul. `/aide` et `/alerts/[id]` : tous les rôles, avec un détail d'alerte hors périmètre en 307.
8. **Fuites dans le flux RSC côté MANAGER** sur les 6 pages de pilotage du cas 7, avec `mgr.M10451` et `mgr.M12037`. `scanLeaks` sur le HTML : salaire, probabilité, lift, `phrase_rh`, noms hors périmètre, « TND ».
9. **ADMIN sur `/derive`.** Aucune clé `observed`, `expected` ni `referenceRate` dans le flux. Sur `/transparency`, figer le comportement retenu après l'arbitrage du § 2.
10. **Petites populations en HTTP.** Créer dans `sec.db` un manager dont le périmètre compte moins de 5 personnes. Attendus : `/retention` sans courbe d'ensemble, `/synthese` sans sorties, absentéisme de `/organigramme` masqué, `/equipes` masqué.
11. **CSRF des Server Actions.** Rejouer `updateSettingsAction` (ADMIN), `recomputeAction`, `createRequestAction` (RH) et `updateTrainingRecoAction` (MANAGER) avec un `Origin` étranger. Attendu : aucune écriture (`app_setting`, `app_job`, `privacy_request`, `insight_recommendation` et `audit_log` inchangés).
12. **Server Actions hors rôle.** Identifiant d'action repris de la page d'un autre rôle, par exemple MANAGER appelant `updateSettingsAction`, `updateWorkforceRecoAction`, `decideRecommendationAction` ou `createRequestAction`. Attendu : refus audité, aucune écriture.
13. **En-têtes HTTP.** `Content-Security-Policy` sur `/login` et `/api/health`. `Strict-Transport-Security` en production.
14. **Recommandations IA d'un N+2** (unitaire, `tests/ai/*`). Un manager tente REJETEE sur une recommandation ABSENTEISME, FORMATION puis CHARGE adressée à son N-1. Figer la règle retenue au § 2.
15. **Motif de sortie côté manager** (unitaire, `tests/retention`, `tests/ergo-pilot/synthese.test.ts`), selon l'arbitrage du § 2. Équipe de 6 avec une seule démission : ni `events` ventilés, ni « dont 1 départ volontaire ».

## Notes proposées

- **Sécurité : 8/10.** Gardes serveur systématiques (DAL, DTO par rôle, zod, audit des refus), CSP et HSTS corrigés, aucune fuite exploitable trouvée. Deux points manquent : une campagne HTTP rejouée depuis le 30/09 sur les nouvelles routes, et l'arbitrage de quelques déductions (motif de sortie côté manager, indicateurs de démission visibles par l'ADMIN).
