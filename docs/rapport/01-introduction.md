# Chapitre 1 — Introduction générale

## 1.1 Contexte

Le départ volontaire d'un salarié coûte à l'entreprise bien au-delà du poste laissé vacant : recrutement et intégration du remplaçant, perte de savoir-faire, désorganisation de l'équipe, voire départs en chaîne. Un siècle de recherche en psychologie du travail et en management a montré que ce départ est le plus souvent l'aboutissement d'un processus, fait d'insatisfaction, de recherche d'alternatives et d'événements déclencheurs (Hom et al., 2017). Une partie de ce processus laisse des traces dans les données que l'entreprise possède déjà : stagnation de carrière, rémunération décrochée du marché, charge de travail, absences courtes répétées, départs dans l'équipe.

Ces données existent chez les clients du progiciel AJIR, édité par ArabSoft. Ces entreprises, pour la plupart des PME et des ETI tunisiennes de 150 à 800 salariés installées sur leur propre serveur, accumulent depuis des années des pointages, des absences, des bulletins de paie, des formations et des évaluations. Aujourd'hui, ces données ne servent qu'au reporting : elles décrivent le passé, sans aider la direction des ressources humaines (RH) à anticiper un départ ni à choisir où agir.

Le champ du *People Analytics*, c'est-à-dire l'analyse des données relatives au personnel pour éclairer les décisions RH (Marler et Boudreau, 2017), propose de combler ce manque. Il s'accompagne toutefois de risques bien identifiés. Un modèle mal évalué promet une précision qu'il n'atteindra jamais en production, une probabilité mal calibrée induit en erreur, un score opaque ne permet aucune action et un traitement de données personnelles mal encadré expose l'entreprise comme les salariés.

## 1.2 Problématique

Le projet de fin d'études (PFE) que nous présentons répond à la question formulée dans le cahier des charges révisé (version 2) :

> Comment transformer les données RH accumulées dans AJIR en une aide à la décision fiable, qui estime le risque de démission de chaque salarié, l'explique par des facteurs sur lesquels la RH peut agir, signale les dérives d'absentéisme, et fonctionne sur un seul serveur client avec la stack React + Next.js + SQLite, sans décision automatique ?

Chaque terme de cette question est une contrainte de conception :

- **fiable** : la performance annoncée doit être celle que le client observera. Cela impose un protocole d'évaluation qui respecte le temps et la date réelle de saisie des données ;
- **risque de démission** : on prédit la démission ou l'abandon de poste, pas « toute sortie ». Une fin de contrat à durée déterminée (CDD) ou un départ à la retraite sont connus d'avance et n'appellent pas d'action de rétention ;
- **facteurs sur lesquels la RH peut agir** : l'explication doit être exacte, adaptée au rôle de l'utilisateur, et une recommandation ne peut être déclenchée que par un levier RH (rémunération, charge de travail, formation) ;
- **un seul serveur, stack imposée** : pas de second backend, pas de Python ni de Docker en production, une base SQLite dans un fichier ;
- **sans décision automatique** : l'outil classe et explique, l'humain décide.

## 1.3 Question de recherche

Au-delà de la réalisation du module, le cahier des charges fixe une question de recherche mesurable :

> **Q1.** Dans quelle mesure les fuites de données temporelles (découpage aléatoire, informations saisies après coup) surestiment-elles la performance d'un modèle de démission, et quel gain réel un modèle appris apporte-t-il par rapport à des règles métier une fois ces fuites neutralisées ?

Q1 est mesurée sur un simulateur dont la vérité terrain est connue, avec un plafond de performance « oracle » rapporté. Sa réponse fixe aussi une règle produit : à partir de quelle taille d'entreprise, ou de quel nombre de démissions observées, un modèle appris devient préférable à un score à règles.

## 1.4 Contributions

Le cahier des charges organise le travail autour de trois contributions :

- **C1 — Des données AJIR fiabilisées et un simulateur à vérité terrain.** Un import versionné de l'export AJIR, avec une vingtaine de contrôles de qualité, des rejets motivés, un score de qualité qui bloque le calcul sous un seuil, un calendrier tunisien (jours fériés civils et religieux, Ramadan, séance unique, ponts) et une règle de visibilité des données à leur date de saisie. Un simulateur RH tunisien qui produit un export au format AJIR dont les causes de départ, les anomalies d'absentéisme et les défauts de qualité sont connus, sans que les départs soient tirés d'un modèle logistique des variables observées (non-circularité).
- **C2 — Un protocole d'évaluation temporel anti-fuite.** Un découpage dans le temps à origines glissantes, des variables calculées « à la date t » et testées contre la fuite, le chiffrage de Q1 et une courbe d'apprentissage selon la taille de l'entreprise.
- **C3 — Un module d'aide à la décision explicable et sécurisé.** Une fiche collaborateur en trois zones (faits observés, estimation, suggestions), des facteurs dont le détail dépend du rôle, des niveaux de risque fixés par la capacité d'entretiens de la RH, des alertes et des recommandations suivies, un audit en ajout seul, une couche d'accès aux données qui remplace la sécurité par ligne absente de SQLite, et une exploitation sur site.

## 1.5 Démarche

Le projet combine deux méthodes. Le développement du produit suit Scrum, en sprints de deux semaines avec une définition de « terminé » par fonctionnalité. Le volet données et apprentissage automatique suit CRISP-DM, de la compréhension du métier au déploiement (chapitre 2). Les décisions d'architecture sont consignées dans des fiches de décision (ADR) conservées avec le code, dans [docs/adr/](../adr/).

La règle d'architecture qui structure tout le projet est la suivante : Python ne sert qu'hors ligne, pour le simulateur, l'entraînement et l'évaluation. En production, tout s'exécute en Node.js. Le modèle retenu est exporté en JSON et exécuté en TypeScript, et un jeu de contrôle, dit « golden », vérifie que les deux implémentations donnent le même résultat.

## 1.6 Organisation du rapport

- Le **chapitre 2** présente ArabSoft et AJIR, critique l'existant, décrit la solution proposée et la méthodologie, puis le planning prévisionnel.
- Le **chapitre 3** dresse l'état de l'art : People Analytics, théories du turnover, apprentissage automatique appliqué à l'attrition et ses limites, analyse de survie et risques concurrents, calibration, explicabilité, équité, détection d'anomalies, solutions du marché. Il se termine par notre positionnement.
- Le **chapitre 4** analyse les besoins : acteurs, cas d'utilisation, besoins fonctionnels et non fonctionnels chiffrés, priorisation MoSCoW.
- Le **chapitre 5** présente la conception : architecture, choix techniques, modèle de données, séquences et sécurité.
- Le **chapitre 6** traite des données : contrat d'export AJIR, contrôles de qualité, calendrier tunisien, visibilité à la date de saisie et simulateur.
- Le **chapitre 7** décrit le volet prédictif : formulation, variables, protocole temporel, modèles, métriques, résultats, explicabilité, simulation *what-if* et équité.
- Le **chapitre 8** présente la réalisation (écrans par rôle) et la validation (tests unitaires, d'intégration, de sécurité, de performance, accessibilité, déploiement).
- Le **chapitre 9** analyse l'éthique et la conformité : loi organique n° 2004-63, INPDP, Convention 108, avec le RGPD et le règlement européen sur l'IA comme référentiels.
- Le **chapitre 10** conclut : bilan, limites, menaces à la validité et perspectives.
