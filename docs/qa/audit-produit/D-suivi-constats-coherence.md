# Audit produit D — suivi des constats, cohérence et accessibilité

Date : 04/10/2026. Agent D (lecture seule).

## Périmètre

- Suivi des points laissés ouverts par les audits précédents : [REVUE_TRANSVERSE.md](../REVUE_TRANSVERSE.md) (T1 à T27), [ERGONOMIE.md](../ERGONOMIE.md) (§ 4 « À appliquer », § 5 « Restant »), [ACCESSIBILITE.md](../ACCESSIBILITE.md) (« Restant »), [CLARTE.md](../CLARTE.md), [COUVERTURE.md](../COUVERTURE.md) (§ 5, § 6), [BUGS_E2E.md](../BUGS_E2E.md), [BACKLOG_INTEGRATION.md](../BACKLOG_INTEGRATION.md), [ergonomie/*.md](../ergonomie/) et [LIVRABLE_DESIGN_SYSTEM.md](../LIVRABLE_DESIGN_SYSTEM.md) § 7.
- Contrôle transversal de cohérence dans `src/app` et `src/components` (couleurs, libellés, formats, KPI, terminologie, boutons).
- Accessibilité : restants et régressions évidentes depuis le 30/09.

## Méthode

Lecture des documents de suivi, puis vérification de chaque point dans le code actuel (Grep, lecture ciblée). Aucun serveur, aucun test, aucune capture. Les résultats E2E et axe sont repris de [VERIFICATION_FINALE.md](../VERIFICATION_FINALE.md) (04/10 : E2E 153/153, axe 0 violation sur 43 pages en clair, 21 en sombre, 1 en menu réduit). Ce qui dépend du rendu est marqué « à vérifier ».

États : **Corrigé**, **Partiel**, **Ouvert**, **Obsolète** (écran refondu ou choix assumé et documenté). Priorité : P0 à P3. Effort : faible, moyen, élevé.

## 1. Tableau de suivi

Décompte : **29 Corrigé**, **18 Partiel**, **26 Ouvert**, **3 Obsolète** (76 points). Les docs de suivi ne reflètent pas cet état : REVUE_TRANSVERSE n'a toujours qu'un point marqué corrigé, ACCESSIBILITE garde « 5, 8, 9 et 10 restent ouverts ».

### 1.1 REVUE_TRANSVERSE (01/10)

| Source | Constat | État | Preuve | Priorité si ouvert |
|---|---|---|---|---|
| T1 | « Équipes en tension » : deux définitions | Ouvert | Charge : `label="Équipes en tension"` = pic d'heures sup prévu ([charge/page.tsx:142](../../../src/app/(app)/charge/page.tsx), :359 ; définition [insight-kit.tsx:43-46](../../../src/components/ai/workload/insight-kit.tsx)). Équipes : `TENSION: "Équipes en tension"` = 2 signaux sur 5 ([equipes/page.tsx:38](../../../src/app/(app)/equipes/page.tsx)) | P1 · faible |
| T2 | Heures sup : 3 libellés, 2 unités | Ouvert | « Heures supplémentaires par personne » ([synthese/page.tsx:219](../../../src/app/(app)/synthese/page.tsx)) ; « Heures sup par ETP » ([charge/page.tsx:161](../../../src/app/(app)/charge/page.tsx)) ; « heures sup. : … par personne et par mois » ([equipes/page.tsx:176](../../../src/app/(app)/equipes/page.tsx), :273) | P1 · moyen |
| T3 | Décider une recommandation : présentations multiples | Partiel | Rejet unifié « Rejeter la recommandation » + confirmation partout. Reste : « Marquer comme réalisée » secondaire dans `RecoBoard` (/absenteeism, /charge, /formations : [workload/reco-status-form.tsx:94-103](../../../src/components/ai/workload/reco-status-form.tsx), `Button` sans `variant`, défaut `secondary` [button.tsx:73](../../../src/components/ui/button.tsx)) contre primaire ailleurs ; « Rejeter avec motif » sur la fiche ([recommendation-forms.tsx:130](../../../src/components/pilotage/recommendation-forms.tsx)) ; statut « Proposée » ([pilotage/labels.ts:17](../../../src/components/pilotage/labels.ts)), « En attente de décision » (/previsions, /recommendations, RecoBoard), « à décider » ([dashboard/page.tsx:130](../../../src/app/(app)/dashboard/page.tsx), [synthese/page.tsx:237](../../../src/app/(app)/synthese/page.tsx), [employee-detail.tsx:244](../../../src/components/pilotage/employee-detail.tsx)) | P1 · faible |
| T4 | Ordre des noms | Partiel | `fmt.person` créé « Nom Prénom » ([ui/index.tsx:449](../../../src/components/ui/index.tsx)) mais **0 appel** dans `src`. Prénom Nom reste : titres d'alertes ([engine/recommendations.ts:124](../../../src/lib/engine/recommendations.ts), [anomalies/index.ts:389](../../../src/lib/anomalies/index.ts)), Charge ([ai-workload.ts:144-146](../../../src/lib/dal/ai-workload.ts), :231), Formations ([ai-training.ts:79](../../../src/lib/dal/ai-training.ts), :137-138), Utilisateurs ([admin.ts:94](../../../src/lib/dal/admin.ts)), palette Ctrl+K ([command-palette.tsx:193](../../../src/components/ux/command-palette.tsx)) | P1 · moyen |
| T5 | Absentéisme : chiffres non rapprochables | Partiel | Période écrite à côté du KPI ([absenteeism/page.tsx:206](../../../src/app/(app)/absenteeism/page.tsx) `period`). Reste : 2 décimales sur /absenteeism (`fr.rate` défaut 2, [insight-kit.tsx:15](../../../src/components/ai/workload/insight-kit.tsx)) contre 1 sur Synthèse et Équipes (`formatRate` défaut 1, [pilotage/labels.ts:44](../../../src/components/pilotage/labels.ts)) ; populations différentes ([dal/dashboard.ts:69](../../../src/lib/dal/dashboard.ts)) | P1 · moyen |
| T6 | Codes techniques visibles | Partiel | Corrigé : `fmt.model` sur 10 écrans (ex. [charge/page.tsx:323](../../../src/app/(app)/charge/page.tsx), [dashboard/page.tsx:450](../../../src/app/(app)/dashboard/page.tsx)), journal en libellés (`actionLabel`, [admin/audit/page.tsx:8](../../../src/app/(app)/admin/audit/page.tsx)). Reste : « Code du contrôle : {r.rule} » ([import-controls.tsx:158](../../../src/app/(app)/data-health/import-controls.tsx)) ; méthode brute `extra={m.kind}` (RIDGE_…) dans Transparence ([transparency/page.tsx:642](../../../src/app/(app)/transparency/page.tsx)) ; nom de lot `res.source` dans les titres d'alertes ([import/index.ts:568-571](../../../src/lib/import/index.ts)) | P2 · faible |
| T7 | Textes d'alertes hors charte | Partiel | Pluriels et milliers corrigés (`rejectedLines`, [import/index.ts:556](../../../src/lib/import/index.ts)). Reste : date « 29 sept. 2026 à 22:32 » en liste ([alerts/labels.tsx:133-139](../../../src/app/(app)/alerts/labels.tsx)) contre `fmt.dateTime` « 29/09/2026 22:32 » en détail ([alerts/[id]/page.tsx:94](../../../src/app/(app)/alerts/[id]/page.tsx), :148) | P3 · faible |
| T8 | Débordement à 390 px | Partiel | /admin/users en cartes sous 1 024 px ([ergonomie/COMPTE.md](../ergonomie/COMPTE.md) l. 24). /data-health et /transparency : à vérifier, l'E2E ne contrôle que l'en-tête ([navigation.spec.ts:163-185](../../../tests/e2e/navigation.spec.ts)) et les captures finales ne sont pas faites ([VERIFICATION_FINALE.md](../VERIFICATION_FINALE.md) l. 19) | P1 · faible |
| T9 | Surtitre incohérent | Partiel | Surtitre = section du menu sur 17 écrans (ex. `eyebrow="Analyses"` [previsions/page.tsx:179](../../../src/app/(app)/previsions/page.tsx)). Absent sur 8 : /dashboard, /synthese, /employees, /absenteeism, /formations, /charge, /retention, /aide. Non dérivé de `NAV` | P3 · faible |
| T10 | Trois patrons d'introduction | Partiel | `QuestionAnswer` (analyses) et `PageIntro` coexistent dans 13 pages ; rien sur Collaborateurs, Recommandations, Alertes. Règle absente de [CHARTE_UI.md](../CHARTE_UI.md) § 1 | P3 · faible |
| T11 | Libellés de filtres | Corrigé | « Appliquer les filtres » / « Réinitialiser les filtres » aussi sur Droit d'accès ([confidentialite/page.tsx:303-308](../../../src/app/(app)/confidentialite/page.tsx)), Utilisateurs et Journal | — |
| T12 | Trois paginations | Corrigé | `Pagination` commune : alertes ([alerts/page.tsx:201](../../../src/app/(app)/alerts/page.tsx)), utilisateurs ([admin/users/page.tsx:353](../../../src/app/(app)/admin/users/page.tsx)), journal ([admin/audit/page.tsx:229](../../../src/app/(app)/admin/audit/page.tsx)), liste, recommandations, interventions | — |
| T13 | Mois et élisions | Partiel | `fmt.month`, `fmt.ofMonth`, `fmt.de` créés ([ui/index.tsx:451-459](../../../src/components/ui/index.tsx)), utilisés sur Dérive seulement ([derive/page.tsx:211](../../../src/app/(app)/derive/page.tsx)). Reste : « calcul de août » ([synthese/page.tsx:116](../../../src/app/(app)/synthese/page.tsx), :284, :292, :300) ; « Équipe de Amri » ([dal/teams.ts:341](../../../src/lib/dal/teams.ts), [ai-workload.ts:198](../../../src/lib/dal/ai-workload.ts), [dal/absenteeism.ts:168](../../../src/lib/dal/absenteeism.ts)) ; axes « sept. 24 » ([insight-kit.tsx:22](../../../src/components/ai/workload/insight-kit.tsx)) contre « sept. 2024 » ([workforce/chart-options.ts:8-9](../../../src/components/ai/workforce/chart-options.ts)) | P2 · faible |
| T14 | Couleurs sémantiques divergentes | Partiel | Deux ambres fusionnés (`STATUS_COLORS` = `SEMANTIC`, [pbi.tsx:20](../../../src/components/charts/pbi.tsx)) ; facteur favorable en vert sur Transparence ([transparency/page.tsx:475](../../../src/app/(app)/transparency/page.tsx)). Reste : « À surveiller » en badge bleu (`SURVEILLER: "sky"`, [insights/labels.ts:7](../../../src/components/insights/labels.ts)) mais pastille jaune (:10, [teams.tsx:11](../../../src/components/insights/teams.tsx)) ; Faible en gris sur Formations ([formations/page.tsx:279](../../../src/app/(app)/formations/page.tsx), assumé) | P2 · faible |
| T15 | Adoption contre réalisation | Ouvert | « Taux d'adoption » ([recommendations/page.tsx:145](../../../src/app/(app)/recommendations/page.tsx)) ; « Taux de réalisation des recommandations » ([interventions/page.tsx:129](../../../src/app/(app)/interventions/page.tsx)) | P2 · faible |
| T16 | Mise en service des modèles : consignes contradictoires | Ouvert (aggravé) | « mis en service par l'administrateur » ([charge/page.tsx:77](../../../src/app/(app)/charge/page.tsx), [formations/page.tsx:341](../../../src/app/(app)/formations/page.tsx), [forecast-section.tsx:65](../../../src/components/ai/absenteeism/forecast-section.tsx), [previsions/page.tsx:192](../../../src/app/(app)/previsions/page.tsx)) ; « hors de l'interface » ([transparency/page.tsx:958](../../../src/app/(app)/transparency/page.tsx), :1007) ; nouveau : « depuis la console d'administration » ([derive/page.tsx:44](../../../src/app/(app)/derive/page.tsx)) et, pour l'ADMIN, « mettre en service une nouvelle version » ([compte/page.tsx:19](../../../src/app/(app)/compte/page.tsx)). Aucun bouton de mise en service dans l'UI | P1 · faible |
| T17 | États vides hétérogènes | Partiel | Plus de point final ; « Aucun calcul de risque publié » harmonisé ([dashboard/page.tsx:87](../../../src/app/(app)/dashboard/page.tsx), [employee-detail.tsx:509](../../../src/components/pilotage/employee-detail.tsx)). Sans pourquoi : « Aucun groupe à afficher » ([workload/sections.tsx:72](../../../src/components/ai/workload/sections.tsx)), « Aucune équipe prévue ce mois-ci », « Aucun département prévu » ([charge/page.tsx:233](../../../src/app/(app)/charge/page.tsx), :253) | P3 · faible |
| T18 | Admin hors gabarit (majuscules, boutons < 40 px) | Corrigé | `min-h-10` sur toutes les tailles de `Button` ([button.tsx:23-25](../../../src/components/ui/button.tsx)) ; plus d'en-tête en majuscules dans l'admin (reste [derive/page.tsx:95](../../../src/app/(app)/derive/page.tsx), hors admin) | — |
| T19 | Deux formulaires de suivi d'alerte | Corrigé | « Prendre en charge l'alerte », « Marquer comme traitée », « Rejeter l'alerte » ([alert-status-form.tsx:74](../../../src/app/(app)/alerts/alert-status-form.tsx), :96, :119) | — |
| T20 | Pluriels « (s) » | Partiel | « Paramètre(s) invalide(s) ignoré(s) » ([filters.tsx:171](../../../src/components/pilotage/filters.tsx), libellé visé par l'E2E) ; « Paramètre(s) d'adresse ignoré(s) » ([confidentialite/page.tsx:206](../../../src/app/(app)/confidentialite/page.tsx)) ; « ligne(s) » dans l'export du droit d'accès ([privacy/export.ts:444](../../../src/lib/privacy/export.ts)) | P3 · faible |
| T21 | Jours abrégés « j » | Partiel | Formations et Console corrigées. Reste fiche : `formatDays` → « 2 j » ([insights/labels.ts:88](../../../src/components/insights/labels.ts)), utilisé par [whats-new.tsx:70](../../../src/components/insights/whats-new.tsx) et [journey.tsx:61](../../../src/components/insights/journey.tsx) | P3 · faible |
| T22 | « salarié » visible | Corrigé | Aucune occurrence dans les `.tsx` ; seulement des commentaires dans `src/lib` | — |
| T23 | Filtre Type de l'admin | Corrigé | `TYPES_BY_ROLE` ([alerts/labels.tsx:13-17](../../../src/app/(app)/alerts/labels.tsx)) | — |
| T24 | Fiche inexistante sans h1 | Corrigé | `headingLevel={1}` ([(app)/not-found.tsx:10](../../../src/app/(app)/not-found.tsx)) | — |
| T25 | Champs natifs en anglais | Partiel | Import : champ fichier masqué, libellé maison ([admin-controls.tsx:155-165](../../../src/app/(app)/data-health/admin-controls.tsx)). Champs date natifs restants ([admin/audit/page.tsx:122](../../../src/app/(app)/admin/audit/page.tsx), :126 ; [reco-decision.tsx:76](../../../src/app/(app)/recommendations/reco-decision.tsx)) : langue du navigateur | P3 · faible |
| T26 | Noms de départements | Ouvert | `shortDepartment` ([pilotage/chart-options.ts:24](../../../src/components/pilotage/chart-options.ts)) utilisé seulement par le tableau de bord ; « au département Direction de la production » ([ai/workforce/recommendations.ts:124](../../../src/lib/ai/workforce/recommendations.ts)) | P2 · faible |
| T27 | Graphiques illisibles à 390 px | Partiel | Libellés sur deux lignes avec « … », `hideOverlap: false` sous 640 px ([ergonomie/CHARTS.md](../ergonomie/CHARTS.md) l. 10, 14). Rendu à vérifier en capture | P2 · faible |
| Revue, console | Erreurs d'hydratation /transparency et d'état /recommendations | Ouvert (à vérifier) | L'E2E ne relève que les messages CSP ([navigation.spec.ts:50-52](../../../tests/e2e/navigation.spec.ts)) | P3 · faible |
| Revue, performance | Non mesurable contre 3 s | Corrigé | Build de production : tableau de bord p95 = 103 ms sous 20 utilisateurs ([BACKLOG_INTEGRATION.md](../BACKLOG_INTEGRATION.md) l. 30) | — |

### 1.2 ERGONOMIE.md (30/09)

| Source | Constat | État | Preuve | Priorité si ouvert |
|---|---|---|---|---|
| § 4.1 | Retour contextuel fiche → liste filtrée | Corrigé | `ORIGINS` + `safeReturn` ([employees/[id]/page.tsx:23-69](../../../src/app/(app)/employees/[id]/page.tsx)) | — |
| § 4.2 | Filtres : rôle, puces retirables, « Réinitialiser » conditionnel, Première / Dernière | Corrigé | `restricted` ([filters.tsx:114-168](../../../src/components/pilotage/filters.tsx)), « Retirer le filtre » (:152), `first/last` (:217) | — |
| § 4.3 | Export CSV et « recommandation en attente » dans la liste | Corrigé | `ExportButton` ([employees/(liste)/page.tsx:163](../../../src/app/(app)/employees/(liste)/page.tsx)), `PendingHint` (:24, :49) | — |
| § 4.4 | Décision depuis la liste, tuile cliquable | Corrigé | `RecoDecision`, tuile `statut: "PROPOSEE"` ([recommendations/page.tsx:142](../../../src/app/(app)/recommendations/page.tsx)) | — |
| § 4.5 | Alertes : « Concerne », pagination, alerte suivante | Corrigé | [alerts/page.tsx:172](../../../src/app/(app)/alerts/page.tsx), :201 ; « Traiter l'alerte nouvelle suivante » ([alerts/[id]/page.tsx:195](../../../src/app/(app)/alerts/[id]/page.tsx)) | — |
| § 4.6 | Sommaire de fiche, squelette du what-if | Corrigé | « Aller à » et squelette à chaque calcul ([ergonomie/COLLAB.md](../ergonomie/COLLAB.md) l. 15, 27) | — |
| § 4.7 | Recherche d'un collaborateur dans l'en-tête | Obsolète | Remplacée par la recherche rapide Ctrl+K ([(app)/layout.tsx:45](../../../src/app/(app)/layout.tsx)) | — |
| § 4.7 | Badge d'alertes du menu → `?status=NOUVELLE` | Ouvert | Lien fixe `href={i.href}` vers /alerts ([sidebar.tsx:186-190](../../../src/components/layout/sidebar.tsx)) | P3 · faible |
| § 4.8 | Session expirée : retour à la page demandée | Corrigé | `/login?next=` ([BACKLOG_INTEGRATION.md](../BACKLOG_INTEGRATION.md) l. 42, 142) | — |
| § 4.9 | Pagination du journal | Corrigé | [admin/audit/page.tsx:229](../../../src/app/(app)/admin/audit/page.tsx) | — |
| § 5.1 | Validation visuelle 320 / 1 440 px | Partiel | E2E et axe faits ; captures finales non faites ([VERIFICATION_FINALE.md](../VERIFICATION_FINALE.md) l. 19) | P1 · moyen |
| § 5.2 | Filtres persistants entre écrans | Obsolète | Choix assumé (filtres dans l'URL, retour contextuel) | — |
| § 5.3 | Compteur plafonné à 500 | Corrigé | `countAlerts` ([dal/alerts.ts:163](../../../src/lib/dal/alerts.ts)) | — |
| § 5.4 | Liste des fichiers obligatoires dupliquée | Ouvert | `const MANDATORY` recopiée ([admin-controls.tsx:10](../../../src/app/(app)/data-health/admin-controls.tsx)) | P3 · faible |

### 1.3 ACCESSIBILITE.md « Restant », CLARTE, COUVERTURE, BUGS_E2E, BACKLOG

| Source | Constat | État | Preuve | Priorité si ouvert |
|---|---|---|---|---|
| ACC R5 | Variation des `KpiCard` portée par la couleur | Corrigé | Pastille écrite « favorable » / « à surveiller » ([pbi.tsx:191-200](../../../src/components/charts/pbi.tsx)) | — |
| ACC R8 | Confirmations natives `window.confirm` | Corrigé | `ConfirmDialog` ([confirm.tsx:132](../../../src/components/ui/confirm.tsx)) ; plus aucun `window.confirm` | — |
| ACC R9 | Focus non déplacé après navigation client | Ouvert | `main#contenu tabIndex={-1}` ([(app)/layout.tsx:87](../../../src/app/(app)/layout.tsx)), aucun code de focus trouvé | P3 · faible |
| ACC R10 | Cibles tactiles ~24 px | Partiel | `Button` à 40 px. Restent 32 px : [org-detail-panel.tsx:141](../../../src/components/org-chart/org-detail-panel.tsx), [settings-row.tsx:115](../../../src/components/admin/settings-row.tsx), « Afficher le détail » de l'organigramme, liens d'en-tête de visuel (≥ 24 px WCAG 2.5.8) | P3 · faible |
| ACC 2.11 | Gris neutre à 2,6:1 | Corrigé | `contexte: "#7c8aa1"` 3,5:1 ([theme.ts:18](../../../src/components/charts/theme.ts)) | — |
| CLARTE § 6 | 31 libellés à corriger | Corrigé | Aucun ancien texte trouvé (« Probabilité 6 mois », « Salarié lié », « Worker de calcul », « top-k »…) hors commentaires | — |
| CLARTE § 3 | Une décimale ; jours en toutes lettres | Partiel | `fr.rate` à 2 décimales ([insight-kit.tsx:15](../../../src/components/ai/workload/insight-kit.tsx)) ; « j » ([insights/labels.ts:88](../../../src/components/insights/labels.ts)) | P2 · faible |
| COUV § 5 | Bugs B1 à B4 | Corrigé | B1 `Math.floor` ([score.ts:52](../../../src/lib/scoring/score.ts)) ; B2 clé sha256 ([registry.ts:188](../../../src/lib/scoring/registry.ts)) ; B3 trigger `BEFORE INSERT` ([0006_audit_hardening.sql:4](../../../drizzle/0006_audit_hardening.sql)) ; B4 `safeInternalLink` ([dal/alerts.ts:114-118](../../../src/lib/dal/alerts.ts)) | — |
| COUV § 6 | 3 points à arbitrer | Corrigé | Minimum de 1 documenté ([CONVENTIONS.md:131](../../CONVENTIONS.md)) ; job IMPORT en échec ([jobs/handlers.ts:162](../../../src/lib/jobs/handlers.ts)) ; contribution nulle filtrée ([score.ts:59](../../../src/lib/scoring/score.ts)) | — |
| BUGS E2E-06 | Correction de fond des dates de démission | Corrigé | `backtestEvent` ([BACKLOG_INTEGRATION.md](../BACKLOG_INTEGRATION.md) l. 138) | — |
| BUGS, observation | Le manager voit le nom d'anciens managers hors de sa hiérarchie | Ouvert (à arbitrer) | `readableCareer` résout tous les noms ([synthesis.ts:405-411](../../../src/lib/dal/synthesis.ts)), aucun filtre MANAGER sur `CHANGEMENT_MANAGER` (:586) | P2 · faible |
| BACKLOG | `caddy validate`, services WinSW sur Windows Server | Ouvert | Hors code, à faire sur le serveur de recette (l. 13) | P2 · moyen |
| BACKLOG | `data/eval-*.db` (~1,3 Go) supprimables | Ouvert | Décision du stagiaire (l. 26) | P3 · faible |
| BACKLOG | Message « démarrage à froid » sur Transparence | Corrigé | `verdict(c, m, coldStart)` ([transparency/page.tsx:86](../../../src/app/(app)/transparency/page.tsx)) | — |
| BACKLOG | Seuils charge et absentéisme dans l'écran Paramètres | Corrigé | [settings-labels.ts:92-184](../../../src/components/admin/settings-labels.ts) | — |

### 1.4 Vague ergonomie du 04/10 (« Non fait ») et livrable

| Source | Constat | État | Preuve | Priorité si ouvert |
|---|---|---|---|---|
| UI | Marge droite des lignes de référence à 390 px | Ouvert (assumé) | [ergonomie/UI.md](../ergonomie/UI.md) l. 25 | P3 · moyen |
| UI | `ButtonLink` sans indicateur de navigation | Ouvert (assumé) | UI.md l. 26 | P3 · moyen |
| UI | `PageHeader` resserré entre 640 et 1 023 px | Ouvert (assumé) | UI.md l. 27 | P3 · faible |
| IA | Statuts des recommandations non alignés | Ouvert | Voir T3 ; [ergonomie/IA.md](../ergonomie/IA.md) l. 29 | P1 · faible |
| IA | Faible en gris sur Formations, contre la charte « vert = faible » | Ouvert (assumé) | IA.md l. 28 ; [CHARTE_UI.md](../CHARTE_UI.md) l. 40 | P3 · faible |
| IA | Rétention : verdict toujours neutre | Ouvert | Aucune référence dans le DTO (IA.md l. 26) | P3 · moyen |
| IA | Légende directe, `OnThisPage`, tableaux locaux de /previsions | Ouvert (assumé) | IA.md l. 24, 25, 27 | P3 · moyen |
| COLLAB | Canevas de l'organigramme non parcourable au clavier | Ouvert (assumé) | Vue Liste en alternative ([ergonomie/COLLAB.md](../ergonomie/COLLAB.md) l. 29) | P3 · élevé |
| COLLAB | Rampes de couleur en hexadécimal (organigramme, équipes) | Ouvert | [org-chart/scale.ts:28-31](../../../src/components/org-chart/scale.ts), [teams.tsx:9-12](../../../src/components/insights/teams.tsx), [teams-treemap.tsx:16-17](../../../src/components/insights/teams-treemap.tsx) | P3 · moyen |
| COLLAB | Zone 1 « Faits » au lieu d'« Observations » | Ouvert | Titre visé par l'E2E (COLLAB.md l. 28) | P3 · faible |
| COLLAB | Actions principales en haut de la fiche | Obsolète | Décision : le sommaire « Aller à » suffit (COLLAB.md l. 26) | — |
| PILOT P10 | « Analyser » sans objet, en-tête de visuel non repliable | Corrigé | « Analyser l'absentéisme » ([dashboard/page.tsx:390](../../../src/app/(app)/dashboard/page.tsx)) ; en-tête repliable ([CHANTIER_VISUELS.md](../CHANTIER_VISUELS.md) l. 41) | — |
| ACTION E2 | Export CSV sans état en cours | Ouvert (assumé) | [ergonomie/ACTION.md](../ergonomie/ACTION.md) l. 33 | P3 · moyen |
| ACTION E3 | « Voir les données » replié imprimé seul | Corrigé | CHANTIER_VISUELS.md l. 42 | — |
| ACTION I6 | Tableau à 6 colonnes en défilement sur mobile | Ouvert (assumé) | ACTION.md l. 35 | P3 · moyen |
| COMPTE C6 | 3 actions par ligne sur /admin/users | Ouvert (assumé) | [ergonomie/COMPTE.md](../ergonomie/COMPTE.md) l. 14 | P3 · moyen |
| CHARTS | Dette : `MARK` à déplacer dans theme.ts | Corrigé | `import { … MARK … } from "./theme"` ([builders.ts:2](../../../src/components/charts/builders.ts), :23-30). LIVRABLE § 7.8 est donc périmé | — |
| LIVRABLE § 7.1 | Captures finales | Ouvert | Étape 5 non faite ([VERIFICATION_FINALE.md](../VERIFICATION_FINALE.md) l. 19) ; trois `{{CAPTURES}}` restent dans [LIVRABLE_DESIGN_SYSTEM.md](../LIVRABLE_DESIGN_SYSTEM.md) (l. 207, 231, 245) | P1 · moyen |

## 2. Incohérences actuelles

Décompte : **0 P0**, **7 P1**, **9 P2**, **11 P3** (27 incohérences ; la ligne « masse salariale, risque élevé, turnover » note une cohérence).

### 2.1 Indicateurs : même idée, calculs ou libellés différents

| Élément | Où | Problème | Proposition | Priorité |
|---|---|---|---|---|
| « Équipes en tension » | [charge/page.tsx:142](../../../src/app/(app)/charge/page.tsx) ; [equipes/page.tsx:38](../../../src/app/(app)/equipes/page.tsx) | Même libellé, deux règles (pic d'heures sup contre cumul de signaux), deux chiffres | Charge : « Équipes en surcharge prévue ». Garder « tension » pour Équipes. Bulle « ? » dédiée (effort faible) | P1 |
| Heures supplémentaires | Synthèse, Équipes, Interventions : `overtimePerHeadOf` = heures / mois de présence ([dal/teams.ts:102-135](../../../src/lib/dal/teams.ts)). Charge : par ETP ([ai-workload.ts:170](../../../src/lib/dal/ai-workload.ts)) | Deux calculs, deux unités, trois écritures (« Heures sup », « Heures sup. », « Heures supplémentaires ») | Une unité de référence (h par ETP et par mois) et un libellé « Heures supplémentaires par ETP ». À défaut, écrire « par personne présente » partout où ce n'est pas l'ETP (effort moyen) | P1 |
| Taux d'absentéisme | `agg_kpi_monthly` ([dal/dashboard.ts:125-128](../../../src/lib/dal/dashboard.ts)) ; calcul détaillé (:178) ; buckets hebdo ([dal/absenteeism.ts:150](../../../src/lib/dal/absenteeism.ts)) ; `monthlyMeasures` (teams.ts:76, repris par [synthesis.ts:142](../../../src/lib/dal/synthesis.ts), [interventions.ts:127](../../../src/lib/dal/interventions.ts), [org-chart.ts:322](../../../src/lib/dal/org-chart.ts)) | Définition commune (`isUnplannedNonHealth`, [pilotage-metrics.ts:37](../../../src/lib/dal/pilotage-metrics.ts)) mais 4 chemins de calcul, 4 libellés (« Taux d'absence », « Absentéisme hors santé », « Absentéisme de l'entreprise », « du périmètre ») et 2 précisions (2 décimales sur /absenteeism, 1 ailleurs) | Libellé unique « Absentéisme hors santé » ; `fr.rate` à 1 décimale par défaut ; garder la période à côté de chaque valeur (effort faible) | P1 |
| Effectif | « hors stages et SIVP » ([dal/dashboard.ts:69](../../../src/lib/dal/dashboard.ts), [synthese/page.tsx:204](../../../src/app/(app)/synthese/page.tsx)) ; « collaborateurs actifs » ([equipes/page.tsx:315](../../../src/app/(app)/equipes/page.tsx)) ; tous les présents (/absenteeism) | Trois populations sous le même mot, écart visible pour un manager (T5 : 7 contre 9) | Écrire la population sous chaque effectif (« tous contrats », « hors stages et SIVP ») (effort faible) | P2 |
| Suivi des recommandations | [recommendations/page.tsx:145](../../../src/app/(app)/recommendations/page.tsx) ; [interventions/page.tsx:129](../../../src/app/(app)/interventions/page.tsx) ; [formations/page.tsx:383](../../../src/app/(app)/formations/page.tsx) | « Taux d'adoption » (sur décidées) et « Taux de réalisation » (sur émises) ; « taux de réalisation » sert aussi aux formations | Un nom par indicateur et son dénominateur écrit (« sur 110 décidées ») (effort faible) | P2 |
| Composant KPI | `KpiCard` (9 pages, ex. dashboard, charge) ; `KpiTile` (6 pages, ex. équipes, recommandations, confidentialité) | Deux tuiles pour le même rôle, rendu à vérifier côte à côte | Converger vers un seul composant, ou documenter quand utiliser l'autre (effort moyen) | P2 |
| Masse salariale, risque élevé, turnover | Masse : `agg_kpi_monthly` sur Tableau de bord et Prévisions ([ai-workforce.ts:148](../../../src/lib/dal/ai-workforce.ts)) ; risque : run publié ([dal/dashboard.ts:288](../../../src/lib/dal/dashboard.ts)) ; turnover : `rollingTurnover` seul ([pilotage-metrics.ts:223](../../../src/lib/dal/pilotage-metrics.ts)) | Cohérents : aucune fonction concurrente trouvée | — | — |

### 2.2 Libellés, terminologie, boutons

| Élément | Où | Problème | Proposition | Priorité |
|---|---|---|---|---|
| Décider une recommandation | [workload/reco-status-form.tsx:94-131](../../../src/components/ai/workload/reco-status-form.tsx) ; [recommendation-forms.tsx:126-131](../../../src/components/pilotage/recommendation-forms.tsx) ; [pilotage/labels.ts:17](../../../src/components/pilotage/labels.ts) | Primaire ici, secondaire là ; rejet sans icône dans `RecoBoard` ; « Rejeter avec motif » sur la fiche ; statut « Proposée » / « En attente de décision » / « à décider » | `variant="primary"` et `icon="x"` dans `RecoBoard` ; « Rejeter la recommandation » sur la fiche ; statut unique « En attente de décision » (déjà majoritaire) (effort faible) | P1 |
| Ordre des noms | Voir T4 (6 fichiers DAL et UI) | « Borhen Hamrouni » dans les alertes, « Hamrouni Borhen » dans la liste et la fiche | Concaténer `last_name \|\| ' ' \|\| first_name` dans les requêtes ; `fmt.person` côté UI (effort moyen, alertes déjà en base à recalculer ou laisser) | P1 |
| Mise en service des modèles | Voir T16 (7 textes) | Trois versions : par l'administrateur, depuis la console, hors de l'interface. Mon compte promet à l'ADMIN un geste qui n'existe pas | Un seul texte : « La mise en service se fait hors de l'interface, par la procédure outillée et tracée » ; corriger [compte/page.tsx:19](../../../src/app/(app)/compte/page.tsx) et [derive/page.tsx:44](../../../src/app/(app)/derive/page.tsx) (effort faible) | P1 |
| « à surveiller » | Pastille KPI défavorable ([pbi.tsx:192](../../../src/components/charts/pbi.tsx)) ; niveau d'équipe à 1 signal ([insights/labels.ts:6](../../../src/components/insights/labels.ts)) ; palier de l'organigramme ([scale.ts:36](../../../src/components/org-chart/scale.ts)) ; dérive ([derive/page.tsx:38](../../../src/app/(app)/derive/page.tsx)) | Même mot pour quatre échelles différentes | Garder « à surveiller » pour les niveaux ; pastille KPI « défavorable » (effort faible) | P3 |
| Gravité | Alertes : Critique / Attention / Information ([alerts/labels.tsx:31-35](../../../src/app/(app)/alerts/labels.tsx)) ; contrôles d'import : Rejet / Correction / Avertissement ([rule-help.ts:110-113](../../../src/components/monitoring/rule-help.ts)) | CLARTE § 2 demande le même mot ; ici ce sont deux échelles | Nommer la colonne d'import « Effet » (déjà le cas en partie) et retirer la ligne « gravité » de CLARTE pour l'import (effort faible) | P3 |
| Codes techniques résiduels | Voir T6, T7 | Code de contrôle, méthode RIDGE_…, nom de lot affichés | Code en infobulle ; `KIND_LABEL` étendu aux modèles par sujet ; « Import AJIR du 29/09/2026 » (effort faible) | P2 |
| Noms de départements | Voir T26 | Long, court ou avec code selon l'écran | `shortDepartment` dans les axes et les phrases des pages IA (effort faible) | P2 |
| Export du droit d'accès | [privacy/export.ts:33](../../../src/lib/privacy/export.ts), :444 | Document remis au collaborateur : « Simulation what-if », « ligne(s) » | « Simulation « et si ? » », pluriel accordé (effort faible) | P2 |
| Titres d'onglet et menu | « Console d'administration » ([admin/page.tsx:16](../../../src/app/(app)/admin/page.tsx)) contre « Console » ([sidebar.tsx:49](../../../src/components/layout/sidebar.tsx)) ; « Formations obligatoires » ([formations/page.tsx:23](../../../src/app/(app)/formations/page.tsx)) contre « Formations » (sidebar.tsx:40) | CLARTE § 4 : titre identique au menu | Aligner le menu sur le titre, ou l'inverse (effort faible) | P3 |
| Surtitres | Voir T9 | 8 écrans sans surtitre | Le poser partout, idéalement depuis `NAV` (effort faible) | P3 |
| États vides sans pourquoi | Voir T17 | 3 états réduits à un titre | Ajouter la raison (« aucune prévision publiée ce mois-ci ») (effort faible) | P3 |
| Pluriels « (s) » | Voir T20 | 3 textes | Accorder (le texte de `filters.tsx:171` est visé par l'E2E : adapter le sélecteur) (effort faible) | P3 |

### 2.3 Formats, couleurs, code

| Élément | Où | Problème | Proposition | Priorité |
|---|---|---|---|---|
| Formateurs dupliqués | `fmt` ([ui/index.tsx:428](../../../src/components/ui/index.tsx)) ; [pilotage/labels.ts:28-44](../../../src/components/pilotage/labels.ts) ; [insights/labels.ts:87-88](../../../src/components/insights/labels.ts) ; `fr` ([insight-kit.tsx:12-25](../../../src/components/ai/workload/insight-kit.tsx)) ; [workforce/chart-options.ts:9](../../../src/components/ai/workforce/chart-options.ts) ; locaux ([backtesting/page.tsx:18](../../../src/app/(app)/backtesting/page.tsx), [previsions/page.tsx:17](../../../src/app/(app)/previsions/page.tsx), [transparency/page.tsx:40](../../../src/app/(app)/transparency/page.tsx), [derive/page.tsx:22](../../../src/app/(app)/derive/page.tsx), [absenteeism/page.tsx:38](../../../src/app/(app)/absenteeism/page.tsx)) | Sortie française partout (aucun `toFixed` affiché), mais défauts différents : taux à 2 décimales dans `fr`, années à 2 chiffres dans `fr.monthShort`. `fmt.person` et `fmt.ofMonth` jamais appelés | Faire de `fr` un alias de `fmt` (`fmt.pct`, `fmt.month(…, { short: true })`) (effort moyen) | P2 |
| Mois abrégés | [insight-kit.tsx:22](../../../src/components/ai/workload/insight-kit.tsx) ; [workforce/chart-options.ts:9](../../../src/components/ai/workforce/chart-options.ts) | « sept. 24 » (Absentéisme, Charge) contre « sept. 2024 » (Prévisions, Vérification a posteriori) | `fmt.month(ym, { short: true })` partout (effort faible) | P2 |
| Élision | Voir T13 | « calcul de août », « Équipe de Amri » | `fmt.ofMonth`, `fmt.de` (déjà écrits) (effort faible) | P3 |
| Dates d'alertes | Voir T7 | Format différent liste / détail | `fmt.dateTime` dans la liste (effort faible) | P3 |
| Jours « j » | Voir T21 | « 2 j » sur la fiche | `formatDays` en toutes lettres (effort faible) | P3 |
| Couleurs des niveaux : deux sources | Badges : jetons CSS ([globals.css:104-110](../../../src/app/globals.css) : Moyen `#92400e`, Faible `#047857`) ; graphiques : `SEMANTIC` ([theme.ts:12-14](../../../src/components/charts/theme.ts) : `#d97706`, `#15803d`) | Pastille Moyen brune, barre Moyen ambre. Libellés des niveaux définis 4 fois ([ui/index.tsx:264](../../../src/components/ui/index.tsx), [pilotage/labels.ts:1](../../../src/components/pilotage/labels.ts), [pilotage/chart-options.ts:15-20](../../../src/components/pilotage/chart-options.ts), [privacy/export.ts:28](../../../src/lib/privacy/export.ts)), mêmes mots. Aucune classe Tailwind de couleur brute pour le risque dans `src` | Point de couleur de `RiskBadge` lu depuis `RISK_COLORS` ; un seul `LEVEL_LABELS` exporté (effort faible) | P3 |
| Couleurs de tension | [insights/labels.ts:7-11](../../../src/components/insights/labels.ts) ; [teams.tsx:9-12](../../../src/components/insights/teams.tsx) ; [teams-treemap.tsx:16-17](../../../src/components/insights/teams-treemap.tsx) | « À surveiller » bleu en badge, jaune en pastille ; « Tension » ambre en badge, orange `#fb923c` en pastille ; hexadécimaux hors jetons | `TENSION_TONE.SURVEILLER = "amber"` ; rampe partagée dans theme.ts (effort faible) | P2 |
| Code mort | [insights/chart-options.ts](../../../src/components/insights/chart-options.ts) | Importé nulle part ; encres en dur (`#64748b`, `#475569`) | Supprimer après vérification (effort faible) | P3 |

### 2.4 Documents de suivi

| Élément | Où | Problème | Proposition | Priorité |
|---|---|---|---|---|
| Docs de suivi et livrable | [REVUE_TRANSVERSE.md](../REVUE_TRANSVERSE.md) ; [ACCESSIBILITE.md](../ACCESSIBILITE.md) l. 102 ; [ERGONOMIE.md](../ERGONOMIE.md) § 4 ; [LIVRABLE_DESIGN_SYSTEM.md](../LIVRABLE_DESIGN_SYSTEM.md) l. 207, 231, 245, 252 | T1-T27 sans statut ; R5, R8, R10 encore « ouverts » alors que faits ; « À appliquer » non marqués ; trois `{{CAPTURES}}` ; « 56 attendues » contre « 136 prévues, 128 produites » ([VERIFICATION_FINALE.md](../VERIFICATION_FINALE.md) l. 10) ; dette `MARK` déjà soldée | Reporter les états du § 1 dans chaque doc ; remplir ou retirer `{{CAPTURES}}` avant de montrer le livrable (effort faible) | P1 |

## 3. Accessibilité : restants et régressions

### 3.1 Restants

| Point | État | Preuve |
|---|---|---|
| Audit automatisé | Corrigé | axe : 0 violation, 43 pages en clair, 21 en sombre, 1 en menu réduit ; E2E 153/153 ([VERIFICATION_FINALE.md](../VERIFICATION_FINALE.md) l. 17) |
| R5 variation des KPI | Corrigé | Pastille écrite ([pbi.tsx:191-200](../../../src/components/charts/pbi.tsx)) ; même contrat pour `KpiTile` ([ergonomie/UI.md](../ergonomie/UI.md) l. 17) |
| R8 confirmations | Corrigé | `ConfirmDialog` : focus piégé, Échap, focus rendu (UI.md l. 29) |
| R9 focus après navigation | Ouvert, P3 | Aucun déplacement du focus vers `main` trouvé |
| R10 cibles | Partiel, P3 | 40 px pour `Button` ; restent des cibles de 32 px (organigramme, Paramètres, liens d'en-tête de visuel) |
| Canevas de l'organigramme | Ouvert (assumé), P3 | Vue Liste comme alternative clavier ([ergonomie/COLLAB.md](../ergonomie/COLLAB.md) l. 29) |
| Rendu 390 px, menu réduit, sommaire collant | À vérifier, P1 | Jamais vus au navigateur pendant les vagues ([LIVRABLE_DESIGN_SYSTEM.md](../LIVRABLE_DESIGN_SYSTEM.md) § 7.2) ; captures non faites |

### 3.2 Régressions recherchées dans le code ajouté depuis le 30/09

| Contrôle | Résultat | Preuve |
|---|---|---|
| Boutons icône sans nom accessible | Aucun trouvé. Menu réduit, thème, recherche, déconnexion, menu mobile : texte `sr-only` | [sidebar.tsx:323-324](../../../src/components/layout/sidebar.tsx), [theme.tsx:227-231](../../../src/components/ui/theme.tsx), [command-palette.tsx:50-51](../../../src/components/ux/command-palette.tsx), [(app)/layout.tsx:80-81](../../../src/app/(app)/layout.tsx) |
| Liens réduits à une icône | Aucun trouvé | Recherche multi-lignes `<Link …><Icon/></Link>` sans résultat |
| Menu réduit | Libellés gardés en `sr-only`, compteur d'alertes doublé d'un texte masqué | [sidebar.tsx:142](../../../src/components/layout/sidebar.tsx), :208 |
| Information portée par la couleur seule | Pas de régression : couleurs écrites dans les sous-titres et tableaux « Voir les données » | [charge/page.tsx:214](../../../src/app/(app)/charge/page.tsx), [formations/page.tsx:279](../../../src/app/(app)/formations/page.tsx), pastilles de tension avec texte ([equipes/page.tsx:166-168](../../../src/app/(app)/equipes/page.tsx)) |
| Couleur sémantique contradictoire | À corriger (P2) : « À surveiller » en badge bleu (`sky`) alors que le bleu signifie « neutre » dans la charte | [insights/labels.ts:7](../../../src/components/insights/labels.ts) ; [CHARTE_UI.md](../CHARTE_UI.md) l. 40 |
| Couleurs hors jetons | Magenta de marque en classes Tailwind (`dark:text-fuchsia-300`, `bg-fuchsia-50`), contraste validé par axe | [ui/index.tsx:61](../../../src/components/ui/index.tsx), [alerts/page.tsx:145](../../../src/app/(app)/alerts/page.tsx), [alerts/[id]/page.tsx:116](../../../src/app/(app)/alerts/[id]/page.tsx), [(app)/layout.tsx:16](../../../src/app/(app)/layout.tsx), [admin-ui.tsx:7](../../../src/components/admin/admin-ui.tsx) |
| Champs date natifs | Langue de l'interface du navigateur (P3) | Voir T25 |

## Notes proposées

| Dimension | Note | Justification |
|---|---|---|
| Professionnalisme (cohérence) | 6,5/10 | Gros progrès (jetons, boutons à 40 px, filtres et pagination uniques, `fmt.model`, 31 libellés de CLARTE). Restent des contradictions visibles en démonstration : deux « Équipes en tension », trois mesures d'heures sup, statuts de recommandation, ordre des noms, consignes de mise en service. Docs de suivi non à jour. |
| Lisibilité | 7,5/10 | Textes français, unités et périodes écrites, états vides expliqués, statuts en mots, axe à 0 violation. Pénalités : décimales et mois abrégés variables d'un écran à l'autre, quelques codes techniques et élisions fautives. |
