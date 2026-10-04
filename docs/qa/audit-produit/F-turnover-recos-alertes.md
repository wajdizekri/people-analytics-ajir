# Audit produit F : turnover, recommandations, alertes

Date : 04/10/2026. Agent F, audit en lecture seule (7 agents en parallèle).

## Périmètre

- Fiche collaborateur : `src/app/(app)/employees/[id]/**`, `src/components/pilotage/employee-detail.tsx`, `what-if-panel.tsx` (lecture seule, voir chantier LEVIER), `src/components/insights/whats-new.tsx`.
- Liste des collaborateurs (affichage du niveau).
- Pages `/recommendations`, `/interventions`, `/transparency` (seulement : comprend-on le score ?).
- Moteur : `src/lib/engine/recommendations.ts`, `src/lib/scoring/model.ts` (phrases), `src/lib/anomalies/index.ts` (alertes d'absentéisme), `src/lib/dal/{employees,recommendations,alerts,synthesis,teams}.ts`.
- Alertes : `src/app/(app)/alerts/**`, `src/lib/engine/alerts.ts`.
- Rôles RH et MANAGER. L'ADMIN ne voit ni fiche ni recommandation (inchangé, non réaudité).

## Méthode

Lecture du code et des audits antérieurs (CLARTE, MESSAGES_SERVEUR, ERGONOMIE, REVUE_TRANSVERSE, ergonomie/IA, ACTION, COLLAB, RESULTATS_ML, DEMO, DICTIONNAIRE). Un point déjà listé n'est repris que s'il est encore ouvert dans le code (constat d'origine cité). Pas de serveur, pas de requête à la base : les exemples tirés de la base de démonstration sont marqués « à vérifier ». Six captures du 04/10 (`docs/qa/captures/design-system/final/`, base E2E) lues pour confirmer, voir § 6.

Priorités : P0 critique avant soutenance, P1 important, P2 amélioration, P3 confort. Colonne « Chantier IA » : couverture probable par le chantier en cours dans `wt\` (CHANTIER_IA.md).

Déjà corrigé et vérifié dans le code (non repris) : libellés de CLARTE § 6 sur la liste, la fiche, la simulation, les recommandations et les alertes (« Niveau de risque », « Probabilité à 6 mois », « Gravité », « parmi les collaborateurs évalués ») ; identifiant brut du modèle sur la fiche (REVUE_TRANSVERSE T6) remplacé par « modèle du 30/09/2026 » (`fmt.model`) ; texte des nouvelles alertes de risque (T7) : « c'est une estimation, pas une certitude » (`src/lib/engine/recommendations.ts:80`).

## 1. Parcours du risque

| Étape | Ce qui existe | Ce qui manque | Preuve |
|---|---|---|---|
| 1. Quel est le risque ? | Niveau en mots + échelle à trois crans ; RH : probabilité à 6 mois, « soit 3,7 fois le risque moyen », date du calcul, version et date de publication ; manager : niveau seul, « le détail chiffré est réservé à la RH ». Liste : badge, probabilité, « × la moyenne », bulles « ? » sur les en-têtes. | Sur la fiche, rien ne dit ce que veut dire « 15 % » (sur 100 personnes comparables, 15 partent, 85 restent) ni que la plupart des collaborateurs classés Élevé restent. Les bulles `probabilite` et `niveauEleve` existent mais ne sont pas posées sur la fiche. | `employee-detail.tsx:592-596` (libellé « Probabilité à 6 mois » sans `TermTip`) ; `terms.ts:16` (« la plupart de ces collaborateurs ne partent pas », non utilisé sur la fiche) ; `content.ts:364` (FAQ « si 6 des 20… les 14 autres restent », seulement dans /aide). |
| 2. Pourquoi ? | RH : jusqu'à 5 facteurs, phrase chiffrée (`phrase_rh`), sens (« Fait monter / Fait baisser le risque »), groupe, poids, barre. Résumé « En bref » limité aux facteurs à la hausse. Mention « Estimation, pas une certitude. Facteurs associés, pas des causes. » | **Manager : catégories affichées sans leur sens.** Les facteurs qui font baisser le risque sont listés comme « facteurs principaux ». Poids « fort » calculé par rapport au premier facteur de la personne, même s'il pèse peu. | `employees.ts:553-555` (aucun filtre sur `direction`) ; `employee-detail.tsx:224-225` (« 3 facteurs principaux » pris sans filtre) ; `employee-detail.tsx:641-642` (part de la contribution rapportée au plus grand facteur). |
| 3. Quels signaux ? | Zone « Faits » (paie, absences hors santé par catégorie, formations, évaluations), « Nouveautés », « Parcours », historique du niveau sur 12 mois, tableau « Voir les données ». | Les signaux de pointage cités par les facteurs (« 9 retards sur 3 mois », « jours ouvrés sans pointage ») n'apparaissent nulle part dans « Faits » : la RH ne peut pas les vérifier avant l'entretien. L'historique et les « Nouveautés » comparent août (modèle statistique) à juillet (score à règles) sans le dire. | `employee-detail.tsx:395-479` (RhFacts : rémunération, absences, paie) ; `employees.ts:462-468` (historique tous modèles confondus) ; `score.ts:96,177` (runs de backtest au statut PUBLIE). |
| 4. Que peut faire la RH ? | Zone « Suggestions » (action, statut, « Déclenchée par », décision avec date, motif, avis de pertinence) ; /recommendations en « Pour qui / Pourquoi / Que faire » ; simulation « et si ? » ; suivi avant / après. | Sur la fiche, ni « Que faire » ni facteur précis : seulement « Revue de la rémunération · Déclenchée par : Rémunération ». L'action est choisie par groupe, pas par signal (une « Revue de la charge de travail » peut venir de retards). L'alerte de risque et l'entretien proposé sont deux tâches séparées, sans lien. | `employee-detail.tsx:797-802` ; `recommendations/page.tsx:22-35` (dictionnaires WHY/WHAT propres à la liste) ; `engine/recommendations.ts:62-70`. |

| # | Constat du parcours | Preuve | Prio | Effort | Chantier IA |
|---|---|---|---|---|---|
| P1 | Manager : les catégories de facteurs sont listées sans leur sens ; celles qui font baisser le risque deviennent « facteurs principaux » dans « En bref » et dans « Catégories de facteurs associés ». Incohérent avec l'alerte et « Quoi de neuf », filtrées à la hausse. Parcours de démo manager (DEMO.md étape 7 : équipe « tous Faible »). | `employees.ts:553-555` ; `employee-detail.tsx:224-232, 680-697` ; `synthesis.ts:444` ; `engine/recommendations.ts:75` | **P0** | faible | Non |
| P2 | Signaux de pointage cités par les facteurs (retards, jours sans pointage, horaires) absents de la zone « Faits » : la RH ne peut pas vérifier le chiffre avant d'en parler. | `employee-detail.tsx:395-479` ; capture du 04/10 (fiche, `…-1440-graphiques-1.png`) | P2 | moyen | Non |
| P3 | Poids « fort / moyen / faible » relatif au premier facteur de la personne. | `employee-detail.tsx:641-642` | P2 | faible | Non |
| P4 | Manager : aucune consigne d'action sur la fiche. | `employee-detail.tsx:728` | P2 | faible | Non |
| P5 | Liste RH : probabilité et « × la moyenne » sans aucun facteur ; il faut ouvrir la fiche pour savoir pourquoi. | `employees/(liste)/page.tsx:64-72` | P3 | moyen | Non |

Côté manager, ce qu'il voit réellement : niveau, échelle, historique des niveaux, catégories de facteurs (hors Assiduité, hors Rémunération avec le score à règles), recommandations sans la revue de rémunération et sans bouton, alertes « Passage au niveau de risque Élevé » et « Absentéisme inhabituel » de son équipe. Aucune probabilité, aucun salaire, aucun signal individuel d'absentéisme (conforme à CONVENTIONS.md). Aucune phrase ne lui dit quoi faire sur la fiche, hors « La décision revient à la RH » (`employee-detail.tsx:728`).

## 2. Crédibilité de la prédiction

| # | Élément | Constat | Preuve | Prio | Effort | Chantier IA |
|---|---|---|---|---|---|---|
| C1 | Date du calcul | Présente partout : « Calcul au 31/08/2026 », « publiée le … ». | `employee-detail.tsx:587, 604-607` | — | — | — |
| C2 | Version | « Estimation calculée avec le modèle du 30/09/2026 » : lisible. La méthode (modèle statistique ou score à règles) se déduit seulement du format. Pas de lien vers Transparence depuis la fiche. | `employee-detail.tsx:605` ; `ui/index.tsx:464-468` | P3 | faible | Non |
| C3 | Sens de la probabilité | La calibration est bonne (O/E 1,00, RESULTATS_ML § 4) : « 15 % » veut vraiment dire « environ 15 sur 100 ». Ce n'est écrit que sur Transparence (« Sur 100 collaborateurs classés Élevé ») et dans la FAQ. Sur la fiche, le RH voit un pourcentage sans repère. | `employee-detail.tsx:592-596` ; `transparency/page.tsx:155` ; `content.ts:364` | P1 | faible | Non |
| C4 | Changement de méthode | Les 72 runs B0 de backtest sont au statut PUBLIE. L'historique de la fiche, les « Nouveautés » (« Nouveau facteur associé ») et les alertes « Passage au niveau Élevé » comparent le run LOGREG d'août au run B0 de juillet. B0 ne classe Élevé que 1,3 % de l'effectif et n'a pas de facteur à la baisse : une partie des « passages » et des « nouveaux facteurs » vient du changement de méthode, pas de la situation du collaborateur. Le tableau « Voir les données » montre « Score à règles (2 points) » puis « 15,0 % », mais le titre du graphique dit « Niveau en hausse ». Capture du 04/10 : « Nouveau facteur associé : 9 retards sur 3 mois » alors que le score à règles n'a pas de règle sur les retards. | `employees.ts:462-468` ; `teams.ts:35-46` ; `synthesis.ts:437-452` ; `engine/recommendations.ts:89-96` ; `employee-detail.tsx:543-550` | P1 | faible | Non (SYNTHESE touche la synthèse, pas la fiche) |
| C5 | Avertissement non causal | Présent : mention de la zone Estimation, `NON_CAUSAL_NOTICE` de la simulation, `CAUSALITY_NOTICE` des interventions (y compris le retour vers la moyenne), pied de l'alerte « aide à la décision ». Seule entorse : « Testez l'effet estimé d'une action avant de la décider » (simulation). | `employee-detail.tsx:481` ; `whatif/index.ts:11` ; `intervention-effects.tsx:8-9` ; `what-if-panel.tsx:400` | P3 | faible | Oui (LEVIER réécrit le panneau) |
| C6 | Précision affichée | Probabilité à une décimale (« 15,0 % ») avec une AUC de 0,63 et une pente de 0,84 : fausse précision. Aucune fourchette individuelle. | `labels.ts:42` (`formatProb`) | P3 | faible | Non (CONFORME ne couvre que absentéisme, charge, effectifs) |
| C7 | Horizon | « d'ici 6 mois » sans date de fin (calcul au 31/08/2026 → fin février 2027). | `employee-detail.tsx:239, 595` | P3 | faible | Non |
| C8 | Manager | Aucun repère de fiabilité sur la fiche (Transparence lui est interdite). La bulle `niveauRisque` dit « estimation, pas une certitude » ; la phrase utile (« la plupart ne partent pas ») reste dans /aide. | `employee-detail.tsx:488` ; `terms.ts:16` | P2 | faible | Non |

## 3. Recommandations

Génération : à chaque publication de calcul (`applyPublicationEffects`), pour les niveaux Élevé et Moyen. Une action par groupe « actionnable » présent dans les 3 premiers facteurs avec une contribution à la hausse ; un entretien pour tout Élevé. Une action reste ouverte tant qu'elle n'est pas décidée (pas de doublon, pas d'expiration). Le lien vers la prédiction (`prediction_id`) et le groupe (`trigger_group`) sont stockés ; le signal précis (`top_feature`, `phrase_rh`) est disponible dans `prediction_factor` mais n'est jamais relu pour la recommandation.

| Type | Déclencheur | Spécifique ? | Lien aux données | Problème | Proposition |
|---|---|---|---|---|---|
| Entretien de rétention | Niveau Élevé | Non : même texte pour tous (« Proposer un entretien pour comprendre ses attentes et ses perspectives. ») | Niveau seul | Doublon avec l'alerte « Passage au niveau Élevé » (voir R5). Sur la fiche, aucune phrase « Que faire ». | Afficher sur la fiche les 2-3 phrases chiffrées à la hausse comme points à aborder (elles sont déjà chargées dans `d.estimation.factors`). |
| Revue de la rémunération | Groupe Rémunération à la hausse | Partiel : WHY générique (« La rémunération fait partie des principaux facteurs… ») | `phrase_rh` disponible (« Salaire à 90 % de la médiane du poste ») mais non affichée avec la recommandation | Le RH doit relier lui-même la recommandation au facteur, affiché plus haut dans une autre zone. | « Pourquoi : Salaire à 90 % de la médiane du poste (calcul du 31/08/2026). » |
| Revue de la charge de travail | Groupe Temps de travail à la hausse | Non | Le groupe mélange heures sup, tendance, **retards, horaires irréguliers, jours sans pointage** (`features.json:24-28`) | Texte « Faire le point… sur la charge de travail et les heures supplémentaires » proposé même quand le signal est « 9 retards sur 3 mois » ou « jours ouvrés sans pointage ni absence déclarée » (qui peut aussi être une saisie manquante dans AJIR). Côté manager, la catégorie s'appelle « Charge de travail » alors que le signal est un retard. | Choisir la phrase « Que faire » selon `top_feature` : heures sup → charge ; retards ou horaires → « échanger sur les contraintes d'horaires » ; jours sans pointage → « vérifier d'abord la saisie dans AJIR ». |
| Plan de formation et de développement | Groupe Formation et évaluation à la hausse | Non | Le groupe mélange heures de formation, **formation obligatoire en retard, absence d'évaluation, note basse, note en baisse** | « Proposer une formation ou un parcours de développement adapté » ne répond ni à « Aucune évaluation disponible » (planifier l'évaluation) ni à « Formation obligatoire en retard » (terminer celle qui existe, déjà relancée par /formations). | Même principe : phrase selon `top_feature` ; pour une obligatoire en retard, renvoyer vers la relance de /formations. |
| Relance d'une formation obligatoire (IA Formations, contraste) | Risque estimé de dépasser l'échéance | Oui : nom, intitulé, code, échéance, facteurs | `rationale` chiffrée (`ai/training/step.ts:71-72`) | Bon modèle à suivre ; peut doubler le « Plan de formation » du même collaborateur sans lien. | Mentionner la relance existante sur la carte « Plan de formation ». |

Cohérence recommandations ↔ facteurs, sur exemples :

- Test `tests/unit/engine-metrics.test.ts:154-165` : facteurs [Absences ↑, Temps de travail ↑, Rémunération ↓, Formation ↑] en Élevé → Revue de la charge + Entretien ; Formation (4e) ignorée ; Rémunération à la baisse ignorée. Règle respectée. Les tests ne vérifient que le groupe, jamais le signal (`top_feature`).
- Fiche d'Omar Othmani (DEMO.md étape 3, capture du 04/10) : facteurs « Taux d'absence hors santé de 12 % sur 3 mois », « Salaire à 90 % de la médiane du poste », « 9 retards sur 3 mois ». La règle produit Revue de la rémunération (cohérent), Entretien (cohérent) et **Revue de la charge de travail déclenchée par 9 retards** (incohérent : ses heures supplémentaires baissent, 5,5 h en août contre 10,0 h en juillet). Observé sur la base E2E ; c'est la fiche du parcours de démonstration.

| # | Constat | Preuve | Prio | Effort | Chantier IA |
|---|---|---|---|---|---|
| R1 | « Pourquoi » générique par groupe sur /recommendations et simple groupe sur la fiche, alors que la phrase chiffrée du facteur déclencheur existe. | `recommendations/page.tsx:22-28, 240` ; `employee-detail.tsx:801` ; `dal/recommendations.ts:111-114` (pas de jointure `prediction_factor`) | P1 | faible (fiche : facteurs déjà chargés) à moyen (liste : jointure) | Non |
| R2 | Action choisie par groupe, pas par signal : « Revue de la charge de travail » pour des retards ou des jours sans pointage, « Plan de formation » pour une évaluation manquante. Cas réel sur la fiche de démo d'Omar Othmani (capture du 04/10) ; sur Transparence, la variable la plus influente du groupe « Temps de travail » (« Levier RH ») est « Plus de jours sans pointage ». | `engine/recommendations.ts:7-11, 62-70` ; `model.ts:258-260` ; `features.json:24-28, 35-39` ; § 6 | P1 | moyen | Non |
| R3 | La fiche n'affiche pas « Que faire » : les phrases WHY/WHAT sont des constantes locales de /recommendations. Deux écrans, deux niveaux d'explication pour la même recommandation. | `recommendations/page.tsx:22-35` ; `employee-detail.tsx:771-807` | P1 | faible | Non |
| R4 | « Taux d'adoption 0 % — 0 réalisée sur 110 décidées » : les 110 recommandations « remplacées par un nouveau calcul » (`runs supersede`) comptent comme rejetées. La note le dit, mais la tuile laisse croire que la RH a rejeté 110 propositions. Sur la fiche, elles apparaissent « Rejetée · Motif du rejet : Remplacée : recalcul avec le modèle entraîné ». REVUE_TRANSVERSE T15 visait le nom et le dénominateur, pas ce point. | `dal/recommendations.ts:93` ; `recommendations/page.tsx:133-136, 145-148` ; `engine/recommendations.ts:137` ; DEMO.md (110 rejetées) | P1 | faible | Non |
| R5 | L'alerte « Passage au niveau Élevé » et la recommandation « Entretien de rétention » naissent du même évènement et se traitent séparément ; aucune ne renvoie à l'autre. Le bandeau « À traiter » les compte deux fois. | `engine/recommendations.ts:110-128` ; `alerts/labels.tsx:111-112` | P1 | faible | Non |
| R6 | Aucune péremption : une recommandation reste « Proposée » si le collaborateur repasse Faible, n'est plus évalué ou quitte l'entreprise. La liste la classe « Priorité basse » sans dire que le déclencheur a disparu. Pas d'impact dans la base de démo (un seul mois), impact dès le calcul suivant. | `engine/recommendations.ts:98-101` ; `dal/recommendations.ts:73, 111-114` (aucun filtre sur la sortie) ; `recommendations/page.tsx:40-42` | P2 | moyen | Non |
| R7 | Libellés d'état encore différents : « Proposée » (badge), « N à décider » (fiche RH), « N en attente » (fiche manager), « En attente de décision » (/recommendations). Constat ouvert de ergonomie/IA.md (dernière ligne du tableau) et REVUE_TRANSVERSE T3. | `employee-detail.tsx:244, 730` ; `labels.ts:17` ; `recommendations/page.tsx:20, 85` | P2 | faible | Non |
| R8 | Lien recommandation → simulation absent : la « Revue de la rémunération » ne propose pas de simuler la hausse correspondante. | `employee-detail.tsx:708-769` | P3 | faible | Partiel (LEVIER : meilleur levier dans la simulation) |

## 4. Alertes

### Par type

| Type (gravité) | Quoi | Pour qui | Pourquoi | Quand | Que faire (texte affiché) | Lien |
|---|---|---|---|---|---|---|
| Risque de départ (Attention, fixe) | « Passage au niveau de risque Élevé : Prénom Nom » ; message : estimation parmi les plus fortes, catégories à la hausse, « c'est une estimation, pas une certitude » | Manager de la hiérarchie et RH (audience MANAGER) ; statut partagé | Élevé ce mois, pas Élevé au calcul publié précédent | Publication du calcul mensuel ; une par collaborateur et par mois | « Prévoir un échange avec le collaborateur pour comprendre sa situation. » (RH et manager) | Fiche |
| Absentéisme collectif (Attention) | « Absentéisme inhabituel : l'équipe de X » ou département ; taux observé, attendu, écart en points, période, calendrier pris en compte | Manager (équipes) et RH ; départements : RH seule | Deux semaines consécutives au-dessus du seuil de z robuste | Détection d'anomalies du batch ; alerte si la période finit dans les 13 dernières semaines | Message : « Échangez avec l'équipe pour en comprendre la cause… » ; action : « Analyser l'absentéisme de votre équipe et en parler avec la RH. » | `/absenteeism` sans filtre |
| Absences répétées (Information) | « Absences répétées à vérifier : Prénom Nom » ; facteur de Bradford, nombre d'absences, jours, seuil, période | RH seule (le manager ne voit jamais ce signal) | Bradford 12 mois ≥ seuil (250 par défaut) | Chaque calcul mensuel | « Vérifier les absences avec le collaborateur, sans présumer de leur cause. » | Fiche |
| Qualité des données (Critique ou Attention) | Import bloqué ou rejets | RH ; ADMIN si non nominative | Contrôles de l'import | À l'import | RH : « Vérifier la qualité de l'import avec l'administrateur. » | Santé des données |
| Système (Critique) | Service de calcul arrêté, échec du calcul, modèle illisible | ADMIN seul | Traitement en échec | À l'évènement | « Vérifier que le service de calcul fonctionne, puis relancer le traitement en attente. » | Console ou Santé des données |

Statuts : Nouvelle → En cours → Traitée ou Rejetée (motif obligatoire), datés et tracés. Filtres : statut, type (selon le rôle), gravité. Tri : nouvelles et en cours, puis gravité, puis date. Actions : prendre en charge, marquer traitée, rejeter, alerte suivante dans la même sélection, lien vers la source avec retour.

### Problèmes

| # | Constat | Preuve | Prio | Effort | Chantier IA |
|---|---|---|---|---|---|
| A1 | Alerte de risque sans lien avec l'entretien proposé (voir R5). Pour la RH, l'action utile est « décider l'entretien proposé », pas seulement « prévoir un échange ». | `alerts/labels.tsx:111-112` ; `alerts/[id]/page.tsx:158-166` | P1 | faible | Non |
| A2 | Les 17 alertes « Passage au niveau Élevé » du 31/08 sont calculées contre le run B0 de juillet : une partie des « passages » vient du changement de méthode (voir C4). | `engine/recommendations.ts:89-96, 116` ; DEMO.md (17 alertes) | P1 (à dire à l'oral au minimum) | faible | Non |
| A3 | Signal de Bradford recréé chaque mois tant que le facteur reste au-dessus du seuil (fenêtre glissante de 12 mois) : jusqu'à 12 alertes pour la même personne, même si la précédente est encore ouverte. | `anomalies/index.ts:365, 372, 392` (`bradford:<id>:<mois>`) | P2 | faible | Non |
| A4 | Alerte d'équipe : « Concerne » affiche le département (lien vers `/absenteeism` sans filtre) alors que le titre vise « l'équipe de X ». | `anomalies/index.ts:155-158, 316` ; `alerts/page.tsx:178-181` ; `alerts/[id]/page.tsx:128-131` | P2 | faible | Non |
| A5 | Statut partagé entre manager et RH, sans responsable : un manager peut rejeter une alerte de risque, qui disparaît des nouvelles alertes de la RH. | `dal/alerts.ts:68-81, 202-222` | P2 | moyen (à arbitrer) | Non |
| A6 | Le message dit « Échangez avec l'équipe », l'action proposée dit « Analyser… et en parler avec la RH » : deux consignes dans la même alerte. | `anomalies/index.ts:292` ; `alerts/labels.tsx:115` | P3 | faible | Non |
| A7 | Ordre « Prénom Nom » dans les titres d'alertes et `employeeName` ; « Nom Prénom » ailleurs. Constat T4 de REVUE_TRANSVERSE toujours ouvert. | `engine/recommendations.ts:124` ; `anomalies/index.ts:389` ; `dal/alerts.ts:134` | P2 | faible | Non |
| A8 | Filtre « Type » de la RH : « Système » toujours vide (alertes système réservées à l'ADMIN). Suite du constat A2 d'ACTION, corrigé pour ADMIN et manager seulement. | `alerts/labels.tsx:14` ; `engine/alerts.ts:36` ; `dal/alerts.ts:70` | P3 | faible | Non |
| A9 | Message de l'alerte de risque lu par la RH avec les catégories du manager (« Charge de travail ») alors que la fiche dit « Temps de travail ». | `engine/recommendations.ts:73-81` | P3 | faible | Non |

## 5. Contenu à reformuler

| Texte | Problème | Proposition |
|---|---|---|
| Manager, « En bref » : « Risque Faible — 3 facteurs principaux : rémunération, évolution de carrière et contexte d'équipe » (`employee-detail.tsx:224-232`) | **P0.** Facteurs à la baisse présentés comme raisons du risque. Pour un collaborateur Faible (938 sur 987), les premiers facteurs sont souvent protecteurs. Contredit l'alerte et les « Nouveautés », filtrées à la hausse (`synthesis.ts:444`). | Filtrer `direction = 'HAUSSE'` dans `toManagerDetailDto` (`employees.ts:553`), comme `turnoverMessage`. Sans facteur à la hausse : « aucun domaine ne fait nettement monter le risque ». Intro de la liste : « Domaines qui font monter l'estimation ». |
| RH, « En bref » : « 3 facteurs principaux : rémunération, formation et évaluation et absences (hors santé) » (`employee-detail.tsx:222, 231`) | Libellés de groupe joints par « et » : illisible ; moins précis que les phrases chiffrées affichées plus bas. | « Facteurs principaux : salaire à 90 % de la médiane du poste ; 9 retards sur 3 mois ; taux d'absence hors santé de 12 % sur 3 mois. » |
| « Probabilité estimée d'un départ volontaire d'ici 6 mois, soit 3,7 fois le risque moyen des collaborateurs évalués. » (`employee-detail.tsx:595`) | Pas de repère concret ; horizon sans date. | Ajouter : « Sur 100 collaborateurs avec cette estimation, environ 15 partent d'ici fin février 2027 et 85 restent. » + bulle `probabilite`. |
| Badge « Élevé » sur la fiche | Le sens du niveau (capacité RH, la plupart restent) n'est pas sur la fiche. | Bulle `niveauEleve` à côté du badge quand le niveau est Élevé. |
| « Fait monter le risque · Temps de travail · poids fort » (`employee-detail.tsx:641-652`) | « fort » = relatif au premier facteur de la personne : toujours « fort » pour le premier, même chez un Faible. | Seuils absolus sur la contribution, ou « le plus important » / « secondaire ». |
| « Horaires d'arrivée irréguliers (écart-type 4 min) » + « Fait baisser le risque » (`features.json:27`, `model.ts:204-211`) | Libellé fixe : dit « irréguliers » même quand les horaires sont réguliers ; « écart-type » est du jargon. | Phrase selon le sens : « Horaires d'arrivée réguliers (écart moyen de 4 min) » / « irréguliers (écart moyen de 35 min) ». Réécriture côté TypeScript, sans toucher `features.json`. |
| « Évaluation en évolution de -0,5 point(s) », « Heures supplémentaires en évolution de +1,2 h/mois » (`features.json:25, 38`) | « point(s) », trait d'union au lieu du signe moins, tournure abstraite (MESSAGES_SERVEUR § 4 l'a laissé tel quel). | « Note d'évaluation en baisse de 0,5 point » ; « Heures supplémentaires en hausse de 1,2 h par mois sur 6 mois ». |
| « Pas de contrat à durée déterminée », « Évaluation disponible » (`model.ts:206-207`) | Négation automatique maladroite pour une valeur 0. | « En CDI » ; « Évaluation annuelle disponible ». |
| « Déclenchée par : Rémunération » (`employee-detail.tsx:801`) | Groupe seul, pas le signal. | « Pourquoi : salaire à 90 % de la médiane du poste. Que faire : comparer aux postes équivalents et étudier un ajustement. » |
| « Faire le point avec son manager sur la charge de travail et les heures supplémentaires. » quand le signal est un retard (`recommendations/page.tsx:33`) | Action hors sujet (voir R2). | Texte selon `top_feature` (voir § 3). |
| « Taux d'adoption 0 % — 0 réalisée sur 110 décidées » (`recommendations/page.tsx:145-148`) | Remplacements techniques comptés comme décisions RH. | Exclure les « Remplacée » du dénominateur et les afficher à part : « 110 remplacées par le calcul du modèle entraîné ». |
| Manager, Suggestions : « Actions proposées pour ce collaborateur. La décision revient à la RH. » (`employee-detail.tsx:728`) | Ne dit pas quoi faire au manager. | Reprendre la FAQ (`content.ts:364`) : « Le niveau sert à choisir avec qui échanger en premier, jamais à juger une personne. Parlez-en avec la RH. » |
| « Testez l'effet estimé d'une action avant de la décider. » (`what-if-panel.tsx:400`) | « effet » contredit la mention non causale juste en dessous. | « Voyez comment l'estimation changerait si… » (à transmettre à LEVIER). |
| « Niveau en hausse : passé de Faible à Élevé en août 2026 » (`employee-detail.tsx:550`) quand juillet est un score à règles | Changement de méthode présenté comme évolution de la situation. | Ajouter « (calculs au score à règles jusqu'en juillet 2026 : la comparaison mélange deux méthodes) ». |
| « Une équipe (voir la description) » / département affiché pour une alerte d'équipe (`alerts/labels.tsx:128`) | « Concerne » ne nomme pas l'équipe. | « Équipe de Nom Prénom (Département) », lien `/absenteeism?departement=…`. |

## 6. Captures

Captures du 04/10 lues (`docs/qa/captures/design-system/final/`, base E2E, compte rh.demo, fiche d'Omar Othmani M10079) : 6 PNG.

| Capture | Ce qu'elle confirme |
|---|---|
| `rh-fiche-collaborateur-clair-menu-1440.png` | « En bref » : « Risque Élevé — 3 facteurs principaux : absences (hors santé), rémunération et temps de travail » (libellés de groupe, pas les phrases). « Quoi de neuf » : « Niveau de risque inchangé depuis juil. 2026 », « Nouveau facteur associé : 9 retards sur 3 mois », « Heures supplémentaires pointées : 5,5 h en août 2026, contre 10,0 h en juil. 2026 ». |
| `…-1440-graphiques-1.png` | Probabilité « 15,2 % », « 3,8 fois le risque moyen », « modèle du 30/09/2026, publiée le 30/09/2026 », sans repère « sur 100 » ni bulle sur la probabilité. Historique « Niveau en hausse : passé de Moyen à Élevé en avr. 2026 ». Zone « Faits » sans retards ni pointage. |
| `…-1440-graphiques-2.png` | Cartes « Revue de la charge de travail · Déclenchée par : Temps de travail », « Entretien de rétention », « Revue de la rémunération · Déclenchée par : Rémunération » : ni « Pourquoi » chiffré ni « Que faire ». Simulation : « Testez l'effet estimé d'une action ». |
| `…-390-pleine.png` (lecture à basse résolution) | Troisième facteur « 9 retards sur 3 mois » (Temps de travail) : c'est lui qui déclenche la « Revue de la charge de travail », alors que les heures supplémentaires baissent (5,5 h). Exemple réel de R2. |
| `…-390-graphiques-2.png` | Leviers de la simulation : salaire, heures supplémentaires, formation, promotion ; aucun levier pour les retards ou le pointage. |
| `rh-transparence-clair-menu-1440-graphiques-1.png` | « Temps de travail » classé « Levier RH », alors que sa variable la plus influente est « Plus de jours sans pointage » (+7 %) ; les heures supplémentaires ne figurent pas dans les 10 premières. Renforce R2. |

Le « Nouveau facteur associé : 9 retards sur 3 mois » est probablement un effet du changement de méthode (C4) : le score à règles n'a aucune règle sur les retards (DICTIONNAIRE § 6.3), donc ce facteur ne pouvait pas figurer au calcul de juillet. À vérifier sur la base de démonstration.

## Notes proposées

| Dimension | Note | Justification |
|---|---|---|
| IA / prédictions | 7/10 | Estimation datée, versionnée, calibrée, toujours qualifiée de non causale, transparence exemplaire ; mais le manager lit des facteurs protecteurs comme des raisons, le passage B0 → LOGREG fabrique des « hausses », et la fiche ne traduit pas la probabilité. |
| Contenu RH | 6/10 | Parcours « Pour qui / Pourquoi / Que faire » bien posé sur /recommendations et alertes qui disent quoi faire ; mais recommandations génériques par groupe, actions parfois hors sujet, fiche sans « Que faire », indicateur d'adoption trompeur, alerte et entretien en double. |
