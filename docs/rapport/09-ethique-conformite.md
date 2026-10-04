# Chapitre 9 — Éthique et conformité

Estimer le risque qu'un salarié démissionne, c'est traiter des données personnelles pour évaluer une personne dans sa relation de travail. Ce chapitre analyse le cadre juridique applicable aux clients tunisiens d'AJIR. Il présente ensuite les référentiels européens retenus pour les clients qui travaillent avec l'Europe, puis montre comment les exigences qui en découlent se traduisent dans la conception du module, et ce qui reste à la charge du client.

Nous parlons d'**analyse de conformité** et jamais d'un module « conforme » : la conformité est une propriété d'un traitement mis en œuvre par un responsable, dans un contexte donné, et non d'un logiciel. Ce chapitre n'est pas un avis juridique. Il doit être relu par le juriste ou le délégué à la protection des données du client.

## 9.1 Qualification du traitement

- **Responsable du traitement** : l'entreprise cliente d'AJIR, qui décide des finalités (anticiper les départs, suivre l'absentéisme) et des moyens (installation sur son serveur, paramètres, usage des résultats).
- **Éditeur** : ArabSoft fournit le logiciel. Dans une installation sur site, l'éditeur ne traite pas les données. Il devient sous-traitant s'il y accède, par exemple lorsqu'un consultant extrait le panel de variables pour réentraîner le modèle ([docs/EXPLOITATION.md](../EXPLOITATION.md), section 9).
- **Personnes concernées** : les salariés, y compris les salariés sortis, dont l'historique sert aux variables et à l'entraînement.
- **Finalité** : aide à la décision RH en matière de rétention et de suivi de l'absentéisme collectif. Sont **exclues** la décision automatique, la détection de fraude et la proposition automatique de rémunération (chapitre 4).
- **Nature** : un **profilage**, au sens où des aspects personnels (comportement probable de départ) sont évalués à partir de données.

## 9.2 Cadre tunisien : la loi organique n° 2004-63

La loi organique n° 2004-63 du 27 juillet 2004 porte sur la protection des données à caractère personnel (JORT n° 61 du 30 juillet 2004). Ses dispositions pertinentes pour le module sont résumées ci-dessous (Loi organique n° 2004-63, 2004).

**Déclaration préalable (art. 7 et 8).** Tout traitement est soumis à une déclaration préalable auprès de l'Instance nationale de protection des données à caractère personnel (INPDP). L'absence d'opposition de l'Instance dans un délai d'un mois vaut acceptation. La demande précise notamment le lieu et la durée de conservation. L'article 16 écarte l'application de ces articles (ainsi que des articles 27, 28, 31 et 47) au traitement, par l'employeur, des données relatives à la situation professionnelle du salarié lorsqu'il est « nécessaire au fonctionnement du travail et à son organisation ». Il n'est **pas certain** qu'une estimation prédictive du risque de démission relève de cette exception : elle ne sert pas au fonctionnement du travail mais à l'anticipation d'une décision du salarié. Par prudence, nous recommandons au client de déclarer le traitement. Cette démarche est à sa charge, en tant que responsable du traitement.

**Loyauté, proportionnalité, dignité (art. 9 et 11).** Le traitement doit respecter la dignité des personnes et être loyal et proportionné à sa finalité. C'est le fondement de nos choix de minimisation (section 9.5).

**Données de santé (art. 14, 62 à 65).** Le traitement des données relatives à la santé est interdit par principe (art. 14), sauf exceptions (consentement exprès, intérêts vitaux, etc.), et relève d'un régime propre. Il est notamment réservé aux médecins ou aux personnes tenues au secret professionnel (art. 63). La violation de ces règles est sanctionnée pénalement (art. 87). Le module ne peut donc pas utiliser les motifs d'absence pour maladie ou maternité comme variables : nous ne les importons que comme **catégorie**, et nous les excluons de tout calcul individuel (section 9.5).

**Sécurité (art. 18 et 19).** Le responsable doit prendre toutes les précautions nécessaires pour assurer la sécurité des données. L'article 19 énumère notamment : le contrôle des accès, le blocage des usages non autorisés, la **traçabilité a posteriori** (qui a accédé à quelles données, quand) et des copies de réserve sécurisées. Ces exigences correspondent directement au journal d'audit en ajout seul et aux sauvegardes vérifiées du module. L'article 22 impose en outre des conditions (nationalité tunisienne, résidence en Tunisie, absence d'antécédents judiciaires) au responsable, à ses agents et au sous-traitant, ce que le client doit vérifier s'il fait appel à un consultant externe.

