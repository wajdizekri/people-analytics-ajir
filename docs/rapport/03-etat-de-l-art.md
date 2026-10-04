# Chapitre 3 — État de l'art

Ce chapitre situe le projet dans quatre corpus : la littérature managériale sur le *People Analytics* et le départ volontaire, les travaux d'apprentissage automatique sur l'attrition, les méthodes statistiques qui fondent nos choix (analyse de survie, calibration, explicabilité, équité, détection d'anomalies) et les solutions du marché. Il se termine par une synthèse qui positionne notre travail.

## 3.1 Le *People Analytics*

Le *People Analytics*, ou analytique RH, désigne l'usage de données relatives au personnel, et de méthodes d'analyse, pour éclairer les décisions de gestion des ressources humaines. Le terme s'est popularisé au tournant des années 2010, porté par des témoignages de praticiens. Davenport, Harris et Shapiro (2010) décrivent comment des entreprises comme Google, Best Buy ou Procter & Gamble collectent et analysent les données sur leurs salariés pour attirer et retenir les talents. Il s'agit d'un article de praticiens, pas d'une étude empirique.

Les revues académiques sont plus réservées. Marler et Boudreau (2017) n'identifient que 60 articles sur l'analytique RH, dont 14 seulement dans des revues à comité de lecture reconnues. Ils concluent que l'adoption reste faible et que les preuves d'un effet sur la performance des organisations sont rares. La revue de portée de Tursunbayeva, Di Lauro et Pagliari (2018) fait un constat voisin : les bénéfices annoncés, souvent par les fournisseurs, sont peu démontrés, orientés vers l'employeur plutôt que vers le salarié, et les questions éthiques sont largement absentes de la littérature. Leonardi et Contractor (2018) plaident enfin pour compléter les attributs individuels par des données relationnelles (« qui connaît qui »), ce qui rejoint l'importance du contexte d'équipe discutée plus bas.

Deux enseignements orientent notre travail. D'abord, l'enjeu n'est pas de produire un score mais de montrer, avec un protocole défendable, qu'il apporte quelque chose par rapport à des règles simples. Ensuite, l'éthique (données de santé, transparence, minimisation, contrôle humain) doit être une exigence de conception et non une annexe (chapitre 9).

## 3.2 Théories du départ volontaire

### 3.2.1 Un processus plutôt qu'un événement

**Mobley (1977)** a proposé un modèle des « liens intermédiaires » entre l'insatisfaction et le départ. Le lien direct entre satisfaction et départ est constant mais faible ; entre les deux s'intercalent des étapes : penser à partir, évaluer le coût de la recherche et du départ, chercher, comparer les alternatives, former l'intention, partir. Ce modèle a structuré des décennies de recherche. Il a une conséquence directe pour la prédiction : un départ est précédé d'un processus, dont certaines étapes peuvent laisser des traces observables.

**Lee et Mitchell (1994)** ont montré que ce cheminement rationnel n'est pas le seul. Leur **modèle de déroulement** (*unfolding model*) décrit quatre chemins de décision. Plusieurs sont déclenchés par un **choc**, c'est-à-dire un événement, interne ou externe, qui pousse le salarié à reconsidérer sa situation : offre d'emploi, fusion, événement personnel. Certains départs sont très rapides et sans insatisfaction préalable. Pour un modèle prédictif, cela signifie qu'une partie des départs est par nature imprévisible à partir des données RH.

**Mitchell et al. (2001)** ont renversé la question : pourquoi les gens **restent**-ils ? Leur concept d'**ancrage professionnel** (*job embeddedness*) regroupe les liens avec les collègues et la communauté, l'adéquation avec le poste et ce que coûterait le départ. Il prédit le départ volontaire au-delà de la satisfaction, de l'engagement et des alternatives perçues. **Felps et al. (2009)** ont montré dans une étude multiniveau une **contagion** du départ : l'ancrage et la recherche d'emploi des collègues expliquent le départ d'un salarié au-delà de ses propres caractéristiques.

La revue centenaire de **Hom, Lee, Shaw et Hausknecht (2017)** retrace cette évolution : des méthodes pratiques de réduction du turnover aux théories du processus de départ, puis à la psychologie du maintien, aux trajectoires d'attitudes et au turnover collectif.

### 3.2.2 Ce que disent les méta-analyses

La méta-analyse de **Griffeth, Hom et Gaertner (2000)** reste la synthèse quantitative de référence sur les antécédents du départ. Parmi ses résultats (p. 479-481) :

- l'**intention de partir** est le meilleur prédicteur (corrélation corrigée ρ = 0,38), devant l'engagement organisationnel (ρ = −0,23) et la satisfaction globale (ρ = −0,19) ;
- les effets de la **rémunération** sont modestes, au regard de l'importance que lui prêtent praticiens et théoriciens ;
- les **absences** (ρ = 0,20) et, plus faiblement, les **retards** (ρ = 0,06) prédisent le départ. Ce motif est cohérent avec une **progression du retrait** : un salarié désengagé passe du retard à l'absence, puis au départ ;
- la **performance** est négativement liée au départ (ρ = −0,15) ;
- les **alternatives perçues** n'ont qu'un pouvoir prédictif modeste (ρ = 0,12).

### 3.2.3 Conséquences pour notre modèle

Les antécédents les plus puissants (intention, engagement, satisfaction) sont des **attitudes**, mesurées par questionnaire. Elles n'existent pas dans AJIR. Un modèle fondé sur les seules données administratives doit donc s'appuyer sur des indicateurs indirects, par construction plus faibles : rémunération relative, stagnation, charge de travail, comportements de retrait (absences courtes, retards, irrégularité), évaluation, contexte d'équipe. C'est le choix de nos six groupes de variables (chapitre 7).

Ces théories ont aussi guidé la conception du simulateur (chapitre 6). Le départ y résulte d'un engagement latent qui se dégrade (Mobley), d'offres externes et de chocs personnels (Lee et Mitchell), d'une qualité de manager non observée et de départs dans l'équipe (Felps et al.). Des signaux de retrait précèdent la démission (Griffeth et al.). Le modèle ne peut donc pas tout expliquer, et c'est voulu.

## 3.3 Apprentissage automatique appliqué à l'attrition

### 3.3.1 Travaux représentatifs

La prédiction de l'attrition par apprentissage automatique a donné lieu à une abondante littérature appliquée. **Zhao et al. (2019)** comparent dix méthodes supervisées (arbres, forêts aléatoires, *gradient boosting*, XGBoost, régression logistique, SVM, réseaux de neurones, etc.) sur des jeux RH réels et simulés de tailles diverses. Ils en tirent des recommandations de choix d'algorithme selon la taille et la complexité des données. **Fallucchi et al. (2020)** appliquent plusieurs classifieurs au jeu IBM HR Attrition avec un découpage aléatoire stratifié 70/30, suivi d'une validation croisée à cinq plis sur la partie d'apprentissage. **Yahia, Hlel et Colomo-Palacios (2021)** proposent une approche « *deep data* » qui privilégie la qualité des variables sur leur nombre, testée sur deux jeux RH simulés et un petit jeu réel de 450 réponses.

### 3.3.2 Le jeu IBM HR Attrition

Une grande partie de cette littérature repose sur un même jeu de données public, « IBM HR Analytics Employee Attrition & Performance » (pavansubhash, 2017). Sa description sur Kaggle précise qu'il s'agit d'un « jeu de données **fictif** créé par des data scientists d'IBM ». Il compte 1 470 salariés et 35 colonnes, avec un taux d'attrition de 16,1 %. Il ne contient **aucune date** : le temps n'y apparaît que sous forme de durées (âge, ancienneté, années depuis la dernière promotion). Certains travaux le présentent pourtant comme un jeu réel (c'est le cas de Fallucchi et al., 2020). AL-Ali et al. (2026) relèvent explicitement la dépendance excessive de la littérature à ce jeu unique, souvent synthétique, et la limite de généralisation qui en résulte.

Un autre jeu public, « Employee Turnover » (Babushkin, 2017 ; Wijaya, 2020), a une structure de survie : durée d'observation (`stag`) et indicateur de départ (`event`), sur 1 129 lignes. Sa provenance est peu documentée (« le jeu est réel », sans organisation, pays ni période) et il ne contient pas non plus de dates calendaires.

### 3.3.3 Limites méthodologiques

Trois limites récurrentes de cette littérature motivent directement notre question de recherche Q1.

1. **Le découpage aléatoire ignore le temps.** Tirer au hasard les observations de test revient à apprendre sur l'avenir pour prédire le passé, et à mettre un même salarié des deux côtés de la frontière. En présence de données structurées (temporelles, hiérarchiques), une validation croisée aléatoire sous-estime gravement l'erreur de prédiction, et il faut des découpages par blocs adaptés à la structure (Roberts et al., 2017). Pour des séries temporelles, l'évaluation de référence est l'évaluation hors échantillon à **origine glissante** (*rolling origin*) (Tashman, 2000).
2. **La fuite de données.** Kaufman et al. (2012) définissent la fuite comme l'utilisation, pendant l'apprentissage, d'une information sur la cible qui ne serait pas disponible au moment de la prédiction. Kapoor et Narayanan (2023) montrent que ce problème touche des centaines d'articles dans 17 disciplines, et qu'une fois les fuites corrigées, des modèles complexes perdent leur avantage apparent sur une régression logistique. Dans les données RH, la fuite la plus insidieuse est **temporelle** : une absence déclarée en retard, une évaluation saisie des mois après la campagne. Căvescu et Popescu (2026) proposent une évaluation « sans fuite » sur le jeu IBM, mais qui porte sur la fuite liée au prétraitement (rééquilibrage appliqué avant le découpage), et non sur la fuite temporelle. Nous n'avons pas trouvé de travail publié qui mesure l'effet de la date de saisie sur la performance d'un modèle d'attrition.
3. **La cible « toute sortie ».** Les jeux publics codent un indicateur binaire de départ, sans distinguer la démission d'une fin de contrat ou d'une retraite. Un modèle entraîné ainsi apprend en partie des départs connus d'avance.

## 3.4 Analyse de survie en temps discret et risques concurrents

### 3.4.1 Survie en temps discret

Le départ est un **événement daté** : la question naturelle est « quand ? » autant que « si ? ». L'analyse de survie en **temps discret** (Singer et Willett, 1993, 2003) traite des durées mesurées par périodes, ici des mois. On découpe l'histoire de chaque individu en lignes « personne-période » et l'on modélise le **hasard discret** (la probabilité de l'événement pendant la période, sachant qu'il n'a pas eu lieu avant) par une régression logistique. Cette approche gère naturellement les covariables qui varient dans le temps et la censure administrative (fin de l'observation).

La **prédiction dynamique par *landmarking*** (van Houwelingen, 2007) prolonge cette idée. À des dates repères, on ajuste un modèle sur les seuls individus encore à risque, avec leurs covariables mises à jour, pour prédire l'événement dans une fenêtre fixe. C'est exactement la situation de notre produit : chaque fin de mois est une date repère.

### 3.4.2 Risques concurrents

Un salarié peut sortir de l'entreprise pour plusieurs raisons mutuellement exclusives : démission, fin de CDD, licenciement, retraite. Ce sont des **risques concurrents** : la survenue de l'un empêche l'observation des autres. Le tutoriel de Putter, Fiocco et Geskus (2007) rappelle l'erreur classique : traiter les autres causes comme des censures et estimer la probabilité de l'événement d'intérêt par 1 − Kaplan-Meier **surestime** cette probabilité, car on fait comme si le salarié sorti pour une autre raison restait exposé au risque de démissionner. La quantité pertinente est l'**incidence cumulée** de la cause d'intérêt, estimée de façon non paramétrique par l'estimateur d'Aalen et Johansen (1978). Fine et Gray (1999) proposent une régression directe sur cette incidence cumulée. Blanche, Dartigues et Jacqmin-Gadda (2013) définissent l'AUC dépendante du temps en présence de risques concurrents : les sujets sortis pour une autre cause y comptent parmi les « contrôles ».

### 3.4.3 Ce que fait notre formulation

Le plan de cadrage prévoyait un modèle à hasards discrets avec incidence cumulée à 3, 6 et 12 mois. Le cahier des charges v2 a retenu, pour tenir le calendrier, une **classification directe à 6 mois** (chapitre 7). Cette simplification reste cohérente avec la théorie des risques concurrents, pour deux raisons :

- l'étiquette vaut 1 si la démission survient dans les 6 mois, et **0 si une autre sortie survient avant** : les autres sorties ne sont pas censurées ;
- seuls les snapshots dont l'horizon est entièrement observé (`followup_complete`) entrent dans l'apprentissage et l'évaluation, si bien qu'il n'y a pas de censure dans la fenêtre.

L'espérance de l'étiquette sachant les variables est alors exactement l'**incidence cumulée de la démission à 6 mois**, et non 1 − S : la probabilité estimée est celle qui est affichée, sans le biais décrit par Putter et al. (2007). L'AUC est calculée selon la même convention que Blanche et al. (2013), avec les autres sorties parmi les contrôles.

Ce que l'on perd est connu : un seul horizon au lieu d'une courbe de risque ; l'exclusion des six derniers mois de données, dont l'horizon n'est pas clos, alors qu'un modèle à hasards discrets les exploiterait en partie ; aucun effet du temps écoulé depuis la date repère. Ces pertes sont discutées en perspectives (chapitre 10).

## 3.5 Calibration des probabilités

Un score peut bien **classer** les salariés (bonne discrimination) tout en annonçant des probabilités fausses. Van Calster et al. (2019) qualifient la calibration de « talon d'Achille » de l'analytique prédictive : une probabilité mal calibrée induit en erreur la décision, même quand l'AUC est bonne. Ils distinguent plusieurs niveaux de calibration : en moyenne (le ratio observé/prévu), faible (intercept et pente), modérée (courbe de calibration) et forte. La **pente de calibration**, obtenue en régressant l'issue observée sur le logit de la prédiction, remonte à Cox (1958). Une pente inférieure à 1 signale des prédictions trop extrêmes, typiques du surapprentissage. Le **score de Brier** (Brier, 1950) mesure l'erreur quadratique moyenne des probabilités. Le manuel de Steyerberg (2019) traite de la validation et de la mise à jour des modèles de prédiction, et la déclaration TRIPOD (Collins et al., 2015) fixe les éléments à rapporter.

Pour recalibrer un score, la méthode de **Platt** ajuste une sigmoïde sur les scores du modèle, à l'origine ceux d'un SVM (Platt, 2000). Niculescu-Mizil et Caruana (2005) comparent la qualité des probabilités de dix familles d'algorithmes. Ils montrent que la méthode de Platt et la régression isotonique corrigent les distorsions de la plupart d'entre eux, l'isotonique demandant davantage de données. La recalibration est indispensable dans notre cas : la **pondération des classes**, utilisée pour compenser la rareté des démissions, déforme volontairement les probabilités.

Quand les positifs sont rares (environ 4 % des snapshots dans notre cas), l'AUC ROC (Fawcett, 2006) peut donner une image trop optimiste. La courbe **précision-rappel** est plus informative (Saito et Rehmsmeier, 2015), à condition d'être lue avec la prévalence. L'**analyse de courbe de décision** (Vickers et Elkin, 2006) exprime enfin l'utilité d'un modèle en **bénéfice net**, selon le seuil à partir duquel on agirait. Pour le produit, nous lui préférons une mesure plus directe de l'utilité opérationnelle : le **lift à la capacité RH**.

## 3.6 Explicabilité

Deux familles d'approches coexistent. Les **explications a posteriori** s'appliquent à tout modèle. LIME ajuste localement un modèle de substitution interprétable autour d'une prédiction (Ribeiro et al., 2016). Les valeurs de **Shapley**, issues de la théorie des jeux, répartissent la prédiction entre les variables (Štrumbelj et Kononenko, 2014). Lundberg et Lee (2017) les ont unifiées sous le nom de **SHAP**, en montrant qu'elles sont les seules attributions additives à vérifier certaines propriétés souhaitables (précision locale, absence, cohérence). Ces explications sont en général **approchées** (échantillonnage, modèle de substitution) et, quand les variables sont corrélées, elles peuvent évaluer le modèle sur des combinaisons de valeurs irréalistes.

Rudin (2019) défend l'autre voie : pour les décisions à fort enjeu, il vaut mieux utiliser un **modèle intrinsèquement interprétable** que d'expliquer une boîte noire. C'est le choix que nous faisons. Pour un modèle linéaire à variables supposées indépendantes, la valeur SHAP de la variable j est exactement wⱼ (xⱼ − E[xⱼ]) (Lundberg et Lee, 2017, section 4.2, corollaire 1 « *Linear SHAP* »). La contribution que nous affichons, a · βⱼ · zⱼ sur le logit calibré, en est l'application directe : elle est **exacte** et se calcule sans coût.

La documentation fait aussi partie de la transparence. Les **fiches de modèle** (*model cards*) documentent l'usage prévu d'un modèle et ses performances désagrégées par groupes (Mitchell et al., 2019). Les **fiches de jeux de données** (*datasheets*) documentent la motivation, la composition et la collecte d'un jeu (Gebru et al., 2021). Notre page Transparence et la fiche du simulateur ([ml/sim/README.md](../../ml/sim/README.md)) s'en inspirent.

## 3.7 Équité algorithmique

Un score de risque peut désavantager un groupe même si l'attribut qui le définit (sexe, âge) n'est pas une variable du modèle, par l'intermédiaire de variables corrélées, dites **proxys**. Plusieurs critères d'équité de groupe ont été formalisés (Barocas et al., 2023). Les trois principaux sont l'indépendance (même taux de sélection), la séparation (mêmes taux d'erreurs) et la suffisance (même calibration). **Hardt, Price et Srebro (2016)** définissent l'**égalité des chances** (*equality of opportunity*), qui exige des taux de vrais positifs égaux entre groupes, et les *equalized odds*, qui exigent aussi des taux de faux positifs égaux. Ils proposent une correction a posteriori par des seuils propres à chaque groupe.

Ces critères sont en tension. **Kleinberg, Mullainathan et Raghavan (2017)** démontrent que la calibration dans chaque groupe et l'équilibre des scores pour les classes positive et négative ne peuvent être satisfaits simultanément que si la prédiction est parfaite ou si les taux de base sont égaux (théorème 1 de la version publiée). **Chouldechova (2017)** établit un résultat voisin : quand les taux de base diffèrent, un score à parité prédictive ne peut pas avoir des taux de faux positifs et de faux négatifs égaux entre groupes.

Il n'existe donc pas de score « équitable » dans l'absolu : il faut choisir le critère qui correspond au **préjudice** visé par l'usage. Dans notre cas, être classé « Élevé » déclenche un entretien ou une révision salariale : le préjudice est d'**être oublié**, et l'égalité des taux de vrais positifs est le critère pertinent. Ce choix, et la décision de mettre ou non un modèle en service, relèvent d'un humain, documenté (chapitre 7).

## 3.8 Détection d'anomalies dans des séries

Chandola, Banerjee et Kumar (2009) distinguent trois types d'anomalies : ponctuelles (une valeur isolée aberrante), **contextuelles** (une valeur anormale dans son contexte, par exemple un taux d'absence normal en semaine de Ramadan mais anormal en semaine ordinaire) et collectives (une suite de valeurs anormale dans son ensemble). L'absentéisme d'une équipe relève des deux derniers types : ce qui compte est un écart persistant par rapport à ce que le calendrier laisse attendre.

