# Chapitre 2 — Contexte du projet et méthodologie

Ce chapitre présente l'organisme d'accueil et le progiciel AJIR, analyse les limites de l'existant, puis décrit la solution proposée, la méthodologie de travail et le planning prévisionnel.

## 2.1 Organisme d'accueil : ArabSoft

ArabSoft est un éditeur tunisien de logiciels de gestion, créé en 1985 et installé à Tunis (Montplaisir). L'entreprise se présente comme spécialisée dans l'étude, le développement et la distribution de logiciels, notamment pour le secteur public, et s'est distinguée par des solutions bilingues français-arabe (ArabSoft, s.d.-a). Son catalogue compte sept progiciels : XLIA (gestion hôtelière), HAYET (réseaux et fournisseurs d'énergie), AJIR (ressources humaines), ARZAK (achats, stocks et immobilisations), MERKAZIA (centrale d'information et de risques), JIBAYA (fiscalité) et AMIN (gestion financière et comptable).

> **À COMPLÉTER (stagiaire)** : effectif d'ArabSoft, organigramme et service d'accueil du stage, noms et fonctions des encadrants entreprise et académique, dates exactes du stage. Ces informations ne figurent ni dans le cahier des charges ni sur le site de l'éditeur.

## 2.2 Le progiciel AJIR

AJIR est le progiciel de gestion des ressources humaines d'ArabSoft. D'après l'éditeur, il couvre le traitement des salaires, les congés, le pointage, la gestion sociale, les prêts, la réglementation et les procédures, la gestion administrative, le recrutement, les emplois et compétences, la formation, un budget prévisionnel de la masse salariale, ainsi qu'un module « reporting et tableaux de bord » (tableaux, graphes et états) (ArabSoft, s.d.-b).

Le cahier des charges précise le contexte d'usage retenu pour ce projet. Les clients visés sont majoritairement des PME et des ETI tunisiennes de 150 à 800 salariés. AJIR y est installé *on-premise*, sur un serveur du client, et reste la **source de vérité** : le module ne crée ni ne modifie aucun salarié ni aucune donnée de paie. Il lit un export de fichiers CSV produit par AJIR.

Plusieurs caractéristiques d'AJIR conditionnent la faisabilité du volet prédictif et devaient être vérifiées au cadrage : présence d'un motif de sortie codé, d'une date de démission, conservation de l'historique (paie, poste, manager) ou écrasement, stockage des dates de saisie, modules effectivement déployés chez les clients, possibilité d'exporter les utilisateurs et la hiérarchie.

> **À COMPLÉTER (stagiaire)** : réponses obtenues d'ArabSoft à ces six vérifications (point 1 de la section 12 du cahier des charges). En leur absence, le contrat d'export du chapitre 6 et les délais de repli de la section 6.4 servent d'hypothèses de travail documentées.

## 2.3 Critique de l'existant

### 2.3.1 Le reporting AJIR

Le module de reporting d'AJIR restitue des états et des graphiques sur les données saisies. C'est un outil **descriptif** : il répond à « combien de salariés, quelle masse salariale, combien de jours d'absence », pas à « qui risque de partir et pourquoi ». Trois manques en découlent :

1. **Aucune anticipation.** Le départ d'un salarié n'est visible qu'une fois la démission saisie, alors que la marge d'action de la RH se situe avant.
2. **Aucune lecture croisée.** Les signaux faibles d'un départ sont dispersés entre la paie (rémunération décrochée), la carrière (stagnation), le pointage (heures supplémentaires, retards) et les absences. Un état par module ne les rapproche pas.
3. **Aucune correction du calendrier.** Un pic d'absentéisme pendant le Ramadan, une semaine de pont ou la séance unique d'été n'a pas la même signification qu'en semaine ordinaire. Un seuil fixe produit alors des fausses alertes.

### 2.3.2 Le sujet initial

Le sujet initial du stage (document « README — Module intelligent RH ») posait un socle fonctionnel solide : trois rôles (Administrateur, Responsable RH, Manager), un contrôle d'accès par rôle côté serveur, un tableau de bord, une fiche collaborateur « augmentée », des alertes et des recommandations, sur la stack React + Next.js + SQLite. Il laissait cependant ouverts plusieurs points qui rendaient la partie intelligente ni évaluable ni défendable. Le cahier des charges v2 les a tranchés (tableau 2.1).

*Tableau 2.1 — Points ouverts du sujet initial et décisions du cahier des charges v2.*

| Sujet initial | Limite | Décision v2 |
|---|---|---|
| Moteur IA « laissé évolutif » | Rien à évaluer ni à défendre | Spécification figée au cadrage : population, cible, horizon, variables, modèles, protocole, critères de succès |
| « Risque de turnover » non défini | Un modèle « toute sortie » apprend surtout les dates de fin de CDD | Cible = démission ou abandon de poste à 6 mois ; autres sorties traitées comme risques concurrents |
| Seed fictif déterministe | Un modèle entraîné sur des données tirées au hasard ne prouve rien | Simulateur RH à vérité terrain ; le seed reste réservé aux tests |
| Quatre recommandations codées en dur | Aucun lien entre le score et l'action | Recommandations déclenchées par les facteurs actionnables, avec un statut et un suivi |
| Périmètre manager « département » ou « équipe » | Ambiguïté ; risque d'exposition de données | Hiérarchie du manager ; niveau de risque et catégories de facteurs, jamais de salaire ni de probabilité |
| Motif d'absence exploité | Donnée de santé, sensible | Catégorie seulement ; maladie et maternité exclues de tout score individuel |
| Ordre de développement en cascade | Méthodologie inadaptée à un PFE | Sprints de deux semaines (Scrum) et CRISP-DM pour le volet données |
| Critères d'acceptation qualitatifs | Validation subjective | Critères chiffrés (performance, sécurité, qualité du modèle) |

Le cahier v2 a aussi ajouté ce qui manquait à un PFE d'ingénieur : intégration avec AJIR, qualité des données, état de l'art, modélisation UML, éthique et conformité, exploitation sur site et liste explicite de ce qui est hors périmètre.

## 2.4 Solution proposée

Nous proposons un module People Analytics qui se greffe à AJIR sans le modifier (figure 2.1). Chaque mois, après la paie, l'export CSV d'AJIR est importé et contrôlé. Un processus de fond, le *worker*, calcule alors 25 variables par salarié à la fin du mois, estime le risque de démission à 6 mois, l'explique par groupes de facteurs et publie le résultat d'un seul coup. Il crée ensuite les recommandations et les alertes. L'application web présente à chaque rôle ce qui le concerne : tableau de bord, liste et fiche des collaborateurs, absentéisme, alertes, recommandations, santé des données, transparence du modèle et administration.

*Figure 2.1 — Vue d'ensemble de la solution : AJIR (export CSV) → import et contrôles → SQLite → worker (variables, scoring, publication, alertes) → Next.js (couche d'accès aux données, pages et API) → navigateur ; chaîne hors ligne : simulateur Python → entraînement Python → bundle JSON vérifié. Source : cahier des charges v2, section 5, et [README.md](../../README.md).*