**Droits des personnes (art. 32 à 42).** Le salarié dispose d'un **droit d'accès** à ses données, avec une copie sous une forme intelligible lorsqu'elles sont traitées par des procédés automatisés (art. 32), dans un délai d'un mois (art. 38). Il dispose aussi d'un **droit d'opposition** pour des raisons valables, légitimes et sérieuses, sauf si le traitement est prévu par la loi. Selon l'article 42, « l'opposition suspend immédiatement le traitement ».

**Conservation (art. 45).** Les données sont détruites à l'expiration de la durée déclarée ou lorsqu'elles ne sont plus nécessaires à la finalité, selon les formes prévues par la loi.

**Absence de règle sur la décision automatisée.** La loi de 2004 ne contient pas de disposition spécifique sur les décisions fondées exclusivement sur un traitement automatisé ou sur le profilage. Un projet de réforme (projet de loi organique n° 25/2018) n'a pas été adopté. Une proposition de loi organique déposée en 2025 est à l'examen en commission à l'Assemblée des représentants du peuple en 2026. D'après la presse, elle prévoit notamment l'interdiction des décisions fondées exclusivement sur un traitement automatisé et des analyses d'impact (Business News, 2026 ; African Manager, 2026). Nous n'avons pas trouvé trace de son adoption à la date de rédaction. Concevoir dès maintenant le module comme une aide à la décision, avec un humain dans la boucle, anticipe cette évolution.

L'**INPDP**, instituée par l'article 75, reçoit les déclarations, délivre les autorisations, contrôle les traitements et peut les interdire (art. 76 à 81).

## 9.3 Convention 108 du Conseil de l'Europe

La Tunisie a adhéré à la Convention pour la protection des personnes à l'égard du traitement automatisé des données à caractère personnel (STE n° 108) et à son protocole additionnel (STE n° 181) par la loi organique n° 2017-42 du 30 mai 2017. La Convention y est entrée en vigueur le 1er novembre 2017 (Loi organique n° 2017-42, 2017 ; Conseil de l'Europe, 2019). Elle consacre les principes de loyauté, de finalité, de proportionnalité, d'exactitude et de sécurité, ainsi qu'un régime renforcé pour les catégories particulières de données, dont la santé.

La Tunisie a signé le 24 mai 2019 le protocole d'amendement (STCE n° 223, dite « Convention 108+ »). À notre connaissance, elle ne l'a pas ratifié, et ce protocole n'est pas encore en vigueur. Il introduit notamment le droit de ne pas être soumis à une décision fondée uniquement sur un traitement automatisé sans que son point de vue soit pris en compte. Ce droit n'est donc pas opposable aujourd'hui en Tunisie, mais il indique la direction prise par le droit.

## 9.4 Référentiels européens pour les clients exposés à l'Europe

Certains clients d'AJIR travaillent avec des groupes européens, ou pourraient y être soumis s'ils ont un établissement dans l'Union. Pour eux, et comme bonne pratique pour tous, nous utilisons deux textes européens comme **référentiels**, sans prétendre qu'ils s'appliquent de plein droit à une PME tunisienne qui traite les données de ses salariés en Tunisie.

### 9.4.1 RGPD

Le règlement (UE) 2016/679 (RGPD) ne s'applique hors de l'Union qu'en cas d'établissement dans l'Union, ou de ciblage ou de suivi de personnes qui s'y trouvent (art. 3) (Règlement (UE) 2016/679, 2016). Quatre articles servent de référence :

- **art. 9** : les données concernant la santé sont une catégorie particulière, dont le traitement est interdit sauf exceptions ;
- **art. 22** : droit de ne pas faire l'objet d'une décision fondée exclusivement sur un traitement automatisé, y compris le profilage, produisant des effets juridiques ou affectant la personne de manière significative ;
- **art. 35** : analyse d'impact relative à la protection des données (AIPD) pour les traitements susceptibles d'engendrer un risque élevé, notamment l'évaluation systématique d'aspects personnels ;
- **art. 88** : règles propres au traitement dans le cadre des relations de travail.

