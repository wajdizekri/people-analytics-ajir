# Audit accessibilité (WCAG 2.1 AA) et UX

Date : 29/09/2026. Référentiel : WCAG 2.1 niveau AA, plus les règles UX de [CONVENTIONS.md](../CONVENTIONS.md) : couleur de risque toujours accompagnée d'un libellé, états chargement / vide / erreur, libellés en français, confirmation des actions sensibles.

Méthode : relecture du code de chaque écran et de chaque composant partagé, calcul des contrastes à partir des couleurs Tailwind. Vérifications faites : `npx tsc --noEmit`, `npx eslint`, `npx vitest run`. L'audit automatisé axe-core n'a pas été lancé, car `next dev` et `next build` sont interdits pendant les travaux parallèles (voir « Restant »).

Périmètre : connexion, activation, accès refusé, gabarit `(app)`, tableau de bord, liste des collaborateurs, alertes, absentéisme, recommandations, santé des données, transparence, console et pages d'administration, composants `src/components/**`. La **fiche collaborateur** (`employees/[id]`) et le **backtesting** sont hors périmètre, car d'autres contributeurs les modifient en parallèle. Les constats relevés au passage figurent dans « Restant ».

Statuts : **Corrigé**, **Conforme** (vérifié, rien à changer), **Restant** (à faire ou à arbitrer).

## 1. Gabarit, navigation, clavier

| # | Constat | Critère | Statut |
|---|---|---|---|
| 1.1 | Pas de lien d'évitement vers le contenu. | 2.4.1 | **Corrigé** : premier élément focalisable « Aller au contenu », visible au focus, vers `main#contenu` (`tabIndex=-1`) dans `(app)/layout.tsx`. |
| 1.2 | Le menu latéral est masqué sous `md` et n'a aucun équivalent : la navigation est impossible sur téléphone. | 1.4.10, 2.1.1 | **Corrigé** : `MobileNav` (`components/layout/sidebar.tsx`), un bouton « Menu » dans l'en-tête avec `aria-expanded` et `aria-controls`. À l'ouverture, le focus va au premier lien. Échap ferme le menu et rend le focus au bouton ; choisir un lien le ferme aussi. Les liens du menu mobile sont plus hauts. La matrice `NAV` et les rôles ne changent pas. |
| 1.3 | Le menu était dans un `<aside>`, donc un repère « complémentaire » inadapté. Les titres de section (« Pilotage »…) étaient de simples `<p>` sans lien avec leur liste. | 1.3.1 | **Corrigé** : conteneur neutre, `<nav aria-label="Navigation principale">` conservé, chaque `<ul>` porte `aria-labelledby` vers son titre de section. Menu collant (`sticky`) sur les pages longues. |
| 1.4 | Titres de section du menu en `text-slate-400` : contraste 2,6:1. | 1.4.3 | **Corrigé** : `text-slate-500` (4,8:1). |
| 1.5 | En-tête : le lien vers `/compte` n'annonce que « identifiant + rôle ». L'identifiant déborde à 320 px. | 2.4.4, 1.4.10 | **Corrigé** : préfixe masqué « Mon compte : », identifiant visible à partir de `sm`, badge de rôle conservé, marges `p-4 md:p-6`. |
| 1.6 | Focus visible : la règle globale `:focus-visible`, placée hors des couches Tailwind, l'emporte sur les `focus:outline-none` des champs. | 2.4.7 | **Conforme**. Ajout : pas de cadre autour des cibles `tabIndex=-1`, pour que le lien d'évitement n'encadre pas tout le contenu. |
| 1.7 | Texte indicatif (placeholder) à environ 50 % de la couleur du texte. | 1.4.3 | **Corrigé** : `#64748b` dans `globals.css`. |
| 1.8 | Animations des squelettes de chargement sans `prefers-reduced-motion`. | 2.3.3 (confort) | **Corrigé** : réduction globale dans `globals.css` et `motion-reduce:animate-none`. |
| 1.9 | Bordures des champs en `border-slate-300` : 1,5:1 face au fond blanc. | 1.4.11 | **Corrigé** : `border-slate-500` (4,8:1) sur les filtres, la connexion, l'activation, les alertes, le journal d'audit, la création de compte, les paramètres et la décision de recommandation. Bordure d'erreur des paramètres : `red-400` (2,8:1) remplacé par `red-600`. |
| 1.10 | Titres de document incohérents (« — People Analytics » ou « — People Analytics AJIR »). `/interdit` n'avait pas de titre. | 2.4.2 | **Corrigé** : tous les écrans du périmètre portent « … — People Analytics AJIR ». La fiche et le backtesting sont à aligner (voir « Restant »). |
| 1.11 | Manager : le menu indique « Mon équipe », mais la page s'intitule « Collaborateurs ». | 3.2.4 | **Corrigé** : titre « Mon équipe » côté manager. |