Les choix structurants sont les suivants :

- **Une estimation, pas une décision.** Le module classe les salariés selon leur exposition au risque et l'explique. Il ne déclenche aucune action automatiquement : une recommandation est une suggestion que la RH réalise ou rejette.
- **Un niveau de risque lié à la capacité RH.** Le niveau « Élevé » regroupe au plus les k salariés les plus exposés, k étant la capacité mensuelle d'entretiens de la RH (2 % de l'effectif scoré par défaut). Un seuil fixe de probabilité laisserait cette classe presque vide, les démissions étant rares.
- **Un modèle simple, exact à expliquer, avec un repli.** Un score à règles (B0), issu des règles du sujet initial, sert de référence à battre et de repli tant qu'aucun modèle appris n'est validé. Le modèle visé est une régression logistique calibrée, dont la contribution de chaque variable se calcule exactement.
- **Une vue par rôle.** La RH voit les chiffres (probabilité, phrase chiffrée par facteur, salaire). Le manager voit le niveau de risque et des catégories de facteurs pour sa seule hiérarchie. L'administrateur administre l'outil sans accéder aux données nominatives.
- **Une exploitation sur site.** Node.js et un fichier SQLite suffisent. Python ne sert qu'hors ligne, sur un poste d'ArabSoft ou de l'étudiant.

## 2.5 Méthodologie

Le projet a deux natures. Côté produit, il s'agit d'une application web dont les exigences se précisent au fil des retours. Côté données, il s'agit d'une démarche expérimentale dont les résultats conditionnent le produit : si le modèle appris ne bat pas le score à règles, c'est ce dernier qui est déployé. Nous avons donc combiné deux cadres.

### 2.5.1 Scrum pour le produit

Scrum organise le travail en itérations de durée fixe, les *sprints*, qui produisent chacune un incrément utilisable, inspecté en revue (Schwaber et Sutherland, 2020). Nous l'avons adapté à un projet mené par un seul étudiant :

