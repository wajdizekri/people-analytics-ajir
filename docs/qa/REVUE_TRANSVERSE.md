# Revue transverse de cohérence UI

Relecteur transverse, en lecture seule sur le code. Objet : repérer les incohérences **entre** écrans que chaque agent, centré sur son domaine, ne voit pas. Référentiels : [CHARTE_UI.md](CHARTE_UI.md), [CLARTE.md](CLARTE.md), [DEMO.md](../DEMO.md).

## Méthode

- Parcours Playwright (Chromium headless, un navigateur à la fois) sur le serveur partagé `http://localhost:3000`, avec les trois comptes de démonstration : toutes les entrées du menu, plus une fiche collaborateur, un détail d'alerte, les accès interdits et une fiche inexistante.
- Pour chaque page : capture pleine page à 1440 px et 390 px, puis relevé automatique du DOM (titre, sous-titre, surtitre, actions d'en-tête, boutons et leur style, cartes KPI, titres de visuels, en-têtes de tableaux, états vides, débordement à 390 px, erreurs console, temps de chargement) et recherche de motifs interdits (codes techniques, `null`/`NaN`, anglais, vocabulaire de CLARTE § 2, formats de nombres et de dates).
- Complément statique en lecture : libellés de boutons, de KPI et d'états vides dans `src/`, palettes des graphiques.
- Captures : `docs/qa/captures/revue-transverse/passe-<n>/<rôle>-<page>-<largeur>.png`.

Domaines (agents) cités : **[1] composants partagés**, **[2] tableau de bord et synthèse**, **[3] collaborateurs et fiche**, **[4] absentéisme, charge, formations**, **[5] prévisions, équipes, interventions, recommandations**, **[6] données et modèle**, **[7] administration, alertes, compte, droit d'accès**, **[8] connexion, aide, textes globaux**.

Gravité : **Majeur** = un utilisateur peut tirer une conclusion fausse ou ne pas savoir quoi faire ; **Moyen** = incohérence visible qui ralentit la lecture ; **Mineur** = finition.

## Passes

| Passe | Horaire (01/10/2026) | État du code | Remarques |
|---|---|---|---|
| 1 | 11 h 55 – 13 h 15 | travaux en cours depuis 11 h 40 | serveur indisponible de 12 h 13 à 12 h 50 (processus `next dev` arrêté), puis erreurs 500 intermittentes dues à des fichiers en cours d'édition ; les pages admin ont été capturées avant 12 h 10, les pages RH et manager entre 12 h 55 et 13 h 15. |

## Constats — passe 1

### Majeur

**T1. « Équipes en tension » : même libellé, deux définitions, deux chiffres** — [4] et [5]
- /equipes (RH) : 3 « en forte tension », **13 « en tension »** (= 2 signaux sur 5 : risque, absentéisme, heures sup, formations, recommandations), 41 « à surveiller », sur **157** équipes.
- /charge (RH) : **« Équipes en tension 17 sur 154 »** (= pic d'heures sup prévu au-dessus du seuil de 12,8 h/ETP, « probable » ou « possible »).
- Un RH qui passe d'un écran à l'autre lit deux réponses contradictoires à la même question. Captures : [rh-equipes-1440](captures/revue-transverse/passe-1/rh-equipes-1440.png), [rh-charge-1440](captures/revue-transverse/passe-1/rh-charge-1440.png).
- Proposition : réserver « tension » à un seul écran. Par exemple « équipes en surcharge prévue » sur Charge (c'est un dépassement d'heures sup) et garder « tension » pour Équipes (cumul de signaux), avec deux bulles « ? » distinctes dans `src/lib/help/terms.ts` [8].

**T2. Heures supplémentaires : trois mesures pour le même mois, deux unités** — [2], [4], [5]
- Synthèse : « Heures supplémentaires par personne, août 2026 : **5,7 h** ».
- Charge : « Heures sup par ETP, entreprise, août 2026 (observé) : **7,5 h** » ; graphique « autour de 7,2 h par ETP ».
- Équipes : « heures sup. : **6,2 h** par personne et par mois » (3 mois).
- Manager : 5,0 h (Synthèse) contre 4,6 h (Équipes). Libellés « heures sup », « heures sup. », « heures supplémentaires ».
- Proposition : une mesure de référence (h par ETP et par mois) et un libellé unique « Heures supplémentaires par ETP » sur les quatre écrans ; si deux mesures coexistent, l'écrire (« par personne présente, ≠ par ETP »).

**T3. Décider d'une recommandation : quatre présentations du même geste** — [3], [4], [5]
- /recommendations : « Marquer comme réalisée » **primaire plein** + « Rejeter » rouge plein.
- /formations, /absenteeism, /charge (RecoBoard) : « Marquer comme réalisée » **secondaire contour** + « Rejeter la recommandation » **rouge plein** (le bouton destructif est le plus visible de la zone) + « Remettre à traiter ».
- /previsions : « Marquer comme réalisée » + « Rejeter » + « Remettre en attente de décision ».
- Fiche collaborateur : « Marquer comme réalisée » + « Rejeter avec motif » (secondaire).
- Relevé automatique : « Marquer comme réalisée » rendu 46 fois en primaire et 15 fois en secondaire. Statut écrit « Proposée », « à traiter », « en attente de décision », « à décider » selon l'écran.
- Captures : [rh-recommendations-1440](captures/revue-transverse/passe-1/rh-recommendations-1440.png), [rh-formations-1440](captures/revue-transverse/passe-1/rh-formations-1440.png), [rh-employees_fiche-1440](captures/revue-transverse/passe-1/rh-employees_fiche-1440.png).
- Proposition (convention commune, voir DEMANDES_COMPOSANTS) : « Marquer comme réalisée » (primaire), « Rejeter la recommandation » (destructif, avec motif), « Remettre à décider » (tertiaire) ; statut affiché « À décider / Réalisée / Rejetée ».

**T4. Ordre des noms : « Nom Prénom » ou « Prénom Nom » selon l'écran** — [3], [4], [5], [7], [1]
- Nom Prénom : Collaborateurs (« Trabelsi Wassim »), fiche (« Othmani Omar », manager « Souissi Hazem »), Synthèse, Recommandations, Équipes (« Équipe de Souissi Hazem »).
- Prénom Nom : Alertes (« Risque de départ élevé : Borhen Hamrouni », « Voir la fiche de Borhen Hamrouni »), Charge (« Équipe de Raja Rebai »), Formations (« Relancer Taher Bouslama »), Utilisateurs (« Sonia Gabsi »).
- La même personne n'est pas reconnaissable d'un écran à l'autre (recherche visuelle, tri alphabétique). Proposition : un formateur partagé `fmt.person()` [1] et un ordre unique (Nom Prénom, comme la liste et la fiche).

**T5. Absentéisme : quatre chiffres pour la même équipe, sans rapprochement possible** — [2], [4], [5]
- Manager (équipe de S. Zribi) : 0,9 % (Tableau de bord, moyenne 12 mois), 0,0 % (Synthèse, août), 0,60 % (Absentéisme, 26 semaines), 0,2 % (Équipes, 3 mois).
- RH : 0,8 % / 0,6 % / **0,77 %** / 0,7 % ; deux décimales sur Absentéisme, une ailleurs.
- Effectif du manager : 7 (Tableau de bord, CDI et CDD) contre « 9 collaborateurs » (Absentéisme).
- Proposition : même période de référence pour la carte principale de chaque écran (12 derniers mois), une décimale partout (CLARTE § 3), et le dénominateur écrit quand il diffère.

**T6. Codes techniques visibles** — [6], [7], [2], [3], [4]
- Journal d'audit : actions `employee.view`, `privacy.view`, `auth.login`, cible « employee #429 », détail « source: page · view: MANAGER · salary: false · score: true », résultat « OK », IP « ::1 » ; Console : `access.page`, « route #/employees/79 » ([admin-admin_audit-1440](captures/revue-transverse/passe-1/admin-admin_audit-1440.png), [admin-admin-1440](captures/revue-transverse/passe-1/admin-admin-1440.png)).
- Santé des données : « Code du contrôle : POINTAGE_DUPLIQUE », MATRICULE_INCONNU, SALAIRE_SOUS_SMIG… (admin et RH).
- Transparence : méthodes RIDGE_DIRECT, RIDGE_LOG, STOCK_FLUX, LOGREG, REGRESSION_LOG_SAISONNIERE.
- Identifiant de modèle « logreg-v1-20260930 », « abs-ridge-v1-20260930 », « workload-ridge-v1-20260930 » sur 8 écrans (Tableau de bord, fiche, Absentéisme **y compris pour le manager**, Charge, Vérification a posteriori, Dérive, Transparence) ; nom de lot « mixte_medium_s1 » dans les alertes.
- Proposition : libellé en français, code en infobulle ou dans « Détails techniques » ; hors Transparence, écrire « modèle mis en service le 30/09/2026 » (helper partagé, voir DEMANDES_COMPOSANTS).

**T7. Textes d'alertes stockés hors charte** — [7]
- « Import AJIR mixte_medium_s1 : **15448** ligne(s) rejetée(s) (Pointage en double : 7739 ; Matricule inconnu : 5273…) » : pas de séparateur de milliers, « (s) », code de lot.
- Alertes turnover : « Une **prédiction** est une estimation : à confirmer lors d'un entretien. » (CLARTE § 6 demandait « C'est une estimation, pas une certitude… » ; les alertes déjà en base gardent l'ancien texte).
- Date : « 29 sept. 2026 22:32 » dans la liste, « 29/09/2026 22:32 » dans le détail.
- Proposition : reformuler à l'affichage (ou recalculer les textes) et aligner le format de date.

**T8. Débordement horizontal à 390 px** — [6], [7]
- /admin/users : 981 px ([admin-admin_users-390](captures/revue-transverse/passe-1/admin-admin_users-390.png)) — corrigé depuis par `min-w-0` sur `<main>` [1], à revérifier.
- /data-health : 621 px (admin et RH) ; /transparency : 419 px (cartes Équité « Sexe », « Tranche d'âge »).

### Moyen

**T9. Surtitre d'en-tête (eyebrow) incohérent** — tous domaines, [1]
- Aucun : Tableau de bord, Absentéisme, Formations, Charge, Console, Aide. « PILOTAGE » : Synthèse, Collaborateurs, Équipes, Recommandations, Interventions. « SUIVI » : Alertes. « ESPACE PERSONNEL » : Mon compte. « PROTECTION DES DONNÉES » : Droit d'accès. « PRÉVISION INDICATIVE » : Prévisions (sert d'avertissement). « ADMINISTRATION » : Utilisateurs, Paramètres, Journal, mais pas la Console.
- Le catalogue dit « l'eyebrow reprend la section du menu » : à automatiser dans `PageHeader` à partir de `NAV` [1], sinon à retirer partout.

**T10. Trois patrons d'introduction** — [2], [3], [4], [5], [6], [7]
- « À quoi sert cette page » (`PageIntro`) : Tableau de bord, Synthèse, Équipes, Interventions, Santé des données, Transparence, Dérive, Vérification a posteriori.
- « Question → réponse » (`QuestionAnswer`) : Absentéisme, Charge, Formations ; « En bref » : Prévisions ; rien : Collaborateurs, Recommandations, Alertes, Droit d'accès, Console.
- Proposition : une règle simple (par exemple réponse en une phrase en haut de chaque écran d'analyse, `PageIntro` repliable pour les autres).

**T11. Libellés de filtres et de recherche** — [7], [3]
- Valider : « Appliquer les filtres » (12 écrans, composant `FilterForm`), « Filtrer » (Utilisateurs, Journal d'audit), « Filtrer le registre » (secondaire, Droit d'accès), « Rechercher » (Droit d'accès).
- Effacer : « Réinitialiser les filtres », « Réinitialiser » (Journal), « Effacer les filtres » (code admin).
- Proposition : réutiliser `FilterForm` ou au moins ses deux libellés sur les écrans d'administration.

**T12. Pagination : trois formats, une liste sans pagination** — [3], [7], [1]
- Collaborateurs, Recommandations : « 1–25 sur 1 168 · Page 1 sur 47 », « Suivant : page 2 », « Dernière page ».
- Journal d'audit : « 368 entrée(s) · Entrées 1 à 50 · page 1 sur 8 », « Page suivante → ».
- Alertes : « Liste des alertes (1), page 1 sur 1 ». Utilisateurs : 158 lignes sans pagination (page de 13 000 px).

**T13. Mois et dates** — [2], [4], [5], [6], [1]
- Synthèse mélange « Août 2026 », « août 2026 », « juil. 2026 » et « juillet 2026 » dans la même page.
- Axes : « sept. 24 » (Absentéisme, Charge), « sept. 2024 » (Prévisions), « Septembre 2026 » (Formations).
- Élision : « entre le calcul de juil. 2026 et celui **de août** 2026 » (Synthèse), « Comparaison **de août** 2026 » (Dérive), « Équipe **de Amri** Nadia » (Équipes).

**T14. Couleurs sémantiques divergentes** — [2], [4], [5], [6], [3], [1]
- « Faible » : vert sur le Tableau de bord, **gris** dans les barres de Formations.
- Facteur qui fait baisser le risque : **vert** sur la fiche, **bleu** sur Transparence (« ▼ bleu : associé à un risque plus faible »).
- « À surveiller » : ambre en Synthèse et dans les KPI, **badge bleu** sur Équipes (`TENSION_TONE.SURVEILLER = sky`) ; « Tension » en orange #E66C37 (couleur catégorielle) hors palette sémantique.
- Deux ambres coexistent : `STATUS_COLORS.attention` #b45309 (pbi.tsx, encore utilisé par insights/labels et monitoring) et `SEMANTIC.attention` #d97706 (builders).

**T15. Suivi des recommandations : deux indicateurs pour une idée** — [5]
- Recommandations : « Taux d'adoption 0 % — 0 réalisée sur 110 décidées » ; Interventions : « Taux de réalisation des recommandations 0 % — … sur 182 émises ». Nom et dénominateur différents.

**T16. Mise en service des modèles : consignes contradictoires** — [4], [5], [6]
- Absentéisme, Charge, Formations : « une fois le modèle … mis en service **par l'administrateur** ». Prévisions : « L'administrateur de l'outil doit les enregistrer puis les mettre en service ». Transparence : « La mise en service se fait **hors de l'interface**, par la procédure outillée ». L'administrateur n'a aucun bouton pour le faire. Textes relevés dans le code : ils ne s'affichent que si aucun modèle n'est en service (pas le cas dans la base de démonstration).

**T17. États vides hétérogènes** — [2], [3], [4], [6], [7]
- Titres avec point final (administration, données : « Aucun compte actif. », « Aucun calcul publié. ») ou sans (autres domaines).
- Sans « pourquoi » ni action : « Aucun import terminé. », « Aucune version enregistrée. », « Aucune équipe prévue ce mois-ci », « Aucun département prévu », « Aucun groupe à afficher ».
- « Aucun calcul de risque publié » rédigé de trois façons (Tableau de bord : « le 10 de chaque mois » ; fiche : « au prochain calcul mensuel » ; Santé des données : « Aucun calcul publié. »).

**T18. Tableaux et boutons de l'administration hors gabarit** — [7], [6]
- En-têtes en MAJUSCULES (Console, Utilisateurs, Paramètres) ; casse normale partout ailleurs.
- Boutons sous 40 px : Utilisateurs (« Lien d'activation », « Désactiver » : 26 px), Journal (« Filtrer » : 22 px), Paramètres (30-32 px), Santé des données côté admin (« Lancer l'import » : 20 px, « Relancer le calcul mensuel » : 22 px). Fiche : « Fixer l'augmentation à +3 % » (32 px) [3].

**T19. Suivi d'une alerte : deux formulaires** — [7]
- Alerte n° 1 (admin, 12 h) : choix « Prendre en charge / Rejeter » puis bouton « Enregistrer » (libellé interdit par la charte) ; alerte n° 39 (RH, 13 h) : « Prendre en charge l'alerte » + « Rejeter l'alerte ». Probablement un état intermédiaire : à revérifier en passe 2.

**T26. Noms de départements : trois écritures** — [2], [4], [5]
- Tableau de bord : « Production », « Administrative et financière », « Qualité » ; Absentéisme, Charge, Formations : « Direction de la production », « Direction des systèmes d'information » ; Prévisions : « Direction de la production (PROD) », « (DSI) ». À 390 px, les noms longs sont tronqués (« Direction administrative et »).
- Proposition : un libellé court unique (helper partagé ou colonne `short_label`), code entre parenthèses seulement dans les tableaux.

**T27. Graphiques illisibles à 390 px** — [2], [4], [1]
- Charge : barres « pic d'heures sup par équipe » sans nom une ligne sur deux (étiquettes d'axe sautées) ([rh-charge-390](captures/revue-transverse/passe-1/rh-charge-390.png)).
- Tableau de bord : axe du turnover écrasé (« 10 %, 8 %, 6 %, 4 %, 2 % » superposés) ([rh-dashboard-390](captures/revue-transverse/passe-1/rh-dashboard-390.png)).
- Proposition : `interval: 0` sur les axes de catégories des barres horizontales et hauteur minimale par barre dans les builders [1] ; hauteur mobile suffisante pour les courbes.

### Mineur

- **T20.** Pluriels « (s) » quand le nombre est connu : « ligne(s) rejetée(s) », « 0 compte(s) désactivé(s) », « 368 entrée(s) », « 158 compte(s) » — [7], [6].
- **T21.** Jours abrégés « j » : fiche « 2 j en août 2026, contre 0 j » à côté de « 14 jours » [3] ; Formations « en moyenne 17 j avant l'échéance » [4] ; Console « +7 vs 7 j préc. » [7] (CLARTE : jours en toutes lettres).
- **T22.** « salarié » : Prévisions (« 3 salariés atteignent l'âge légal ») [5] ; signaux Bradford sur Absentéisme et Alertes (« Signal à vérifier avec le salarié ») [4], [7] ; création de compte (« si elle est salariée ») [7].
- **T23.** /alerts côté admin : filtre « Type » proposant Turnover et Absentéisme, sous-titre « Alertes turnover, absentéisme… » alors que l'admin ne voit que données et système — [7].
- **T24.** Fiche inexistante (/employees/99999999) : page sans `h1` — [3].
- **T25.** Champs natifs en anglais dans Chromium headless (« Choose Files / No file chosen », « dd/mm/yyyy ») : dépend de la langue du navigateur, à vérifier sur un poste en français ; un libellé personnalisé l'éviterait — [6], [7].

## Rôles, console, performance — passe 1

- **Rôles : conforme.** Admin → /dashboard et /employees/79 redirigés vers /interdit ; manager → /employees/79, /data-health, /admin, /recommendations redirigés ; aucune occurrence de TND, salaire, probabilité ou lift sur les écrans du manager (hors textes d'aide qui expliquent ces exclusions). À arbitrer : l'admin voit nom, prénom et matricule des managers liés aux comptes (Utilisateurs) et des matricules dans les exemples de rejets (prévu par DEMO.md).
- **Erreurs console** (hors messages de rechargement à chaud) : /transparency « A tree hydrated but some attributes… didn't match » [6] ; /recommendations « Can't perform a React state update on a component that hasn't mounted yet » [5].
- **Performance : non mesurable contre le seuil de 3 s.** Serveur de développement partagé, compilation à la demande et huit agents en parallèle : temps serveur « à chaud » de 0,1 à 20 s. Pages relativement les plus lentes : /transparency (19,7 s), /equipes (16,2 s), /derive (15,9 s), /recommendations (14,3 s), /charge (12,3 s). À mesurer sur un build de production (`npm run start`), hors périmètre de cette revue.
- **Stabilité du serveur partagé** : une erreur de compilation dans un fichier en cours d'édition (`dashboard/page.tsx`, `workload/reco-status-form.tsx`) met **toutes** les pages en 500 ; arrêt complet de 12 h 13 à 12 h 50.
