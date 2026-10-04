# ADR-013 — Worker Node séparé et file de jobs dans SQLite

- **Statut** : acceptée
- **Date** : 28/09/2026
- **Références** : cahier des charges v2 § 5 ; [src/worker/](../../src/worker/) ; [src/lib/jobs/](../../src/lib/jobs/) ; table `app_job` dans [src/db/schema.ts](../../src/db/schema.ts)

## Contexte

L'import d'un export (1,5 million de pointages) et le calcul mensuel durent de quelques secondes à quelques minutes. Les exécuter dans une requête HTTP bloquerait le serveur web et les exposerait aux délais d'expiration du proxy ; SQLite n'accepte qu'un écrivain à la fois. Le sujet initial demandait d'éviter les microservices si Next.js suffit.

## Décision

- **Un second processus Node**, même dépôt et même code TypeScript, sans API réseau : `npm run worker` ([src/worker/index.ts](../../src/worker/index.ts)). Il applique les migrations au démarrage, puis boucle.
- **File de jobs dans SQLite** (`app_job`) : types `IMPORT`, `AGGREGATE`, `FEATURES`, `SCORING`, `ANOMALIES`, `BATCH_MENSUEL` ; **un seul job actif par (type, cible)** (index unique partiel `job_one_active`) ; prise FIFO dans une transaction `BEGIN IMMEDIATE`.
- **Planification** : croner, `0 2 10 * *` fuseau Africa/Tunis (le 10 du mois après la paie) ; le cron ne met en file le `BATCH_MENSUEL` que pour le dernier mois complet non encore publié.
- **Vivacité** : heartbeat toutes les 15 s dans `app_setting.worker_heartbeat` et `app_job.heartbeat_at` ; sondage de la file toutes les 5 s ; `recoverStale` au démarrage puis toutes les 60 s (job sans heartbeat depuis 10 min remis en file une fois, puis ECHEC ; run STAGING orphelin en ECHEC).
- **Arrêt propre** : premier signal (`SIGINT`, `SIGTERM`, `SIGBREAK`) = fin du job en cours puis fermeture de la base ; second signal = sortie immédiate, le job sera repris.
- **Next.js ne calcule rien** : il met des jobs en file (téléversement, recalcul, scoring) et lit les résultats ; il calcule l'état du heartbeat à la lecture (`/api/health`, *Santé des données*) et crée l'alerte SYSTEME « worker arrêté ».

## Alternatives considérées

| Alternative | Raison du rejet |
|---|---|
| Calcul dans un Route Handler | Requêtes longues, verrou d'écriture tenu pendant la navigation des utilisateurs |
| Redis + BullMQ | Service supplémentaire à installer et superviser |
| Tâche planifiée du système d'exploitation seule | Pas de file pour les demandes de l'interface, pas de reprise |
| Worker threads dans le processus Next.js | Cycle de vie lié au serveur web, redémarrages lors des déploiements |

## Conséquences

- Deux services Node à installer et superviser (`PeopleAnalyticsWeb`, `PeopleAnalyticsWorker`, en plus du proxy `PeopleAnalyticsProxy`, [deploy/windows/](../../deploy/windows/)) ; `/api/health` renvoie « dégradé » si le worker n'est pas actif.
- Le worker est le **seul écrivain de masse en production** ; les commandes CLI (`import`, `pipeline`, `model.ts`) contournent la file et ne doivent pas tourner en même temps qu'un job (règle d'exploitation, non verrouillée).
- Le job `IMPORT` n'enchaîne pas le calendrier ni les agrégats (faits par la CLI d'import ou par le batch mensuel) : après un import par l'interface, les indicateurs du tableau de bord ne sont à jour qu'après un recalcul.
- Si le worker est tué pendant un import, la ligne `import_batch` reste `EN_COURS` (seuls `app_job` et `scoring_run` sont repris).
