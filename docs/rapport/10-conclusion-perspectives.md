# Chapitre 10 — Conclusion générale et perspectives

## 10.1 Bilan

Ce projet devait transformer les données accumulées dans AJIR en une aide à la décision RH fiable, sur un seul serveur client, avec la stack React + Next.js + SQLite et sans décision automatique. Nous faisons le bilan au regard des trois contributions annoncées.

**C1 — Des données fiabilisées et un simulateur à vérité terrain.** L'import lit l'export AJIR de onze fichiers en flux. Il applique 24 contrôles motivés et calcule un score de qualité qui bloque le calcul sous 95 %. Il construit un calendrier tunisien (fériés civils et religieux, Ramadan, séance unique, ponts) et applique à toutes les sources la règle de visibilité à la date de saisie. Sur le simulateur, tous les défauts injectés ont été détectés par la règle attendue, sans faux rejet (32 533 sur 32 533 pour la graine 1), avec la réserve que règles et défauts ont été conçus ensemble (chapitre 6). Le simulateur produit un export réaliste au format AJIR, dont les départs ne sont pas tirés d'un logit des variables observées. Il fournit la vérité terrain nécessaire à l'évaluation : mécanismes, probabilité oracle, anomalies et défauts étiquetés.

**C2 — Un protocole d'évaluation temporel anti-fuite.** Le protocole à origines glissantes, le bootstrap groupé par salarié et les trois volets de l'expérience Q1 (découpage, date de saisie, courbe d'apprentissage) sont implémentés et reproductibles. Les variables sont testées contre la fuite par perturbation des données futures.

Sur le jeu principal du simulateur, la réponse à Q1 est nette ([docs/RESULTATS_ML.md](../RESULTATS_ML.md)) :

- le **découpage aléatoire** gonfle l'AUC de la régression logistique de +0,03 à +0,04, mais celle de LightGBM de +0,29 (0,925 annoncé contre 0,640 dans le temps) ;
- les **variables calculées sans tenir compte de la date de saisie** ajoutent environ +0,01 d'AUC et surtout surestiment le lift, annoncé à 3,70 alors que le même modèle obtient 2,95 en production ;
- une fois ces fuites neutralisées, la régression logistique bat le score à règles de +0,071 d'AUC [0,038 ; 0,103], avec un lift de 3,33 à la capacité contre 2,06, et des probabilités calibrées (O/E de 1,00). LightGBM n'apporte rien de plus ;
- la supériorité sur les règles devient fiable à partir d'une vingtaine de démissions observées sur le jeu principal, d'une trentaine sur les trois jeux regroupés, et la calibration en demande environ 150 : c'est la règle de démarrage à froid du produit ;
- le modèle (AUC 0,63) reste loin du plafond oracle (0,80), l'essentiel du signal simulé passant par des causes que les données RH n'observent pas.

**C3 — Un module d'aide à la décision explicable et sécurisé.** Le module couvre les huit modules *Must* du cahier des charges et les *Should* : what-if, backtesting, Transparence, retour sur les recommandations, ouverture depuis AJIR par jeton signé. Il y ajoute quatre IA par sujet construites avec la même discipline : prévision de l'absentéisme, projection des effectifs et de la masse salariale, risque de retard des formations obligatoires, charge de travail (chapitre 7, section 7.12). Le modèle LOGREG est promu sur la base de démonstration, protégé par une règle de démarrage à froid. Quelques écarts sont tracés au chapitre 8. Plusieurs propriétés sont vérifiées :

- l'explication est exacte pour le modèle affiché et rendue selon le rôle ;
- les niveaux de risque sont bornés par la capacité d'entretiens de la RH ;
- la campagne de tests de sécurité n'a trouvé aucune vulnérabilité de gravité moyenne ou supérieure, et aucune fuite de donnée sensible vers le manager ;
- le calcul mensuel complet s'exécute en un peu plus d'une minute sur la base de démonstration (14 s pour le dernier mois avec les quatre étapes IA) ;
- les droits d'accès et d'opposition sont outillés, et la conservation des données est bornée par un outil de purge.

Le tableau 10.1 confronte les critères d'acceptation chiffrés du cahier des charges aux mesures disponibles.

*Tableau 10.1 — Critères d'acceptation et état.*

| Critère | Seuil | Mesure | État |
|---|---|---|---|
| Autorisation (BNF-1) | 100 % des routes privées testées | 13 routes de l'API sur 13, 5 profils, 60 tests HTTP réussis sur le build final ; 22 écrans vérifiés par rôle dans le navigateur ; refus à l'entrée des pages journalisés ([SECURITE_PERF.md](../qa/SECURITE_PERF.md), § 9) | Atteint |
| Confidentialité manager (BNF-2) | Aucune donnée salariale ni probabilité | Aucune fuite détectée (API et pages) ; fuite de l'opposition vers le manager corrigée lors de la vérification finale | Atteint |
| Performance du tableau de bord (BNF-3) | p95 < 500 ms, 20 utilisateurs | 103 ms sur le build final (liste des collaborateurs : 193 ms), 0 erreur ; 554 ms puis 424 ms avant la mise en cache des agrégats | Atteint |
| Calcul mensuel (BNF-4) | < 15 min | 1,06 min (première campagne) ; 14 à 17 s pour le dernier mois (30/09/2026) | Atteint |
| Robustesse et restauration (BNF-5, BNF-6) | Reprise ; restauration < 5 min | Reprise des jobs, runs et imports interrompus testée ; restauration de 19 s à 1 min 30 | Atteint (reprise non mesurée sur le serveur cible) |
| Qualité (BNF-7) | Couverture ≥ 70 % ; aucune alerte haute ZAP | Couverture : features 99,6 %, DAL 97,8 %, scoring 100 % des instructions ; 655 tests Vitest, 67 pytest, 113 tests de bout en bout (39 pages sans violation axe), tous réussis ; `npm audit` : 0 vulnérabilité en production ; aucune vulnérabilité ≥ moyenne au test manuel ; ZAP non passé | Couverture atteinte ; ZAP à passer |
| Modèle (BNF-9 à BNF-11) | Bat B0, O/E dans [0,8 ; 1,25], lift ≥ 3 | ΔAUC +0,071 [0,038 ; 0,103] ; O/E 1,00 [0,88 ; 1,12] ; lift 3,33 [2,41 ; 4,33] (simulateur) | Atteint en valeur ; bornes basses de la pente et du lift hors cible |
| Fidélité TypeScript ↔ Python (BNF-12) | < 10⁻⁶ sur le golden | Écart maximal 1,1 × 10⁻¹⁶ sur les 200 lignes du golden de `logreg-v1-20260930` | Atteint |
| Anti-fuite (BNF-13) | Variables inchangées | Test par propriétés ([features.test.ts](../../src/lib/features/features.test.ts)) | Couvert par test |
| Utilisateurs (BNF-14) | ≥ 80 % de réussite sur 6 tâches | Non réalisé | **À COMPLÉTER** |

## 10.2 Limites

Nous distinguons les limites du volet prédictif, celles du produit et celles de la détection d'anomalies.

**Volet prédictif.**

- Toutes les mesures sont obtenues sur un **simulateur** : elles valent preuve de méthode, pas preuve de valeur métier. Le calage du simulateur repose sur des ordres de grandeur plausibles, non validés par des statistiques d'ArabSoft ou de l'INS, ni par une revue de réalisme par des RH.
- La formulation retenue est une **classification à un seul horizon** (6 mois). Elle estime correctement l'incidence cumulée de la démission à 6 mois, grâce aux risques concurrents comptés comme non-événements et à l'exclusion des horizons incomplets (chapitre 3). Mais elle n'offre pas de courbe de risque à 3 et 12 mois, et elle n'exploite pas les six derniers mois de données.
- Le modèle promu sur la base de démonstration est appris sur le simulateur : chez un client, il faudra le réentraîner, et la règle de démarrage à froid le remplacera par B0 tant que l'historique compte moins de 30 démissions observées. Sa calibration dépend du taux de base récent, et la borne basse de l'intervalle de sa pente de calibration (0,67) sort de la cible. Une rupture de conjoncture exigera une recalibration.
- La réplication montre que le gain d'AUC sur B0 dépend du scénario : il se reproduit sur une seconde graine mais disparaît dans le scénario « charge », où la logistique double pourtant le lift de B0. Les seuils de 30 et 150 démissions reposent sur des critères en partie définis après la lecture de la réplication.
- Les IA par sujet ont chacune leurs limites : l'effectif est mieux prévu par la persistance que par le modèle, la prévision d'absentéisme d'une équipe garde une erreur de l'ordre du taux lui-même, le risque de retard de formation repose presque entièrement sur le délai restant, et aucune recommandation par sujet n'est évaluée contre un effet réel.
- Les **interventions** RH réalisées sont enregistrées, mais pas encore exploitées au réentraînement. Un départ évité grâce à une action serait appris comme un faux positif.
- La **porte de promotion** d'un modèle (backtest sur les données du client, non-infériorité face à B0, calibration, rapport d'équité lu) reste une procédure humaine ; seule la règle de démarrage à froid est automatisée.
- Le **déclenchement des recommandations** au niveau du groupe peut proposer un examen de la charge de travail sur la base de retards (chapitre 7).

