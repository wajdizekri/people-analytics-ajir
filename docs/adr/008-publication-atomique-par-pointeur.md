# ADR-008 — Publication atomique d'un calcul par pointeur

- **Statut** : acceptée
- **Date** : 28/09/2026
- **Références** : cahier des charges v2 § 5 « Concurrence » et § 8 « Robustesse » ; `scoreMonth` dans [src/lib/scoring/score.ts](../../src/lib/scoring/score.ts) ; `getPublishedRun` dans [src/lib/dal/employees.ts](../../src/lib/dal/employees.ts) ; `recoverStale` dans [src/lib/jobs/index.ts](../../src/lib/jobs/index.ts)

## Contexte

Un calcul mensuel écrit environ un millier de prédictions et six facteurs par salarié. L'écrire dans une seule transaction bloquerait longtemps l'unique écrivain SQLite ; l'écrire par morceaux exposerait l'interface à un calcul à moitié écrit, ou mélangerait deux mois. Un worker peut aussi être tué en plein calcul. Le cahier exige que l'interface ne voie jamais un calcul partiel et que le retour arrière soit simple.

## Décision

- Chaque calcul est un **run** (`scoring_run`) identifié par `(as_of, model_version_id)` ; toutes ses lignes (`prediction`, puis `prediction_factor`) portent son `run_id`.
- Écriture en trois temps :
  1. `INSERT scoring_run` en statut **STAGING** ;
  2. prédictions et facteurs écrits par **lots de 500 salariés**, chacun dans une transaction `BEGIN IMMEDIATE` courte ;
  3. **une dernière transaction** passe le run en **PUBLIE** et écrit `app_setting.current_run_id = run_id`.
- **Toutes les lectures** de l'interface passent par `getPublishedRun()` : run pointé par `current_run_id` **et** en statut `PUBLIE`. Un run en STAGING ou en ECHEC n'est jamais lu.
- **Recalcul d'un run déjà publié** (même mois, même modèle, `force`) : suppression et réécriture complète des lignes, remappage des recommandations vers les nouvelles prédictions et pointeur, dans **une seule transaction**.
- **Effets métier après publication** : recommandations et alertes TURNOVER (`applyPublicationEffects`) sont créées après la bascule, dans leur propre transaction, de façon **idempotente** (dédoublonnage par action/salarié/mois et par `dedup_key`). Elles ne sont pas créées pour un run non pointé (backtest, mois antérieur au calcul courant).
- **Reprise** : un run STAGING plus vieux que 10 minutes est marqué ECHEC par `recoverStale` ; un run ECHEC ou STAGING du même `(mois, modèle)` est supprimé avant tout nouveau calcul ; une erreur d'écriture marque le run ECHEC et crée une alerte SYSTEME, le pointeur restant sur le calcul précédent.
- **Garde-fous de publication** : refus si le dernier import est BLOQUE, si le mois dépasse `data_end_date`, ou (via l'API) si le mois est antérieur au calcul publié.

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| Une seule transaction pour tout le run | Verrou d'écriture long, interface et imports bloqués |
| Tables « courantes » vidées puis réécrites | Fenêtre où l'interface voit un état vide ou partiel ; pas de retour arrière |
| Double table (A/B) et renommage | `ALTER TABLE RENAME` sous charge et index à reconstruire ; historique perdu |
| Objets métier créés dans la transaction de bascule (plan détaillé) | Transaction de bascule plus longue ; l'idempotence donne la même garantie de cohérence au rejeu |

## Conséquences

- Critère « worker interrompu en plein calcul : l'interface reste sur le calcul précédent, puis le job reprend » couvert par construction et par les tests de la file ([src/lib/jobs/jobs.test.ts](../../src/lib/jobs/jobs.test.ts)).
- L'historique des runs publiés alimente la courbe des 12 derniers mois de la fiche et le backtesting.
- Le retour arrière remet un ancien identifiant dans `current_run_id` : `npx tsx scripts/run.ts rollback <runId>` (run PUBLIE dont la date de coupure n'est pas postérieure au calcul courant, déjà publié comme courant sauf `--force`, refusé pendant un calcul ; audité `scoring.rollback`), `scripts/run.ts list` pour choisir. Les recommandations et alertes créées par le run abandonné restent en place : l'état « Obsolète » des objets métier d'un run annulé, prévu au plan, n'est pas implémenté.
- L'index unique `run_asof_model` n'est pas partiel : il interdit deux runs du même mois pour le même modèle, d'où la suppression préalable des runs en échec.
