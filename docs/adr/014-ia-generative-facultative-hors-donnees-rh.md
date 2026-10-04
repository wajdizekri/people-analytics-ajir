# ADR-014 — IA générative facultative, désactivée par défaut, jamais sur des données RH

- **Statut** : acceptée (écart assumé au cahier des charges, décision d'Aymen du 04/10/2026)
- **Date** : 04/10/2026
- **Références** : cahier des charges v2 § 4 (« Could et hors périmètre » : assistant conversationnel LLM en Won't, traitement on-premise) ; [rapport ch. 4](../rapport/04-analyse-specification.md) ; [src/lib/ai/narrative/](../../src/lib/ai/narrative/) (synthèse rédigée) ; [src/lib/rag/](../../src/lib/rag/) (assistant d'aide) ; [docs/conformite/aipd.md](../conformite/aipd.md) ; [docs/qa/CHANTIER_RAG.md](../qa/CHANTIER_RAG.md)

## Contexte

Le cahier des charges exclut un assistant conversationnel fondé sur un grand modèle de langage (LLM) et impose un traitement sur site, sans dépendance à un service externe. Deux demandes du 04/10/2026 s'en approchent :

1. **Synthèse du mois rédigée** (/synthese) : quelques phrases qui résument les indicateurs déjà affichés.
2. **Assistant d'aide** (tableau de bord RH et manager, console ADMIN) : répondre à « comment est calculé le niveau de risque ? », « que faire face à une alerte de dérive ? » à partir de la documentation.

## Décision

- **Le cœur des deux fonctions n'utilise aucun LLM et fonctionne hors ligne** :
  - synthèse : phrases produites par des gabarits déterministes à partir des agrégats du rôle ;
  - assistant : **recherche documentaire** (index plein texte SQLite FTS5 en mémoire sur la documentation et l'aide, filtré par rôle) qui renvoie un extrait et ses sources. Ce n'est pas un assistant conversationnel : pas de mémoire de conversation, pas de génération.
- **La reformulation par IA générative est une option, désactivée par défaut** : elle n'est active que si une clé est définie (`SYNTHESIS_AI_API_KEY`, `ASSISTANT_AI_API_KEY`). Sans clé, aucun flux sortant.
- **Données transmises quand l'option est active** :
  - synthèse : uniquement une liste blanche typée d'agrégats non nominatifs déjà visibles par le rôle ;
  - assistant : uniquement la question et des **extraits de documentation** ; **jamais** de donnée RH ni de résultat de calcul ; question non transmise si elle contient un matricule ou une adresse e-mail.
- **Garde-fous de sortie** : réponse construite uniquement à partir des données ou passages fournis ; chaque nombre du texte généré doit figurer dans l'entrée, chaque citation doit exister, sinon repli automatique sur la version sans IA ; aucune lecture causale ; aucune décision proposée.
- **Traçabilité** : chaque appel est audité sans son contenu (périmètre ou longueur, nombre de passages, mode, modèle).

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| Ne rien faire (aide statique seule) | Demande explicite d'Aymen ; l'aide existante est riche mais longue à parcourir |
| Assistant conversationnel complet sur les données (RAG sur les fiches) | Contraire au cahier des charges et à la DAL par rôle (ADR-007) ; risque d'injection par les données ; AIPD lourde |
| LLM local sur le serveur du client | Poste et serveur cible sous-dimensionnés (8 Go) ; maintenance d'un modèle hors de portée du projet |
| Option activée par défaut | Contraire au traitement on-premise et à la minimisation |

## Conséquences

- En installation sans Internet (cible du cahier des charges), le comportement est strictement celui du périmètre initial : gabarits et recherche documentaire.
- Activer une clé crée un transfert vers un sous-traitant hors de Tunisie : avis du juriste, mise à jour de l'AIPD et du registre, vérification contractuelle de la conservation (voir aipd.md).
- Le rapport doit présenter ces fonctions comme une **extension facultative** hors du périmètre contractuel (ch. 4, écart ; ch. 10, perspectives), en citant cet ADR.