## 2. Composants partagés

| # | Constat | Critère | Statut |
|---|---|---|---|
| 2.1 | `RiskBadge` : couleur toujours doublée d'un libellé (« Risque Élevé »…). En revanche, « Non évalué » était en `slate-400` (2,6:1). | 1.4.1, 1.4.3 | **Corrigé** : `slate-500`. |
| 2.2 | `Card` impose un `h2`, même sous un `h2` de section (santé des données). | 1.3.1 | **Corrigé** : prop optionnelle `headingLevel` (2 par défaut), `h3` dans le détail d'un import. |
| 2.3 | `RouteError` remplace la page sans titre de niveau 1. | 1.3.1, 2.4.6 | **Corrigé** : le titre de l'erreur devient le `h1`. |
| 2.4 | `RouteLoading` : `aria-live` sur un contenu présent dès le rendu, squelettes exposés. | 4.1.3 | **Corrigé** : `role="status"`, libellé masqué, squelettes en `aria-hidden`. |
| 2.5 | `DataDetails`, l'alternative textuelle des graphiques : tableau sans légende, première colonne sans en-tête de ligne, zone défilante inaccessible au clavier, tous les résumés identiques (« Voir les données »). | 1.3.1, 2.1.1, 2.4.6 | **Corrigé** : prop `caption` (légende du tableau et nom de la zone), `th scope="row"`, zone `tabIndex=0` et `role="region"`, contexte masqué ajouté au résumé (« Voir les données : Absentéisme mensuel »). Rendu visuel inchangé. |
| 2.6 | `Pagination` : total non formaté, liens « Précédent » et « Suivant » sans indication de page. | 2.4.4 | **Corrigé** : `fmt.int` et mention masquée « : page N ». |
| 2.7 | `fmt.date` sur une date seule (`new Date("AAAA-MM-JJ")`) : décalage d'un jour possible selon le fuseau. `fmt.dateTime` dépend du fuseau de la machine (écart serveur/navigateur) et affiche les secondes. `fmt.int` utilise `fr-TN` alors que le reste est en `fr-FR`. Espace sécable avant « % » et « TND ». | Lisibilité, 1.4.10 | **Corrigé** : date seule formatée sans objet `Date`, fuseau explicite `Africa/Tunis`, `jj/mm/aaaa hh:mm`, `fr-FR` partout, espace insécable avant `%`, `TND` et `×` (aussi dans `labels.ts`). |
| 2.8 | `KpiCard` (kit « Power BI ») : le caractère favorable ou défavorable d'une variation n'est porté que par la couleur, et les flèches ▲▼ sont lues « triangle noir ». | 1.4.1, 1.1.1 | **Corrigé** pour les lecteurs d'écran : flèches en `aria-hidden`, mention masquée « (évolution favorable/défavorable) ». Pour les daltoniens, le jugement reste porté par la couleur (sens et signe restent lisibles) : voir « Restant ». |
| 2.9 | `KpiCard` : valeur en 28 px, les montants (« 1 234 567 TND ») débordent de la tuile sur deux colonnes à 320 px. | 1.4.10 | **Corrigé** : `text-2xl` sous `sm`, 28 px au-delà ; tableau de bord en une colonne sous `sm` (seul changement de rendu, et uniquement en largeur mobile). |
| 2.10 | Graphiques ECharts : `role="img"` et `aria-label` sur chaque graphique, mais info-bulles au survol uniquement. | 1.1.1, 2.1.1 | **Conforme** : chaque graphique est suivi d'un tableau de données (`DataDetails` ou tableau visible) : tableau de bord, absentéisme, transparence (tableau de calibration), santé des données, console. |
| 2.11 | Palette catégorielle `CHART_COLORS` : toutes ≥ 3:1 sur blanc (#B98A00 ≈ 3,1:1). La couleur « neutre » `#94a3b8` (non évalués) est à 2,6:1. | 1.4.11 | **Conforme** pour la palette, **Restant** (faible) pour la couleur neutre, compensée par la légende et le tableau. |

## 3. Écrans

### Connexion, activation, accès refusé

| # | Constat | Critère | Statut |
|---|---|---|---|
| 3.1 | Connexion : message d'erreur non relié aux champs, sans `aria-invalid`. | 3.3.1, 1.3.1 | **Corrigé** : `aria-invalid`, `aria-describedby="login-error"`, zone `aria-live`, bordure rouge. |
| 3.2 | Connexion : l'identifiant est effacé après un échec, car l'action réinitialise le formulaire. | UX (3.3) | **Corrigé** : champ identifiant contrôlé. |
| 3.3 | Activation : erreur (mots de passe différents, politique) non reliée aux champs ; libellé « Confirmation » ambigu. | 3.3.1, 2.4.6 | **Corrigé** : `aria-invalid` et `aria-describedby` sur les deux champs, libellé « Confirmation du mot de passe ». |
| 3.4 | Cartes de connexion et d'activation en `p-8` à 320 px. | 1.4.10 | **Corrigé** : `p-6 sm:p-8`. |
| 3.5 | `/interdit` sans titre de document. | 2.4.2 | **Corrigé**. |

### Tableau de bord, collaborateurs, absentéisme, recommandations

| # | Constat | Critère | Statut |
|---|---|---|---|
| 3.6 | Tableau « risque par département » : liens réduits à un chiffre (« 3 »), première colonne sans en-tête de ligne. | 2.4.4, 1.3.1 | **Corrigé** : `th scope="row"` et texte masqué « 3 collaborateur(s) en risque élevé — Production : voir la liste ». |
| 3.7 | Indices non formatés (« Moyen : 1234 »), lift avec espace sécable. | Lisibilité | **Corrigé**. |
| 3.8 | Collaborateurs : en-têtes triables avec « ▲ » lu à voix haute et but du lien implicite. | 1.3.1, 2.4.4 | **Corrigé** : « Trier par Nom, ordre croissant » (masqué), flèche en `aria-hidden`, `aria-sort` conservé ; nom en `th scope="row"`. |
| 3.9 | Absentéisme : synthèse par groupe sans en-tête de ligne ; tableau alternatif sans légende. | 1.3.1 | **Corrigé**. Séries de couleurs multiples : légende et tableau, **Conforme**. |
| 3.10 | Recommandations : collaborateur en `td`. Le rejet d'une recommandation (`DecideForm`, composant partagé, aussi utilisé par la fiche) n'a pas de confirmation. | 1.3.1, 3.3.4 | **Corrigé** : `th scope="row"`, confirmation au rejet. |
| 3.11 | États chargement, vide et erreur. | Conventions | **Conforme** : `loading.tsx`, `error.tsx` et `EmptyState` étaient déjà présents. |

### Alertes

| # | Constat | Critère | Statut |
|---|---|---|---|
| 3.12 | Ni état de chargement ni état d'erreur. | Conventions | **Corrigé** : `alerts/error.tsx`, plus un `Suspense` dans la page (squelette sous l'en-tête). Pas de `loading.tsx` dans `alerts/` : il envelopperait `/alerts/[id]`, dont la redirection 403 et le 404 doivent précéder le streaming, comme pour la fiche. |
| 3.13 | `/alerts/[id]` inexistant : page 404 par défaut de Next, en anglais. | 3.1.2, UX | **Corrigé** : `alerts/[id]/not-found.tsx` en français, avec lien de retour. |
| 3.14 | Rejeter ou traiter une alerte la clôture définitivement, sans confirmation. | 3.3.4 | **Corrigé** : confirmation explicite pour « Rejeter » et « Marquer comme traitée ». |
| 3.15 | Erreur sur le commentaire obligatoire reliée au champ mais non annoncée. | 4.1.3 | **Corrigé** : `role="alert"`. |
| 3.16 | Libellés de filtres incohérents (« Filtrer » ici, « Appliquer » ailleurs) ; flèche « ← » lue. | 3.2.4 | **Corrigé** : « Appliquer » partout, flèches en `aria-hidden`. |

