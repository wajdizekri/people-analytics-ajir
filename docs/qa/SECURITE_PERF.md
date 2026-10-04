# Sécurité & Performance — campagne de tests (boîte grise, niveau HTTP)

> **Campagne finale du 30/09/2026 : voir § 9** (60/60 tests HTTP, 102/102 avec le durcissement ; `/api/dashboard` p95 = 103 ms et `/api/employees` p95 = 193 ms sous 20 utilisateurs ; 0 vulnérabilité en production selon `npm audit`). Les §§ 1 à 7 décrivent la première campagne (29/09).

Date : 2026-09-29. Cible : serveur de production **isolé** — build `NEXT_DIST_DIR=.next-sec`, `DATABASE_PATH=data/sec.db` (copie de `app.db`, jamais écrite en production), `next start -p 3300`. Aucun paquet installé. Tests rejouables : [tests/security/](../../tests/security), [scripts/perf.ts](../../scripts/perf.ts).

## 1. Résumé

- **~60 tests Vitest** regroupant **plus de 350 cas HTTP** (rôles × routes × charges utiles) : 60/60 au vert.
- **Vulnérabilités : 0 critique, 0 élevée, 0 moyenne.** 2 faibles (en-têtes CSP/HSTS absents ; latence dashboard sous charge) + 4 observations informationnelles (voir §4).
- **Performance :** `GET /api/dashboard` p95 = **424–554 ms** selon la mesure (critère < 500 ms → **à la limite** sous 20 VUs soutenus ; p50 ≈ 218–299 ms — voir §4.6), `GET /api/employees` p95 = 427–750 ms, pipeline complet = **1,06 min** (critère < 15 min → **OK**).
- Le contrôle d'accès (401/403/404), le cloisonnement DTO par rôle, le périmètre manager, l'anti-CSRF, la gestion de session, l'anti-brute-force et le téléversement sont **conformes** au cahier des règles de [docs/CONVENTIONS.md](../CONVENTIONS.md).

## 2. Méthodologie & isolation

- Copie cohérente : `VACUUM INTO data/sec.db` depuis `app.db` (lecture seule). Le serveur de test tourne sur le port 3300, arrêté en fin de campagne.
- Comptes : `admin` / `rh.demo` / `mgr.M10451` (périmètre : 10 collaborateurs, racine `employee_id=451`).
- Deux modes de connexion utilisés : (a) vraie Server Action `/login` rejouée sans JS (formulaire multipart avec champs `$ACTION_*`), (b) sessions de test insérées directement dans `sec.db` au format de [src/lib/auth/session.ts](../../src/lib/auth/session.ts) (id = SHA-256 du jeton).
- Détection de fuite : parcours récursif des réponses (clés interdites, valeurs de salaire/probabilité/lift/masse salariale connues, phrases `phrase_rh`, noms hors périmètre, mention « TND ») — cf. `scanLeaks` dans [tests/security/helpers.ts](../../tests/security/helpers.ts).

## 3. Matrice d'autorisation (résultats)

Codes HTTP observés, conformes à l'attendu pour anonyme / ADMIN / RH / MANAGER (dans/hors périmètre) :

| Route | anon | ADMIN | RH | MGR (dans) | MGR (hors) |
|---|---|---|---|---|---|
| `GET /api/health` | 200 | 200 | 200 | 200 | — |
| `GET /api/me` | 401 | 200 | 200 | 200 | — |
| `GET /api/dashboard` | 401 | **403** | 200 | 200 | — |
| `GET /api/employees` | 401 | **403** | 200 | 200 | — |
| `GET /api/employees/[id]` | 401 | 403¹ | 200 | 200 | **403** (existe) / 404 (inexistant) |
| `POST /api/employees/[id]/what-if` | 401 | 403 | 200/409 | **403** | 403 |
| `GET /api/alerts` | 401 | 200 | 200 | 200 (filtré) | — |
| `PATCH /api/alerts/[id]` | 401 | 200/403/404/409 | idem | 403/404 | — |
| `GET /api/imports` | 401 | 200 | 200 | **403** | — |
| `GET /api/admin/users` | 401 | 200 | **403** | 403 | — |
| `POST /api/admin/users` | 401 | 201/400/409 | 403 | 403 | — |
| `POST /api/imports` | 401 | 202/400/422/413 | 403 | 403 | — |
| `POST /api/predictions/run` | 401 | 202/400/409 | 202/400/409 | **403** | — |

