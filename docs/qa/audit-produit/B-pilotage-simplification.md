# Audit produit B : écrans de pilotage, simplification

Date : 04/10/2026. Agent B, lecture seule.

## Périmètre

Écrans `/dashboard`, `/synthese`, `/absenteeism`, `/charge`, `/formations`, `/equipes`, `/previsions`, `/retention`, `/organigramme`, `/interventions`, `/recommendations`, les composants qu'ils utilisent, le menu (`src/components/layout/sidebar.tsx`, `NAV`) et l'accueil après connexion (`src/app/page.tsx` → `homePath` : `/dashboard` pour RH et manager, `src/lib/dal/context.ts:85`). Rôles RH et MANAGER.

## Méthode

Lecture du code des pages et des composants, puis comparaison avec les audits existants (ERGONOMIE, CLARTE, REVUE_TRANSVERSE, CHARTE_UI, DESIGN_SYSTEM, ergonomie/PILOT, CHARTS, ACTION, UI, IA, DEMO). Un constat déjà listé n'est repris que s'il est toujours ouvert dans le code, avec sa référence d'origine (T1, T2…). J'ai regardé 11 captures RH du 04/10, mentionnées « capture du 04/10 » (`docs/qa/captures/design-system/final/`). Contraintes de [CHANTIER_IA.md](../CHANTIER_IA.md) : Synthèse (agent SYNTHESE), Interventions (CAUSAL), Rétention (TYPOLOGIE), Absentéisme, Charge et Prévisions (CONFORME) sont en cours de modification dans `wt\`. Les recommandations sur ces pages s'appliquent après la fusion de ce chantier. Aucune fonction nouvelle n'est proposée.

---

## 1. Carte des écrans

Menu RH : 20 entrées en 6 sections, dont 13 de pilotage. Menu manager : 12 entrées ([sidebar.tsx:17-73](../../../src/components/layout/sidebar.tsx)).

| Écran | Rôles | Décision permise | KPI / graphiques / tableaux / filtres | Verdict |
|---|---|---|---|---|
| Tableau de bord | RH, MANAGER | Repérer le département et le niveau où agir, ouvrir la liste des collaborateurs concernés | RH : 7 KPI, 7 graphiques, 1 tableau, 6 filtres, 2 raccourcis « À traiter », 1 bouton d'en-tête. Manager : 6 KPI, 4 graphiques (2 sur un seul département), 1 tableau, 3 filtres | **Garder et simplifier** : page d'accueil, à restructurer (§ 2) |
| Synthèse du mois | RH, MANAGER | Savoir quoi traiter ce mois-ci : 5 constats, chacun avec un bouton (capture du 04/10) | 7 KPI, 0 graphique, 2 tableaux, 0 filtre, 2 boutons + 1 par constat | **Fusionner** : le bloc « À traiter en priorité » passe en tête du tableau de bord. La page reste un rapport imprimable, ouvert depuis le tableau de bord et retiré du menu |
| Absentéisme | RH, MANAGER | Lancer une action collective, vérifier un signal individuel (RH) | RH : 4 KPI, 3 graphiques, 1 tableau + 1 liste, liste de recommandations, 3 filtres + 1 sélecteur de périmètre propre à la prévision. Manager : 3 KPI, 1 filtre | **Garder et simplifier** : une seule courbe au lieu de deux |
| Charge de travail | RH, MANAGER | Prioriser les équipes à décharger, prévoir les entretiens de surcharge (RH) | RH : 4 KPI, 3 graphiques, 3 tableaux, liste de recommandations, 0 filtre. Manager : 3 KPI (dont le seuil), 1 graphique, 1 tableau | **Garder et simplifier** : renommer « tension », retirer le tableau Départements en doublon |
| Formations | RH, MANAGER | Savoir qui relancer, et avant quelle échéance | 4 KPI, 2 graphiques, 2 tableaux, liste de recommandations, 0 filtre | **Garder** |
| Équipes | RH, MANAGER (« Mes équipes ») | Choisir avec quel manager échanger en premier | 5 KPI, 1 carte proportionnelle (treemap, 157 équipes), 1 tableau de 7 colonnes, 2 filtres, 1 bouton | **Garder**, y intégrer l'organigramme comme vue, replier la treemap |
| Organigramme | RH, MANAGER | Voir qui encadre qui et repérer une branche exposée | 3 KPI (collaborateurs, responsables, niveaux hiérarchiques), 1 arbre (vues Graphique / Liste, 3 couleurs), panneau de détail | **Fusionner dans Équipes** : même unité (l'équipe d'un manager), mêmes signaux (risque, absentéisme). Retirer du menu |
| Prévisions effectifs | RH | Anticiper recrutements, fins de CDD et budget | 3 indicateurs « En bref », 1 alerte budget, formulaire de 4 champs, 2 graphiques, 2 tableaux, recommandations (4 visibles) | **Garder** : replier le scénario et le tableau par grade |
| Rétention | RH, MANAGER | Repérer les populations d'embauchés qui partent tôt | 4 KPI, 1 graphique, 1 tableau (avec comparaison), 2 filtres | **Garder pour la RH** en simplifiant le vocabulaire (C4). À vérifier pour le manager (U16) |
| Interventions | RH | Savoir si les actions décidées sont suivies d'effet | 5 KPI, 2 graphiques à 100 %, 2 tableaux, 1 filtre. Presque vide dans la démo (« 1 % réalisées », « Aucune mesure complète », capture du 04/10) | **Fusionner avec Recommandations** (partie « Suivi »), retirer du menu |
| Recommandations | RH | Réaliser ou rejeter les recommandations liées au risque de départ | Bloc d'adoption (1 barre + 4 KPI), 3 filtres, liste de 25 cartes par page, export | **Garder** comme boîte de décision unique. Déplacer le bloc d'adoption vers le suivi |

Doublons relevés :
- **Synthèse et tableau de bord.** Les deux affichent le risque élevé, l'effectif, l'absentéisme (moyenne 12 mois d'un côté, mois seul de l'autre), les alertes et recommandations (raccourcis d'un côté, KPI de l'autre), les formations (« réalisées » d'un côté, « en retard » de l'autre).
- **Équipes et Charge.** T1 et T2 sont toujours ouverts (U1, C8). Les deux classent des équipes.
- **Équipes et Organigramme.** Même découpage, deux visuels (treemap et arbre), mêmes indicateurs.
- **Tableau de bord et Absentéisme.** Même graphique « absentéisme par département ». Courbe mensuelle sur le tableau de bord, plus deux courbes sur /absenteeism.
- **Recommandations et Interventions.** T15 ouvert : « Taux d'adoption » contre « Taux de réalisation ».
- **Recommandations et 4 listes par sujet.** Voir U2.

## 2. Tableau de bord et page d'accueil

**Un responsable RH qui découvre l'application comprend-il la situation tout de suite ? En partie.** Les titres disent le message (« 19 collaborateurs en risque élevé… », « Le turnover reste stable… »). Mais à 1 440 px, la première carte KPI commence vers 630 px (capture du 04/10). Avant elle, on traverse l'encart « À quoi sert cette page », le bandeau « À traiter », un bloc de 6 listes déroulantes avec son bouton, puis « Filtres actifs : aucun ». L'écran s'ouvre donc sur des réglages, pas sur une situation.

| Question | Constat dans le code |
|---|---|
| KPI prioritaires présents ? | Effectif : oui (« Effectif fin août 2026 »). Risque de départ : oui (« Collaborateurs en risque élevé » et « Turnover glissant 12 mois »). Absentéisme : oui. Masse salariale : oui, RH seulement. Formations : oui (« Formations obligatoires réalisées »). Alertes critiques : pas de KPI, seulement le raccourci « 37 nouvelles alertes », en rouge s'il y a une critique ([dashboard/page.tsx:112-124](../../../src/app/(app)/dashboard/page.tsx)) |
| Trop de KPI ? | Oui : 7 pour la RH (grille de 4, donc 4 + 3), chacun avec libellé, période, valeur, variation, pastille de jugement, aide, mini-courbe et lien, soit environ 45 éléments à lire. La charte (§ 1) en prévoit 3 à 5 |
| Période affichée ? | Oui dans l'en-tête : « sept. 2025 – août 2026 (12 derniers mois) ». Mais les variations comparent août 2026 à sept. 2025 ([:346](../../../src/app/(app)/dashboard/page.tsx)), ce qui n'est ni le mois précédent ni le même mois de l'année précédente (C5) |
| Filtres compréhensibles ? | Libellés clairs, mais 6 filtres visibles pour la RH. « Niveau de risque » ne s'applique qu'à une partie de la page : note « le niveau de risque filtre le bloc risque et la liste, pas les indicateurs d'effectif » ([:332](../../../src/app/(app)/dashboard/page.tsx)) (U14) |
| Alertes visibles ? | Oui (raccourci « À traiter »), mais sans hiérarchie : bleu sauf s'il y a une critique. Les 86 recommandations par sujet n'y sont pas comptées (U2) |
| Hiérarchie visuelle ? | Plate : les 7 KPI ont le même poids, aucun n'utilise `tone` ou `status` (prévus par `KpiCard`, [pbi.tsx:266-268](../../../src/components/charts/pbi.tsx)). Les 7 graphiques sont en grille égale |
| Où cliquer ensuite ? | 5 liens de KPI, 3 liens de visuels, les barres et les nombres du tableau : beaucoup d'entrées, aucune désignée comme première. La liste « où agir » existe, mais sur la Synthèse (« À traiter en priorité (5) », capture du 04/10) |

**Hiérarchie proposée, construite uniquement avec des éléments existants :**

| Niveau | Question | Contenu | Origine |
|---|---|---|---|
| 1, visible sans défiler | Que dois-je traiter ? | Titre, périmètre, une seule mention « données au ». Bloc « À traiter en priorité » : 3 à 5 constats avec bouton (alertes, passages en risque élevé, recommandations à décider, formations en retard). Il remplace le bandeau « À traiter » et l'encart « À quoi sert cette page », qui passe dans le « ? » du titre. Filtres visibles : Période et Département | `StatementList` + `getSynthesis` ([synthese/page.tsx:154-174](../../../src/app/(app)/synthese/page.tsx)), `ShortcutBar` retiré ([dashboard:285](../../../src/app/(app)/dashboard/page.tsx)) |
| 2 | Quelle est la situation ? | 4 KPI : Collaborateurs en risque élevé (lien vers la liste), Turnover 12 mois (avec la part volontaire en aide), Absentéisme hors santé (12 mois), Effectif (avec entrées et sorties en aide). Mini-courbes conservées | [dashboard:349-402](../../../src/app/(app)/dashboard/page.tsx) |
| 3 | Où agir ? | 2 visuels cliquables côte à côte : « Risques élevés et moyens par département » et « Absentéisme par département » | [dashboard:486-503, 565-588](../../../src/app/(app)/dashboard/page.tsx) |
| 4, replié | Pour aller plus loin | « Voir l'évolution sur 12 mois » : courbes du turnover et de l'absentéisme. « Plus d'indicateurs » : Formations obligatoires (lien /formations) et Masse salariale (RH, lien /previsions). « Voir le détail par département » : tableau des niveaux par département, avec le lift moyen pour la RH, et la note de source. Contrat, Tranche d'âge et Ancienneté sous « Plus de filtres » | [dashboard:414-451, 508-545, 593-645](../../../src/app/(app)/dashboard/page.tsx) |
| Supprimé | | Répartition des niveaux (le KPI 1 et son titre disent déjà la même chose), Effectif par département (aucune décision), courbe d'effectif (axe trompeur, I1), filtre Niveau de risque (le clic sur les barres et le KPI ouvre déjà la liste filtrée) | |

Résultat : 7 KPI → 4 visibles + 2 repliés. 7 graphiques → 2 visibles + 2 repliés. 6 filtres → 2 visibles. Côté manager, l'équipe compte 7 collaborateurs en CDI ou CDD (REVUE_TRANSVERSE T5) : la barre des niveaux (6 « Faible ») et la courbe du turnover d'une petite équipe gagneraient à devenir une phrase. `smallTeam` existe déjà ([:75](../../../src/app/(app)/dashboard/page.tsx)).

Effet sur les tests E2E : libellés « Indicateurs RH de l'entreprise », « Filtres actifs : aucun », libellés des KPI et tableau « … niveau de risque et par département » (ergonomie/PILOT.md, § Libellés E2E). Garder ces textes ou adapter les spécifications.

## 3. Graphiques

| Graphique | Écran | Question métier | Verdict | Proposition |
|---|---|---|---|---|
| Répartition des niveaux de risque (barres, 4) | Tableau de bord | Combien de collaborateurs sont exposés ? | Supprimer | Le titre répète le KPI 1. La barre « Élevé » (19) est écrasée par « Faible » (938) (capture du 04/10) |
| Risques élevés et moyens par département | Tableau de bord | Dans quel département agir d'abord ? | Garder (niveau 3) | Utile et cliquable. Passer le tableau de détail en dessous, replié |
| Effectif fin de mois (courbe) | Tableau de bord | L'effectif évolue-t-il ? | Supprimer | Axe de 1 068 à 1 078 : une baisse de 9 personnes (0,8 %) ressemble à une chute (I1). La mini-courbe du KPI suffit |
| Turnover 12 mois, total et volontaires | Tableau de bord | Les départs augmentent-ils ? | Masquer (niveau 4) | Courbe plate, « reste stable ». Le KPI et sa mini-courbe portent la même information |
| Absentéisme mensuel + moyenne | Tableau de bord | Le mois dernier est-il anormal ? | Masquer (niveau 4) | Déjà traité deux fois sur /absenteeism. Titre à 0,6 % à côté d'un KPI à 0,8 % (moyenne) et d'une ligne de référence à 0,78 % : trois chiffres dans le même bloc (capture du 04/10) |
| Effectif par département | Tableau de bord | Où est l'effectif ? | Supprimer | Aucune décision associée. Information disponible dans la liste filtrée |
| Absentéisme par département | Tableau de bord | Quel département s'absente le plus ? | Garder (niveau 3) | Titre arrondi à « 1,0 % contre 0,8 % », barres à « 0,98 % » et « 0,78 % » (capture du 04/10) : une seule précision |
| Tendance hebdomadaire sur 26 semaines | Absentéisme | La tendance se dégrade-t-elle ? | Fusionner | Deux courbes de taux sur la même page (hebdomadaire sur 26 semaines, mensuelle sur 24 mois + prévision), avec trois moyennes : 0,77 %, 0,79 %, 0,80 % (capture du 04/10). Garder la courbe mensuelle avec prévision, et l'hebdomadaire en option « Afficher par semaine » |
| Taux par département ou par équipe | Absentéisme | Quel groupe examiner ? | Garder | En ambre dès 0,01 pt au-dessus de la moyenne (« Direction des ressources h… 0,78 % » contre 0,77 %) : la couleur « à surveiller » signale un écart sans portée. Prévoir un seuil (par exemple 1,2 × la moyenne, déjà utilisé par Équipes) |
| Prévision à 3 mois (sélecteur de périmètre) | Absentéisme | Une hausse arrive-t-elle ? | Garder (courbe unique) | Le sélecteur « Périmètre affiché » double le filtre Département de la page (U7) |
| Pic prévu par équipe (barres, 20 au plus) | Charge | Quelles équipes décharger ? | Garder | Renommer la tension (U1). Équipes nommées « Raja Rebai » (Prénom Nom, T4 ouvert) |
| Pic prévu par département | Charge | Quel département ? | Garder | Noms tronqués « Direction des systèmes d'i… » (I3). Le tableau « Départements » du détail fait doublon avec « Voir les données » |
| Heures sup de l'entreprise, observées et prévues | Charge | Tendance générale ? | Masquer | Les KPI 2 et 3 donnent déjà le dernier mois et la prévision. À passer dans le détail |
| Courbe de l'équipe avec seuil (manager) | Charge | Mon équipe va-t-elle dépasser ? | Garder | Le seuil y est déjà tracé en tirets, d'où le KPI « Seuil de tension » inutile (U9) |
| Formations non terminées par mois d'échéance | Formations | Quand relancer ? | Garder | Clair, titre-message |
| Formations à risque par département ou par intitulé | Formations | Où relancer ? | Garder | |
| Carte des équipes (treemap) | Équipes | Quelles équipes cumulent des signaux ? | Masquer (repliée) | 157 rectangles, déjà retirée sur mobile au-delà de 30 équipes ([equipes:28](../../../src/app/(app)/equipes/page.tsx)). Le tableau trié par tension répond mieux à la question |
| Arbre hiérarchique coloré | Organigramme | Qui encadre qui ? | Fusionner dans Équipes | Vue « Organigramme » à côté du tableau |
| Effectif observé et projeté (bande à 80 %) | Prévisions | Combien serons-nous dans 12 mois ? | Garder | |
| Masse salariale observée et projetée | Prévisions | Tiendrons-nous le budget ? | Garder | |
| Courbe de maintien (Kaplan-Meier) | Rétention | Quelle part des embauchés reste ? | Garder (RH) | Passer la note du log-rank (χ², degrés de liberté, p) dans « Comment lire » (C4) |
| Statut des recommandations par type (100 %) | Interventions | Les recommandations sont-elles suivies ? | Déplacer vers Recommandations | Remplace le bloc d'adoption. « Rejetées » de 55 à 70 % parce que les 110 recommandations remplacées par recalcul y sont comptées (C2) |
| Niveau de risque avant / après (100 %) | Interventions | L'action est-elle suivie d'une baisse ? | Masquer tant qu'aucune mesure n'est complète | Vide dans la démo (« Aucune mesure complète pour l'instant ») |
| Barre d'adoption (HTML) | Recommandations | Où en sont les recommandations ? | Déplacer | Vers la partie suivi, avec le graphique ci-dessus |

## 4. Tableaux

| Écran | Tableau | Colonnes | Tri | Pagination | Recherche | Constat |
|---|---|---|---|---|---|---|
| Tableau de bord | Niveaux de risque par département | 6 (RH, avec « Lift moyen »), 5 (manager) | Oui | Non (8 lignes) | Non | Doublon du graphique par département. À replier. « Lift moyen » est un terme de modèle : sa place est sur Transparence |
| Synthèse | Passés en risque élevé / Sortis du risque élevé | 4 et 5 | Oui | 10 par page | Non | Correct. « Matricule » en colonne séparée : aurait sa place sous le nom, comme sur Formations |
| Absentéisme | Signaux individuels (RH) | 4 | Oui | 10 | Non | Correct, état vide présent |
| Charge | Équipes en tension | 5-6 | Oui | 25 | Non | Doublon du graphique « pic prévu par équipe » |
| Charge | Départements | 5 | Oui | — | Non | **Supprimer** : déjà dans « Voir les données » du graphique par département |
| Charge | Surcharges individuelles (RH) | 6 | Oui | 25 | Non | Utile |
| Formations | À risque / Déjà en retard | 6 (RH) / 4 | Oui | 10 | Non | Listes plafonnées et signalées (IA.md). Correct |
| Équipes | Équipes triées par tension | 7 | Oui | 25 (défaut de `DataTable`) | Non | 157 lignes sans recherche par manager (U15). Hauteur bloquée à 75vh (`maxHeight`) en plus de la pagination : double défilement |
| Prévisions | Projection par département | 6 | Non (tableau local) | — | Non | Déjà relevé (IA.md, non fait). Acceptable sur 8 lignes |
| Prévisions | Effectif actuel par grade | 4 (avec « Salaire de base moyen ») | Non | — | Non | Aucune décision associée sur cet écran. **À replier** |
| Interventions | Ce qui change après l'action | 6 | Non | — | Non | Dans la démo : 5 lignes de « — » et « Aucune mesure complète » (capture du 04/10). Masquer tant que la mesure est nulle |
| Interventions | Actions réalisées | 7 | Non | Oui | Non | Tableau maison, sans tri (contrairement à `DataTable`) |
| Recommandations | Liste en cartes | — | Ordre fixé par le serveur | 25 | Non (3 filtres) | Correct. Le bloc d'adoption repousse la liste sous le premier écran |

États vide et chargement : chaque écran du périmètre a son `loading.tsx` et son `error.tsx` (vérifié par Glob). Les états vides suivent le schéma quoi / pourquoi / action (ACTION.md, PILOT.md).

## 5. Problèmes UX

| # | Problème | Écran | Gravité | Effort | Impact | Recommandation |
|---|---|---|---|---|---|---|
| U1 | **T1 toujours ouvert** : KPI « Équipes en tension » sur Charge ([charge/page.tsx:142, 290, 359](../../../src/app/(app)/charge/page.tsx)) et sur Équipes ([equipes/page.tsx:38](../../../src/app/(app)/equipes/page.tsx)), avec deux définitions et deux chiffres. Les deux écrans figurent dans le parcours de démonstration ([DEMO.md](../../DEMO.md), étape 4) | Charge, Équipes | P0 | faible | Chiffres contradictoires devant le jury | Sur Charge : « Équipes en surcharge prévue » (KPI, titre de section, bulle `Def id="tension"`) |
| U2 | Recommandations éclatées : /recommendations et le compteur « À traiter » ne comptent que les recommandations de départ ([dashboard:126](../../../src/app/(app)/dashboard/page.tsx), [synthesis.ts:188](../../../src/lib/dal/synthesis.ts)). Les 86 recommandations par sujet se décident sur 4 autres pages ([absenteeism:334](../../../src/app/(app)/absenteeism/page.tsx), [charge:277](../../../src/app/(app)/charge/page.tsx), [formations:314](../../../src/app/(app)/formations/page.tsx), [previsions:498](../../../src/app/(app)/previsions/page.tsx)) | Tableau de bord, Synthèse, Recommandations | P1 | moyen | La RH lit « 72 recommandations à décider » sans savoir que 86 recommandations par sujet existent ailleurs ([DEMO.md](../../DEMO.md)) | Court terme : un raccourci par sujet dans « À traiter », pointant vers l'ancre `#actions` de chaque page. Ensuite : /recommendations comme boîte unique, avec un filtre « Sujet » |
| U3 | Tableau de bord : premier KPI vers 630 px à 1 440 px, sous l'encart d'aide, le bandeau, 6 listes et « Filtres actifs : aucun » (capture du 04/10) | Tableau de bord | P1 | faible | La situation n'est pas visible à l'ouverture | Niveau 1 du § 2 : Période et Département visibles, le reste sous « Plus de filtres », `PageIntro` replié dans le « ? » du titre |
| U4 | Aucune priorité sur le tableau de bord : 7 KPI de même poids, aucun `tone`. La liste « À traiter en priorité » n'existe que sur la Synthèse | Tableau de bord | P1 | moyen | Le RH ne sait pas par où commencer | Reprendre `StatementList` de la Synthèse en tête du tableau de bord (hiérarchie du § 2) |
| U5 | Menu manager : « Mon équipe », « Mes équipes », « Organigramme » ([sidebar.tsx:29-31](../../../src/components/layout/sidebar.tsx)), trois entrées pour le même périmètre, dont deux aux libellés presque identiques | Menu | P1 | faible | Hésitation à chaque visite | Garder « Mon équipe » (collaborateurs) et « Équipes » ; l'organigramme devient une vue d'Équipes |
| U6 | Menu RH : 20 entrées, dont 13 de pilotage | Menu | P1 | moyen | Charge de mémoire, fonctions qui se recoupent | Retirer du menu Synthèse (bouton du tableau de bord, déjà présent), Organigramme (bouton d'Équipes, déjà présent) et Interventions (lien « Voir les interventions » de Recommandations, déjà présent). Pages conservées. Adapter `tests/e2e/navigation.spec.ts:11, 15, 130-158` |
| U7 | Absentéisme : deux contrôles de périmètre, le filtre « Département » et le sélecteur « Périmètre affiché » de la prévision (capture du 04/10) | Absentéisme | P2 | faible | On ne sait pas lequel s'applique | La prévision suit le filtre de la page. Supprimer le sélecteur |
| U8 | Prévisions : le formulaire « Tester un autre scénario » (4 champs) s'intercale entre « En bref » et les graphiques. « Graphiques affichés pour » est mêlé aux hypothèses et oblige à cliquer sur « Recalculer la projection » ([previsions:321-333](../../../src/app/(app)/previsions/page.tsx), capture du 04/10) | Prévisions | P2 | faible | Les graphiques passent sous la ligne de flottaison | Formulaire replié (ouvert si scénario simulé), choix du département sorti du formulaire |
| U9 | Charge, manager : KPI « Seuil de tension » ([charge:399](../../../src/app/(app)/charge/page.tsx)), un paramètre présenté comme un indicateur | Charge | P2 | faible | Une carte sur trois ne mesure rien | Retirer : le seuil figure déjà dans le graphique et la réponse |
| U10 | Interventions dans la démo : KPI à « — » ou « Aucune mesure complète », tableau des écarts rempli de « — » (capture du 04/10) | Interventions | P2 | faible | Un écran presque vide affiché comme un tableau de bord | Tant que `t.measured = 0`, n'afficher que le statut des recommandations et le message d'attente (après la fusion du chantier CAUSAL) |
| U11 | KPI Turnover → « Voir la rétention des embauchés » ([dashboard:374-375](../../../src/app/(app)/dashboard/page.tsx)) : le lien mène à un autre indicateur (cohortes d'embauche), pas au détail du turnover | Tableau de bord | P2 | faible | Rupture de lecture | Pointer vers la courbe du turnover (niveau 4), ou retirer le lien |
| U12 | **T5 toujours ouvert** : périodes par défaut différentes (12 mois sur le tableau de bord, 26 semaines sur Absentéisme ([absenteeism:167](../../../src/app/(app)/absenteeism/page.tsx)), 3 mois sur Équipes, 1 mois sur la Synthèse). L'absentéisme de l'entreprise apparaît à 0,8 %, 0,6 %, 0,77 %, 0,79 %, 0,80 % (captures du 04/10) | Tableau de bord, Absentéisme, Équipes, Synthèse | P2 | moyen | Aucun chiffre de référence | Absentéisme par défaut en « Mois » (12 mois), et période écrite dans chaque libellé de KPI |
| U13 | Recommandations : bloc « Où en sont les 182 recommandations ? » + 4 KPI avant la liste à décider ([recommendations:109-162](../../../src/app/(app)/recommendations/page.tsx)) | Recommandations | P2 | faible | L'action principale descend sous le premier écran | Replier le bloc, ou le déplacer vers le suivi (U6). Libellés visés par `tests/e2e/recommendations.spec.ts:135` |
| U14 | Filtre « Niveau de risque » partiel sur le tableau de bord ([dashboard:321-325, 332](../../../src/app/(app)/dashboard/page.tsx)) | Tableau de bord | P2 | faible | Un filtre qui ne filtre qu'une partie de la page | Retirer : le KPI et les barres ouvrent déjà la liste filtrée par niveau |
| U15 | Équipes : 157 lignes sans recherche, filtre par département seulement | Équipes | P3 | faible | Retrouver l'équipe d'un manager oblige à paginer | À vérifier : si la recherche Ctrl K trouve un manager, le dire dans l'en-tête du tableau |
| U16 | Rétention, manager : courbe arrêtée sous 5 personnes suivies (`minAtRisk = MIN_GROUP_SIZE`, [retention.ts:169](../../../src/lib/dal/retention.ts)) ; pour une équipe de 9, page probablement vide ou très courte | Rétention | P3 | faible | Entrée de menu qui mène à un état vide | À vérifier sur `mgr.M10451`. Si confirmé, retirer l'entrée du menu manager |

## 6. Problèmes UI

| # | Problème | Écran | Gravité | Effort | Recommandation |
|---|---|---|---|---|---|
| I1 | Courbe d'effectif : axe de 1 068 à 1 078 (capture du 04/10). L'axe ne part de 0 qu'en dessous de 50 personnes ([dashboard:164](../../../src/app/(app)/dashboard/page.tsx)) | Tableau de bord | P2 | faible | Supprimer la courbe (§ 2), ou faire partir l'axe de 0 |
| I2 | KPI de 1 000 ou plus sans séparateur visible : « 1069 » (tableau de bord), « 1168 » (organigramme), alors que le texte courant affiche « 1 168 » (captures du 04/10). `fmt.int` utilise `Intl` (espace fine insécable) | Tableau de bord, Organigramme | P2 | faible | À vérifier : rendu de l'espace fine avec `tabular-nums` dans Segoe UI. Sinon, remplacer par une espace insécable dans les valeurs de KPI |
| I3 | **T26 toujours ouvert** hors du tableau de bord : « Direction des systèmes d'i… », « Direction des ressources h… » (captures Charge et Absentéisme du 04/10) | Charge, Absentéisme | P2 | faible | Utiliser `shortDepartment` (déjà utilisé par le tableau de bord) dans `departmentBars` et `groupBars` |
| I4 | KPI Absentéisme : la flèche « ▼ » seule sur sa ligne, puis « −0,2 pt en août 2026 vs sept. 2025 » (capture du 04/10) | Tableau de bord | P3 | faible | Raccourcir le libellé (« −0,2 pt vs sept. 2025 »), sujet lié à C5 |
| I5 | Titres de visuels avec noms longs (« Direction de la production regroupe 28 % de l'effectif », « Direction logistique : … ») au-dessus d'axes en noms courts (« Production », « Logistique ») | Tableau de bord | P3 | faible | Même nom court dans le titre et sur l'axe |
| I6 | « Données AJIR au 31/08/2026 » trois fois au-dessus de la ligne de flottaison (barre du haut, pied du menu, en-tête), plus la note de source | Tous | P3 | faible | Garder la puce de la barre du haut. Dans l'en-tête de page, ne dire que la période |
| I7 | Sous-titres de visuels sur 2 ou 3 lignes, qui listent les couleurs (« rouge : tension probable · ambre : possible · tirets : seuil de tension », [charge:214](../../../src/app/(app)/charge/page.tsx)) | Charge, Tableau de bord, Formations | P3 | faible | Couleurs dans la légende, sous-titre limité à mesure, unité, périmètre, période |
| I8 | Organigramme : l'arbre commence vers 750 px, après un encart d'aide de 5 lignes (charte § 1 : 3 au plus), un avis sur les rattachements corrigés et 3 KPI sans décision (capture du 04/10) | Organigramme | P3 | faible | Sans objet si la page est fusionnée (U5). Sinon, encart replié et KPI retirés |
| I9 | Bouton primaire d'en-tête « Voir les alertes d'absentéisme » ([absenteeism:154](../../../src/app/(app)/absenteeism/page.tsx)) : un bouton principal qui ne fait que naviguer | Absentéisme | P3 | faible | Variante secondaire |
| I10 | « Filtres actifs : aucun » toujours affiché (capture du 04/10) | Tableau de bord, Rétention | P3 | faible | N'afficher la ligne que s'il y a des filtres. Libellé visé par les tests E2E, à adapter |

## 7. Contenu

| # | Texte | Problème | Proposition |
|---|---|---|---|
| C1 (P1) | « 1,9 % des 987 évalués » ([dashboard:357](../../../src/app/(app)/dashboard/page.tsx)), « 19 collaborateurs en risque élevé, soit 1,9 % des évalués » ([messages.ts:53](../../../src/app/(app)/dashboard/messages.ts)) | La part « Élevé » est fixée par la capacité d'entretiens (2 %, CONVENTIONS « Niveau de risque ») : le pourcentage se lit comme un taux de risque mesuré. Même effet sur la variation jugée « favorable » ou « à surveiller » sur la Synthèse ([synthese:186](../../../src/app/(app)/synthese/page.tsx)) | « 19 collaborateurs à recevoir en priorité (capacité d'entretiens : 2 % des 987 évalués) ». Variation sans jugement (`good: "neutral"`) |
| C2 (P1) | « Rejetées » de 55 à 70 % par type d'action (capture Interventions du 04/10), « Taux d'adoption » ([recommendations:134](../../../src/app/(app)/recommendations/page.tsx)) | Les 110 recommandations « Remplacée : recalcul » ([DEMO.md](../../DEMO.md)) sont comptées comme des refus de la RH | Statut affiché « Remplacée », hors du dénominateur. T15 (deux noms pour le même indicateur) reste ouvert |
| C3 (P1) | « entre le calcul de juil. 2026 et celui de août 2026 » ([synthese:116](../../../src/app/(app)/synthese/page.tsx), capture du 04/10) | **T13 toujours ouvert**, sur le premier écran du parcours de démonstration. Mois abrégés par `formatMonth` ([labels.ts:27](../../../src/components/pilotage/labels.ts)) dans le titre, mois complet (« juillet 2026 ») dans les constats | « celui d'août 2026 ». Mois en toutes lettres dans les phrases |
| C4 (P1) | « IC à 95 % : 88,4 – 92,9 % » ([retention:144](../../../src/app/(app)/retention/page.tsx)), « Test du log-rank : χ² = … pour N degrés de liberté, p = … » ([:193](../../../src/app/(app)/retention/page.tsx)), « les autres sont censurées » ([:167](../../../src/app/(app)/retention/page.tsx)), « risque spécifique… risques concurrents » ([:224](../../../src/app/(app)/retention/page.tsx)) | Vocabulaire de statisticien, absent de CLARTE § 2. Seuls « Kaplan-Meier » et « censure » ont une bulle ([terms.ts:196-203](../../../src/lib/help/terms.ts)) | « Fourchette probable à 95 % ». Garder seulement « écart net / pas d'écart net » (déjà dans le titre), le reste dans « Comment lire ». « encore présents à la date des données » au lieu de « censurées » |
| C5 (P2) | « Variation : août 2026 comparé à sept. 2025 » ([dashboard:346](../../../src/app/(app)/dashboard/page.tsx)), KPI Absentéisme « Taux moyen sur les 12 derniers mois » avec une variation mois contre mois ([:384-386](../../../src/app/(app)/dashboard/page.tsx)) | Référence ni mois précédent ni année précédente (charte § 4). La valeur (moyenne) et la flèche (écart entre deux mois isolés) ne parlent pas de la même chose | Variation contre le même mois de l'année précédente, ou contre les 12 mois précédents pour une moyenne |
| C6 (P2) | « Formations obligatoires réalisées » (tableau de bord : terminées sur échues, même en retard, [dashboard.ts:342](../../../src/lib/dal/dashboard.ts)), « Réalisées à l'échéance » ([formations:258](../../../src/app/(app)/formations/page.tsx)), « Formations obligatoires en retard » (Synthèse) | Trois mesures pour un même sujet. Le chiffre du tableau de bord correspond à l'aide « terminées même en retard » de Formations, pas à son grand chiffre | Une mesure de référence, « Réalisées à l'échéance », sur les trois écrans |
| C7 (P2) | 1 069 (« CDI et CDD »), « 1 168 actifs, tous contrats » (sous-titre du graphique de risque, Organigramme), 987 évalués | Trois effectifs sur le même écran (capture du 04/10, graphiques 1) | Un effectif de référence (CDI et CDD), les autres expliqués dans une bulle |
| C8 (P2) | « Heures sup par ETP » (Charge), « Heures supplémentaires par personne » ([synthese:219](../../../src/app/(app)/synthese/page.tsx)), « Heures sup. par pers. / mois » ([equipes:273](../../../src/app/(app)/equipes/page.tsx)), « Heures sup. » ([interventions:144](../../../src/app/(app)/interventions/page.tsx)) | **T2 toujours ouvert** | Une mesure et un libellé : « Heures supplémentaires par ETP et par mois » |
| C9 (P2) | Périmètre du manager : « Votre équipe et toute votre hiérarchie » (tableau de bord), « Votre équipe (périmètre hiérarchique) » (Synthèse), « Vos équipes (9 collaborateurs) » (Absentéisme), « Vos équipes d'au moins 5 personnes » (Charge), « Votre périmètre » (Équipes), « Votre équipe (N collaborateurs) » (Formations), « Votre hiérarchie » (Organigramme) | 7 formulations pour un même périmètre | Une formule (« Votre équipe : N collaborateurs »), complétée seulement si un seuil s'applique |
| C10 (P2) | Sous-titre d'Équipes : « Tableau de bord par équipe : signaux de difficulté et niveau de tension » ([equipes:112](../../../src/app/(app)/equipes/page.tsx)) | Se confond avec l'écran « Tableau de bord » | « Signaux de difficulté et niveau de tension, équipe par équipe » |
| C11 (P3) | « calibrées sur les erreurs passées des modèles effectif-v1-20260930 et masse-v1-20260930 » ([previsions:463](../../../src/app/(app)/previsions/page.tsx), version brute de [ai-workforce.ts:205](../../../src/lib/dal/ai-workforce.ts)) | **T6 toujours ouvert** ici (corrigé ailleurs par `fmt.model`) | `fmt.model(...)` |
| C12 (P3) | « Source : agrégats mensuels » / « calcul détaillé sur la population filtrée » ([dashboard:447](../../../src/app/(app)/dashboard/page.tsx)), colonne « Lift moyen » ([:611](../../../src/app/(app)/dashboard/page.tsx)) | Détail technique sur l'écran d'accueil | Dans le détail replié (niveau 4). Lift sur Transparence |
| C13 (P3) | « les taux peuvent différer légèrement de ceux du haut de page » ([forecast-section.tsx:77](../../../src/components/ai/absenteeism/forecast-section.tsx)) | L'écran signale lui-même son incohérence (T5) | À retirer une fois U12 et la courbe unique en place |
| C14 (P3) | Dans la même liste : « N à traiter » ([reco-status-form.tsx:219](../../../src/components/ai/workload/reco-status-form.tsx)) et le statut « En attente de décision » ([:32](../../../src/components/ai/workload/reco-status-form.tsx)). Filtre « Proposée (en attente de décision) » ([recommendations:20](../../../src/app/(app)/recommendations/page.tsx)) | T3 corrigé pour les boutons, mais 3 mots restent pour le statut | « À décider » partout (proposition du catalogue) |
| C15 (P3) | « Données simulées : les chiffres illustrent la méthode, pas une entreprise réelle. » ([retention:217](../../../src/app/(app)/retention/page.tsx)) | Seul écran à le dire | À arbitrer : bandeau de démonstration commun, ou rien |
| C16 (P3) | « {n} équipe(s) de votre périmètre non affichée(s) » ([charge:404](../../../src/app/(app)/charge/page.tsx)) | **T20 toujours ouvert** | Accord selon le nombre |

## 8. Proposition de simplification

**Supprimer**
- Tableau de bord : « Répartition des niveaux de risque », « Effectif par département », courbe d'effectif, filtre « Niveau de risque ».
- Charge : tableau « Départements » (doublon de « Voir les données »), KPI manager « Seuil de tension ».
- Absentéisme : sélecteur « Périmètre affiché » de la prévision (la page a déjà son filtre).

**Fusionner**
- Synthèse dans le tableau de bord : « À traiter en priorité » devient le niveau 1. La Synthèse reste le rapport imprimable du mois, hors menu.
- Organigramme dans Équipes, sous forme de vue (Tableau / Organigramme). La treemap est repliée.
- Interventions dans Recommandations (partie « Suivi », avec le bloc d'adoption et le graphique de statut). T15 est réglé par un seul indicateur.
- Absentéisme : deux courbes de taux réunies en une (mensuelle avec prévision, hebdomadaire en option).
- À terme : une seule boîte de recommandations (départ + 4 sujets), filtre « Sujet ».

**Déplacer**
- `PageIntro` (« À quoi sert cette page ») vers le « ? » à côté du titre, sur toutes les pages qui l'utilisent (T10 ouvert).
- Colonne « Lift moyen » et note de source du tableau de bord vers le détail replié ou Transparence.
- Choix « Graphiques affichés pour » hors du formulaire de scénario (Prévisions).

**Masquer (replier, « Voir… »)**
- Tableau de bord : courbes du turnover et de l'absentéisme, KPI Formations et Masse salariale, tableau des niveaux par département, filtres Contrat / Tranche d'âge / Ancienneté.
- Prévisions : « Tester un autre scénario » (ouvert si scénario simulé), « Effectif actuel par grade ».
- Charge : courbe de l'entreprise.
- Interventions : KPI d'écarts et graphique avant / après tant qu'aucune mesure n'est complète.
- Recommandations : bloc d'adoption au-dessus de la liste.

**Simplifier**
- « Équipes en tension » → « Équipes en surcharge prévue » sur Charge (U1).
- Une période de référence et une précision par indicateur (U12, C5, C6, C8).
- Vocabulaire de la Rétention (C4) et part « Élevé » présentée comme une capacité (C1).
- Menu : RH, 13 → 10 entrées de pilotage ; manager, 10 → 8 (sections « Vue d'ensemble » et « Collaborateurs » réduites à « Tableau de bord », « Alertes », « Mon équipe », « Équipes »).

---

## Notes proposées

- **UX : 6/10.** Parcours solides (clic vers la liste, retours contextuels, « À traiter »), mais 20 entrées de menu, des recommandations dispersées sur 5 écrans et un tableau de bord qui ne dit pas par où commencer.
- **UI : 7,5/10.** Kit Power BI cohérent et charte respectée (titres-messages, « Voir les données », états vides). Restent une hiérarchie plate, des réglages au-dessus de la ligne de flottaison, des noms tronqués et un axe d'effectif trompeur.
- **Lisibilité : 6/10.** Les titres-messages aident, mais un même indicateur prend 3 à 5 valeurs selon l'écran (absentéisme, heures sup, effectif), et les sous-titres de 2 à 3 lignes alourdissent les visuels.
- **Contenu RH : 6,5/10.** Contenu utile et prudent (estimation, facteurs associés, petits groupes). Mais la capacité d'entretiens est lue comme un taux, les recommandations remplacées passent pour des rejets, et la Rétention reste écrite pour des statisticiens.
