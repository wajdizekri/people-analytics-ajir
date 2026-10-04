# Rapport de projet de fin d'études

**People Analytics & Predictive Turnover** — module d'aide à la décision RH, prédictif et explicable, intégré au progiciel AJIR d'ArabSoft.

Un fichier Markdown par chapitre. Citations au format auteur-année, bibliographie au format APA 7 ([bibliographie.md](bibliographie.md)). Les encadrés « À COMPLÉTER » signalent une information absente du dépôt (données de stage, résultats pas encore produits, captures) : ils doivent être résolus avant la mise en page finale.

## Table des matières

| # | Chapitre | Fichier |
|---|---|---|
| — | Résumé, abstract, mots-clés | [00-resume.md](00-resume.md) |
| 1 | Introduction générale | [01-introduction.md](01-introduction.md) |
| 2 | Contexte du projet et méthodologie | [02-contexte-methodologie.md](02-contexte-methodologie.md) |
| 3 | État de l'art | [03-etat-de-l-art.md](03-etat-de-l-art.md) |
| 4 | Analyse et spécification des besoins | [04-analyse-specification.md](04-analyse-specification.md) |
| 5 | Conception | [05-conception.md](05-conception.md) |
| 6 | Données : contrat AJIR, qualité, calendrier et simulateur | [06-donnees-simulateur.md](06-donnees-simulateur.md) |
| 7 | Prédiction et explication du risque de démission | [07-prediction-explication.md](07-prediction-explication.md) |
| 8 | Réalisation et validation | [08-realisation-validation.md](08-realisation-validation.md) |
| 9 | Éthique et conformité | [09-ethique-conformite.md](09-ethique-conformite.md) |
| 10 | Conclusion générale et perspectives | [10-conclusion-perspectives.md](10-conclusion-perspectives.md) |
| — | Bibliographie | [bibliographie.md](bibliographie.md) |

**Annexes proposées** (documents existants du dépôt, à joindre tels quels ou résumés) : fiches de décision [docs/adr/](../adr/) ; diagrammes UML [docs/architecture/](../architecture/) ; dictionnaire des données, des KPI et des variables [docs/DICTIONNAIRE.md](../DICTIONNAIRE.md) ; contrat d'export et conventions [docs/CONVENTIONS.md](../CONVENTIONS.md) ; fiche descriptive du simulateur [ml/sim/README.md](../../ml/sim/README.md) ; contrat des variables [shared/features.json](../../shared/features.json) ; guide d'installation [docs/INSTALLATION.md](../INSTALLATION.md) ; manuel d'exploitation [docs/EXPLOITATION.md](../EXPLOITATION.md) ; parcours de démonstration [docs/DEMO.md](../DEMO.md).

## Liste des figures à produire

### Diagrammes (à exporter depuis les sources Mermaid ou à dessiner)

| Figure | Contenu | Source |
|---|---|---|
| 2.1 | Vue d'ensemble de la solution | Cahier des charges v2, section 5 (« Vue d'ensemble ») ; [README.md](../../README.md), section « Architecture » |
| 2.2 | Gantt prévisionnel (et réel, à compléter) | Tableau 2.3 |
| 4.1 | Diagramme de cas d'utilisation | [architecture/CAS_UTILISATION.md](../architecture/CAS_UTILISATION.md), section « Diagramme » |
| 5.1 | Architecture logique production / hors ligne | Cahier des charges v2, section 5 ; [README.md](../../README.md) |
| 5.2 | Diagramme de déploiement on-premise | [architecture/DEPLOIEMENT.md](../architecture/DEPLOIEMENT.md), section « Diagramme de déploiement » |
| 5.3 | Diagramme entité-association | [architecture/MODELE_DONNEES.md](../architecture/MODELE_DONNEES.md), section 1 (détail : sections 2 à 4) |
| 5.3 bis (annexe) | Diagramme de classes de la couche applicative | [architecture/MODELE_DONNEES.md](../architecture/MODELE_DONNEES.md), section 5 |
| 5.4 | Séquence : calcul mensuel | [architecture/SEQUENCES.md](../architecture/SEQUENCES.md), section 3 |
| 5.5 | Séquence : connexion et contrôle d'accès | [architecture/SEQUENCES.md](../architecture/SEQUENCES.md), section 1 |
| 5.6 | Séquence : import AJIR avec contrôle qualité | [architecture/SEQUENCES.md](../architecture/SEQUENCES.md), section 2 |
| 5.7 | Séquence : fiche consultée par un manager, refus hors périmètre | [architecture/SEQUENCES.md](../architecture/SEQUENCES.md), section 4 |
| 5.8 | Séquence : what-if | [architecture/SEQUENCES.md](../architecture/SEQUENCES.md), section 5 |
| 5.9 | Diagrammes d'états (alerte, recommandation, run, job, lot d'import) | [architecture/ETATS.md](../architecture/ETATS.md) |
| 6.2 | Mécanisme de départ du simulateur | [ml/sim/README.md](../../ml/sim/README.md), section « Mécanisme de départ » |
| 7.1 | Protocole à origines glissantes | `make_split` dans [ml/train/protocol.py](../../ml/train/protocol.py) |
| 7.2 | Courbe de calibration par déciles (recette de production) | Bloc `calibration.bins` de `models/turnover/logreg-v1-20260930/model.json` ou [RESULTATS_ML.md](../RESULTATS_ML.md), § 4 ; ou capture de `/transparency` |
| 7.x (option) | Inflation de l'AUC selon le découpage (Q1a) ; courbe d'apprentissage (Q1d) | `ml/train/results/mixte_medium_s1.json` ; tableaux 7.5 et 7.7 |
| 8.x (option) | Figures d'évaluation des anomalies : compromis précision / faux positifs selon z et k, ablation du calendrier | Données de `ml/eval/results/anomalies.json` ; le rapport [RESULTATS_ANOMALIES_QUALITE.md](../RESULTATS_ANOMALIES_QUALITE.md) ne contient que des tableaux (matplotlib absent) |
| 8.y (option) | Série hebdomadaire d'une équipe avec taux attendu et anomalie détectée | Capture de `/absenteeism` ou `weeklySeries` dans [src/lib/anomalies/index.ts](../../src/lib/anomalies/index.ts) |

