# Audit produit C : collaborateurs, données, administration, navigation

Date : 04/10/2026. Agent C, lecture seule.

**Périmètre.** Liste des collaborateurs, structure de la fiche (le contenu risque, facteurs et recommandations relève de l'agent F), alertes (structure de la liste et du détail), santé des données, dérive, vérification a posteriori, transparence, console, utilisateurs, journal, paramètres, aide, Mon compte, droit d'accès, connexion, activation, accès refusé, pages 404. Navigation globale : menu (`NAV`, rail réduit, menu mobile), en-tête, recherche Ctrl+K, fils d'Ariane, retours, états.

**Méthode.** J'ai relu le code des écrans et du gabarit (`src/app/(app)/**`, `src/components/layout/**`, `src/components/ux/**`) et lu les audits existants (ERGONOMIE, ACCESSIBILITE, CLARTE, REVUE_TRANSVERSE, CHARTE_UI, DESIGN_SYSTEM, CHANTIER_VISUELS, CHANTIER_IA, ergonomie/COLLAB, COMPTE, UI, ACTION). J'ai regardé 12 captures finales du 04/10 (`docs/qa/captures/design-system/final/`). Je ne reprends un point déjà audité que s'il est encore ouvert dans le code. Dans ce cas, je cite le constat d'origine (ex. « T16 »).

---

## 1. Carte des écrans

| Écran | Rôles | Décision permise | Contenu | Verdict |
|---|---|---|---|---|
| `/employees` (liste) | RH, MANAGER | Choisir qui rencontrer en priorité, ouvrir une fiche, exporter une sélection | Recherche, 2 filtres (+ 4 avancés), tri serveur, 25 lignes, cartes sous 672 px, export CSV | **Garder** |
| `/employees/[id]` | RH, MANAGER | Décider d'un échange ou d'une action pour une personne | En-tête (6 faits), En bref, Quoi de neuf, Faits, Estimation, Parcours, Suggestions, Avant/après, Simulation. Neuf blocs, 6 859 px à 390 px (capture du 04/10) | **Garder, simplifier l'ordre** (§ 5, U5) |
| `/alerts` | tous | Trier les situations signalées, en prendre une en charge | Filtres statut, type, gravité. Cartes de 5 lignes, 50 par page | **Garder** (25 par page, filtre « Ouvertes ») |
| `/alerts/[id]` | tous | Prendre en charge ou clôturer, ouvrir l'élément concerné | Message, attributs, action proposée, suivi, alerte suivante | **Garder** |
| `/data-health` | ADMIN, RH | ADMIN : importer, corriger dans AJIR, relancer. RH : savoir si les chiffres sont fiables (une seule réponse : le verdict) | Verdict, intro, 5 KPI (dont « Service de calcul »), contrôles, import, historique, traitements, tendances | **ADMIN : garder. RH : retirer du menu.** Accès par la date des données de l'en-tête et un bandeau sur le tableau de bord quand l'import est à surveiller |
| `/derive` | ADMIN, RH | Décider d'un réentraînement. La RH ne peut pas le faire (« faire réentraîner le modèle », `derive/page.tsx:44`) | Verdict, intro, 4 KPI, feu par variable, démissions observées/prévues | **RH : masquer** (lien déjà présent dans Transparence, `transparency/page.tsx:1052`). **ADMIN : garder ou fusionner dans Transparence** |
| `/backtesting` | RH | Aucune action. Sert à croire (ou non) au classement | Choix d'une date, 5 KPI (précision, lift, rappel), 3 visuels, liste nominative. Toutes les dates proposées sont dans la période d'apprentissage : « les résultats sont optimistes » (capture du 04/10) | **Fusionner dans Transparence** (section Fiabilité, lien « Vérifier sur une date passée »). Garder l'URL |
| `/transparency` | ADMIN, RH | Expliquer et justifier le classement (éthique, réponse à un collaborateur) | Verdict, comment il décide, fiabilité, équité, suivi, détails techniques repliés | **Garder.** C'est le point d'entrée unique « modèle » |
| `/admin` | ADMIN | Voir ce qui demande une action (service de calcul, import, comptes verrouillés, refus) | Tâches fréquentes, état, sécurité, activité | **Garder** |
| `/admin/users` | ADMIN | Créer, débloquer, désactiver, générer un lien | 5 tuiles-compteurs, formulaire de création déplié, recherche et filtres, tableau de 6 colonnes | **Garder, simplifier** (liste d'abord, formulaire replié) |
| `/admin/audit` | ADMIN | Contrôler qui a consulté quoi, enquêter sur un refus | 5 filtres, période rapide, phrases lisibles, pagination | **Garder** |
| `/admin/settings` | ADMIN | Régler les seuils de calcul et de contrôle | 8 thèmes, barre d'enregistrement collante | **Garder.** À arbitrer : capacité d'entretiens RH et budget de masse salariale sont des décisions RH (U13) |
| `/aide` | tous | Comprendre un terme ou un écran | Recherche, sommaire, rubriques filtrées par rôle | **Garder, déplacer** (icône « ? » dans l'en-tête) |
| `/compte` | tous | Changer son mot de passe, choisir le thème, vérifier son activité | Profil, affichage, mot de passe, droits, activité | **Garder, retirer du menu** (l'avatar de l'en-tête y mène déjà, `layout.tsx:60`) |
| `/confidentialite` | RH | Traiter une demande d'accès, d'opposition ou de rectification dans le délai | Étapes, 4 KPI, recherche, registre | **Garder, déplacer** (hors de « Données et modèle ») **et renommer** (K3) |
| `/login`, `/activation` | tous | Se connecter, définir son mot de passe | Formulaires vérifiés côté client, aide repliable | **Garder** |
| `/interdit`, 404 (globale, app, fiche, alerte) | tous | Comprendre et revenir | Raison selon le rôle, retour à l'accueil du rôle | **Garder** |

---

## 2. Navigation et menu par rôle

**Décompte actuel** (`src/components/layout/sidebar.tsx:17-73`) :

| Rôle | Entrées | Sections |
|---|---|---|
| RH | **20** | 6 (Vue d'ensemble 3, Collaborateurs 5, Analyses 5, Données et modèle 5, Aide et compte 2) |
| MANAGER | 12 | 4 |
| ADMIN | 10 | 3 |

**Constats.**
- **Menu RH trop long.** À 1440 × 900, Dérive, Vérification a posteriori, Droit d'accès, Aide et Mon compte sont sous le bas du menu. Il faut faire défiler le menu lui-même (captures du 04/10 `rh-tableau-de-bord-clair-menu-1440`, `rh-tableau-de-bord-clair-rail-1440-survol` : même le rail de 20 icônes déborde).
- **Section « Collaborateurs » hétérogène.** Elle mêle des listes de personnes (Collaborateurs, Équipes, Organigramme) et des suivis d'actions (Recommandations, Interventions).
- **« Données et modèle » côté RH.** Quatre écrans de contrôle technique, plus un registre juridique (Droit d'accès) sans rapport avec le modèle.
- **Manager : « Mon équipe » et « Mes équipes » se suivent** (`sidebar.tsx:29-30`). Les deux libellés ne diffèrent que d'un « s ». Ce point n'a pas été relevé avant.
- **Doublons dans le menu.** « Mon compte » est aussi l'avatar de l'en-tête. Équipes et Organigramme se renvoient l'un à l'autre (« Voir l'organigramme », « Voir les équipes ») : ce sont deux vues d'un même objet.
- **Points positifs.** La recherche Ctrl+K est bien faite (pages, collaborateurs, alertes, récents, états de chargement et d'erreur). Les fils d'Ariane et les retours `?retour=` sont complets (COLLAB, ACTION). Le lien d'évitement et l'`aria-current` sont en place.

**Menu simplifié proposé** (aucune page supprimée, URL inchangées) :

| RH (14) | MANAGER (9) | ADMIN (7) |
|---|---|---|
| **Vue d'ensemble** : Tableau de bord, Synthèse du mois, Alertes | **Vue d'ensemble** : Tableau de bord, Synthèse du mois, Alertes | **Administration** : Console, Alertes, Utilisateurs et accès, Paramètres, Journal d'audit |
| **Collaborateurs** : Collaborateurs, Équipes (organigramme dans la page) | **Mon périmètre** : Mes collaborateurs, Mes équipes (organigramme dans la page) | **Données et modèle** : Santé des données, Modèle (Transparence, avec la dérive en section) |
| **Actions** : Recommandations, Interventions | **Analyses** : Absentéisme, Formations, Charge de travail, Rétention | |
| **Analyses** : Absentéisme, Formations, Charge de travail, Rétention, Prévisions effectifs | | |
| **Conformité** : Transparence du modèle (liens vers Vérification a posteriori et Dérive), Droit des collaborateurs | | |

Pour tous les rôles, Aide (« ? ») et Mon compte (avatar) passent dans l'en-tête. Pour la RH, Santé des données est atteinte par la pastille « Données AJIR au … », qui devient un lien.

**Version minimale avant la soutenance.** Retirer du menu RH Dérive, Vérification a posteriori et Mon compte, et ajouter le lien manquant Transparence → Vérification. Le menu RH passe de 20 à 17 entrées. Coût : `NAV` et `tests/e2e/navigation.spec.ts:7-16` (listes visible/hidden), puis une relance E2E.

---

## 3. États UI

| Écran | Chargement | Vide | Erreur | Succès | Désactivé |
|---|---|---|---|---|---|
| Liste collaborateurs | `loading.tsx` (squelette liste) | 2 cas : filtres ou aucun actif, raison selon le rôle (`(liste)/page.tsx:189-200`) | `error.tsx` | Export par téléchargement natif | Tri par probabilité absent pour le manager (l. 107) |
| Fiche | **Aucun `loading.tsx`.** Retour au clic seulement depuis la liste (`pending-hint.tsx`) ; rien depuis la palette ou une alerte (U12) | `EmptyState` par zone (opposition, aucun calcul, non évalué, aucune suggestion) | `error.tsx`, `not-found.tsx`, redirection vers `/interdit` | Toasts des décisions | Simulation masquée en cas d'opposition (`[id]/page.tsx:71`) |
| Alertes (liste) | `Suspense` + `AlertsListSkeleton` (pas de `loading.tsx`, choix voulu) | 3 cas (`alerts/page.tsx:100-117`) | `error.tsx` + `Notice` « Filtres invalides » | — | — |
| Alerte (détail) | Aucun (choix voulu pour les 403 et 404) | — | `not-found.tsx`, `/interdit` | Toast + « Enregistrement… » (ACTION D2) | Alerte clôturée : `Notice`, plus de formulaire |
| Santé des données | `loading.tsx` | Import, historique et traitements expliqués selon le rôle | `error.tsx` + `Notice` « Import introuvable » | Toasts d'import (`admin-controls.tsx:101-128`), actualisation automatique | Recalcul (`page.tsx:273-274`) et import (`admin-controls.tsx:249`) désactivés **avec la raison** |
| Dérive | `loading.tsx` | Verdict neutre + `EmptyState` (l. 220, 301, 368), KPI « Non calculé » | `error.tsx` | — | — |
| Vérification a posteriori | `loading.tsx` | Aucun modèle, aucune date, aucun Élevé/Moyen (l. 156, 164, 455) | `error.tsx` | — | — |
| Transparence | `loading.tsx` | Aucun modèle, mesures ou versions (l. 1006, 922, 623) | `error.tsx` | — | — |
| Console | `loading.tsx` | `EmptyState` par visuel + « Tout fonctionne normalement » | `error.tsx` | — | — |
| Utilisateurs | `loading.tsx` | 2 cas (l. 263-274) | `error.tsx` | Toasts (`user-actions.tsx:29-38`) | — |
| Journal | `loading.tsx` | « Aucune entrée… » + « Afficher tout le journal » | `error.tsx` + `Notice` | — | — |
| Paramètres | `loading.tsx` | — | `error.tsx` | Toast | « Enregistrer » désactivé tant que rien n'a changé (`settings-save-bar.tsx:96`) |
| Aide, Mon compte, Droit d'accès | `loading.tsx` | Recherche vide, activité vide, recherche de personne vide | `error.tsx` | Toasts (mot de passe, demandes) | — |
| Connexion | Bouton « Connexion… » | — | Message relié au champ, `aria-live` (`login-form.tsx:105-110`) | Redirection vers la page demandée (`next`) | — |
| Palette Ctrl+K | Indicateur + « Recherche en cours… » | Message selon la saisie | Bandeau + « Réessayer » | Toast de changement de thème | — |

**Bilan.** La couverture est quasi complète et homogène (toasts via `announce`/`toastResult`, désactivations expliquées). Il reste deux trous : la fiche et le détail d'alerte ouverts hors de la liste n'ont aucun indicateur de chargement (U12). Et `RouteError` dit « contactez l'administrateur » même à l'administrateur (`route-states.tsx:13`, U18).

---

## 4. Tableaux

| Tableau | Pagination | Tri | Recherche | Filtres | Colonnes | Responsive |
|---|---|---|---|---|---|---|
| Collaborateurs | Serveur, 25, « 1–25 sur N » | Serveur sur 5 colonnes, phrase de tri, puces en cartes | Nom, prénom, matricule | Département, niveau, + contrat, manager, âge, ancienneté repliés | RH 6, manager 5. « Contrat » sert peu à décider | Cartes sous 672 px (container query). **Double défilement** : tableau en `max-h-[70vh] overflow-auto` dans une page qui défile (`(liste)/page.tsx:237`) |
| Alertes | 50 par page (**25 ailleurs**, `alerts/page.tsx:30`) | Ordre imposé et annoncé (statut, gravité, date) | Aucune (la palette cherche les alertes ouvertes) | Statut, type (selon le rôle), gravité. **Pas de valeur « Ouvertes »** | Cartes de 5 lignes : badges, titre, message, Concerne, Action proposée | Natif (liste). Page très longue avec 50 cartes |
| Journal d'audit | Serveur, `Pagination` commune (ERGONOMIE § 4.9 fait) | Fixe, les plus récentes d'abord | — | Utilisateur, type d'action, résultat, dates, période rapide. Le filtre Utilisateur est un `select` de tous les identifiants (`audit/page.tsx:94-99`, environ 160 comptes) | 4, IP masquée sous lg | Fiches sous md, filtres repliés sous 640 px |
| Utilisateurs | 25, « 1–25 sur 159 » | 4 colonnes | Identifiant, e-mail, nom, matricule | Rôle, état. **L'état est filtré deux fois** : tuiles-compteurs (l. 167-181) et `select` (l. 240-247) | 6. **Colonne Actions coupée à 1440 px**, « Désactiver » tronqué (capture du 04/10 `admin-utilisateurs-clair-menu-1440`, conteneur `lg:overflow-x-auto` l. 277) | Cartes sous lg. 9 444 px à 390 px (acceptable pour un usage sur poste) |

---

## 5. Problèmes UX

| # | Problème | Écran | Gravité | Impact | Recommandation |
|---|---|---|---|---|---|
| U2 | Deux verdicts contraires sur le même modèle, à deux clics d'écart. Dérive : rouge « Action recommandée : envisager un réentraînement ». Transparence : vert « Modèle dans ses cibles ». La dérive affiche pourtant démissions observées/prévues = 1,01, « Dans la cible » (captures du 04/10 `rh-derive-clair-menu-1440`, `rh-transparence-clair-menu-1440` ; `derive/page.tsx:36-46`) | Dérive, Transparence | **P0**, faible | Le jury ou la RH conclut que le modèle n'est pas fiable, ou ne sait pas qui croire | Rouge seulement si observé/prévu sort de la cible. Une dérive des variables avec calibration correcte = « À surveiller » (ambre). Reprendre la même phrase dans le verdict de Transparence |
| U1 | Menu RH de 20 entrées. Quatre écrans techniques (Santé, Dérive, Vérification, et Transparence en partie) sur lesquels la RH n'a aucune décision à prendre. Cinq entrées hors écran à 1440 × 900 (§ 2) | Menu | **P1**, moyen | Recherche visuelle lente, écrans annexes mis au même niveau que le pilotage, Aide invisible | Menu proposé au § 2. Au minimum, retirer Dérive, Vérification a posteriori et Mon compte du menu RH |
| U3 | Le formulaire de création de compte propose « Responsable RH » par défaut (`user-create-form.tsx:21`), le rôle qui voit tous les salaires. 156 comptes sur 159 sont des managers | Utilisateurs | **P1**, faible | Un oubli crée un compte avec accès à toute l'entreprise | Liste sans valeur par défaut (« Choisir un rôle », obligatoire) ou Manager par défaut |
| U19 | Les captures du 04/10 montrent « Service de calcul : Arrêté, Critique » côté RH et le point « Le service de calcul ne répond pas » (`rh-sante-donnees-clair-menu-1440`) | Santé des données, Console | **P1**, faible (à vérifier) | En démonstration, une tuile rouge sur la console et la santé des données | Lancer `npm run worker` avant la soutenance et le vérifier sur la console. Voir aussi U8 |
| U4 | « Mon équipe » (liste) et « Mes équipes » (équipes) se suivent dans le menu manager (`sidebar.tsx:29-30`) | Menu manager | P2, faible | Le manager ouvre le mauvais écran | « Mes collaborateurs » / « Mes équipes ». Garder « Mon équipe » comme titre de page si un E2E le vise |
| U5 | Fiche trop longue avant la décision. À 1440, le haut de l'écran montre l'en-tête, En bref et « Quoi de neuf » ; les zones commencent sous la ligne de flottaison. À 390, l'Estimation arrive vers 2 500 px et les Suggestions vers 4 300 px, sur 6 859 px au total (capture du 04/10 `rh-fiche-collaborateur-clair-menu-390-pleine`). Grade et Famille de métier occupent chacun une carte de l'en-tête | Fiche | P2, moyen | Sur mobile, le manager fait défiler trois écrans avant le niveau de risque | Ordre proposé : en-tête compact (nom, poste, manager, ancienneté), En bref (avec une ligne « Depuis le dernier calcul »), 1 Faits, 2 Estimation, 3 Suggestions, Simulation. Puis, repliés : Quoi de neuf, Parcours, Avant/après. Sous 640 px, replier les sous-blocs de Faits. Grade et famille passent dans Faits |
| U6 | Le badge du menu compte les alertes ouvertes (37), mais le lien mène à `/alerts` avec tous les statuts, clôturées comprises (`sidebar.tsx:190`). Toujours ouvert (ERGONOMIE § 4.7) | Menu, Alertes | P2, faible | Le nombre lu dans le menu n'est pas celui de la liste | Ajouter un statut « Ouvertes » (nouvelles et en cours) au filtre et faire pointer le badge dessus |
| U7 | L'en-tête n'est pas collant (`layout.tsx:39`). Sur mobile, le bouton « Menu » et la recherche disparaissent au défilement. Le menu mobile ne se ferme pas par un toucher hors du panneau (`sidebar.tsx:337-347`, Échap seulement) | Gabarit, 390 px | P2, faible | Sur une fiche de 6 859 px, il faut remonter tout en haut pour naviguer | `sticky top-0 z-20` sur l'en-tête (à vérifier avec `OnThisPage` collant et `scroll-padding`), fermeture au toucher extérieur |
| U8 | La RH voit la tuile « Service de calcul » en rouge « Critique », alors que la bannière dit « Données utilisables, à surveiller » en ambre (`data-health/page.tsx:32-37` contre l. 96-104 ; capture du 04/10) | Santé des données (RH) | P2, faible | Signal contradictoire sur un point où la RH ne peut rien faire | Masquer la tuile pour la RH, ou l'aligner sur le ton du verdict |
| U9 | Intro « À quoi sert cette page » non repliable, répétée à chaque visite. Avec le verdict et « Sur cette page », environ 430 px avant le premier chiffre (Santé, Dérive, Transparence : captures du 04/10). T10 toujours ouvert | Écrans techniques | P2, faible | Page vue dix fois, lue une fois | `PageIntro` dans un `<details>` ouvert à la première visite (mémorisé par page, comme `pa-nav`) |
| U10 | Utilisateurs : formulaire de création toujours déplié au-dessus de la liste (`users/page.tsx:183-205`). L'état est filtrable par les tuiles et par un `select` | Utilisateurs | P2, faible | Débloquer ou relancer un compte oblige à passer le formulaire | Liste d'abord. Formulaire replié, ouvert par « Créer un compte ». Retirer le `select` État |
| U11 | Double défilement dans la liste des collaborateurs (`(liste)/page.tsx:237`) | Liste | P2, faible | La molette défile le tableau ou la page selon la position du pointeur | Garder l'en-tête collant sur la page (`sticky top-0`) et supprimer `max-h-[70vh]` |
| U12 | Fiche et détail d'alerte sans indicateur de chargement quand on les ouvre depuis la palette, une alerte ou un autre écran (voir l'absence de `loading.tsx` au § 3) | Fiche, Alerte | P2, moyen (à vérifier) | Clic sans effet visible pendant le rendu serveur (4 appels DAL pour la fiche) | Même découpage `Suspense` que `/alerts` : contrôles 403/404 avant, contenu en flux |
| U13 | La capacité d'entretiens RH et le budget de masse salariale (qui pilote les recommandations de Prévisions) sont réglés par l'ADMIN. La RH ne peut ni les voir ni les corriger (`settings-labels.ts:166-201`) | Paramètres | P2, moyen (à arbitrer) | Une décision RH dépend de l'administrateur | Arbitrer : section « Règles RH » visible ou modifiable par la RH, ou valeur affichée en lecture dans Prévisions et Tableau de bord |
| U14 | L'ordre des noms varie toujours (T4). « Nom Prénom » dans la liste et la fiche ; « Prénom Nom » dans la palette (`command-palette.tsx:193`), le champ Concerne des alertes (`alerts.ts:134`) et les titres d'alertes (`recommendations.ts:124`, `anomalies/index.ts:389`) | Palette, Alertes | P2, faible (palette) à moyen (titres en base) | « Gabsi Abir » dans la liste, « Abir Gabsi » dans la palette (capture du 04/10) | Formateur commun `Nom Prénom` |
| U15 | Palette : les pages n'ont pas de mots-clés (`command-palette-items.ts:35`). « backtesting », « employés » ou « RGPD » ne trouvent rien. Pour les collaborateurs, la recherche se fait n'importe où dans le nom (`search.ts:35`) : « abs » donne 7 « Gabsi » (capture du 04/10) | Palette | P3, faible | Recherche bruyante ou muette | `keywords` par entrée de `NAV`. Sous 4 caractères, chercher en début de nom ou de prénom |
| U16 | Détail d'alerte : le retour est « ← Toutes les alertes » au lieu du `Breadcrumb` de la fiche. Gravité, type et date sont répétés entre le sous-titre et la liste d'attributs (`alerts/[id]/page.tsx:85-120`) | Alerte | P3, faible | Deux patrons de retour, lecture redondante | `Breadcrumb` « Alertes › titre ». Sous-titre réduit à la date |
| U17 | Journal : filtre Utilisateur en `select` d'environ 160 identifiants (`audit/page.tsx:94-99`) | Journal | P3, faible | Recherche pénible | Champ texte avec `datalist` |
| U18 | `RouteError` : « contactez l'administrateur » est affiché aussi à l'ADMIN (`route-states.tsx:13`) | Toutes | P3, faible | Message absurde pour ce rôle | Texte selon le rôle (ADMIN : « consultez le journal et le service de calcul ») |

---

## 6. Problèmes UI

| # | Problème | Écran | Gravité | Recommandation |
|---|---|---|---|---|
| I1 | Colonne Actions coupée à 1440 px avec le menu déployé : « Désactiver » est tronqué et se trouve sous un défilement horizontal (capture du 04/10 `admin-utilisateurs-clair-menu-1440`, `users/page.tsx:277`) | Utilisateurs | **P1**, faible | Actions empilées (`flex-col`) dans la cellule, ou e-mail et collaborateur lié fusionnés sous l'identifiant pour libérer une colonne |
| I2 | Hiérarchie de la fiche : zones numérotées 1, 2, 3 entremêlées de blocs non numérotés de même poids (Quoi de neuf, Parcours, Avant/après, Simulation). « Aller à » ne liste ni Quoi de neuf ni Parcours (`employee-detail.tsx:245-250`) | Fiche | P2, faible | Blocs annexes en style secondaire (repliés, sans carte pleine), ou ajoutés à « Aller à » |
| I3 | Date des données affichée trois fois à 1280 px et plus : pastille de l'en-tête, pied du menu et sous-titre de page. Le pied du menu n'a pas de `xl:hidden` (`sidebar.tsx:276-283`), alors que le commentaire de `layout.tsx:50-51` prévoit l'inverse. L'identité est aussi affichée deux fois (en-tête et pied du menu) | Gabarit | P3, faible | `xl:hidden` sur la date du pied de menu. Garder l'identité dans l'en-tête seulement |
| I4 | Palette : la ligne d'aide clavier est collée au bord gauche, sans filet. `sm:not-sr-only` remet `padding: 0` et ne rend pas la bordure (`command-palette.tsx:396`, capture du 04/10 `rh-palette-ctrl-k-clair-menu-1440`) | Palette | P3, faible | Envelopper le texte : `<div class="hidden sm:block border-t px-4 py-2">` et un doublon `sr-only` |
| I5 | Couleurs hors jetons (DESIGN_SYSTEM § 1) : pastille ADMIN `fuchsia-*` (`layout.tsx:16`), type d'alerte `text-brand-magenta dark:text-fuchsia-300` (`alerts/page.tsx:145`, `[id]/page.tsx:116`), surtitre de `PageHeader` (`ui/index.tsx:61`) | Gabarit, Alertes | P3, faible | Jeton `--pa-accent-2` (magenta AJIR) en clair et en sombre |
| I6 | Initiales inversées : « GA » dans la liste (`Initials name={lastName firstName}`, `(liste)/page.tsx:315`), « AG » sur la fiche (`employee-detail.tsx:145`) | Liste, Fiche | P3, faible | Même ordre (voir U14) |
| I7 | Surtitre incohérent, encore en partie (T9) : absent sur la liste des collaborateurs et sur Aide. Présent sur Équipes, Organigramme et Mon compte | Liste, Aide | P3, faible | « Collaborateurs » et « Aide et compte », ou dérivé automatiquement de `NAV` |
| I8 | Utilisateurs : bouton primaire « Créer un compte » en en-tête qui renvoie à un formulaire 100 px plus bas, lui-même doté d'un primaire « Créer le compte ». Trois primaires visibles avec « Appliquer les filtres » (capture du 04/10) | Utilisateurs | P3, faible | Le bouton d'en-tête ouvre le formulaire replié (U10). Filtres en secondaire |

---

## 7. Contenu

| # | Texte | Problème | Proposition |
|---|---|---|---|
| K1 | « …faire réentraîner le modèle, puis mettre en service la nouvelle version depuis la console d'administration. » (`derive/page.tsx:44`) | **P1.** Faux : aucun bouton de mise en service dans la console. Transparence dit « hors de l'interface » (`transparency/page.tsx:958`). T16 toujours ouvert | « …demander un réentraînement à l'équipe technique. La mise en service se fait hors de l'interface, par une procédure tracée. » (RH : « Prévenez l'administrateur de l'outil. ») |
| K2 | ADMIN, « Vous pouvez » : « Suivre le modèle et mettre en service une nouvelle version » (`compte/page.tsx:19`) | **P1.** Même contradiction (T16). Aussi `charge/page.tsx:77` et `forecast-section.tsx:65`, hors de mon périmètre (chantier IA) | « Suivre le modèle et sa fiabilité (mise en service par procédure outillée) » |
| K3 | Menu et titre « Droit d'accès », surtitre « Données et modèle » (`confidentialite/page.tsx:196`) | P2. La page couvre accès, opposition et rectification, et ce n'est pas un écran « modèle » | « Droits des collaborateurs », section « Conformité » ou « Collaborateurs » |
| K6 | « Précision au niveau Élevé », « Rappel au niveau Élevé » (`backtesting/page.tsx:330, 342`) | P2. Jargon statistique (CLARTE § 1) | « Part des classés Élevé qui ont démissionné », « Part des démissions repérées » (bulle « ? » conservée) |
| K7 | Verdict de Transparence : « Régression logistique régularisée en service depuis le 30/09/2026 : 3,3 fois plus de démissions… » (capture du 04/10) | P2. Nom de méthode en titre pour la RH | « Modèle statistique en service depuis le 30/09/2026 : 3,3 fois plus de démissions au niveau Élevé. » (méthode dans Détails techniques) |
| K4 | « Quoi de neuf » (`whats-new.tsx:136`) | P3. Registre familier, calque de « What's new » | « Depuis le dernier calcul » |
| K5 | « Absences hors santé non planifiées : 2 j en août 2026, contre 0 j en juil. 2026 » (capture fiche du 04/10) | P3. Jours abrégés et mois abrégé, T21 toujours ouvert | « 2 jours en août 2026, aucun en juillet » |
| K9 | « Les facteurs… associés au départ, pas des causes » dans le verdict **et** dans l'intro de Transparence (`transparency/page.tsx:984`, capture du 04/10) | P3. Répétition à 150 px d'écart | Garder la phrase une seule fois (intro) |
| K10 | « Paramètre(s) d'adresse ignoré(s) » (`confidentialite/page.tsx:206`) | P3. « (s) » alors que le nombre est connu (T20) | Accorder selon `ignored.length` |
| K11 | Sous-titre Utilisateurs : « 159 comptes : 1 administrateur, 2 responsables RH, 156 managers. Un nouveau compte reçoit… » (`users/page.tsx:159`) | P3. Deux lignes, chiffres déjà dans les tuiles | « Créer, débloquer et désactiver les comptes. Un lien d'activation est valable 7 jours. » |
| K12 | Historique des imports : `{i.source}` affiché brut (`data-health/page.tsx:316`) | P3, à vérifier. Nom de lot technique (« mixte_medium_s1 » relevé en T6) | Libellé « Export du JJ/MM/AAAA », lot en infobulle |

---

## 8. Responsive

**À soigner sur mobile** (usage nomade du manager et de la RH) :
- **Alertes** (liste et détail). Priorité : gravité, titre, Concerne, bouton « Traiter ». Déjà en cartes ; passer à 25 par page.
- **Fiche.** Priorité : niveau + 3 facteurs (En bref), suggestions à décider, manager. Les 6 859 px actuels sont à réduire (U5).
- **Liste des collaborateurs.** Priorité : recherche, nom, niveau. Déjà en cartes, avec tri par puces.
- **Connexion, activation, Mon compte (mot de passe).** Déjà conformes (COMPTE, ACCESSIBILITE).

**Sur poste seulement** (aucun débordement toléré, pas d'optimisation) : console, utilisateurs, journal, paramètres, santé des données, dérive, transparence, vérification a posteriori.

**Points ouverts.** En-tête non collant et menu mobile sans fermeture au toucher extérieur (U7). Utilisateurs : 9 444 px à 390 px (acceptable). Aucun débordement horizontal vu sur les captures 390 du 04/10 (fiche, utilisateurs, tableau de bord).

---

## 9. Proposition de simplification

- **Supprimer (doublons, pas de fonction)** : Mon compte du menu (avatar), date des données dans le pied du menu à 1280 px et plus (I3), `select` État des utilisateurs (U10), chiffres du sous-titre Utilisateurs (K11), phrase répétée de Transparence (K9).
- **Fusionner** : Vérification a posteriori et Dérive dans Transparence côté RH (sections ou liens « Vérifier sur une date passée », « Stabilité des données »), avec un seul verdict sur le modèle (U2). Organigramme comme vue d'Équipes (bouton déjà présent). « Quoi de neuf » résumé en une ligne dans En bref.
- **Déplacer** : Droit d'accès vers « Conformité » ou « Collaborateurs ». Aide dans l'en-tête. Santé des données côté RH derrière la pastille « Données AJIR au … » (lien), avec un bandeau sur le tableau de bord si l'import est à surveiller.
- **Masquer** : tuile « Service de calcul » pour la RH (U8), formulaire de création de compte (replié), intro « À quoi sert cette page » après la première visite (U9), blocs annexes de la fiche (repliés).
- **Simplifier** : menu RH 20 → 14, manager 12 → 9, admin 10 → 7 (§ 2). Alertes à 25 par page avec un filtre « Ouvertes » relié au badge (U6). Ordre de la fiche (U5). Rôle obligatoire à la création de compte (U3).

---

## Notes proposées

- **UX : 7/10.** Parcours, retours contextuels, états et confirmations sont solides. En revanche, le menu RH est surchargé, deux verdicts sur le modèle se contredisent et la fiche est longue avant la décision.
- **UI : 7,5/10.** Le design system est cohérent (jetons, squelettes, toasts, rail). Restent une colonne d'actions coupée à 1440 px, quelques doublons visuels (date ×3) et des couleurs hors jetons.
- **Lisibilité : 6,5/10.** Les écrans techniques empilent verdict, intro et KPI avant le contenu. Le jargon reste (précision, rappel, régression logistique) et l'ordre des noms varie entre écrans.
- **Professionnalisme : 7,5/10.** Le rendu est soigné et les rôles sont bien cloisonnés. Mais en démonstration, une alerte rouge « réentraîner » à côté d'un modèle « dans ses cibles », et une consigne de mise en service impossible, entament la crédibilité.