### 9.4.2 Règlement européen sur l'intelligence artificielle (AI Act)

Le règlement (UE) 2024/1689 classe à **haut risque** les systèmes d'IA destinés à prendre des décisions affectant les conditions de la relation de travail, la promotion ou le licenciement, ou à surveiller et évaluer la performance et le comportement des personnes (annexe III, point 4, b). Un système de l'annexe III qui effectue un **profilage** de personnes physiques est toujours considéré comme à haut risque (art. 6, § 3) (Règlement (UE) 2024/1689, 2024). Notre module, qui estime un risque individuel de démission, relèverait de cette catégorie s'il était utilisé dans l'Union. Plusieurs obligations en découlent : gestion des risques, qualité et gouvernance des données, documentation technique, journalisation, transparence envers l'utilisateur, contrôle humain, exactitude et robustesse. Pour l'employeur qui déploie le système, elles comprennent aussi l'information préalable des représentants des travailleurs et des travailleurs concernés (art. 26, § 7). Le règlement interdit par ailleurs la reconnaissance des émotions sur le lieu de travail (art. 5, § 1, f), ce que le module ne fait pas.

Le calendrier d'application des obligations propres aux systèmes à haut risque de l'annexe III a été reporté au 2 décembre 2027 par le règlement dit « Digital Omnibus » sur l'IA (règlement (UE) 2026/1744, publié en juillet 2026) (Office des publications de l'Union européenne, 2026).

