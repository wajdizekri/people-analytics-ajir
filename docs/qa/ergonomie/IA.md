# Ergonomie des pages d'analyse (agent IA, session aziz-pfe-e9, 04/10/2026)

Périmètre : /absenteeism, /charge, /formations, /previsions, /retention, `src/components/ai/**`, `src/components/retention/**`. Rôles RH et MANAGER (ADMIN redirigé vers /interdit, inchangé). Grille : [CHANTIER_ERGONOMIE.md](../CHANTIER_ERGONOMIE.md). Gravité Nielsen 1 à 4. Le parcours absentéisme déjà corrigé ([ERGONOMIE.md](../ERGONOMIE.md) E6-E9) n'a pas été refait.

Constat général : les cinq écrans suivaient déjà la structure de la charte (question → verdict → 3-4 KPI → visuels dont le titre dit le message → « Que faire ? » → détail → « Comment lire »). Les frictions restantes portaient sur les formulaires, les retours vers la fiche, les sous-titres incomplets et l'accessibilité des données de prévision.

## Frictions

| Écran | Rôle | Grav. | Friction | Statut |
|---|---|---|---|---|
| /previsions | RH | 3 | Champ « Budget annuel » : `min=1` + `step=1000` → le navigateur refusait tout montant rond (21000000, l'exemple affiché) avec un message incompréhensible. | **Corrigé** : `step="any"`, aide reliée (`aria-describedby`), « montant en TND, sans espace ». |
| fiche (depuis /formations, /charge) | RH, MANAGER | 3 | `?retour=/formations#…` et `?retour=/charge#surcharges` sont rejetés par `safeReturn` de la fiche : le fil d'Ariane affiche « Collaborateurs » et le retour perd le contexte. | **Corrigé par COLLAB** sur demande [IA] (CHANTIER_ERGONOMIE.md, marquée [FAIT]) : les liens posés par /formations et /charge reviennent désormais à la section d'origine. |
| /previsions | RH | 2 | Paramètre invalide : avertissement avec les clés techniques (« embauches, hausse ») sans dire comment corriger. | **Corrigé** : titre « Hypothèse non prise en compte », nom en clair + plage admise, « Corrigez la valeur dans « Tester un autre scénario », puis cliquez sur « Recalculer la projection » ». |
| /previsions | RH | 2 | « Voir les données du graphique » ne contenait que les mois projetés (ni l'observé, ni le scénario de référence en mode simulé) : alternative accessible incomplète. | **Corrigé** : colonnes Observé, Projection, Fourchette probable à 80 % basse/haute, Scénario de référence si simulé. |
| /previsions | RH | 2 | Saisie du rythme d'embauche au pas de 5 (72 % refusé) ; plages de valeurs non écrites. | **Corrigé** : pas de 1 dans le champ chiffré (curseur inchangé), « Valeur possible : de 0 à 300 % », plage de la hausse dans le libellé accessible. |
| /formations | MANAGER | 2 | Tableau « à risque » sans lien vers la fiche côté manager (même périmètre que la fiche) ; tableau « en retard » sans lien pour les deux rôles. | **Corrigé** : nom en lien + ligne cliquable (`rowHref`), retour vers `#a-risque` / `#retards`. |
| /formations | RH, MANAGER | 2 | Listes plafonnées à 200 lignes sans le dire (titre « (N) » ≠ lignes affichées). | **Corrigé** : « Les N plus anciennes sont listées » / « les N premières sont listées ». |
| /absenteeism | RH, MANAGER | 2 | Variation du KPI « Taux d'absence » : « +0,12 pt sur 4 semaines », référence implicite. | **Corrigé** : « +0,12 pt sur les 4 dernières semaines vs les semaines précédentes » (mois : « vs les mois précédents »). |
| /charge | MANAGER | 2 | Plusieurs équipes : prévisions sans aucune indication d'incertitude ; graphique tronqué à 8 équipes sans le dire. | **Corrigé** : note « Fourchette probable à 80 % … dans « Voir les données » et dans le tableau du détail », fourchette dans le tableau de données, mention de la troncature. |
| /charge | MANAGER | 1 | KPI « Équipe la plus chargée » sans jugement en mots. | **Corrigé** : « Tension probable / possible / Sous le seuil ». |
| /absenteeism, /charge, /formations, /previsions | RH, MANAGER | 1 | Sous-titres de visuels sans période ou sans périmètre. | **Corrigé** : période (« 12 derniers mois », « d'ici … », « échéances des N prochains jours ») et périmètre ajoutés. |
| /absenteeism, /charge, /formations | RH, MANAGER | 1 | Toast des recommandations passé par un effet (`useActionToast`) au niveau de la liste. | **Corrigé** : `toastResult` dans l'action (contrat de `withActionToast`), focus en tête de liste conservé. |
| /previsions | RH | 1 | Hex de palette en dur (`#475569`, pastille de bande en `rgba` Tailwind) ; valeur de fin de courbe écrite dans la couleur grise de la série (4,4:1). | **Corrigé** : `AXIS.axisLabel.color`, `BAND_FILL`/`DARK_COLORS`, encre `LEGEND.textStyle.color`. |
| /charge (manager, plusieurs équipes), /retention | RH, MANAGER | 1 | Pas de légende directe en bout de courbe (≤ 3 séries). | **Non fait** : noms d'équipe longs, la marge droite réduirait trop le tracé à 390 px ; légende et tableau présents. |
| /absenteeism, /charge, /formations | RH, MANAGER | 1 | Pages longues sans sommaire `OnThisPage`. | **Non fait** : les KPI portent déjà « Voir la liste / Voir la prévision » vers les sections ; pas de refonte. |
| /retention | RH, MANAGER | 1 | Verdict toujours neutre (« est-ce grave ? » sans réponse). | **Non fait** : aucune référence (cible, N-1) dans le DTO ; pas d'ajout de donnée. |
| /previsions | RH | 1 | « Projection par département » et « Effectif par grade » en tableaux locaux (sans tri). | **Non fait** : vue en cartes déjà présente sous 640 px ; adoption de `DataTable` + `footer` possible plus tard. |
| /formations | RH, MANAGER | 1 | Barres « risque faible » en gris alors que la convention dit Faible = vert. | **Non fait, volontaire** : charte § 5 « mettre en valeur la donnée importante, griser le reste » ; le gris est écrit dans le sous-titre. |
| Recommandations | RH, MANAGER | 1 | Libellés d'état non alignés entre écrans (« À traiter » ici, « En attente de décision » sur /previsions, /recommendations). | **Non fait** : pas de convention unique adoptée (le catalogue propose « À décider ») ; à trancher entre ACTION et IA. |

## Fichiers modifiés

- `src/app/(app)/absenteeism/page.tsx` : variation du KPI avec référence, sous-titres des visuels.
- `src/app/(app)/charge/page.tsx` : sous-titre du visuel des équipes, KPI manager qualifié, incertitude du visuel multi-équipes.
- `src/app/(app)/formations/page.tsx` : liens vers la fiche (manager, retards), listes plafonnées signalées, sous-titres.
- `src/app/(app)/previsions/page.tsx` : avertissement des hypothèses invalides, tableaux « Voir les données » complets, sous-titre de la masse salariale.
- `src/components/ai/workforce/scenario-form.tsx` : budget (`step="any"`, aide reliée), pas et plages des champs.
- `src/components/ai/workforce/chart-options.ts`, `projection-chart.tsx` : couleurs du kit, encre des étiquettes.
- `src/components/ai/workload/reco-status-form.tsx` : toast à la réponse du serveur.
- Tests ajoutés : `tests/ergo-ia/{components,pages,formations,charge}.test.ts` (rendu statique).

## Libellés E2E

Aucun libellé visé par `tests/e2e/*.spec.ts` ni par BRANCHEMENTS_4E.md § D3 n'a changé (titres h1, « Sorties comptées », « Comparer par », « Appliquer les filtres », « Courbe de maintien en escalier », « Voir les données », « Comment lire », « Limites », « Détail par département », boutons des recommandations).

## Demandes

- [IA] → COLLAB : `ORIGINS` de `src/app/(app)/employees/[id]/page.tsx` (`/formations`, `/charge`) : **[FAIT]**. Aucune demande ouverte.

## Vérification

`npx vitest run tests/ai tests/retention tests/ergo-ia --maxWorkers=2` : 23 fichiers, 122 tests réussis, 1 ignoré ; `tests/pilotage/pages.test.ts` (rend /absenteeism) : 7/7. `npx eslint` sur les fichiers modifiés et tests/ergo-ia : 0 erreur. `npx tsc --noEmit` : aucune erreur dans le périmètre ; erreurs hors périmètre (travaux en cours d'autres agents) dans `confidentialite/page.tsx` (`Steps`), `derive/page.tsx`, `src/components/monitoring/{data,model}-options.ts`, `tests/ui-admin/monitoring.test.ts`. Rendu visuel à 390 px et en sombre non vérifié au navigateur (Playwright interdit).
