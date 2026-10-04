# Défauts relevés par les tests end-to-end (Playwright)

Suite : `tests/e2e/` (11 fichiers de specs, 113 tests, dont 39 audits axe) · configuration : `playwright.config.ts` · relance : `npm run test:e2e`.
Options : `E2E_SKIP_BUILD=1` réutilise le build `.next-e2e` ; `E2E_WORKERS=2` parallélise ; `E2E_REUSE_SERVER=1` réutilise un serveur lancé à part avec `node tests/e2e/server.mjs`. Rapport HTML : `npx playwright show-report test-results/e2e-report`.

**Isolation.** `data/app.db` est copiée par l'API backup de better-sqlite3 (source ouverte en lecture seule) vers `data/e2e.db`. Le build va dans `.next-e2e` et `next start` écoute sur `http://localhost:3200` ; Playwright l'arrête en fin d'exécution. `next build` réécrit `tsconfig.json` et `next-env.d.ts` pour son distDir ; ces deux fichiers sont restaurés à l'identique après le build. Si le build échoue (erreur de type dans un fichier en cours d'écriture par un autre contributeur), le script fait 3 essais espacés de 2 minutes.

**Données ajoutées dans `e2e.db` uniquement** : le compte `e2e.verrou` (RH, pour le verrouillage) ; sur l'équipe de `mgr.M10451`, une alerte TURNOVER et un signal individuel d'absentéisme saisi avec l'audience MANAGER (la DAL doit le filtrer) ; les recommandations ENTRETIEN et REVISION_SALARIALE d'un collaborateur de cette équipe.

Chaque défaut ouvert est couvert par un test qui échoue tant qu'il n'est pas corrigé (champ « Test »). Sévérités : Bloquante, Majeure, Moyenne, Mineure.

## Dernière exécution (vérification finale)

30/09/2026 vers 21 h 40, build `.next-e2e` reconstruit sur l'état final, copie de `data/app.db` (run LOGREG n° 73, après le remplacement des effets du run B0), Chromium, 1 worker, 6,5 min : **113 tests, 113 réussis, 0 échoué, 0 ignoré**.

Campagne finale en trois passes complètes (`npm run test:e2e`, build compris) :

| Passe | Tests | Réussis | Échecs | Nature des échecs et suite donnée |
|---|---|---|---|---|
| 1 | 95 | 91 | 4 | 1 vrai défaut d'accessibilité (A11Y-06 sur `/transparency`) → application corrigée ; 3 sélecteurs périmés (libellé « Probabilité à 6 mois » de la passe de clarté, équipe de démonstration du manager sans niveau Élevé ni Moyen) → specs corrigées |
| 2 | 113 | 103 | 10 | audit axe étendu aux 18 pages ajoutées depuis (synthèse, équipes, interventions, dérive, formations, charge, prévisions, droit d'accès, aide, page 404) : 10 violations (A11Y-05, A11Y-06) → application corrigée |
| 3 | 113 | 113 | 0 | dont le nouveau contrôle CSP : aucune violation de la Content-Security-Policy dans la console de Chromium sur toutes les entrées du menu des 3 rôles |

- Les défauts E2E-01 à E2E-09 et A11Y-01 à A11Y-04, corrigés avant la campagne finale, sont **revalidés** : leurs tests passent.
- Tout le reste passe : authentification (3 rôles, message générique, déconnexion avec invalidation serveur, verrouillage puis déverrouillage par l'admin, pas d'énumération des comptes), menus et accès refusés par rôle, tableaux de bord RH et manager (KPI, filtres, drill-down, aucun montant TND ni probabilité côté manager), liste et fiche (3 zones, DTO par rôle, hors périmètre → `/interdit` + 403 + refus audité), recommandation réalisée → intervention et audit, workflow des alertes, alertes invisibles pour le manager, santé des données, transparence, backtesting, what-if, administration (création puis activation d'un compte, paramètres bornés, journal d'audit filtrable).

## Défauts fonctionnels (tous corrigés)

### E2E-01 — Rejet d'alerte : après un refus serveur, le choix « Rejeter » est perdu et l'alerte passe « En cours » (Moyenne) — CORRIGÉ le 30/09, revalidé

- **Page / rôle** : `/alerts/[id]`, RH (le manager a le même formulaire).
- **Étapes** : ouvrir une alerte « Nouvelle » → cocher « Rejeter » → saisir un commentaire composé d'espaces, qui passe les contrôles `required` et `minLength=3` du navigateur → Enregistrer (confirmer) → le message « Un commentaire est obligatoire pour rejeter une alerte. » s'affiche → saisir un vrai commentaire → Enregistrer.
- **Attendu** : « Rejeter » reste coché et l'alerte passe « Rejetée » avec le commentaire.
- **Obtenu** : après le refus, le bouton radio revient sur « Prendre en charge » alors que le libellé indique encore « obligatoire pour un rejet », et le commentaire est vidé. La seconde soumission enregistre **EN_COURS** au lieu de REJETEE.
- **Sévérité** : Moyenne. Un statut erroné est enregistré sans avertissement ; on peut le rattraper ensuite.
- **Fichier probable** : `src/app/(app)/alerts/alert-status-form.tsx`. React 19 réinitialise le formulaire après l'action (`useActionState`) : le radio, contrôlé par `useState`, se désynchronise du DOM et le `textarea`, non contrôlé, est vidé. Pistes : initialiser `defaultChecked`/`defaultValue` à partir de l'état renvoyé par l'action, ou contrôler aussi le commentaire.
- **Test** : `alerts.spec.ts` › « rejet : refus serveur d'un commentaire vide (espaces) sans perdre le choix « Rejeter » ».

### E2E-02 — Décision sur une recommandation : même désynchronisation après un refus serveur (Mineure) — CORRIGÉ le 30/09, revalidé

- **Page / rôle** : `/employees/[id]`, zone 3 « Suggestions », RH.
- **Étapes** : « Traiter cette recommandation » → « Rejetée » → saisir un commentaire composé d'espaces → Enregistrer. Le serveur refuse avec « Un commentaire est requis pour rejeter une recommandation. » → saisir un commentaire valide → Enregistrer.
- **Attendu** : « Rejetée » reste coché et la recommandation passe « Rejetée ».
- **Obtenu** : « Réalisée » est recoché à l'écran mais le champ date reste masqué, car l'état React vaut toujours REJETEE. La seconde soumission échoue avec « La date de réalisation est requise. » et l'utilisateur doit recocher « Rejetée » pour avancer.
- **Sévérité** : Mineure. Aucune donnée erronée n'est enregistrée, mais le parcours est bloqué et déroutant.
- **Fichier probable** : `src/components/pilotage/recommendation-forms.tsx` (`DecideForm`). Même cause que E2E-01.
- **Test** : `recommendations.spec.ts` › « rejet : refus serveur d'un commentaire vide (espaces) sans perdre le choix « Rejetée » ».

### E2E-03 — Aucun message de confirmation après une décision sur une recommandation (Mineure) — CORRIGÉ le 30/09, revalidé

- **Page / rôle** : `/employees/[id]`, zone 3, RH.
- **Étapes** : traiter une recommandation (Réalisée ou Rejetée) → Enregistrer.
- **Attendu** : le message « Recommandation réalisée : intervention enregistrée. » (ou « Recommandation rejetée. ») s'affiche.
- **Obtenu** : le message n'apparaît jamais. `revalidatePath` fait sortir la recommandation du statut PROPOSEE ; le `DecideForm`, qui porte l'état du message, est alors démonté et remplacé par le `FeedbackForm`. Seul le badge change.
- **Sévérité** : Mineure. L'utilisateur n'a pas de retour explicite et le `role="status"` n'est jamais annoncé aux lecteurs d'écran.
- **Fichier probable** : `src/components/pilotage/recommendation-forms.tsx` et `src/components/pilotage/employee-detail.tsx` (`SuggestionsZone`). Piste : afficher le message au niveau de la liste ou dans l'élément traité.
- **Test** : `recommendations.spec.ts` › « un message de confirmation reste affiché après la décision ».

### E2E-06 — Vérification a posteriori (backtesting) : démissions datées avant la date d'origine (Mineure) — CORRIGÉ le 30/09 (affichage puis correction de fond dans `backtestEvent`), revalidé

- **Page / rôle** : `/backtesting`, mois par défaut (origine au 28/02/2026), RH.
- **Étapes** : ouvrir Backtesting et lire la colonne « Démission dans les 6 mois ».
- **Attendu** : des dates strictement postérieures à l'origine, avec un délai supérieur à 0.
- **Obtenu** : « Oui, le 09/02/2026 » avec un délai de « 0,0 mois », et de même le 10/02/2026. Ces dates sont imputées (date de sortie − 1 mois, faute de `resignation_date`) pour des démissions saisies après l'origine. Leur prise en compte dans `y6` est correcte, mais la date affichée contredit l'en-tête de la colonne.
- **Sévérité** : Mineure. L'affichage est trompeur ; les métriques ne sont pas affectées.
- **Fichier probable** : `src/lib/dal/backtest.ts` (`eventDate` et `delay` sont repris de `v_label_panel.event_date`) et `src/app/(app)/backtesting/page.tsx`. Pistes : afficher la date de sortie ou la mention « date estimée », et borner le délai.
- **Test** : `data-model.spec.ts` › « cohérence : les démissions comptées sont postérieures à la date d'origine ».

### E2E-08 — Filtre « Manager » : homonymes impossibles à distinguer (Mineure) — CORRIGÉ le 30/09

- **Page / rôle** : `/employees`, RH.
- **Obtenu** : la liste déroulante Manager contient deux entrées « Souissi Hazem », sans matricule ni département pour les distinguer.
- **Fichier probable** : `src/lib/dal/employees.ts` (`managerOptions`, le libellé vaut `last_name || ' ' || first_name`). Piste : ajouter le matricule au libellé.
- **Test** : aucun, constat manuel.

### E2E-09 — Date « aujourd'hui » calculée en UTC (Mineure, relevé à la lecture du code, non reproduit) — CORRIGÉ le 30/09

- **Page / rôle** : `/employees/[id]`, formulaire de décision, RH.
- **Constat** : `today={new Date().toISOString().slice(0, 10)}` sert de valeur par défaut et de `max` à la date de réalisation. Entre minuit et 1 h (heure de Tunis, UTC+1), la date proposée est celle de la veille et le navigateur refuse la date du jour.
- **Fichier probable** : `src/app/(app)/employees/[id]/page.tsx`. Piste : calculer la date dans le fuseau `Africa/Tunis`.

### Observation arbitrée — l'ADMIN voit matricules et dates d'absence dans les exemples de rejet (ARBITRÉ le 30/09 : matricule conservé, dates, catégories et durées d'absence masquées ; `maskRejectionMessage`)

- **Page / rôle** : `/data-health`, bloc « Exemples de lignes concernées », ADMIN.
- **Constat** : depuis la première campagne, les montants sont masqués pour l'ADMIN (`maskRejectionMessage`) et le test correspondant passe. En revanche, les matricules de salariés existants restent visibles avec la date de l'événement, par exemple « Absence du 2023-02-16 en double pour M10006 ». C'est un choix documenté dans `src/lib/privacy/mask.ts` (« suffisent à retrouver la ligne dans AJIR »), mais il reste en tension avec `src/lib/dal/context.ts` (« l'ADMIN … ne voit aucune donnée nominative ni indicateur RH »). Le nombre de matricules visibles est consigné en annotation du test.
- **Test** : `data-model.spec.ts` › « séparation des tâches : aucun montant de salaire dans les exemples de rejet montrés à l'admin » (réussi).

### Observation à arbitrer — Parcours d'un collaborateur : noms des anciens managers visibles par le manager (Mineure)

- **Page / rôle** : `/employees/[id]`, composant « Parcours », MANAGER (vérification finale par rôle, serveur isolé).
- **Constat** : un changement de manager s'affiche « Changement de manager (Ben Amor Yassine → Boughanmi Ghassen) » : le manager voit le nom d'anciens managers de son collaborateur, hors de sa hiérarchie. Aucune donnée RH de ces personnes (ni salaire, ni risque) : c'est une information d'organigramme, visible dans AJIR.
- **Piste** si la minimisation stricte est retenue : dans `getEmployeeJourney` (`src/lib/dal/synthesis.ts`), vue MANAGER, remplacer les noms hors périmètre par « un autre manager ».

## Accessibilité (axe-core, WCAG 2.0/2.1 niveaux A et AA)

**Campagne finale (30/09, 21 h 40) : 39 pages contrôlées, 0 violation.** Pages : anonyme (connexion, activation invalide), RH (tableau de bord, collaborateurs, fiche, absentéisme, recommandations, alertes et détail, santé des données, transparence, vérification a posteriori, Mon compte, synthèse, équipes, interventions, dérive, formations, charge de travail, prévisions, droit d'accès, aide, page 404), manager (tableau de bord, Mon équipe, fiche, accès refusé, synthèse, équipes, formations, charge de travail), admin (console, utilisateurs, paramètres, journal d'audit, santé des données, transparence, dérive, aide). Détail par page : `test-results/e2e-axe/<rôle>-<page>.json` et pièces jointes du rapport HTML.

### A11Y-05 — Notes de bas de page en `text-slate-500` sur le fond `bg-canvas` (Moyenne) — CORRIGÉ le 30/09, revalidé

- **Critère** : WCAG 1.4.3 ; `#62748e` sur `#f3f5f8` = 4,36:1 (texte de 12 px).
- **Pages** : `/synthese` (RH et manager), `/equipes` (RH et manager), `/interventions`, `/derive` (RH et admin), `/charge`, `/previsions`.
- **Correction** : `text-slate-600` sur ces notes (« Données au … », « Référence : … », « Modèle … »), même règle que A11Y-01.

### A11Y-06 — Zones défilantes sans accès au clavier (Moyenne) — CORRIGÉ le 30/09, revalidé

- **Critère** : WCAG 2.1.1 (règle axe `scrollable-region-focusable`).
- **Pages** : `/transparency` (rapport d'équité, modèles par sujet, historique des versions), `/interventions` (tableau par type d'action), `/formations` (formations en retard).
- **Correction** : `tabIndex={0}`, `role="region"` et nom accessible sur le conteneur défilant, comme `DataDetails`.

### Première campagne (30/09, 19 h) : 21 pages, 11 avec violation, toutes corrigées

**Sans violation (10 pages)** : `/activation`, et pour la RH `/absenteeism`, `/alerts/[id]`, `/transparency`, `/backtesting`, `/compte`, et pour l'admin `/admin`, `/admin/users`, `/admin/settings`, `/admin/audit`.

**Avec violation (11 pages).** Toutes sont de gravité « serious » selon axe.

#### A11Y-01 — Contraste insuffisant du texte `text-slate-500` sur le fond de page `bg-canvas` (Moyenne) — CORRIGÉ le 30/09, revalidé

- **Critère** : WCAG 1.4.3 (contraste minimum, 4,5:1).
- **Obtenu** : `#62748e` sur `#f3f5f8` donne **4,36:1** (texte de 11 à 14 px).
- **Pages** :
  - `/login` : « Compte oublié ou verrouillé ? » ;
  - `/dashboard` RH et manager : ligne « Filtres actifs » et note de source ;
  - `/employees` RH et manager ; `/recommendations` ; `/alerts` : ligne « Filtres actifs » ;
  - `/interdit` : sous-titre de la marque en 11 px.
- **Fichiers probables** :
  - `src/components/pilotage/filters.tsx` (`ActiveFilters`, conteneur `gap-x-2`) ;
  - `src/app/(app)/dashboard/page.tsx` (note `mt-2 text-xs text-slate-500`) ;
  - `src/app/login/page.tsx` (paragraphe `mt-4`) ;
  - `BrandMark` dans `src/components/layout/sidebar.tsx`.
- **Piste** : passer en `text-slate-600` tout texte posé directement sur `bg-canvas`, ou éclaircir le fond.

#### A11Y-02 — Contraste insuffisant dans l'en-tête de la fiche collaborateur (Mineure) — CORRIGÉ le 30/09, revalidé

- **Obtenu** : `#62748e` sur `#eef4fb` (encadré `bg-sky-50`) donne **4,3:1**.
- **Pages** : `/employees/[id]`, RH et manager.
- **Fichier probable** : `src/components/pilotage/employee-detail.tsx`.

#### A11Y-03 — Liste de définitions mal structurée dans la zone Observations de la fiche (Moyenne) — CORRIGÉ le 30/09, revalidé

- **Critère** : WCAG 1.3.1 (information et relations).
- **Règles axe** : `definition-list` et `dlitem` (12 nœuds).
- **Obtenu** : les `dt`/`dd` sont enveloppés dans deux niveaux de `div` (`div.bg-slate-50 > div.min-w-0 > dt`). Un `dl` n'admet que des `dt`/`dd`, éventuellement regroupés par un seul `div`. Les lecteurs d'écran perdent donc l'association libellé → valeur.
- **Pages** : `/employees/[id]`, RH et manager.
- **Fichier probable** : `src/components/pilotage/employee-detail.tsx` (`<dl className="mt-4 grid …">`, vers la ligne 150). Piste : un seul `div` par paire, ou déplacer la mise en forme sur `dt`/`dd`.

#### A11Y-04 — Contraste limite dans l'historique des imports (Mineure) — CORRIGÉ le 30/09, revalidé

- **Obtenu** : `#62748e` sur `#f5f8fd` donne **4,47:1**.
- **Page** : `/data-health`, RH.
- **Fichier probable** : `src/app/(app)/data-health/page.tsx`, cellule `whitespace-nowrap` du tableau d'historique (texte secondaire `text-slate-500 block`).

## Corrigés depuis la première campagne (29-30/09)

- **Campagne finale (30/09, 21 h)** : A11Y-05 et A11Y-06 ci-dessus ; specs mises à jour : libellé « Probabilité à 6 mois » (liste et fiche), fiche manager testée sur le collaborateur le plus exposé de l'équipe (plus de niveau Élevé ni Moyen dans l'équipe de démonstration depuis le LOGREG), audit axe étendu à 18 pages, contrôle des violations CSP dans `navigation.spec.ts`.