Trois idées de la littérature fondent notre détecteur :

- **Statistiques robustes.** La moyenne et l'écart-type sont eux-mêmes déformés par les valeurs aberrantes qu'on cherche. Leys et al. (2013) recommandent la règle « médiane ± k × écart absolu médian (MAD) ».
- **Saisonnalité retirée avant le test.** Hochenbaum, Vallis et Kejariwal (2017) retirent tendance et saisonnalité par décomposition, puis appliquent un test fondé sur la médiane et le MAD (S-H-ESD) à des métriques d'infrastructure.
- **Comparaison à des périodes comparables.** En surveillance épidémiologique, l'algorithme de Farrington et al. (1996) fixe un seuil d'alerte à partir des semaines comparables des années précédentes et signale chaque dépassement.

La carte de contrôle **CUSUM** (Page, 1954), qui cumule les écarts pour détecter un changement de niveau, est une alternative classique pour les dérives lentes.

Notre détecteur combine ces idées : taux attendu égal à la médiane des 26 semaines précédentes ramenées à une semaine normale par un facteur propre à chaque classe calendaire tunisienne, dispersion robuste par le MAD avec un plancher binomial, et persistance exigée sur deux semaines (chapitre 8). Le signal individuel utilise le **facteur de Bradford** (S² × D, où S est le nombre d'épisodes d'absence et D le nombre de jours), indicateur de pratique RH qui pénalise les absences courtes et répétées. Il est réservé à la RH et formulé « à vérifier ».

