# Fiches de décision d'architecture (ADR)

Format commun : statut, date, références ; **Contexte** ; **Décision** ; **Alternatives considérées** ; **Conséquences** (y compris les écarts constatés entre la décision et le code au 29/09/2026).

| N° | Décision | Statut |
|---|---|---|
| [001](001-stack-react-nextjs-sqlite.md) | Stack React + Next.js 16 + SQLite, ajouts TypeScript, Drizzle, zod, ECharts, croner, pino | acceptée (contrainte client) |
| [002](002-python-hors-ligne-modele-json-execute-en-typescript.md) | Python hors ligne ; modèle exporté en JSON, exécuté en TypeScript, contrôlé par un jeu golden | acceptée |
| [003](003-regression-logistique-en-production-lightgbm-comparateur.md) | Régression logistique calibrée en production, B0 en repli, LightGBM comparateur hors ligne | acceptée |
| [004](004-cible-demission-6-mois-risques-concurrents.md) | Cible : démission ou abandon à 6 mois ; autres sorties en risques concurrents ; population scorée | acceptée |
| [005](005-visibilite-as-of-par-date-de-saisie.md) | Visibilité as-of par date de saisie, délais de repli, test anti-fuite | acceptée |
| [006](006-niveaux-de-risque-par-capacite-rh.md) | Niveaux de risque par capacité RH (plafond, ex-æquo jamais départagés) | acceptée |
| [007](007-couche-acces-donnees-au-lieu-rls.md) | Couche d'accès aux données (DAL), DTO par rôle, séparation des tâches ADMIN/RH | acceptée |
| [008](008-publication-atomique-par-pointeur.md) | Publication atomique d'un run par pointeur `current_run_id` | acceptée |
| [009](009-exclusion-des-donnees-de-sante.md) | Exclusion des données de santé des variables et des scores | acceptée |
| [010](010-simulateur-verite-terrain-non-circulaire.md) | Simulateur RH à vérité terrain non circulaire | acceptée |
| [011](011-gardes-petites-populations-cote-manager.md) | Gardes de petites populations côté manager (seuil 5, masquage secondaire) | acceptée |
| [012](012-sessions-opaques-plutot-que-jwt.md) | Sessions opaques révocables plutôt que JWT | acceptée |
| [013](013-worker-separe-et-file-de-jobs-sqlite.md) | Worker Node séparé et file de jobs dans SQLite | acceptée |
| [014](014-ia-generative-facultative-hors-donnees-rh.md) | IA générative facultative (synthèse, assistant d'aide), désactivée par défaut, jamais sur des données individuelles (synthèse : agrégats non nominatifs ; assistant : documentation seule) | acceptée (écart assumé au cahier des charges) |

Vue d'ensemble et diagrammes : [docs/architecture/](../architecture/ARCHITECTURE.md). Dictionnaire des données, KPI et variables : [docs/DICTIONNAIRE.md](../DICTIONNAIRE.md).