- **E2E-01** (30/09, intégration écrans) : `alert-status-form.tsx` n'utilise plus `<form action>` (réinitialisé par React 19) ; envoi manuel dans une transition, choix et commentaire contrôlés. Le formulaire n'est plus remonté à chaque étape (`key` retiré) : « Alerte mise à jour. » reste annoncé (`role="status"`).
- **E2E-02** : même correction dans `DecideForm` (`recommendation-forms.tsx`) : décision, date, pertinence et commentaire contrôlés, conservés après un refus du serveur.
- **E2E-03** : le message de confirmation est porté par `RecommendationActions`, qui reste monté quand la revalidation remplace la décision par le retour de pertinence (fiche et liste des recommandations).
- **E2E-06** (affichage) : une démission datée au plus tard à la date d'origine (date imputée) s'affiche « Oui (date de démission non renseignée) », délai « — » ; les métriques sont inchangées. La correction de fond (`eventDate` dans `src/lib/dal/backtest.ts`) reste à arbitrer.
- **E2E-08** : libellé du filtre Manager « Nom Prénom (matricule) » (`managerOptions`).
- **E2E-09** : date par défaut et maximum de la date de réalisation calculés dans le fuseau `Africa/Tunis` (`todayTunis`, `components/pilotage/labels.ts`).
- **A11Y-01** : textes posés sur `bg-canvas` passés en `text-slate-600` ou plus foncé (filtres actifs, note de source du tableau de bord, connexion, marque).
- **A11Y-02** : `text-slate-500` remplacé par `text-slate-600` dans toute la fiche (`employee-detail.tsx`).
- **A11Y-03** : un seul `div` par paire `dt`/`dd` dans l'en-tête de la fiche (icône portée par le `dt`).
- **A11Y-04** : texte secondaire de l'historique des imports et des traitements en `text-slate-600`.
- Specs mises à jour avec ces changements : libellés (« Vérification a posteriori », « Matricule du collaborateur », « Niveau de risque : Élevé », filtres non disponibles pour le manager), liens vers la fiche avec `?retour=`, redirection `/login?next=`, menus Synthèse / Équipes / Interventions / Dérive.

- **E2E-05** : le code technique « NIVEAU_ELEVE » affiché comme déclencheur (« Déclenchée par : NIVEAU_ELEVE ») a été remplacé par un libellé. Le test `employees.spec.ts` › « libellés de déclencheur lisibles » passe.
- **E2E-07** : on pouvait énumérer les comptes grâce au message de verrouillage. Un identifiant inconnu est désormais « verrouillé » de la même façon (`src/lib/auth/login.ts`, verrou fantôme). Le nouveau test `auth.spec.ts` › « identifiant inconnu : même verrouillage apparent » passe.
- **E2E-04** (en partie) : les montants de salaire ne sont plus montrés à l'ADMIN dans les exemples de rejet (voir l'observation ci-dessus).
- **Accessibilité** : le contraste des titres de section du menu (`text-slate-400`) et la zone de données défilante de Santé des données (`scrollable-region-focusable`) sont corrigés.
- **Menu** : les liens « Formations », « Charge de travail » et « Prévisions effectifs », apparus avant leurs pages, mènent maintenant à des pages existantes (test « chaque entrée du menu ouvre une page sans erreur » réussi pour les 3 rôles).