## 3.9 Solutions du marché

Les grands éditeurs de logiciels RH proposent des fonctions d'analytique et, pour certains, de prédiction du départ. Nous ne retenons ici que ce que leur documentation publique affirme, consultée en septembre 2026.

- **Visier** est une plateforme d'analytique RH dédiée. Sa documentation (Visier, s.d.-a) décrit des modèles prédictifs, dont un **risque de démission** individuel, estimé par forêt aléatoire à un horizon de 12 mois, accompagné des « principaux attributs de prédiction » en guise d'explication. La solution est hébergée dans le cloud (AWS et Azure) (Visier, s.d.-b).
- **Workday Peakon Employee Voice** vient de l'acquisition de Peakon par Workday, annoncée le 28 janvier 2021 et finalisée le 9 mars 2021 (Workday, 2021a, 2021b). Sa fonction de prédiction d'attrition estime, **par segment** de salariés et non individuellement, afin de protéger l'identité de chacun, une probabilité de départ dans les six mois. Elle repose sur les réponses aux enquêtes d'engagement (engagement, loyauté, développement, participation) et sur l'ancienneté (Workday, s.d.).
- **SAP SuccessFactors People Intelligence** est présenté comme une solution SaaS gérée au sein de SAP Business Data Cloud, qui « utilise l'apprentissage automatique pour prévoir l'attrition par département » (SAP, s.d.). Nous n'avons pas trouvé de score individuel natif dans la documentation publique.
- **Oracle Fusion HCM Analytics** est une solution « cloud native » dont la présentation commerciale annonce des modèles d'apprentissage automatique prêts à l'emploi pour prédire les résultats, identifier les salariés à risque de départ et comprendre les facteurs du turnover (Oracle, s.d.). Nous n'avons pas trouvé de documentation technique du modèle.