**Produit.**

- Le périmètre d'un manager suit la **hiérarchie du dernier import**, et non la hiérarchie à la date consultée.
- Les écarts d'exploitation relevés en cours de projet (retour arrière du calcul publié, reconstruction des agrégats après un import lancé depuis l'interface, import interrompu, purges de rétention, sessions à durée fixe, refus non journalisés à l'entrée des pages, absence de règle de lint, montants visibles par l'administrateur) sont **corrigés** ; ceux qui restent (validation de Caddy et des services sur un vrai Windows Server, formulaires qui perdent un choix après un refus serveur, contrastes relevés par axe-core) sont listés dans [docs/qa/BACKLOG_INTEGRATION.md](../qa/BACKLOG_INTEGRATION.md) et [docs/qa/BUGS_E2E.md](../qa/BUGS_E2E.md).
- Le contrôle du **SMIG** applique un barème daté (528,320 TND jusqu'à fin 2025, 554,736 TND ensuite), dont les valeurs restent à confirmer.
- La **latence** du tableau de bord sous 20 utilisateurs simultanés est à la limite du budget, du fait du caractère synchrone de better-sqlite3.
- Les **dates des fêtes religieuses** sont estimées et doivent être relues chaque année.

**Détection d'anomalies.** La détection collective ne voit pas les motifs individuels (lundi-vendredi, ponts, dérive), que seul le facteur de Bradford retrouve, tardivement. Elle rattache chaque salarié à son manager actuel et lit les absences sans appliquer la règle de visibilité à la date de saisie (chapitre 8).

## 10.3 Menaces à la validité

**Validité interne** : les résultats mesurent-ils bien ce qu'ils prétendent ?

- Les variables et le simulateur ont été conçus par la même équipe, en connaissant les mêmes théories. Même sans génération logistique, les variables risquent de capter exactement les signaux que le simulateur émet, ce qui rendrait les résultats optimistes. Trois choix atténuent ce risque sans l'éliminer : des causes cachées (qualité du manager, marché, événements personnels), du bruit (motifs et dates manquants) et un plafond oracle rapporté.
- Les grilles d'hyperparamètres du modèle ont été élargies après un premier passage sur le jeu principal, et les réglages de la détection d'anomalies ont été choisis sur la graine 1 : ces **degrés de liberté du chercheur** rendent les résultats du jeu principal légèrement optimistes. Seuls les jeux de réplication sont vraiment hors échantillon.
- Une erreur d'implémentation reste possible. Elle est atténuée par la reproduction du golden, la réimplémentation indépendante de la règle d'anomalie en Python et les tests par propriétés.

**Validité externe** : les résultats se généralisent-ils ?

- Une seule entreprise simulée, dans deux scénarios, ne représente pas la diversité des clients d'AJIR. Leur taille (150 à 800 salariés) est souvent inférieure à celle du jeu principal : le nombre de démissions observées, donc la supériorité éventuelle d'un modèle appris, en dépend.
- La **réforme du Code du travail** de mai 2025 fait du CDI la règle et limite le CDD à des cas précis (Loi n° 2025-9, 2025). Elle modifie la structure contractuelle des clients, donc la population scorée et la distribution des sorties concurrentes. Un modèle entraîné sur un historique antérieur à la réforme subira une rupture de distribution.
- Un modèle entraîné sur le simulateur ne doit jamais être appliqué à un client : seule la **méthode** se transpose.

**Validité de construit** : mesure-t-on le bon concept ?

- La cible est une démission codée dans AJIR, datée par la date de démission ou, à défaut, par la sortie moins un mois de préavis. Un motif mal codé (démission saisie « autre ») ou un préavis différent déplace l'étiquette.
- Le risque estimé porte sur un comportement, pas sur une intention : il ne mesure ni la satisfaction ni l'engagement, principaux antécédents du départ selon la littérature (chapitre 3).
- Le lift à la capacité mesure la concentration des démissions parmi les salariés signalés, pas l'utilité d'un entretien. Le facteur de Bradford mesure un volume d'absences courtes, pas un problème.

**Validité des conclusions statistiques** : avec environ 4 % de démissions, le nombre d'événements par fenêtre de test est faible (227 à 270 positifs par origine) et les intervalles de confiance sont larges. Le bootstrap groupé par salarié évite de les sous-estimer, mais il ignore les dépendances entre salariés d'une même équipe et les chocs communs à un mois : les intervalles sont probablement un peu trop étroits. L'AUC empilée mélange en outre des origines calibrées différemment ; l'AUC par origine varie de 0,577 à 0,685.

## 10.4 Perspectives

**Pilote sur données réelles.** C'est la prochaine étape indispensable. Elle suppose :

- l'accord d'un client et la déclaration du traitement à l'INPDP ;
- la mesure des délais réels de saisie, pour fixer les délais de repli au 90e ou 95e centile ;
- l'extraction du panel de variables sur autorisation écrite, et l'entraînement par un consultant hors du serveur de production ;
- le passage de la porte de promotion face au score à règles ;
- un test utilisateur avec deux ou trois RH du client ;
- une revue de réalisme du simulateur par ces mêmes RH.

**Intégration avec AJIR.** Le module est prêt : lien profond par matricule et ouverture par jeton signé (HMAC) à usage unique de 60 secondes ([docs/INTEGRATION_AJIR.md](../INTEGRATION_AJIR.md)). Reste le développement côté ArabSoft : entrée de menu AJIR et génération du jeton, qui ouvriraient à terme la voie à une authentification unique (SSO).

**Du risque à l'effet de l'action.** Le module répond à la question « qui risque de partir ? ». La RH se pose la question suivante : « pour qui un entretien, ou une révision salariale, changerait-il l'issue ? ». C'est l'objet de la **modélisation d'uplift**, qui estime l'effet incrémental d'une action dans un cadre causal (Gutierrez et Gérardy, 2017). Elle exige des données d'intervention, que le module enregistre déjà, et idéalement une part d'affectation contrôlée. Elle aiderait aussi à traiter la **performativité** de la prédiction : la décision prise sur la base du score modifie l'issue qu'il prédit (Perdomo et al., 2020).

**Un modèle à plusieurs horizons.** Un modèle à hasards discrets sur un panel à dates repères (Singer et Willett, 2003 ; van Houwelingen, 2007) donnerait une courbe de risque à 3, 6 et 12 mois et exploiterait les données récentes, au prix d'un protocole plus complexe. LightGBM pourrait être envisagé pour les grands clients, si la courbe d'apprentissage le justifie.

**Consolidation du produit.** Les priorités sont les suivantes :

- la hiérarchie reconstituée à la date consultée, pour la sécurité comme pour les anomalies ;
- la règle de visibilité appliquée à la détection d'anomalies ;
- la correction des défauts et des contrastes relevés par la campagne de bout en bout ;
- la mesure de performance sur le build final, avec le cache des agrégats ;
- l'exploitation des interventions au réentraînement ;
- l'évaluation des recommandations par sujet contre un effet observé, lors du pilote.

**Veille réglementaire.** Une proposition de réforme de la loi organique n° 2004-63 est à l'examen. Elle pourrait introduire l'interdiction des décisions fondées exclusivement sur un traitement automatisé et l'analyse d'impact obligatoire. La conception du module l'anticipe, mais la réforme devra être suivie, de même que le calendrier d'application du règlement européen sur l'IA pour les clients exposés à l'Europe.

## 10.5 Conclusion générale

Ce projet a montré qu'une aide à la décision RH prédictive peut être construite sur une stack modeste, sur le serveur du client, sans sacrifier la rigueur de l'évaluation ni la protection des salariés. Sa valeur principale n'est pas un algorithme. Elle tient à une discipline : ne jamais utiliser une donnée avant la date où elle était connue, évaluer dans le temps, mesurer l'incertitude, expliquer exactement, borner la décision par la capacité humaine et exclure ce qui ne doit pas être traité. Le simulateur a permis de rendre cette discipline mesurable. Seul un pilote sur données réelles dira si elle apporte, chez un client d'AJIR, la valeur qu'elle promet.
