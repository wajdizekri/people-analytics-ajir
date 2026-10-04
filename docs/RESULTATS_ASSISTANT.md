# Assistant d'aide — résultats (chantier « assistant d'aide », 04/10/2026)

Champ « Poser une question… » sous l'en-tête du tableau de bord (RH, manager) et de la console (ADMIN). Il répond **à partir de la documentation et de l'aide seulement**, filtrées par le rôle de la session : jamais à partir des données des collaborateurs ni d'un chiffre de la base. Deux modes :

1. **Extrait (défaut, seul mode sans Internet)** : extrait du passage le plus pertinent, avec ses sources. Aucun flux sortant.
2. **Reformulation par IA générative (facultative)** : API Claude appelée côté serveur par `fetch`, sans dépendance npm, active seulement si `ASSISTANT_AI_API_KEY` est définie. Texte vérifié avant affichage, repli automatique sur l'extrait.

## Architecture

Corpus → index FTS5 en mémoire → réponse extraite ou reformulée.

| Étape | Fichier | Rôle |
|---|---|---|
| Contrat commun | `src/lib/rag/types.ts` | `RagChunk` (titre, texte, rôles autorisés, lien interne, source), `AssistantAnswer` (`mode` EXTRAIT, IA ou AUCUN ; réponse ; sources ; mention), bornes de la question (3 à 300 caractères), 4 passages au plus |
| Corpus | `scripts/rag-index.ts`, `src/lib/rag/sources.ts` → `src/lib/rag/corpus.json` | `npm run rag:index` découpe les sources (contenus du centre d'aide `src/lib/help/content.ts`, glossaire `terms.ts`, documents choisis) en passages, avec les rôles de chaque entrée et une empreinte des sources (`sourcesHash`) |
| Recherche | `src/lib/rag/index.ts`, `synonyms.ts` | Index SQLite FTS5 **en mémoire** (better-sqlite3), construit au premier appel et reconstruit quand `corpus.json` change. Question réduite à des mots (aucune syntaxe FTS5 transmise), mots vides retirés, synonymes métier ajoutés (« turnover » ↔ « départs »…), classement bm25 avec le titre pondéré ×5 |
| Réponse | `src/lib/rag/answer.ts` | `extractiveAnswer` (3 phrases ou 350 caractères au plus du meilleur passage) ; `answerQuestion` (reformulation vérifiée si la clé est définie, sinon extrait) |
| Service | `src/lib/dal/assistant.ts`, `src/app/api/assistant/route.ts` | `POST /api/assistant` `{ question }` : session exigée (ADMIN, RH, MANAGER), corps borné à 2 ko, question validée, quota par compte, audit `assistant.ask` |
| Interface | `src/components/help/help-assistant.tsx` | `HelpAssistant` (une ligne repliée, panneau de réponse après envoi) ; questions d'exemple `ASSISTANT_EXAMPLES` dans `src/lib/help/content.ts` |

## Filtrage par rôle

- Chaque passage porte ses rôles autorisés, repris des `roles` des entrées d'aide (absents = tous les rôles) ; jamais vide.
- Le rôle vient **de la session**, jamais du corps de la requête.
- Le filtre est appliqué **dans la requête FTS5, avant le classement** : un passage d'un autre rôle n'est jamais lu. Le service refiltre les passages trouvés avant la réponse.
- Conséquence : l'ADMIN ne lit aucun passage de méthodologie ni de pilotage RH ; le manager ne lit pas les passages réservés à la RH (salaires, pourcentage de risque, signaux individuels d'absentéisme).

## Garde-fous