> **À CONFIRMER** : références et dates du règlement (UE) 2026/1744 à vérifier sur EUR-Lex (source consultée : notice de l'Office des publications ; EUR-Lex était inaccessible lors de la vérification).

## 9.5 Traduction dans la conception

Le tableau 9.1 relie chaque exigence, tunisienne ou issue des référentiels, aux mesures du module et à leur état.

*Tableau 9.1 — Exigences et mesures.*

| Exigence | Source | Mesure dans le module | État |
|---|---|---|---|
| Pas de donnée de santé dans un calcul individuel | Loi 2004-63, art. 14 et 62-65 ; RGPD art. 9 | Motif réduit à une catégorie ; maladie et maternité exclues des variables, y compris par masquage des jours dans les pointages ; propriété testée ; anomalies d'absentéisme « hors santé » (ADR-009) | Réalisé |
| Minimisation, proportionnalité | Loi 2004-63, art. 11 ; Convention 108 | DTO par rôle en liste blanche ; manager sans salaire, probabilité ni signal individuel d'absentéisme ; indicateurs masqués sous 5 personnes ; administrateur sans donnée RH, qui ne voit dans les rejets d'import que le matricule (ni montant, ni date ou catégorie d'absence) ; prévisions des IA par sujet agrégées ; sexe, âge, situation familiale et gouvernorat exclus des variables (ADR-007, ADR-011) | Réalisé |
| Pas de décision exclusivement automatisée | RGPD art. 22 ; Convention 108+ ; proposition de réforme tunisienne | Aucune action automatique ; recommandations proposées puis réalisées ou rejetées par la RH ; vocabulaire « estimation », « facteurs associés » ; niveau borné par la capacité humaine de traitement ; promotion d'un modèle par un humain, en ligne de commande | Réalisé |
| Contrôle humain effectif | AI Act, art. 14 et 26 | Explication exacte par groupe, historique, limites affichées ; what-if marqué « estimation non causale » ; porte de promotion (backtest, calibration, équité) à décider par un humain ; règle de démarrage à froid (B0 sous 30 démissions observées, probabilité « indicative » sous 150) | Réalisé ; porte de promotion non automatisée |
| Transparence | Loi 2004-63, art. 32 ; AI Act | Page Transparence (modèle, variables, métriques, calibration, équité, golden, versions, démarrage à froid) ; fiche du simulateur ; note d'information type | Réalisé (note à adapter par le client) |
| Sécurité et traçabilité | Loi 2004-63, art. 18-19 | Installation sur site, TLS, argon2id, sessions révocables à expiration glissante (2 h d'inactivité, 10 h au plus), verrouillage et limitation de débit, audit en ajout seul des lectures sensibles et des refus (y compris à l'entrée des pages), sauvegardes vérifiées (chapitre 5) | Réalisé |
| Exactitude des données | Convention 108 | Contrôles de qualité, rejets motivés, blocage du calcul sous le seuil de qualité, visibilité à la date de saisie (chapitre 6) | Réalisé |
| Équité | AI Act (gouvernance des données) | Rapport d'équité par sexe et âge, variables proxys, décision humaine documentée (chapitre 7) | Réalisé (rapport) |
| Droit d'accès | Loi 2004-63, art. 32 | Écran RH « Droit d'accès » : registre des demandes, export audité (JSON et CSV par rubrique, libellés en français) des données, variables, estimations, recommandations et demandes d'un salarié | Réalisé |
| Droit d'opposition | Loi 2004-63, art. 42 | Opposition enregistrée par la RH (table `employee_opposition`, auditée) : purge immédiate des estimations, facteurs, variables et recommandations ouvertes ; salarié exclu des variables, du panel d'entraînement exporté, du scoring, du what-if et des étapes IA | Réalisé |
| Conservation limitée | Loi 2004-63, art. 45 | Durées proposées : sauvegardes 30 jours, exports déposés 90 jours, prédictions 24 mois (hors calcul publié), audit 12 mois avant archivage hors ligne ; purge par `scripts/retention.ts`, simulation puis application tracée ([docs/EXPLOITATION.md](../EXPLOITATION.md), section 7) | Réalisé ; durées à valider avec le client |
| Information des représentants du personnel | AI Act, art. 26 § 7 (référentiel) | Note d'information type aux salariés et complément pour les instances représentatives ([docs/conformite/note-information.md](../conformite/note-information.md)) | Rédigée ; à adapter et diffuser par le client |

Les deux droits qui manquaient au premier état du module, et qui touchent des **droits** et non des fonctionnalités, sont désormais outillés.

Le **droit d'accès** est exercé depuis l'écran RH « Droit d'accès » : la RH recherche le salarié, enregistre la demande et produit un export intelligible (23 rubriques : identité, contrats, sortie, carrière, paie, pointages, absences, formations, évaluations, variables calculées, estimations et facteurs, recommandations et interventions, alertes, risques de formation, recommandations thématiques, signaux d'absentéisme, compte applicatif, demandes, état de l'opposition et journal des accès qui le concernent, l'auteur n'y étant désigné que par son rôle), en JSON et en CSV. L'export est audité. Les absences pour santé y figurent comme ce qu'elles sont, des faits importés d'AJIR, jamais comme variable ou score.

Le **droit d'opposition** suspend immédiatement le traitement selon l'article 42. Son enregistrement supprime dans la même transaction les estimations, facteurs, variables calculées, recommandations encore proposées, alertes de risque de départ et risques individuels de formation du salarié ; les décisions déjà prises par la RH sont conservées. Le salarié est ensuite exclu à chaque étape : variables mensuelles, panel exporté pour un réentraînement, scoring, simulation *what-if* (refus explicite), recommandations et étapes IA par sujet. La levée de l'opposition ne restaure rien : le salarié redevient éligible au calcul suivant.

## 9.6 Questions éthiques au-delà du droit

### 9.6.1 Le risque de stigmatisation

Un salarié classé « Élevé » pourrait être traité différemment : écarté d'un projet, d'une formation, d'une promotion, au motif qu'il « va partir ». Le module limite ce risque de trois façons :

- le manager ne voit ni probabilité ni chiffre, seulement un niveau et des **catégories** de facteurs ;
- le libellé est « exposition au risque », avec le rappel qu'une prédiction est une estimation à confirmer lors d'un entretien ;
- les recommandations ne proposent que des actions **favorables** au salarié : entretien, révision salariale, examen de la charge, formation.

Le cahier des charges laisse ouverte la question de l'action que doit déclencher un niveau « Élevé » côté manager : entretien de rétention ou simple signalement. Elle doit être tranchée avec le client, et l'usage prévu doit figurer dans la note d'information.

### 9.6.2 Une prédiction qui change ce qu'elle prédit

Quand une prédiction guide une action, elle modifie l'issue qu'elle cherchait à prévoir : c'est la **prédiction performative** (Perdomo et al., 2020). Si la RH retient un salarié signalé, la démission n'a pas lieu, et un réentraînement naïf apprendrait que le signal était faux. Le module enregistre chaque action réalisée sous forme d'**intervention** datée pour pouvoir en tenir compte (censure au réentraînement), et il s'interdit tout indicateur de « départs évités », qui supposerait une inférence causale qu'il ne fait pas. L'exploitation de ces interventions au réentraînement reste à outiller (chapitre 10).

### 9.6.3 Absentéisme : collectif d'abord, jamais de soupçon

La détection d'anomalies d'absentéisme est orientée vers le **collectif** : une dérive dans une équipe signale un problème d'organisation ou de charge, pas une faute. Le signal individuel (facteur de Bradford) est réservé à la RH et formulé « à vérifier avec le salarié, sans présumer de sa cause ». Le module ne fait aucune détection de fraude.

L'évaluation a d'ailleurs mis ce principe à l'épreuve (chapitre 8, section 8.5.6). Des tests individuels qui qualifient un motif, comme des absences concentrées les lundis et vendredis ou collées aux ponts, se sont montrés plus précis que le facteur de Bradford. Nous ne les avons pas intégrés : nommer un tel motif pour une personne revient à présumer d'un abus, ce qui relève de la détection de fraude exclue par le cahier des charges.

### 9.6.4 Le simulateur n'est pas une preuve de valeur

Présenter des résultats obtenus sur données simulées comme une validation « sur données réelles » serait trompeur. Le rapport distingue systématiquement la preuve de méthode, sur simulateur, de la preuve de valeur, qui exigera un pilote sur données client. Un modèle entraîné sur le simulateur ne doit jamais scorer un vrai client.

## 9.7 Livrables de conformité

Le cahier des charges prévoit quatre livrables de conformité, à valider avec le client avant toute mise en service. Les trois premiers sont rédigés dans [docs/conformite/](../conformite/) :

1. une **analyse d'impact simplifiée** ([aipd.md](../conformite/aipd.md)) : description du traitement, nécessité et proportionnalité, risques pour les salariés (stigmatisation, erreur, biais, fuite de données, détournement de finalité, décision automatisée) cotés en gravité et vraisemblance, mesures du tableau 9.1, risques résiduels et plan d'action ;
2. une **note d'information type** aux salariés, avec un complément pour les instances représentatives du personnel ([note-information.md](../conformite/note-information.md)) : finalité, données utilisées et exclues, logique générale, qui voit quoi, durées de conservation, droits ;
3. une **procédure d'exercice des droits** d'accès, d'opposition et de rectification ([procedure-exercice-des-droits.md](../conformite/procedure-exercice-des-droits.md)), qui s'appuie sur l'écran « Droit d'accès », décrit les purges et l'archivage du journal d'audit ; s'y ajoute un **registre des traitements** ([registre-traitements.md](../conformite/registre-traitements.md)) ;
4. la **déclaration à l'INPDP**, à la charge du client, qui peut reprendre le registre.

Ces documents sont des modèles : les durées de conservation, l'usage du niveau « Élevé » côté manager et les destinataires restent à arrêter avec le client et son délégué à la protection des données.

## 9.8 Conclusion

Le cadre tunisien impose l'essentiel : déclaration, sécurité et traçabilité, interdiction de traiter les données de santé, droits d'accès et d'opposition. Les référentiels européens et la Convention 108+ indiquent la direction : contrôle humain, analyse d'impact, transparence, information des représentants du personnel. La conception du module répond à la plupart de ces exigences par construction. Elle exclut la santé, minimise par rôle, laisse la décision à l'humain et trace les accès. Les droits d'accès et d'opposition sont outillés et tracés, la conservation est bornée par un outil de purge, et les livrables documentaires (AIPD, note d'information, procédure, registre) sont rédigés sous forme de modèles ; il reste au client à les valider, à arrêter les durées de conservation et à déclarer le traitement.
