# Chapitre 9 — Éthique et conformité

Estimer le risque qu'un salarié démissionne, c'est traiter des données personnelles pour évaluer une personne dans sa relation de travail. Ce chapitre analyse le cadre juridique applicable aux clients tunisiens d'AJIR. Il présente ensuite les référentiels européens retenus pour les clients qui travaillent avec l'Europe, puis montre comment les exigences qui en découlent se traduisent dans la conception du module, et ce qui reste à la charge du client. La section 9.7 examine enfin les garde-fous des fonctions ajoutées en fin de projet : IA générative facultative, assistant d'aide, comparaison des interventions et profils types de départs.

Nous parlons d'**analyse de conformité** et jamais d'un module « conforme » : la conformité est une propriété d'un traitement mis en œuvre par un responsable, dans un contexte donné, et non d'un logiciel. Ce chapitre n'est pas un avis juridique. Il doit être relu par le juriste ou le délégué à la protection des données du client.

## 9.1 Qualification du traitement

- **Responsable du traitement** : l'entreprise cliente d'AJIR, qui décide des finalités (anticiper les départs, suivre l'absentéisme) et des moyens (installation sur son serveur, paramètres, usage des résultats).
- **Éditeur** : ArabSoft fournit le logiciel. Dans une installation sur site, l'éditeur ne traite pas les données. Il devient sous-traitant s'il y accède, par exemple lorsqu'un consultant extrait le panel de variables pour réentraîner le modèle ([docs/EXPLOITATION.md](../EXPLOITATION.md), section 9).
- **Éditeur d'une API d'IA générative** : il n'intervient que si le client active l'une des deux options de reformulation décrites à la section 9.7.1. Il devient alors un sous-traitant situé hors de Tunisie ; dans la configuration livrée, aucune donnée ne sort de l'installation ([ADR-014](../adr/014-ia-generative-facultative-hors-donnees-rh.md)).
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
| Minimisation, proportionnalité | Loi 2004-63, art. 11 ; Convention 108 | DTO par rôle en liste blanche ; manager sans salaire, probabilité ni signal individuel d'absentéisme ; indicateurs masqués sous 5 personnes ; administrateur sans donnée RH, qui ne voit dans les rejets d'import que le matricule (ni montant, ni date ou catégorie d'absence) ; prévisions des IA par sujet agrégées ; sexe, âge, situation familiale et gouvernorat exclus des variables (ADR-007, ADR-011) ; profils types de départs et comparaison appariée des interventions réservés à la RH, agrégés, sans aucun salarié étiqueté ; assistant d'aide filtré par rôle avant le classement des passages (section 9.7) | Réalisé |
| Pas de décision exclusivement automatisée | RGPD art. 22 ; Convention 108+ ; proposition de réforme tunisienne | Aucune action automatique ; recommandations proposées puis réalisées ou rejetées par la RH ; vocabulaire « estimation », « facteurs associés » ; niveau borné par la capacité humaine de traitement ; promotion d'un modèle par un humain, en ligne de commande ; recherche des leviers : pistes « à discuter lors d'un échange, pas une décision », rien n'est enregistré hormis l'audit | Réalisé |
| Contrôle humain effectif | AI Act, art. 14 et 26 | Explication exacte par groupe, historique, limites affichées ; what-if marqué « estimation non causale » ; porte de promotion (backtest, calibration, équité) à décider par un humain ; règle de démarrage à froid (B0 sous 30 démissions observées, probabilité « indicative » sous 150) ; recommandations « remplacées » par un recalcul comptées à part, hors du taux d'adoption et des rejets (section 9.7.5) | Réalisé ; porte de promotion non automatisée |
| Transparence | Loi 2004-63, art. 32 ; AI Act | Page Transparence (modèle, variables, métriques, calibration, équité, golden, versions, démarrage à froid) ; fiche du simulateur ; note d'information type ; méthode de rédaction affichée sous la synthèse du mois ; couverture mesurée des fourchettes de prévision affichée, y compris quand elle est sous la cible | Réalisé (note à adapter par le client ; couverture affichée après promotion des modèles v2, chapitre 10) |
| Aucune lecture causale présentée comme un constat | Loi 2004-63, art. 9 et 11 (loyauté) ; AI Act (exactitude, transparence) | Comparaison appariée des interventions intitulée « estimation non causale », mention « estimation sous hypothèses », encadré « Ce que ce chiffre ne dit pas », aucun nombre de départs ; textes générés refusés s'ils contiennent une formulation causale ; aucun indicateur de « départs évités » (section 9.7.3) | Réalisé |
| Pas de flux sortant sans cadre | Cahier des charges (traitement sur site) ; loi 2004-63 (transfert à l'étranger) ; RGPD, chapitre V (référentiel) | Synthèse et assistant sans IA générative par défaut ; reformulation facultative, activée seulement par une clé dédiée, jamais sur des données individuelles ; synthèse : liste blanche typée d'agrégats non nominatifs ; assistant : documentation seule, aucune donnée RH (question et extraits d'aide), question non transmise si elle contient un matricule ou une adresse e-mail ; repli automatique (ADR-014) | Réalisé ; activation subordonnée à l'avis du juriste, à l'AIPD (§ 7 et 8) et au registre |
| Sécurité et traçabilité | Loi 2004-63, art. 18-19 | Installation sur site, TLS, argon2id, sessions révocables à expiration glissante (2 h d'inactivité, 10 h au plus), verrouillage et limitation de débit, audit en ajout seul des lectures sensibles et des refus (y compris à l'entrée des pages), sauvegardes vérifiées (chapitre 5) ; appels d'IA générative et questions de l'assistant audités sans leur contenu | Réalisé |
| Exactitude des données | Convention 108 | Contrôles de qualité, rejets motivés, blocage du calcul sous le seuil de qualité, visibilité à la date de saisie (chapitre 6) | Réalisé |
| Équité | AI Act (gouvernance des données) | Rapport d'équité par sexe et âge, variables proxys, décision humaine documentée (chapitre 7) ; audit d'équité des profils types de départs (V de Cramér profil × sexe 0,048, profil × tranche d'âge 0,269), attributs sensibles exclus du regroupement (section 9.7.4) | Réalisé (rapports) ; lien indirect des profils à l'âge signalé |
| Droit d'accès | Loi 2004-63, art. 32 | Écran RH « Droit d'accès » : registre des demandes, export audité (JSON et CSV par rubrique, libellés en français) des données, variables, estimations, recommandations et demandes d'un salarié | Réalisé |
| Droit d'opposition | Loi 2004-63, art. 42 | Opposition enregistrée par la RH (table `employee_opposition`, auditée) : purge immédiate des estimations, facteurs, variables et recommandations ouvertes ; salarié exclu des variables, du panel d'entraînement exporté, du scoring, du what-if et des étapes IA, ainsi que de la recherche des leviers (refus), de la comparaison appariée et du classement en profils (compté parmi les départs, jamais classé) | Réalisé |
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

Quand une prédiction guide une action, elle modifie l'issue qu'elle cherchait à prévoir : c'est la **prédiction performative** (Perdomo et al., 2020). Si la RH retient un salarié signalé, la démission n'a pas lieu, et un réentraînement naïf apprendrait que le signal était faux. Le module enregistre chaque action réalisée sous forme d'**intervention** datée pour pouvoir en tenir compte (censure au réentraînement), et il s'interdit tout indicateur de « départs évités », qui supposerait une inférence causale qu'il ne fait pas. Depuis le 04/10/2026, ces interventions alimentent une comparaison appariée, présentée comme une estimation non causale (section 9.7.3). Leur exploitation au réentraînement reste à outiller (chapitre 10).

### 9.6.3 Absentéisme : collectif d'abord, jamais de soupçon

La détection d'anomalies d'absentéisme est orientée vers le **collectif** : une dérive dans une équipe signale un problème d'organisation ou de charge, pas une faute. Le signal individuel (facteur de Bradford) est réservé à la RH et formulé « à vérifier avec le salarié, sans présumer de sa cause ». Le module ne fait aucune détection de fraude.

L'évaluation a d'ailleurs mis ce principe à l'épreuve (chapitre 8, section 8.5.6). Des tests individuels qui qualifient un motif, comme des absences concentrées les lundis et vendredis ou collées aux ponts, se sont montrés plus précis que le facteur de Bradford. Nous ne les avons pas intégrés : nommer un tel motif pour une personne revient à présumer d'un abus, ce qui relève de la détection de fraude exclue par le cahier des charges.

### 9.6.4 Le simulateur n'est pas une preuve de valeur

Présenter des résultats obtenus sur données simulées comme une validation « sur données réelles » serait trompeur. Le rapport distingue systématiquement la preuve de méthode, sur simulateur, de la preuve de valeur, qui exigera un pilote sur données client. Un modèle entraîné sur le simulateur ne doit jamais scorer un vrai client.

## 9.7 Garde-fous des fonctions ajoutées le 04/10/2026

Les fonctions livrées en fin de projet touchent des zones sensibles : un service externe d'IA générative, des questions saisies en texte libre, une estimation de l'effet des actions RH et un regroupement des départs volontaires. Elles suivent les règles du reste du module : aucune décision automatique, aucune donnée de santé, aucune lecture causale, aucune donnée RH pour l'administrateur. Cette section en décrit les garde-fous et les limites.

### 9.7.1 IA générative : une extension facultative, désactivée par défaut

Le cahier des charges exclut un assistant conversationnel fondé sur un grand modèle de langage (*Won't*, chapitre 4) et impose un traitement sur site. Deux demandes de fin de projet s'en approchent : une synthèse du mois rédigée en quelques phrases, et un assistant d'aide qui répond à des questions sur la méthode à partir de la documentation. Nous les avons retenues comme un **écart assumé** au cahier des charges, encadré par une fiche de décision : IA générative facultative, désactivée par défaut, jamais sur des données individuelles ([ADR-014](../adr/014-ia-generative-facultative-hors-donnees-rh.md)) :

- **le cœur des deux fonctions n'utilise aucun modèle de langage** et fonctionne hors ligne. La synthèse est produite par des phrases types déterministes à partir des agrégats du rôle ; l'assistant est une recherche plein texte locale dans la documentation, qui renvoie un extrait et ses sources ;
- **la reformulation par IA générative est une option désactivée par défaut**. Elle n'est active que si l'exploitant définit une clé propre à chaque fonction. Sans clé, aucun flux ne sort de l'installation, et la variable générique du fournisseur n'active rien ;
- **les données transmises sont bornées** quand l'option est active. La synthèse n'envoie qu'une liste blanche typée de 28 champs d'agrégats non nominatifs, déjà affichés pour le rôle : ni nom, ni matricule, ni service ou équipe nommés, ni salaire, ni probabilité, ni catégorie d'absence ; les valeurs masquées côté manager (moins de 5 personnes) partent masquées. L'assistant n'envoie que la question et au plus quatre extraits de documentation, **jamais de donnée RH** ni de résultat de calcul ;
- **le texte généré est vérifié avant affichage** : chaque nombre doit figurer dans les données fournies, chaque citation doit renvoyer à un passage fourni, une formulation causale est refusée. En cas de refus, d'erreur ou de délai dépassé, la version sans IA s'affiche automatiquement ;
- **la reformulation est signalée et tracée** : la synthèse reformulée porte la mention « Texte rédigé automatiquement » et le nom du modèle, et chaque appel est audité **sans son contenu** ([RESULTATS_IA_SYNTHESE.md](../RESULTATS_IA_SYNTHESE.md), [RESULTATS_ASSISTANT.md](../RESULTATS_ASSISTANT.md)).

Activer une option crée un transfert vers un sous-traitant situé hors de Tunisie. L'analyse d'impact a donc été complétée de deux sections ([aipd.md](../conformite/aipd.md)). La section 7 traite la synthèse : réidentification à partir des agrégats d'une petite équipe (R11), chiffre inventé ou lecture causale (R12), transfert hors de Tunisie sans cadre (R13), dépendance à un service externe (R14). La section 8 traite l'assistant, dont la question est un texte libre qui peut contenir une donnée personnelle malgré son objet. Elle cote trois risques après mesures, en vraisemblance (V) et en gravité (G) sur une échelle de 1 à 4 :

- **R15**, donnée personnelle saisie dans la question puis transmise à l'éditeur de l'API (V 2, G 2) : option désactivée par défaut, filtre des matricules et des adresses e-mail avant envoi, question jamais enregistrée ni journalisée ;
- **R16**, passage réservé à un autre rôle révélé par une réponse (V 1, G 2) : rôle lu dans la session, filtre appliqué avant le classement, corpus sans donnée individuelle ;
- **R17**, réponse inexacte ou consigne détournée par le texte de la question (V 1, G 1) : réponse limitée aux passages fournis, citations et nombres vérifiés, question traitée comme une donnée et non comme une instruction.

Plusieurs points restent ouverts avant toute activation, et relèvent du responsable du traitement. Il n'est pas certain que les agrégats d'une petite équipe échappent à la notion de donnée personnelle. Le régime du transfert vers l'étranger prévu par la loi n° 2004-63 doit être vérifié, avec une autorisation de l'INPDP le cas échéant. La clause de sous-traitance et la durée de conservation des requêtes chez l'éditeur de l'API sont à vérifier au contrat. L'option activée doit enfin être inscrite au registre et portée à la connaissance des salariés et des instances représentatives. Pour l'assistant, les noms et les descriptions de situations individuelles échappent au filtre : la mesure retenue est une consigne aux utilisateurs de ne pas en saisir.

Le règlement européen sur l'IA, retenu comme référentiel, prévoit des obligations de transparence pour les contenus générés (art. 50). La mention affichée sous la synthèse va dans ce sens ; nous n'avons pas qualifié l'application de cet article à un usage interne à l'entreprise.

### 9.7.2 Assistant d'aide : cloisonnement par rôle et audit sans contenu

L'assistant d'aide ([RESULTATS_ASSISTANT.md](../RESULTATS_ASSISTANT.md)) applique la séparation des tâches du module à la documentation elle-même :

- le corpus ne contient que la documentation et l'aide : aucune donnée de collaborateur, aucun chiffre issu de la base ;
- chaque passage porte les rôles autorisés à le lire. Le rôle est lu dans la session, jamais dans la requête, et le filtre est appliqué dans la recherche, **avant le classement** ; le service refiltre ensuite les passages trouvés. L'administrateur ne lit donc aucun passage de méthodologie ni de pilotage RH, et le manager aucun passage réservé à la RH (salaires, pourcentage de risque, signaux individuels d'absentéisme) ;
- la question n'est enregistrée ni en base ni dans les journaux. L'audit retient le compte, la date, la longueur de la question, le nombre de passages et le mode de réponse, **jamais son texte**. Les réponses reformulées gardées en mémoire sont indexées par une empreinte de la question, jamais par la question en clair ;
- sans passage pertinent, l'assistant répond « L'aide ne couvre pas cette question » plutôt que d'inventer une réponse.

La recherche est lexicale et non sémantique : une question formulée loin du vocabulaire de l'aide peut rester sans réponse. C'est une limite d'usage, sans effet sur la protection des données.

### 9.7.3 Une lecture non causale imposée

La page des interventions compare désormais, par type d'action, chaque collaborateur suivi à un collaborateur non suivi au profil proche, évalué le même mois, par appariement sur un score de propension ([RESULTATS_IA_INTERVENTIONS.md](../RESULTATS_IA_INTERVENTIONS.md)). Cette comparaison corrige un biais réel de la lecture « avant / après ». Sur le simulateur, sans aucun effet injecté, 19 à 21 % des suivis voient leur niveau de risque baisser par simple retour vers la moyenne, alors que l'écart apparié reste proche de zéro.

Elle ne tient compte, en revanche, que des variables enregistrées dans AJIR. Le simulateur ne modélisant aucune action RH, la méthode a été validée sur des suivis fictifs, avec un effet connu injecté. Quand le choix des suivis dépend d'une variable non observée, l'estimation change de signe (+3,9 points pour un effet réel de −4,9) et la fourchette à 95 % ne contient l'effet réel que dans 23 % des réplications. Le verdict affiche pourtant « groupes comparables » dans 35 réplications sur 40 : les diagnostics d'équilibre ne voient que ce qui est mesuré. Avec une centaine de suivis, un effet de 1 à 2 points sur la démission reste en outre indétectable.

Nous en avons tiré des règles d'affichage plutôt qu'une promesse :

- la section s'intitule « Comparaison avec des collaborateurs similaires (estimation non causale) » et précise « estimation sous hypothèses ». L'encadré « Ce que ce chiffre ne dit pas » rappelle qu'elle ne mesure pas l'effet de l'action, et qu'un facteur non observé a inversé le sens de l'écart sur données simulées alors que les groupes paraissaient comparables ;
- aucun nombre de départs n'est affiché ni déduit par multiplication par l'effectif ; l'écart est affiché en bleu neutre, jamais en vert « favorable » ;
- aucun chiffre n'est affiché sous 20 suivis comparables pour un type d'action, ni sous 20 paires mesurées pour un indicateur ;
- la section est réservée à la RH. Aucun nom, identifiant, score de propension ni paire ne sort de la couche d'accès aux données, et les salariés opposés au traitement sont exclus des suivis comme des témoins.

Sur la base de démonstration, une seule intervention est enregistrée : chaque type d'action affiche « Effectif insuffisant pour comparer », sans chiffre.

La même règle vaut pour les autres fonctions. La recherche des leviers les plus efficaces présente ses pistes comme « à discuter lors d'un échange, pas une décision » et comme une « estimation du modèle, non causale » ([RESULTATS_IA_LEVIER.md](../RESULTATS_IA_LEVIER.md)). La vérification des textes générés refuse les formulations causales (« à cause », « explique », « évités »). Aucun écran n'affiche de « départs évités ».

### 9.7.4 Audit d'équité des profils types de départs

Les profils types de départs ([RESULTATS_IA_TYPOLOGIE.md](../RESULTATS_IA_TYPOLOGIE.md)) regroupent les départs volontaires selon sept variables professionnelles observées à la veille du départ : ancienneté, délai depuis la dernière promotion, augmentation sur 12 mois, position salariale relative, heures supplémentaires, absences hors santé et heures de formation. Les exclusions sont délibérées :

- le sexe, l'âge, la situation familiale, le gouvernorat et toute donnée de santé ;
- les retards, la régularité d'arrivée, les jours sans badge, les absences courtes et le facteur de Bradford, pour que rien ne ressemble à une détection d'abus ;
- les absences ne nomment jamais un profil, même quand elles en sont le trait le plus marqué.

Le code refuse un modèle qui citerait une variable hors de la liste blanche ou un libellé sensible.

Un attribut exclu peut toutefois revenir par un indicateur indirect. L'audit d'équité mesure donc, hors ligne et sur des agrégats, l'association entre le profil et les attributs exclus, par le V de Cramér (0 : aucune association ; 1 : association complète) :

- **sexe** : V = 0,048. La part de femmes varie de 34 % à 40 % selon le profil, pour 38 % sur l'ensemble des départs ; aucun profil n'est un indicateur indirect du sexe ;
- **âge** : V = 0,269 (0,339 avec une première spécification, écartée). L'âge est exclu, mais l'ancienneté et la carrière en sont des indicateurs indirects : le profil « Arrivées récentes » compte 39 % de moins de 30 ans, contre 30 % sur l'ensemble. Lire ces profils comme des profils d'âge serait un contresens, et aucune action ne doit viser une tranche d'âge.

Les autres garde-fous portent sur la diffusion. Les profils sont réservés à la RH : dans une hiérarchie de 5 à 12 personnes, un manager pourrait en déduire le profil d'un départ, et l'administrateur reçoit un refus audité. Aucun salarié n'est étiqueté : l'affectation d'un départ au profil le plus proche sert seulement à compter. Un profil de moins de 5 départs est masqué, y compris pour la RH, et les salariés opposés au traitement sont comptés parmi les départs sans jamais être classés.

La principale limite est la **stabilité**. Aucune partition de 3 à 6 profils ne passe la règle de stabilité retenue ; la partition choisie, la plus stable, a un indice de Rand ajusté de 0,51 [0,25 ; 0,86] sur 200 rééchantillonnages. Les profils simplifient un continuum. Ils doivent être réentraînés et revalidés, équité comprise, sur les données d'un client avant toute communication.

### 9.7.5 Mesurer fidèlement les décisions humaines

Le contrôle humain suppose que les décisions de la RH soient mesurées sans biais. L'audit produit du 04/10/2026 a relevé un défaut sur ce point ([AUDIT_PRODUIT.md](../qa/AUDIT_PRODUIT.md), section E). Les 110 recommandations du premier calcul, fondé sur le score à règles, avaient été retirées lors du recalcul avec le modèle entraîné ([DEMO.md](../DEMO.md)). Elles étaient pourtant comptées comme des refus de la RH : le taux d'adoption affichait 0 %, et la part des recommandations « rejetées » atteignait 55 à 70 % selon le type d'action. Ces chiffres attribuaient à des personnes une décision prise par un calcul, et ils auraient faussé toute évaluation ultérieure des recommandations.

Les recommandations « remplacées par un nouveau calcul » sont désormais comptées à part, hors du taux d'adoption et des rejets, sur la liste des recommandations, la fiche, l'export et la page des interventions. Le taux d'adoption rapporte les seules réalisations aux décisions effectivement prises par la RH.

### 9.7.6 Points restant à arbitrer

Le même audit a relevé deux écarts à la séparation des tâches, non arbitrés au 04/10/2026 ([AUDIT_PRODUIT.md](../qa/AUDIT_PRODUIT.md), section G). Sur la page Transparence, l'administrateur voit des taux de démission agrégés, qui lui sont retirés sur la page de dérive. Dans les paramètres, il saisit et voit le budget de masse salariale. Ces données ne sont pas nominatives, mais elles relèvent du pilotage RH : il faut soit les retirer à l'administrateur, soit documenter l'exception.

## 9.8 Livrables de conformité

Le cahier des charges prévoit quatre livrables de conformité, à valider avec le client avant toute mise en service. Les trois premiers sont rédigés dans [docs/conformite/](../conformite/) :

1. une **analyse d'impact simplifiée** ([aipd.md](../conformite/aipd.md)) : description du traitement, nécessité et proportionnalité, risques pour les salariés (stigmatisation, erreur, biais, fuite de données, détournement de finalité, décision automatisée) cotés en gravité et vraisemblance, mesures du tableau 9.1, risques résiduels et plan d'action. Elle a été complétée le 04/10/2026 de deux sections sur les options d'IA générative : synthèse rédigée (§ 7, risques R11 à R14) et assistant d'aide (§ 8, risques R15 à R17) ;
2. une **note d'information type** aux salariés, avec un complément pour les instances représentatives du personnel ([note-information.md](../conformite/note-information.md)) : finalité, données utilisées et exclues, logique générale, qui voit quoi, durées de conservation, droits ;
3. une **procédure d'exercice des droits** d'accès, d'opposition et de rectification ([procedure-exercice-des-droits.md](../conformite/procedure-exercice-des-droits.md)), qui s'appuie sur l'écran « Droit d'accès », décrit les purges et l'archivage du journal d'audit ; s'y ajoute un **registre des traitements** ([registre-traitements.md](../conformite/registre-traitements.md)), où toute option d'IA générative activée doit être inscrite (date d'activation, avis du juriste, conditions de l'éditeur de l'API) ;
4. la **déclaration à l'INPDP**, à la charge du client, qui peut reprendre le registre.

Ces documents sont des modèles : les durées de conservation, l'usage du niveau « Élevé » côté manager, les destinataires et l'activation éventuelle des options d'IA générative restent à arrêter avec le client et son délégué à la protection des données.

## 9.9 Conclusion

Le cadre tunisien impose l'essentiel : déclaration, sécurité et traçabilité, interdiction de traiter les données de santé, droits d'accès et d'opposition. Les référentiels européens et la Convention 108+ indiquent la direction : contrôle humain, analyse d'impact, transparence, information des représentants du personnel. La conception du module répond à la plupart de ces exigences par construction. Elle exclut la santé, minimise par rôle, laisse la décision à l'humain et trace les accès. Les droits d'accès et d'opposition sont outillés et tracés, la conservation est bornée par un outil de purge, et les livrables documentaires (AIPD, note d'information, procédure, registre) sont rédigés sous forme de modèles ; il reste au client à les valider, à arrêter les durées de conservation et à déclarer le traitement.

Les fonctions ajoutées en fin de projet suivent les mêmes règles. L'IA générative reste une extension facultative, désactivée par défaut et jamais appliquée à des données individuelles : la synthèse ne transmet que des agrégats non nominatifs, l'assistant que de la documentation. L'assistant d'aide ne lit que la documentation permise au rôle et ne conserve pas les questions. La comparaison des interventions et les profils de départs sont réservés à la RH, agrégés et présentés comme non causaux ; les profils ont fait l'objet d'un audit d'équité. Leurs limites (confusion non observée, stabilité moyenne des profils, lien indirect à l'âge) sont écrites dans les rapports de résultats et dans ce chapitre ; les deux premières sont aussi affichées à l'écran.