Au niveau local, des SIRH destinés aux entreprises tunisiennes existent, par exemple Talenteo ou SIRY. Leur présentation publique ne mentionne pas de prédiction du départ (Talenteo, s.d. ; SIRY, s.d.). Ce constat repose sur une recherche non exhaustive et ne prouve pas l'absence d'une telle offre.

Trois différences séparent ces solutions de notre contexte :

- elles sont **hébergées dans le cloud de l'éditeur**, alors que les clients d'AJIR sont installés sur site ;
- elles supposent un **SIRH de l'éditeur**, ou une intégration lourde ;
- leurs méthodes d'évaluation (protocole, calibration, traitement de la date de saisie) **ne sont pas publiées**. Le choix de Workday Peakon de prédire par segment plutôt qu'individuellement montre par ailleurs que la question de la minimisation se pose aussi aux grands éditeurs. Notre réponse est différente : un score individuel, mais réservé à la RH, et une vue manager en catégories (chapitre 9).

## 3.10 Synthèse et positionnement

Le tableau 3.1 confronte notre module aux deux familles de travaux dont il se distingue : les études académiques d'apprentissage automatique sur l'attrition, et les solutions commerciales.

*Tableau 3.1 — Positionnement.*

| Critère | Études ML sur jeux publics (§ 3.3) | Solutions commerciales (§ 3.9) | Ce projet |
|---|---|---|---|
| Données | Jeu statique, souvent fictif (IBM) | Données du client, dans le cloud de l'éditeur | Export AJIR du client, sur son serveur ; simulateur à vérité terrain pour l'étude |
| Protocole d'évaluation | Découpage aléatoire | Non publié | Origines glissantes, bootstrap groupé par salarié, plafond oracle |
| Date de saisie | Absente des jeux | Non documentée | Règle *as-of* appliquée partout, testée ; effet mesuré (Q1b) |
| Cible | Toute sortie | Variable selon l'éditeur | Démission à 6 mois, autres sorties en risques concurrents |
| Calibration | Rarement rapportée | Non publiée | Platt, O/E, pente, Brier, courbe de calibration |
| Explication | SHAP ou importance globale, approchée | Facteurs de risque, méthode non publiée | Contributions exactes par groupe, rendu selon le rôle |
| Décision | Seuil de classification | Selon l'éditeur | Niveau borné par la capacité d'entretiens RH |
| Contexte local | — | Calendriers génériques | Calendrier tunisien (Ramadan, séance unique, ponts), SMIG, contrats SIVP |
| Données de santé | Non traitées | Non documenté | Exclues, y compris par masquage dans les pointages |
| Équité | Rarement étudiée | Selon l'éditeur | Rapport par sexe et âge, proxys, décision humaine documentée |

Notre contribution n'est pas un nouvel algorithme : le modèle retenu est volontairement simple. Elle tient en trois points. Le premier est un **protocole d'évaluation qui respecte le temps et la date de saisie**, appliqué à un problème où la littérature l'ignore le plus souvent, et qui permet de **mesurer** ce que coûtent les raccourcis habituels (Q1). Le deuxième est un **banc d'essai non circulaire** : un simulateur à vérité terrain au format d'un vrai progiciel tunisien. Le troisième est un **produit exploitable sur site**, sur une stack imposée et modeste, où chaque exigence de la littérature (calibration, explicabilité exacte, équité, humain dans la boucle, minimisation) se traduit par une règle vérifiée dans le code.