### Santé des données, transparence

| # | Constat | Critère | Statut |
|---|---|---|---|
| 3.17 | Ni `loading.tsx` ni `error.tsx`. | Conventions | **Corrigé** sur les deux écrans. |
| 3.18 | Santé des données : cartes « Par règle », « Par fichier », « Exemples » et « Rapport d'import » en `h2` sous le `h2` de section. | 1.3.1 | **Corrigé** : `h3`. |
| 3.19 | Fichiers absents de l'export en `text-slate-400` ; liste d'exemples défilante inaccessible au clavier. | 1.4.3, 2.1.1 | **Corrigé**. |
| 3.20 | « Recalculer » relance tout le calcul mensuel (scores republiés) sans confirmation ; messages de succès sans `role="status"`. | 3.3.4, 4.1.3 | **Corrigé**. |
| 3.21 | Transparence : tableau des déciles sans légende ; écart golden affiché « 1.2e-10 ». | 1.3.1, 3.1 | **Corrigé** : `caption`, « 1,2e-10 ». Barres d'effet en couleur : `aria-hidden`, signe et texte masqué, **Conforme**. |

### Administration

| # | Constat | Critère | Statut |
|---|---|---|---|
| 3.22 | Utilisateurs, paramètres, journal et console : ni `loading.tsx` ni `error.tsx`. | Conventions | **Corrigé**. |
| 3.23 | Désactivation d'un compte. | 3.3.4 | **Conforme** : confirmation déjà présente. |
| 3.24 | Les messages de succès (désactivation, réactivation, déverrouillage) ne sont jamais affichés. | 4.1.3 | **Corrigé** : `role="status"`. |
| 3.25 | Générer un lien d'activation permet de redéfinir le mot de passe et remplace le lien précédent, sans confirmation. | 3.3.4 | **Corrigé** : confirmation. |
| 3.26 | Création de compte : erreur sur le rôle non reliée au champ ; aucune annonce quand il n'y a que des erreurs de champ. | 3.3.1, 4.1.3 | **Corrigé** : `aria-describedby` et résumé `role="alert"`. |
| 3.27 | Lien d'activation : bouton « Copier » peu explicite ; date formatée côté navigateur. | 2.4.6 | **Corrigé** : « Copier le lien », `fmt.dateTime`. |
| 3.28 | Paramètres : enregistrement sans confirmation, alors qu'il change la répartition des niveaux au prochain calcul ; date de modification formatée côté client (écart d'hydratation possible). | 3.3.4 | **Corrigé** : confirmation qui récapitule « libellé : ancienne valeur → nouvelle valeur » ; `fmt.date`. |
| 3.29 | Journal d'audit : « Filtrer » et « Effacer » ; « anonyme » en `slate-400` ; flèches de pagination lues. | 3.2.4, 1.4.3 | **Corrigé** : « Appliquer » et « Réinitialiser », `slate-500`, flèches en `aria-hidden`. Même correction de contraste dans la console. |
| 3.30 | Identifiant du compte en `td`. | 1.3.1 | **Corrigé** : `th scope="row"`. |

