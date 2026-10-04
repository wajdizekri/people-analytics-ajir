# Synthèse mensuelle rédigée — résultats (chantier « 5 IA », 04/10/2026)

Encadré « Synthèse du mois en quelques phrases » en tête de la page /synthese (RH et MANAGER ; l'ADMIN n'y a pas accès). Deux modes :

1. **Phrases types (défaut, seul mode sans Internet)** : 6 phrases déterministes, au plus 20 mots chacune, construites à partir des agrégats déjà affichés pour le rôle.
2. **Reformulation par IA générative (facultative)** : API Claude appelée côté serveur par `fetch`, sans dépendance npm, active seulement si `SYNTHESIS_AI_API_KEY` est définie. Texte vérifié avant affichage, repli automatique sur les phrases types.

## Architecture

| Élément | Fichier | Rôle |
|---|---|---|
| Format et contrôles | `src/lib/ai/narrative/format.ts` | Nombres au format français, comptage des mots, extraction et normalisation des nombres d'un texte |
| Phrases types | `src/lib/ai/narrative/template.ts` | `factsFromSynthesis` (copie champ par champ des KPI du DTO, jamais des listes nominatives ni des constats), `draftSentences` (effectif, mouvements, risque élevé, absentéisme, points ouverts, mise en garde) |
| Charge utile et vérification | `src/lib/ai/narrative/payload.ts` | Liste blanche typée `PAYLOAD_SCHEMA` (28 champs, motif strict par champ), `assertWhitelisted`, `allowedNumbers`, `verifyGenerated` |
| Appel de l'API | `src/lib/ai/narrative/generative.ts` (`server-only`) | `narrativeAiConfig` (variables d'environnement), `buildRequestBody`, `narrativeFor` (cache, délai, repli, rappel d'audit) |
| DAL | `src/lib/dal/synthesis.ts` (ajout en fin) | `getSynthesisNarrative(ctx, dto, meta)` : `ensurePilotage`, DTO du même rôle exigé (403 sinon), audit de chaque appel réel |
| Page | `src/app/(app)/synthese/page.tsx`, `narrative.tsx`, `loading.tsx` | `NarrativeBox` (encadré), `AiNarrative` dans un `<Suspense>` dont le repli est la version par phrases types : la page n'attend jamais l'API |
| Audit | `src/components/admin/audit-labels.ts` (ajouts en fin) | Action `synthesis.narrative.generate`, catégorie « Synthèses rédigées par IA générative », raisons d'échec en clair |

Requête envoyée (`POST https://api.anthropic.com/v1/messages`, en-têtes `x-api-key`, `anthropic-version: 2023-06-01`) : modèle `claude-opus-5-5` par défaut (`SYNTHESIS_AI_MODEL` pour le remplacer si l'éditeur le retire), `max_tokens` 1 024, sans réflexion ni paramètre d'échantillonnage. Prompt système figé en tête, marqué `cache_control` ; il reste sous le minimum de jetons mis en cache par le modèle, donc le vrai cache est applicatif. Le message utilisateur contient la charge utile JSON et le brouillon issu des phrases types.

## Garde-fous

- **Désactivé par défaut** : sans `SYNTHESIS_AI_API_KEY`, aucun `fetch` (testé). La variable générique `ANTHROPIC_API_KEY` n'active rien, pour qu'un poste de développement ne transmette rien par accident.
- **Liste blanche** : chaque valeur est contrôlée par un motif (périmètre parmi deux libellés génériques, mois, date, entiers, taux « 4,2 % », points, heures) ; aucun texte libre ne peut passer. Un champ hors liste, manquant ou mal formé lève une erreur, donc un repli. Les valeurs masquées côté manager partent comme `null`.
- **Vérification du texte généré** : tout nombre doit figurer dans la charge utile (valeurs absolues, chaînes comprises) ; refus aussi pour un nombre en lettres, un format anglais, une mise en forme (liste, titre, lien), plus de 6 phrases, une phrase de plus de 20 mots, un texte tronqué ou une formulation causale (« à cause », « explique », « évités »…). « Non causale » et « facteurs associés » restent permis.
- **Repli** : erreur HTTP, réseau, réponse illisible, arrêt autre que `end_turn`, délai de 10 s dépassé ou texte refusé : les phrases types s'affichent avec la mention « la reformulation par IA générative n'a pas abouti ».
- **Cache** : clé = périmètre (`RH` ou `MANAGER:<id>`) + mois + empreinte SHA-256 de la requête (donc des agrégats, du brouillon et du modèle). Réussite gardée en mémoire du processus web (200 entrées au plus) ; échec retenté au plus tôt 15 minutes plus tard ; affichages simultanés : un seul appel.
- **Audit** : une ligne par appel réel (pas sur un résultat en cache) : compte, date, périmètre `ENTREPRISE` ou `EQUIPE`, taille de la requête en octets, modèle, durée, raison. Ni la charge ni le texte.
- **Mention visible** : « Texte rédigé automatiquement à partir des indicateurs ci-dessous », suivie de la méthode (« Rédaction par phrases types, sans IA générative » ou « Reformulé par IA générative (modèle …) à partir des seuls agrégats ; chaque chiffre a été vérifié »).
- **CSP** : l'appel part du serveur ; `connect-src 'self'` du navigateur n'est pas concerné et reste inchangé.

## Conformité

- [AIPD § 7](conformite/aipd.md) : finalité, données transmises et jamais transmises, sous-traitant hors de Tunisie, désactivation par défaut, conservation, risques R11 à R14, points ouverts (qualification des agrégats, transfert, clause de sous-traitance, information). § 2.3 précise que le transfert n'existe qu'avec l'option.
- [Registre](conformite/registre-traitements.md) : ligne « Option : synthèse rédigée par IA générative ».
- [EXPLOITATION.md § 10](EXPLOITATION.md) et `deploy/env.example` : activation, flux réseau, contrôle, audit, désactivation.
- Aucune donnée nominative, aucune décision automatique, aucune lecture causale ; manager limité aux agrégats déjà autorisés par les gardes (ADR-011).

## Tests

`tests/ia-synthese/` (51 tests, API toujours simulée) :

- `templates.test.ts` : 12 jeux d'agrégats (RH complet, manager en petite population, sans calcul, premier calcul, élisions « d'avril » et « d'août », changement d'année, effectif nul, singuliers, absentéisme stable, en baisse ou indisponible, grands nombres). Pour chacun : 4 à 6 phrases, 20 mots au plus, périmètre et période, format français, nombres inclus dans la charge utile, et le brouillon passe lui-même `verifyGenerated`. Textes exacts pour les cas principaux.
- `payload.test.ts` : champs exacts de la liste blanche, aucune clé d'identification, DTO contenant noms, matricules, identifiants et service sans fuite dans la charge ni dans la requête, refus d'un matricule, d'un nom, d'un identifiant ou d'une valeur mal formée, structure de la requête.
- `verify.test.ts` : extraction des nombres, texte fidèle accepté, nombre inventé, calculé ou arrondi refusé, nombre en lettres, format anglais, vocabulaire causal, contrôles de forme.
- `generative.test.ts` : activation par variable d'environnement, aucun appel sans clé, réussite (en-têtes, signal de délai, audit sans contenu), cache, appels simultanés, repli sur chiffre non fourni, HTTP 401 et 529, `max_tokens`, réponse illisible, réseau coupé, délai dépassé, reprise après 15 minutes.
- `dal-page.test.ts` (base de test des insights) : ADMIN refusé (403 audité), DTO d'un autre rôle refusé, textes RH exacts, manager et petite population masquée, audit RH et manager, rendu statique de l'encadré (phrases types, IA, repli, attente), page RH et manager.

Résultats du 04/10/2026 :

- `npx vitest run tests/ia-synthese tests/insights --maxWorkers=1` : 9 fichiers, **88 tests réussis** (51 du chantier, 37 des insights existants) ; contrôle complémentaire `tests/ergo-pilot tests/ui-admin` : 15 fichiers, 106 tests réussis.
- `npx eslint` sur les fichiers modifiés : 0 erreur, 0 avertissement.
- `npx tsc --noEmit` : aucune erreur dans les fichiers du chantier ; 2 erreurs `LayoutProps` dans `src/app/layout.tsx` et `src/app/(app)/layout.tsx`, dues aux types générés par Next (`.next/types`) absents du worktree, sans lien avec ce chantier.
- Aucun appel réel à l'API.

## Limites

- « un », « une » et « aucun » ne sont pas contrôlés : un texte qui écrirait « aucune alerte » alors qu'il y en a 2 passerait le contrôle des nombres. Risque réduit par la consigne et par le brouillon fourni, pas supprimé.
- Un nombre de la charge utile peut être repris à un autre endroit (par exemple « 2 » attribué au mauvais indicateur) : la vérification porte sur l'appartenance, pas sur le sens.
- Cache en mémoire : perdu au redémarrage du service web, non partagé entre plusieurs processus.
- L'absence d'entraînement sur les données et la durée de conservation chez l'éditeur dépendent du contrat du client (non vérifiées ici).
- Le proxy d'entreprise éventuel (`NODE_USE_ENV_PROXY=1` et `HTTPS_PROXY`) n'a pas été essayé.
- Les heures supplémentaires ne figurent pas dans les phrases types (plafond de 6 phrases) ; elles restent dans la charge utile et sur la page.
- `scripts/check-install.ts` ne signale pas encore l'état de l'option (hors périmètre).