- **Documentation seule** : le corpus ne contient aucune donnée de salarié ni chiffre issu de la base. Les seuls nombres sont ceux des exemples de l'aide.
- **Désactivé par défaut** : sans `ASSISTANT_AI_API_KEY`, aucun appel externe. La variable générique `ANTHROPIC_API_KEY` n'active rien.
- **Ce qui est transmis à l'API** (option active) : la question et les passages trouvés (4 au plus), rien d'autre. Une question qui contient un matricule (`M` suivi de 4 chiffres ou plus) ou une adresse e-mail **n'est pas transmise** : l'extrait s'affiche avec la mention « Question non transmise : elle contient un identifiant personnel ».
- **Vérification du texte généré** : au moins une citation, et seulement de passages fournis (« [1] ») ; 4 phrases de 20 mots au plus, la dernière complète ; aucun nombre absent des passages ; mise en forme retirée. Sinon, repli sur l'extrait avec la mention « Reformulation par IA indisponible ». Délai de 10 s. Le prompt système traite la question comme une donnée, jamais comme une consigne. Réponses réussies gardées en mémoire du service web (200 au plus, clé = empreinte de la question normalisée, des passages et du modèle) ; un échec n'est pas gardé.
- **Réponse honnête** : sans passage pertinent, réponse « L'aide ne couvre pas cette question » (mode AUCUN) et lien « Ouvrir l'aide », plutôt qu'une invention.
- **Quota** : 30 questions par compte sur 15 minutes ; au-delà, refus 429 avec le délai d'attente.
- **Audit** : `assistant.ask` avec la longueur de la question, le nombre de passages, le mode et la raison d'un refus ; **jamais le texte de la question**.
- **Interface** : liens de sources internes seulement (`/…`), réponse affichée en texte brut (aucun HTML interprété).

## Interface

- Repliée par défaut : un champ (« Poser une question… », 300 caractères au plus) et un bouton « Demander », sans paragraphe d'explication. Formulaire `role="search"`, libellé accessible « Poser une question à l'assistant d'aide ».
- Champ vide et actif : 3 questions d'exemple propres au rôle, en puces cliquables qui posent la question.
- Après envoi : bouton « Recherche… » désactivé, puis panneau annoncé (`aria-live="polite"`) avec la réponse, les sources (numérotées comme les citations d'une réponse reformulée), la mention éventuelle et un bouton « Fermer ». Échap ou « Fermer » replie le panneau et rend le focus au champ.
- Erreurs en clair : connexion perdue, session expirée, quota atteint, question invalide (message du serveur repris), service indisponible.
- Jetons sémantiques du design system (clair et sombre), cibles de 40 px au moins, aucun débordement à 390 px.

## Conformité

Section 8 de l'[AIPD](conformite/aipd.md) : question en texte libre pouvant contenir une donnée personnelle, filtre matricule et e-mail, envoi seulement si la clé est définie, audit sans contenu. Question fréquente « Comment fonctionne l'assistant d'aide ? » dans l'aide de chaque rôle.

## Tests

`tests/rag/` : `corpus.test.ts` (corpus généré), `search.test.ts` (requête sûre, synonymes, accents, filtrage par rôle avant la limite, questions piégées, moins de 50 ms pour ~2 000 passages), `answer.test.ts` (extrait, filtre matricule et e-mail, vérification, repli et cache de l'IA, sans appel réseau réel), `dal.test.ts` et `api.test.ts` (service et route), `ui.test.ts` (rendu replié, panneau, états, messages d'erreur, validation de la réponse du serveur, questions d'exemple, question fréquente).

## Limites

- **Recherche lexicale** (mots et synonymes), pas sémantique : une question formulée loin du vocabulaire de l'aide peut rester sans réponse. Enrichir `synonyms.ts` au fil des retours.
- **Mode extrait** : il renvoie le passage le plus pertinent, pas une réponse rédigée pour la question ; les sources permettent d'aller plus loin.
- **Corpus statique** : une modification de l'aide ou de la documentation n'est prise en compte qu'après `npm run rag:index`.
- **Une question à la fois**, sans mémoire de conversation ; français seulement.
- **Index et cache par processus** : reconstruits au premier appel après un redémarrage du service web. Corpus absent ou illisible : l'assistant répond « L'aide ne couvre pas cette question » et un avertissement est journalisé.
- **Option IA** : dépend d'un service externe et d'un flux sortant ; l'extrait reste toujours disponible.