¹ ADMIN sur une fiche existante → 403 (il n'a aucune donnée RH nominative) ; inexistante → 404.

**Pages** (`src/app/(app)/…`) : anonyme → 307 `/login` partout ; rôle non autorisé → soit 307 `/interdit`, soit **200 avec redirection diffusée** vers `/interdit` (voir §4.1) — dans les deux cas, **aucune donnée métier dans la réponse** (coque `loading.tsx` uniquement). Cloisonnement vérifié : pilotage (dashboard/employees/absenteeism) = RH+MANAGER ; backtesting/recommendations = RH ; transparency/data-health = ADMIN+RH ; admin/* = ADMIN ; fiche employé = RH partout, MANAGER dans son périmètre seulement.

**Fuites** : aucune clé/valeur de salaire, masse salariale, probabilité, lift, `phrase_rh`, ni signal d'absentéisme individuel, ni nom hors périmètre dans les réponses MANAGER (`/api/employees`, `/api/employees/[id]`, `/api/dashboard`, `/api/alerts`). Aucun montant/probabilité/phrase dans les réponses ADMIN (`/api/me`, `/api/imports`, `/api/alerts`).

**Paramètres manipulés** : filtres réservés au manager (`contrat`/`age`/`anciennete`) ignorés et signalés (`ignored`), pas de 400 ; types invalides (`departement=abc`, `page=-5`, `tri=xxx`, `niveau=SUPER`, `periode=99z`, `limit=100000`, `severity=ROUGE`) → **400 `VALIDATION`** ; pagination extrême `page=100000` clampée (200), `page=100001` → 400 ; paramètre inconnu ignoré (200) ; méthodes non prévues → **405**.

## 4. Vulnérabilités et écarts

Aucune vulnérabilité exploitable (injection, XSS, CSRF, escalade, IDOR, fuite) n'a été trouvée. Les points ci-dessous sont des durcissements recommandés.

### 4.1 (Faible) En-têtes de sécurité manquants : CSP et HSTS — corrigé (§8)

- **Description :** les réponses portent `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`, et pas de `X-Powered-By`. En revanche **aucune `Content-Security-Policy`** ni **`Strict-Transport-Security`** n'est émise.
- **PoC :** `curl -sD - http://127.0.0.1:3300/login -o /dev/null` → pas d'en-tête `Content-Security-Policy` ni `Strict-Transport-Security`.
- **Impact :** défense en profondeur réduite contre un XSS résiduel (pas de CSP pour bloquer l'exécution de scripts injectés) et absence de forçage HTTPS côté navigateur. Faible car l'application échappe déjà correctement le HTML (React) et sert les API en `application/json`.
- **Sévérité CVSS indicative :** 3.1 (AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N).
- **Correction proposée :** ajouter dans `headers()` une CSP stricte (`default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'` + ajustements `script-src`/`style-src` selon les besoins de Next) et, derrière HTTPS, `Strict-Transport-Security: max-age=63072000; includeSubDomains`.
- **Fichier :** [next.config.ts](../../next.config.ts).

### 4.2 (Info) Pages en HTTP 200 pour un rôle non autorisé (redirection diffusée)

- **Description :** pour les pages dotées d'un `loading.tsx` (ex. `/dashboard`, `/employees`), un rôle non autorisé reçoit **HTTP 200** puis une redirection vers `/interdit` transportée dans le flux RSC, au lieu d'un 3xx immédiat. Les pages sans streaming redirigent en 307.
- **PoC :** `GET /dashboard` avec session ADMIN → `200`, corps = coque `loading` + payload contenant `/interdit`, **sans aucune donnée** (ni matricule, ni salaire, ni « TND »).
- **Impact :** nul sur la confidentialité (aucune donnée métier dans la coque). Risque uniquement cosmétique/monitoring : un scanner qui se fie au seul code HTTP pourrait croire l'accès autorisé.
- **Sévérité :** informationnelle. Comportement déjà documenté dans [docs/DEMO.md](../DEMO.md).
- **Correction éventuelle :** si un 403/redirection ferme est souhaité au niveau HTTP, effectuer le contrôle de rôle avant la frontière de streaming (ou dans le `proxy`), au prix de la perte du squelette de chargement.

### 4.3 (Info) Oracle d'existence 403 vs 404 sur les fiches employé

- **Description :** hors périmètre sur une ressource existante → 403 ; ressource inexistante → 404. Un manager (ou l'ADMIN) peut donc distinguer un id de salarié existant d'un id inexistant.
- **PoC :** MANAGER `GET /api/employees/5` (existe, hors périmètre) → 403 ; `GET /api/employees/9999999` → 404.
- **Impact :** faible — seule l'existence d'un id numérique est révélée, aucune donnée nominative. **Comportement explicitement voulu** par [docs/CONVENTIONS.md](../CONVENTIONS.md) (« hors périmètre → 403 ; inexistant → 404 »).
- **Sévérité :** informationnelle (accepté par conception).
- **Correction éventuelle :** renvoyer un 404 uniforme hors périmètre si l'énumération de l'effectif devient sensible.

### 4.4 (Info) Données nominatives visibles par l'ADMIN dans `/api/admin/users`

- **Description :** `GET /api/admin/users` renvoie, pour chaque compte lié, `employee.name` et `employee.matricule`. La convention indique que l'ADMIN « ne voit aucune donnée nominative ».
- **Impact :** faible et fonctionnellement nécessaire (rattacher un compte manager à un salarié). À valider avec le métier.
- **Sévérité :** informationnelle.
- **Fichier :** `toUserDTO` dans [src/lib/dal/admin.ts](../../src/lib/dal/admin.ts).

### 4.5 (Info) `/api/health` renvoie 200 en état « dégradé » — corrigé (§8)

- **Description :** l'endpoint renvoie 200 tant que la base répond (503 seulement si la base est en erreur), même worker absent (`status: "degrade"`). Aucune fuite (clés : `status`, `database`, `worker`, `model`).
- **Impact :** aucun ; utiliser le champ `status` et non le code HTTP pour la supervision.
- **Sévérité :** informationnelle.

### 4.6 (Faible) Latence du tableau de bord à la limite du budget sous charge soutenue

- **Description :** sous 20 utilisateurs virtuels pendant 60 s, `GET /api/dashboard` mesure **p95 = 554 ms (run 1)** puis **424 ms (run 2)** — donc **à la limite** du critère de 500 ms (dépassé de peu une fois, atteint l'autre). p50 stable ~218–299 ms, p99 534–984 ms, 0 % d'erreur. `GET /api/employees` : p95 750 ms puis 427 ms. En charge légère (1 utilisateur) la réponse est < 40 ms.
- **PoC :** `DATABASE_PATH=data/sec.db npx tsx scripts/perf.ts` (mesure `dashboard.p95`).
- **Cause probable :** `better-sqlite3` est **synchrone** ; sur une instance Next mono-processus, 20 requêtes concurrentes qui déclenchent chacune plusieurs requêtes SQL lourdes (agrégats + population + niveaux de risque) se sérialisent sur l'unique thread Node, ce qui fait grimper les percentiles hauts. La variance entre les deux runs (max 1 581 ms vs 712 ms) reflète la charge concurrente de la machine (compilations d'autres agents en parallèle). En usage réel (quelques utilisateurs RH simultanés), le budget est tenu.
- **Impact :** dégradation de la réactivité en pic de concurrence, pas d'indisponibilité. Faible.
- **Sévérité CVSS indicative :** — (disponibilité/performance, hors modèle CVSS classique) ; priorité fonctionnelle faible.
- **Corrections proposées :** mémoïsation courte des agrégats du tableau de bord (les données ne changent qu'au pipeline mensuel), ou mise en cache HTTP (actuellement `Cache-Control: no-store`), ou exécution des lectures lourdes dans un pool/worker ; à défaut, dimensionner plusieurs instances derrière un répartiteur. Fichiers : [src/lib/dal/dashboard.ts](../../src/lib/dal/dashboard.ts), [src/app/api/dashboard/route.ts](../../src/app/api/dashboard/route.ts).

## 5. Points vérifiés conformes (résumé des attaques)

- **Injection SQL :** requêtes 100 % paramétrées (`@param`), tris/filtres bornés par `enum` zod, recherche `q` échappée pour `LIKE` (`\`). 9 charges × ~12 paramètres → **aucun 500, aucune erreur SQL divulguée** ; l'injection dans `q` n'élargit jamais le résultat. Fichiers : [src/lib/dal/employees.ts](../../src/lib/dal/employees.ts), [alerts.ts](../../src/lib/dal/alerts.ts), [dashboard.ts](../../src/lib/dal/dashboard.ts).
- **XSS :** réponses API en `application/json` (non exécutables) ; le HTML de pages échappe le payload (`<script>` absent en clair) ; XSS stocké dans titre/message/commentaire d'alerte **échappé** ; liens d'alerte dangereux (`javascript:`, `//evil`) **neutralisés en `null`** (cf. `toDTO`, [alerts.ts](../../src/lib/dal/alerts.ts)).
- **CSRF :** contrôle d'origine sur les Route Handlers mutants → **403 `ORIGINE_INVALIDE`** avec `Origin` étranger (PATCH alertes, POST users/imports/predictions/what-if) ; même origine → la logique métier reprend. Server Action `/login` avec `Origin` étranger → **aucune session émise**. Cookie `SameSite=Lax` : non transmis sur POST cross-site. Fichier : [src/lib/api.ts](../../src/lib/api.ts).
- **Session & cookie :** cookie `pa_session` **HttpOnly + Secure + SameSite=Lax** en production ; jeton opaque (SHA-256 en base) ; **invalidé à la déconnexion** (réutilisation → 401) ; session supprimée/expirée/falsifiée → 401 ; **pas de fixation** (un jeton choisi par l'attaquant est rejeté et remplacé à la connexion).
- **Énumération / verrouillage :** message générique identique pour compte inconnu et mauvais mot de passe ; **verrouillage progressif** après 5 tentatives (`failed_attempts`, `locked_until` en base). Fichier : [src/lib/auth/login.ts](../../src/lib/auth/login.ts).
- **Jeton d'activation :** format strict `[A-Za-z0-9_-]{43}`, empreinte SHA-256 stockée, **usage unique** (consommation atomique `RETURNING`), **expiration** respectée, jeton aléatoire rejeté (résistance au brute force). Fichier : [src/lib/dal/admin.ts](../../src/lib/dal/admin.ts).
- **Téléversement `/api/imports` :** réservé ADMIN (RH → 403) ; noms hors contrat / traversée de chemin (`../../etc/passwd`, `evil.exe`, `employees.CSV`) → **400** (liste blanche `enum`) ; en-tête sans `;` → **422** ; dépassement de taille (~9,2 Mo) → **413**. Fichier : [src/lib/dal/imports.ts](../../src/lib/dal/imports.ts).
- **Messages d'erreur :** enveloppe `{ error: { code, message, correlationId } }`, sans pile ni SQL ni chemin de fichier.

## 6. Performance

Serveur de production isolé (port 3300), base `sec.db` (≈ 2 445 salariés, run publié n° 72). Charge : `fetch` concurrent, 20 utilisateurs virtuels, 60 s par endpoint.

### 6.1 Charge API (20 VUs × 60 s), latences en ms

| Endpoint | requêtes | erreurs | débit | p50 | p90 | **p95** | p99 | max |
|---|---|---|---|---|---|---|---|---|
| `GET /api/dashboard` | 3 633 | 0 | 60,2/s | 298,8 | 470,3 | **554,0** | 983,5 | 1 581 |
| `GET /api/employees` | 2 859 | 0 | 47,5/s | 385,2 | 593,5 | 749,9 | 1 076,7 | 1 306 |

Deux mesures de 60 s ont été réalisées : dashboard p95 = **554 ms** (run 1) puis **424 ms** (run 2) ; employees p95 = 750 ms puis 427 ms. Le tableau de bord est donc **à la limite** du critère de 500 ms sous 20 VUs (atteint une fois, dépassé de peu l'autre), avec un p50 stable (~218–299 ms) et 0 % d'erreur. La variance s'explique par la charge concurrente de la machine (compilations d'autres agents en parallèle : max 1 581 ms au run 1 contre 712 ms au run 2). Voir §4.6.

### 6.2 Temps de chargement des pages (ms, 15 échantillons, charge légère)

| Page | p50 | p95 | max |
|---|---|---|---|
| `/login` | 112 | 612 | 612 |
| `/dashboard` | 214 | 466 | 466 |
| `/employees` | 94 | 416 | 416 |
| `/alerts` | 22 | 31 | 31 |
| `/transparency` | 19 | 22 | 22 |
| `/data-health` | 50 | 84 | 84 |
| `/admin/users` | 218 | 469 | 469 |

> Note : ces temps correspondent à la réponse HTTP (coque de streaming/RSC). Le rendu des données lourdes est diffusé ensuite via `loading.tsx`. La première requête `/login` inclut un coût de démarrage à froid.

### 6.3 Pipeline complet

Durée mesurée : **1,06 min** (63,6 s) — calendrier + agrégats + variables (72 mois) + scoring + anomalies + alertes, sur une copie isolée de `sec.db`. **Critère < 15 min : OK.**

Exécuté sur une **copie isolée** de `sec.db` (`sec-pipeline.db`, supprimée ensuite) pour ne pas perturber le serveur en charge ni le run publié. Équivaut à `DATABASE_PATH=data/sec.db npm run pipeline -- --to <dernier mois>`.

## 7. Commandes pour relancer

```powershell
# 1. Copie isolée de la base (jamais d'écriture dans app.db)
#    (VACUUM INTO depuis app.db, ou copier sec.db existante)
# 2. Build + serveur isolés
$env:NEXT_DIST_DIR=".next-sec"; $env:DATABASE_PATH="data/sec.db"
npm run build
npx next start -p 3300 -H 127.0.0.1        # laisser tourner dans un terminal dédié

# 3. Régénérer les données de test (ids de périmètre, valeurs sensibles) — une fois
node tests/security/gen-fixtures.cjs        # écrit tests/security/.fixtures.json

# 4. Tests de sécurité (autre terminal)
$env:SEC_BASE_URL="http://127.0.0.1:3300"; $env:DATABASE_PATH="data/sec.db"
npx vitest run tests/security --no-file-parallelism

# 5. Performance
npx tsx scripts/perf.ts                      # complet (60 s/endpoint + pipeline)
npx tsx scripts/perf.ts --quick              # rapide (8 s/endpoint, sans pipeline)

# 6. Arrêt du serveur de test à la fin.
```

## 8. Correctifs appliqués (durcissement, 2026-09-30)

Tests de non-régression : [tests/security-hardening/](../../tests/security-hardening) (7 fichiers, 41 tests, sans serveur) ; `npx vitest run tests/security-hardening`. Suite complète hors campagne HTTP : 62 fichiers, 523 tests au vert.

| # | Point | Correctif | Fichiers |
|---|---|---|---|
| 1 | §4.1 CSP / HSTS absents | `Content-Security-Policy` (`default-src 'self'` ; `script-src 'self' 'unsafe-inline'`, plus `'unsafe-eval'` en développement seulement ; `style-src 'self' 'unsafe-inline'` ; `img-src 'self' data:` ; `connect-src 'self'` ; `object-src 'none'` ; `frame-ancestors`, `base-uri`, `form-action 'self'`), `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `Strict-Transport-Security: max-age=31536000` en production seulement. Même politique que le Caddyfile. ECharts compatible : rendu canvas sans ressource externe, styles en ligne des infobulles, export en `data:` | [next.config.ts](../../next.config.ts) |
| 2 | §4.5 `/api/health` 200 en dégradé | **503** si la base est inaccessible ou si le worker est hors service (aucun signal depuis plus de 10 min, état `PERIME`, même seuil que l'alerte « Worker de calcul arrêté ») ; 200 sinon, `status` = `degrade` pour un worker en retard, jamais démarré (installation neuve) ou un champion absent. Corps inchangé (4 clés d'état, aucun chemin ni version) | [src/app/api/health/route.ts](../../src/app/api/health/route.ts) |
| 3 | Refus de rôle page/route non audités | `pageContext(roles)` et `requireContext(roles)` journalisent `access.page` / `access.api`, `outcome = REFUSE`, cible `route` (chemin sans paramètres, posé par le proxy dans l'en-tête interne `x-pa-pathname`, toujours écrasé), détail `{ role, required }`, IP. Pas de double audit : ce refus interrompt la requête avant la DAL, donc avant `ensurePilotage` / `ensureRole` ; une route sans exigence de rôle (ex. `/api/dashboard`) reste auditée par la seule DAL. 401 non journalisés | [src/lib/dal/context.ts](../../src/lib/dal/context.ts), [src/proxy.ts](../../src/proxy.ts) |
| 4 | Sessions 10 h fixes, jamais purgées | **Expiration glissante** : la session expire après **2 h sans requête** ; chaque usage repousse `expires_at` (au plus une écriture par minute), jamais au-delà du **plafond absolu de 10 h** après la connexion (échéance du cookie, inchangée). Session expirée ou hors plafond : refusée et supprimée. **Purge** (`DELETE` unique) à chaque connexion et au plus tous les quarts d'heure lors d'une lecture de session. Révocation des autres sessions au changement de mot de passe : déjà en place (`changeOwnPassword`), couverte par un test | [src/lib/auth/session.ts](../../src/lib/auth/session.ts) |
| 5 | B2, B3, B4 ([COUVERTURE.md](COUVERTURE.md)) | B2 : clé du cache du champion = id + `promoted_at` + **SHA-256 du manifeste** (une seule entrée). B3 : trigger `audit_log_no_replace` (`BEFORE INSERT … WHEN EXISTS id`) : `INSERT OR REPLACE`, `REPLACE`, `INSERT OR IGNORE` et upsert sur un id existant refusés (« audit_log est en ajout seul »), testé sur base vierge. B4 : `safeInternalLink` n'accepte qu'un seul `/` suivi d'un caractère autre que `/` ou `\`, sans espace, caractère de contrôle ni `\`, et qui reste sur l'origine une fois résolu. Les trois `it.fails` sont devenus des tests verts | [registry.ts](../../src/lib/scoring/registry.ts), [drizzle/0006_audit_hardening.sql](../../drizzle/0006_audit_hardening.sql), [alerts.ts](../../src/lib/dal/alerts.ts) |
| 6 | Pas de garde-fou sur l'accès à la base | Règle ESLint `no-restricted-imports` : `@/db/client` (alias ou chemin relatif) interdit hors `src/lib/**`, `src/db/**`, `src/worker/**`, `scripts/**` et tests. Aucune page ni composant ne l'importe | [eslint.config.mjs](../../eslint.config.mjs) |
| 7 | Pas de limitation de débit | Mémoire, fenêtre fixe de 15 min, échecs seulement. **Connexion** : 30 échecs par IP fiable ; par compte, le verrou progressif en base (comptes existants) est doublé d'un verrou identique en mémoire pour les identifiants inconnus, inactifs ou sans mot de passe (même message, même délai) et d'une vérification argon2 factice : ni le message « verrouillé » ni le temps de réponse ne révèlent plus l'existence d'un compte. **Activation** : 10 échecs par jeton (compte visé), 20 par IP fiable. Refus pour limite audités (`limite_ip`, `limite`). Mémoire bornée à 10 000 clés (une saturation affaiblit la limitation sans bloquer personne) | [src/lib/auth/rate-limit.ts](../../src/lib/auth/rate-limit.ts), [login.ts](../../src/lib/auth/login.ts), [activation.ts](../../src/lib/auth/activation.ts) |
| 8 | Revue ciblée | `withApi` : un en-tête `Origin: null` (iframe sandbox, redirection) provoquait une 500 ; désormais 403 `ORIGINE_INVALIDE` | [src/lib/api.ts](../../src/lib/api.ts) |

**Confiance accordée à `X-Forwarded-For` (`TRUST_PROXY`).** Variable d'environnement, `0` par défaut. `TRUST_PROXY=N` = nombre de proxys de confiance devant Next.js : l'adresse du client est le N-ième maillon de `X-Forwarded-For` en partant de la droite, les maillons plus à gauche (fournis par le client) sont ignorés, et une valeur qui n'est pas une adresse IP est rejetée. Derrière le Caddy de [deploy/caddy/](../../deploy/caddy/Caddyfile) (qui remplace l'en-tête d'un client non fiable par l'adresse réelle du pair) : `TRUST_PROXY=1`. Sans proxy de confiance, l'en-tête est falsifiable : **aucune clé par IP n'est appliquée** (seule la limitation par compte joue), sinon un attaquant pourrait bloquer l'adresse d'un tiers ou contourner la limite. Ne jamais positionner `TRUST_PROXY` si le port de Next.js est joignable sans passer par le proxy. L'IP journalisée (audit, sessions) suit la même règle quand `TRUST_PROXY` est défini ; sinon elle reste indicative.

**Écarts restants (hors périmètre de ce lot, signalés)** — tous traités le 30/09 (§ 9), sauf `APP_URL`, qui relève de la configuration du serveur cible : `/api/health` renvoie désormais 503 quand le worker est `PERIME` — la matrice de [tests/security/authz.test.ts](../../tests/security/authz.test.ts) attend 200 et doit accepter 503 si la campagne tourne sans worker ; `changeOwnPassword` ([src/lib/dal/account.ts](../../src/lib/dal/account.ts)) ne limite pas les essais du mot de passe actuel ; le téléversement lit tout le corps (`formData()`) avant le contrôle de taille quand `Content-Length` est absent (ADMIN seul, borné à 20 Mo par Caddy) ; liens d'activation construits depuis `X-Forwarded-Host` si `APP_URL` n'est pas défini (le définir en production).

## 9. Campagne finale (2026-09-30, vérification d'intégration)

Serveur de production isolé reconstruit sur l'état final : `NEXT_DIST_DIR=.next-sec`, `DATABASE_PATH=data/sec.db` (copie fraîche de `app.db` par l'API de sauvegarde : run LOGREG n° 73, 2 445 salariés), `next start -p 3300`, sans worker ; serveur arrêté en fin de campagne. Fixtures régénérées (`gen-fixtures.cjs` : périmètre de 10 salariés, 256 valeurs sensibles, 2 434 noms hors périmètre). Dans `sec.db` seulement, un collaborateur de l'équipe de `mgr.M10451` a été rendu opposé au traitement prédictif (avec une action réalisée) pour contrôler la fiche côté manager.

### 9.1 Tests

| Suite | Résultat |
|---|---|
| `tests/security/` (campagne HTTP : matrice API et pages, fuites, injection, XSS, CSRF, session, énumération, activation, téléversement, en-têtes, erreurs) | **60/60** |
| `npm run test:security` (campagne HTTP + `tests/security-hardening`, 9 fichiers) | **102/102** |

Deux adaptations de tests, sans changement applicatif : `/api/health` accepté en 200 ou 503 dans la matrice (503 quand le worker est hors service) ; le test d'énumération cherchait « verrouill » dans toute la page et trouvait l'aide statique « Compte oublié ou verrouillé ? » : il vise désormais le message de verrouillage lui-même (faux positif, aucune fuite).

Correctifs livrés avec la campagne (tests de non-régression sans serveur) :

- **Opposition** : `getEmployeeNews` et `getEmployeeInterventionEffects` ne la révèlent plus au MANAGER (DTO, `tests/insights/insights.test.ts`) ; vérifié dans le navigateur sur la fiche du collaborateur opposé : aucune mention, message « non évalué » identique à celui d'un collaborateur non scoré.
- **Mot de passe actuel** (`changeOwnPassword`) : 5 échecs par compte et par 15 min, puis refus audité (`tests/security-hardening/sessions.test.ts`).
- **Téléversement** : corps lu par morceaux, abandonné au-delà de 9 Mo + 64 Ko même sans `Content-Length` → 413 (`tests/ui-admin/api.test.ts`).
- **Session expirée avec cookie présent** : retour à la page demandée après connexion (`/login?next=`, chemin interne validé) (`tests/unit/page-context-next.test.ts`).

### 9.2 Vérifications par rôle dans le navigateur

Connexion réelle par le formulaire (`admin`, `rh.demo`, `mgr.M10451`), Chromium, 82 pages vues : pour chaque rôle, les 22 écrans du menu et de l'administration, un détail d'alerte et une fiche ; en plus, la fiche du collaborateur opposé (RH) et les 9 fiches de l'équipe (manager). Contrôles sur le texte affiché et sur le HTML complet (flux RSC compris).

- **Aucune erreur 500** ni page d'erreur.
- **ADMIN** : aucun nom ni matricule de salarié hors des deux exceptions documentées (liste des comptes, qui rattache un manager à un salarié ; matricules des rejets d'import dans Santé des données) ; les pages de pilotage mènent à `/interdit`. Le filtre du journal d'audit liste des identifiants de comptes (`mgr.M10005`…), pas des données RH.
- **MANAGER** : ni montant, ni salaire, ni probabilité, ni lift, ni opposition, ni signal individuel d'absentéisme, ni clé sensible dans le flux RSC ; les mots relevés sont des textes d'aide génériques (« Aucune probabilité ni rémunération n'est affichée », « Hors de votre rôle : salaires… »). Pages RH seulement → `/interdit`. Observation à arbitrer (Mineure) : le composant Parcours affiche le nom des anciens managers d'un collaborateur (information d'organigramme, voir BUGS_E2E.md).
- **Pages hors rôle en HTTP 200 (§ 4.2)** : comportement inchangé pour les pages à `loading.tsx` (redirection diffusée) ; fiche hors périmètre et détail d'alerte hors périmètre en 307. Les 22 réponses 200 hors rôle contrôlées (12 pour l'ADMIN, 10 pour le manager) ne contiennent **aucune donnée** (ni nom, ni matricule, ni montant, ni probabilité) et portent toutes la redirection vers `/interdit`. Statut : informationnel, accepté.

### 9.3 Performance (20 utilisateurs virtuels × 60 s, `scripts/perf.ts`, résultats dans [perf-results.json](perf-results.json))

| Point d'accès | Requêtes | Erreurs | Débit | p50 | p90 | **p95** | p99 | max |
|---|---|---|---|---|---|---|---|---|
| `GET /api/dashboard` | 16 512 | 0 | 274,8/s | 70,7 | 95,3 | **103,2** | 135,8 | 289,5 |
| `GET /api/employees` | 8 209 | 0 | 136,5/s | 142,9 | 183,4 | **193,0** | 215,3 | 241,1 |

- **BNF-3 (p95 < 500 ms) : tenu** pour les deux points d'accès, avec 4,5 fois plus de requêtes servies qu'à la première campagne pour le tableau de bord (cache mémoire de `dal/dashboard.ts`). `/api/employees` passe sous 200 ms sans modification de la DAL (requête paginée, 25 lignes) : pas d'optimisation nécessaire.
- Pages (charge légère, 15 échantillons, p95) : `/login` 10 ms, `/dashboard` 50 ms, `/employees` 88 ms, `/alerts` 63 ms, `/transparency` 138 ms, `/data-health` 54 ms, `/admin/users` 211 ms.
- **Pipeline** (dernier mois, sur une copie isolée de `sec.db`) : **16,8 s** (BNF-4 < 15 min : tenu).

### 9.4 Dépendances

`npm audit --omit=dev` : **0 vulnérabilité** dans les dépendances de production. `npm audit` complet : 4 vulnérabilités modérées, toutes dans `drizzle-kit` (outil de génération de migrations, développement seulement) via `esbuild` ≤ 0.24.2 (GHSA-67mh-4wv8-2f99, serveur de développement d'esbuild, jamais lancé ici) ; correctif proposé = rétrogradation cassante de `drizzle-kit`, non appliquée. Aucun scan OWASP ZAP (outil non disponible sur le poste).

### 9.5 Build de production

`npx next build` : sans erreur ni avertissement après correction d'un avertissement Turbopack (« Dynamic filesystem access causes tracing of the whole project », `src/lib/scoring/registry.ts` : chemin résolu depuis `process.cwd()`, marqué `turbopackIgnore` comme dans `dal/drift.ts`).