### Captures d'écran (base de démonstration, voir [docs/DEMO.md](../DEMO.md))

Prendre les captures sur `http://localhost:3000` après `npm run build && npm run start`, avec la base `data/app.db` (import `mixte_medium_s1`, calcul publié), en résolution d'au moins 1 440 px de large. Comptes : `admin`, `rh.demo`, `mgr.M10451`. Pour les figures 7.3, 7.4 et 8.5, utiliser la même fiche (par exemple `/employees/79`) afin de pouvoir comparer les vues.

| Figure | Écran | Compte | URL |
|---|---|---|---|
| 6.1 | Santé des données : lot, score qualité, rejets par règle | `admin` ou `rh.demo` | `/data-health` |
| 7.3 | Zone « Estimation » : vue RH et vue manager côte à côte | `rh.demo` puis `mgr.M10451` | `/employees/<id d'un collaborateur du manager>` |
| 7.4 | Panneau what-if (leviers, avant/après, coût, mention non causale) | `rh.demo` | `/employees/<id>` |
| 8.1 | Connexion (avec message d'erreur) | — | `/login` |
| 8.2 | Liste et détail d'une alerte | `rh.demo` | `/alerts`, `/alerts/<id>` |
| 8.3 | Tableau de bord RH (indicateurs, séries, risque par département) | `rh.demo` | `/dashboard` |
| 8.4 | Liste des collaborateurs filtrée sur « Élevé » | `rh.demo` | `/employees?niveau=ELEVE` |
| 8.5 | Fiche RH complète (trois zones) | `rh.demo` | `/employees/<id>` |
| 8.6 | Absentéisme : séries, anomalies collectives, signaux Bradford | `rh.demo` | `/absenteeism` |
| 8.7 | Backtesting | `rh.demo` | `/backtesting` |
| 8.8 | Fiche vue manager (même salarié que 8.5) | `mgr.M10451` | `/employees/<id>` |
| 8.8 bis | Tableau de bord manager avec indicateurs masqués (petit groupe) | `mgr.M10451` | `/dashboard` |
| 8.8 ter | Refus hors périmètre : page « Accès interdit » | `mgr.M10451` | `/employees/79` |
| 8.9 | Console d'administration | `admin` | `/admin` |
| 8.10 | Journal d'audit filtré sur les refus (`employee.view`, REFUSÉ) | `admin` | `/admin/audit` |
| 8.11 | Transparence du modèle | `admin` ou `rh.demo` | `/transparency` |
| 8.12 (option) | Paramètres | `admin` | `/admin/settings` |
| 8.13 (option) | Utilisateurs et lien d'activation | `admin` | `/admin/users` |

## Liste des tableaux

Chapitre 2 : 2.1 points ouverts du sujet initial, 2.2 phases CRISP-DM, 2.3 planning prévisionnel. Chapitre 3 : 3.1 synthèse comparative et positionnement. Chapitre 4 : 4.1 acteurs, 4.2 cas d'utilisation et droits, 4.3 besoins fonctionnels, 4.4 besoins non fonctionnels, 4.5 MoSCoW. Chapitre 5 : 5.1 couches, 5.2 décisions d'architecture, 5.3 familles de tables, 5.4 menaces et parades. Chapitre 6 : 6.1 fichiers de l'export, 6.2 règles de contrôle, 6.3 défauts injectés et règles déclenchées, 6.4 délais de repli, 6.5 calage du simulateur. Chapitre 7 : 7.1 variables, critères de succès (non numéroté), 7.2 performance comparée, 7.3 différences appariées, 7.4 utilité selon la part ciblée, 7.5 inflation selon le découpage (Q1a), 7.6 effet des variables naïves (Q1b), 7.7 courbe d'apprentissage (Q1d), 7.8 verdict sur les critères, 7.9 rapport d'équité. Chapitre 8 : 8.1 état de réalisation, 8.2 niveaux de test, 8.3 matrice d'autorisation, 8.4 latences sous charge, 8.5 rappel par type d'anomalie. Chapitre 9 : 9.1 correspondance exigences–mesures. Chapitre 10 : 10.1 critères d'acceptation et état.