## Restant

État au 30/09/2026 (vérification finale) : les points 1 à 4, 6 et 7 sont faits ; 5, 8, 9 et 10 restent ouverts (arbitrage ou hors WCAG 2.1 AA).

1. **Audit automatisé** — **FAIT** : axe-core (`@axe-core/playwright`, WCAG 2 A/AA) sur 39 pages des quatre profils, nouvelles pages comprises, dans la suite Playwright ; **0 violation** sur le build final. Les deux défauts relevés en cours de campagne (notes de bas de page à 4,36:1, zones défilantes sans accès clavier) sont corrigés : [BUGS_E2E.md](BUGS_E2E.md), A11Y-05 et A11Y-06.
2. **FAIT** — **Fiche collaborateur et backtesting** (hors périmètre, en cours de modification) : titres de document « — People Analytics » sans « AJIR » ; numéros de zone (« 1. », « 4. ») en `text-slate-400` (2,6:1) dans `employee-detail.tsx` et `what-if-panel.tsx` ; flèche « → » en `slate-400` et champs en `border-slate-300` dans `what-if-panel.tsx`.
3. **FAIT** (`src/app/not-found.tsx` en français, contrôlée par axe) — **Page 404 globale** : `src/app/not-found.tsx` absent, donc une URL inconnue affiche la page par défaut de Next, en anglais (racine `src/app`, hors périmètre).
4. **FAIT** — **`/compte`** (écran ajouté en parallèle) : champs de `password-form.tsx` en `border-slate-300` ; association des erreurs à vérifier.
5. **Ouvert (arbitrage de charte)** — **Variation favorable ou défavorable des `KpiCard`** : pour les daltoniens, le jugement reste porté par la couleur. Option sans changer le visuel : infobulle `title`, ou mot court visible (« en hausse, favorable »), à arbitrer avec la charte « Power BI ».
6. **FAIT** — **Couleur « neutre » des graphiques** : `STATUS_COLORS.neutre` passé de `#94a3b8` (2,6:1) à `#7c8aa0` (3,5:1) dans `src/components/charts/pbi.tsx`.
7. **FAIT** (E2E-01 : formulaire non remonté, message annoncé) — **Alertes** : après passage en « En cours », le formulaire est remonté (`key={status}`) et le message « Alerte mise à jour » n'est pas annoncé ; seul le badge change.
8. **Confirmations** : `window.confirm` (natif, accessible au clavier et aux lecteurs d'écran, non stylé). Une boîte de dialogue maison (`<dialog>` avec piège de focus) est possible si la charte l'exige.
9. **Navigation client** : Next annonce le titre de la nouvelle page, mais le focus n'est pas déplacé vers `main` après un changement de page (comportement par défaut, impact faible).
10. **Cibles tactiles** : boutons `text-xs` d'environ 24 px dans le tableau des utilisateurs (critère 2.5.8, WCAG 2.2, non exigé en 2.1 AA).