- **Sprints de deux semaines**, conclus par une revue avec l'encadrant entreprise, qui joue le rôle de *Product Owner*.
- **Backlog priorisé en MoSCoW** (chapitre 4). Les *Must* sont plafonnés, les *Should* ne sont engagés qu'après le jalon de démonstration des *Must*.
- **Définition de « terminé »** par fonctionnalité : code, tests automatisés, revue et documentation (fiche de décision si un choix d'architecture est en jeu).
- **Règle de coupe écrite à l'avance** : si le retard dépasse une semaine à la fin du sprint S2, le projet bascule sur une variante de 16 semaines réduite aux *Must*.

### 2.5.2 CRISP-DM pour le volet données

CRISP-DM (*Cross-Industry Standard Process for Data Mining*) décrit six phases itératives : compréhension du métier, compréhension des données, préparation, modélisation, évaluation et déploiement (Chapman et al., 2000 ; Wirth et Hipp, 2000). Le tableau 2.2 montre leur traduction dans le projet et les sprints où elles se situent.

*Tableau 2.2 — Phases CRISP-DM et leur réalisation dans le projet.*

| Phase CRISP-DM | Réalisation dans le projet | Sprint |
|---|---|---|
| Compréhension du métier | Définition de la cible (démission à 6 mois), de la population scorée, de la règle de décision par capacité RH, des critères de succès chiffrés | S0 |
| Compréhension des données | Contrat d'export AJIR (11 fichiers), dates de saisie, délais de repli, calendrier tunisien ; simulateur à vérité terrain | S0, S1 |
| Préparation des données | Import avec contrôles de qualité, agrégats mensuels, 25 variables calculées à la date t avec masquage des jours de santé | S2, S3 |
| Modélisation | B0, régression logistique calibrée, LightGBM comme comparateur hors ligne | S4 |
| Évaluation | Protocole temporel à origines glissantes, intervalles de confiance par bootstrap groupé, expérience Q1, courbe d'apprentissage, rapport d'équité | S4, S6 |
| Déploiement | Bundle JSON, jeu « golden », registre des modèles (enregistrer, vérifier, promouvoir, revenir en arrière), worker de scoring mensuel | S5 |

Les deux cadres se rejoignent sur un point : aucun résultat de modélisation n'est « terminé » tant qu'il n'a pas été évalué selon le protocole figé au cadrage, et aucun modèle n'entre en production sans passer le contrôle « golden » et la décision humaine de promotion.

## 2.6 Planning prévisionnel

Le cahier des charges prévoit 20 semaines, découpées en sprints de deux semaines, avec deux semaines tampons et un gel fonctionnel avant la validation (tableau 2.3).

*Tableau 2.3 — Planning prévisionnel (cahier des charges v2, section 9).*

| Semaines | Sprint | Contenu |
|---|---|---|
| 1-2 | S0 — Cadrage | Vérifications AJIR, entretiens RH, cahier des charges validé, protocole et critères figés, maquettes, dépôt et intégration continue |
| 3-4 | S1 — Simulateur et socle | Simulateur v1 ; prototype de bout en bout (simulateur → modèle → affichage) ; sessions et rôles |
| 5-6 | S2 — Données et sécurité | Import et contrôles de qualité, historique, calendrier tunisien, agrégats, synchronisation AJIR ; couche d'accès, audit, administration, tests 403 |
| 7-8 | S3 — Variables et tableau de bord | Calcul des variables, test anti-fuite, étiquettes ; tableau de bord et navigation |
| 9-10 | S4 — IA hors ligne | B0, régression logistique, LightGBM, calibration, protocole temporel, expérience Q1, export JSON et jeu golden |
| 11-12 | S5 — IA en production | Worker de scoring, publication atomique, fiche en trois zones, alertes, recommandations, actions RH |
| 13 | Absentéisme | Dérives collectives, signal individuel RH. **Jalon : démonstration de tous les *Must*** |
| 14 | Tampon | Rattrapage et corrections |
| 15-16 | S6 — *Should* | What-if, backtesting, page Transparence, jeton AJIR |
| 17 | Tampon et gel | Gel fonctionnel en fin de semaine |
| 18 | Validation | Tests de bout en bout, sécurité, charge, reprise, test utilisateur ; guide d'installation et manuels |
| 19-20 | Clôture | Rapport final, démonstration scriptée et vidéo de secours, soutenance, passation à ArabSoft |

La **variante de 16 semaines** ne garde que les *Must*, avec un jalon en semaine 12 et un seul tampon. Le rapport est rédigé en continu, un chapitre par sprint.

*Figure 2.2 — Diagramme de Gantt prévisionnel (à produire à partir du tableau 2.3).*

> **À COMPLÉTER (stagiaire)** : diagramme de Gantt **réel** (dates effectives de chaque sprint), vélocité ou charge constatée par sprint, écarts au prévisionnel et leurs causes, décision prise ou non d'appliquer la règle de coupe. Ces éléments de pilotage ne sont pas dans le dépôt. L'état fonctionnel livré est résumé au chapitre 8 (section 8.1) et au chapitre 10.

## 2.7 Conclusion

Le module proposé comble le principal manque du reporting d'AJIR, l'anticipation, sans toucher au progiciel ni à sa stack d'exploitation. Le cadrage v2 a rendu la partie prédictive évaluable : la cible, la population, le protocole et les critères de succès ont été figés avant toute modélisation. Le chapitre suivant situe ces choix dans la littérature.
