# ADR-012 — Sessions opaques en base plutôt que JWT

- **Statut** : acceptée
- **Date** : 28/09/2026
- **Références** : cahier des charges v2 § 5 et § 7 ; [src/lib/auth/session.ts](../../src/lib/auth/session.ts), [src/lib/auth/login.ts](../../src/lib/auth/login.ts), [src/lib/auth/password.ts](../../src/lib/auth/password.ts) ; activation dans [src/lib/dal/admin.ts](../../src/lib/dal/admin.ts)

## Contexte

Le cahier exige des sessions révocables (désactivation d'un compte, départ d'un manager, synchronisation des comptes depuis AJIR), un verrouillage progressif et un fonctionnement hors ligne. Un JWT signé est valide jusqu'à son expiration : le révoquer impose une liste noire consultée à chaque requête, c'est-à-dire une session en base avec plus de complexité. Auth.js, en mode identifiants, impose précisément des JWT.

## Décision

- **Jeton opaque** : 32 octets aléatoires (`crypto.randomBytes`), encodés base64url, placés dans le cookie `pa_session` : `httpOnly`, `SameSite=Lax`, `Secure` en production (sauf `INSECURE_COOKIES=1` pour une démonstration en HTTP), `path=/`.
- **En base, seule l'empreinte SHA-256 du jeton** sert de clé (`session.id`), avec `user_id`, `created_at`, `expires_at`, IP et user-agent. Une fuite de la table ne permet pas de rejouer une session.
- **Expiration glissante** (révision du 30/09/2026) : la session tombe après 2 h sans requête (`SESSION_IDLE_MINUTES = 120`) ; chaque usage repousse `expires_at` (écriture seulement si l'échéance bouge de plus d'une minute), jamais au-delà du **plafond absolu de 10 h** après la connexion (échéance du cookie).
- **Purge** : les sessions expirées ou au-delà du plafond sont supprimées à chaque connexion, au plus tous les quarts d'heure lors d'une lecture de session (`purgeExpiredSessions`) et par `scripts/retention.ts`.
- **Validation à chaque requête** (`readSession`) : jointure avec `app_user`, refus (et suppression) si session inconnue, inactive depuis 2 h, au-delà du plafond ou compte inactif.
- **Révocation** : suppression des lignes `session` à la déconnexion, à la désactivation d'un compte, à l'activation d'un compte, lors de la synchronisation `users.csv` qui désactive un compte, et au changement de mot de passe depuis *Mon compte* (les **autres** sessions de l'utilisateur sont fermées, `revokeOtherSessions`, [src/lib/dal/account.ts](../../src/lib/dal/account.ts)) ; la restauration d'une sauvegarde vide la table.
- **Mots de passe** : argon2id (`@node-rs/argon2`, m = 19 456 Kio, t = 2, p = 1, paramètres OWASP), politique ≥ 10 caractères avec lettres et chiffres.
- **Verrouillage progressif** : tentative réservée dans une transaction `BEGIN IMMEDIATE` avant la vérification (pas de contournement par requêtes parallèles) ; à partir du 5e échec consécutif, verrou de 1, 2, 4… jusqu'à 64 minutes ; message identique pour identifiant inconnu et mot de passe faux (un identifiant inconnu est « verrouillé » de la même façon).
- **Limitation de débit** en mémoire, en complément ([src/lib/auth/rate-limit.ts](../../src/lib/auth/rate-limit.ts)) : échecs de connexion par IP (30 par 15 min), activation par IP (20) et par compte (10) ; la clé IP ne s'applique que si l'adresse est fiable (`TRUST_PROXY=1` derrière le reverse proxy), sinon seule la limitation par compte joue.
- **Accès à la base** : une règle ESLint interdit d'importer la connexion SQLite hors de `src/lib` (DAL, moteurs), `src/db`, du worker, des scripts et des tests : pages et Route Handlers ne peuvent lire une session ou une donnée qu'à travers la DAL.
- **Activation** : lien à usage unique (jeton de 32 octets, empreinte SHA-256 stockée, validité 7 jours), consommé atomiquement par `UPDATE … RETURNING`.

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| JWT (Auth.js en mode identifiants) | Non révocable sans liste noire ; charge utile lisible ; rotation de clé à gérer |
| Stocker le jeton en clair | Une lecture de la base permettrait d'usurper toutes les sessions |
| Better Auth ou Lucia | Acceptables ; la version maison fait environ 70 lignes, sans dépendance supplémentaire |
| SSO avec AJIR (jeton signé HMAC de lancement) | Livré en complément, pas en remplacement : `GET /api/ajir/launch` ouvre une session opaque ordinaire après vérification du jeton (HMAC-SHA256, 60 s, usage unique) |

## Conséquences

- Une lecture SQLite indexée par requête authentifiée (négligeable en local).
- Une écriture au plus par minute et par session active pour faire glisser l'échéance.
- Les écarts initiaux avec le plan (expiration fixe, sessions expirées jamais purgées, pas de lien profond depuis AJIR) sont résorbés depuis le 30/09/2026.
- CSRF : `SameSite=Lax` + contrôle d'origine natif des Server Actions + contrôle `Origin`/`Host` des Route Handlers mutants dans `withApi` ([src/lib/api.ts](../../src/lib/api.ts)) ; une requête sans en-tête `Origin` n'est pas refusée (le cookie `Lax` n'est de toute façon pas envoyé par un POST inter-sites).
