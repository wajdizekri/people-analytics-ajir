# Chantier « enrichissement » (02/10/2026) — règles communes

Cinq fonctionnalités développées en parallèle par cinq agents de la session aziz-pfe-4e. Lire d'abord [CONVENTIONS.md](../CONVENTIONS.md) (sécurité, rôles, DTO, petits groupes, audit), [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (jetons) et [CHARTE_UI.md](CHARTE_UI.md) (boutons, textes, visuels).

## Contexte à ne pas oublier

- **Une autre session (aziz-pfe-e0) migre en ce moment tout `src/` vers les jetons du design system** (`bg-surface`, `text-fg`, `border-line`, `bg-primary`…). Conséquences :
  - dans le code neuf, **uniquement des jetons sémantiques**, jamais `bg-white`, `text-slate-*`, `bg-sky-*` ;
  - fichier existant : **relire juste avant chaque Edit**, modification chirurgicale (insertion de quelques lignes), **jamais de réécriture complète** ; si un Edit échoue parce que le fichier a changé, relire et réappliquer la même insertion minimale ;
  - erreurs `tsc`/ESLint dans des fichiers hors de ton périmètre : ne pas les corriger, les signaler dans ton compte rendu.
- Rôles : ADMIN = administration seule, **aucune donnée RH** ; RH = toute l'entreprise ; MANAGER = sa hiérarchie (`scopeFilter`, `visibleEmployeeIds`, `canSeeEmployee` de `src/lib/dal/context.ts`), sans salaire, masse salariale, probabilité, `phrase_rh`, ni signal individuel d'absentéisme ; aucun taux ni nombre de sorties sur un groupe < `MIN_GROUP_SIZE` (5) côté manager (`smallGroupMask`, `src/lib/dal/pilotage-metrics.ts`).
- Toute lecture de la base passe par `src/lib/dal/*` (fonction qui reçoit un `AccessContext`, `ensurePilotage` en tête pour les données RH). Pages : `pageContext([...])` ; API : `withApi` + `requireContext([...])`. Entrées validées par zod. Lectures sensibles et exports audités (`src/lib/audit.ts`).
- Visuels « style Power BI » : kit `src/components/charts/pbi.tsx`, wrapper `src/components/charts/echart.tsx`, palette `src/components/charts/theme.ts`. Chaque graphique a une alternative textuelle (table « Voir les données » ou liste de liens).
- Les entrées de menu `/organigramme` et `/retention` (RH + MANAGER), leurs icônes et leurs libellés d'audit (`PAGE_LABEL`) sont **déjà posés** (sidebar.tsx, audit-labels.ts, tests/components/ui.test.ts) : ne pas y retoucher.

## MISE À JOUR (coordination avec aziz-pfe-e0) — prioritaire sur le reste du document

- **Ne plus éditer** : `src/components/layout/sidebar.tsx`, `src/app/(app)/layout.tsx`, `src/components/charts/echart.tsx`, `src/components/charts/pbi.tsx`, `src/app/globals.css`, `src/components/ui/index.tsx`, `src/components/admin/audit-labels.ts`, et les pages `employees/(liste)`, `alerts`, `recommendations`, `dashboard`, `absenteeism`, `equipes`, `synthese` (toutes en cours de réécriture par e0). Import en lecture de ces fichiers : OK.
- À la place : livrer des **composants autonomes** dans tes propres dossiers ; décrire l'insertion exacte (fichier, repère textuel, import + JSX) dans ta section de [BRANCHEMENTS_4E.md](BRANCHEMENTS_4E.md) ; pour un changement d'API d'`echart.tsx` / `pbi.tsx` / `globals.css` / `layout.tsx`, écrire la demande précise (prop voulue, code à insérer) dans [DEMANDES_COMPOSANTS.md](DEMANDES_COMPOSANTS.md), section « Vague design system », préfixe `[aziz-pfe-4e]` (relire juste avant d'éditer, ajout en fin de section seulement).
- `KpiCard` affiche déjà une flèche ▲▼ : la partie « flèche de variation » de l'agent B est abandonnée.

## Interdits pour tous

- `src/db/schema.ts`, `drizzle/*` (pas de migration), `package.json` (pas de nouvelle dépendance), `src/proxy.ts`, `src/lib/dal/context.ts`, `tests/e2e/*` (l'intégrateur ajoutera les pages aux specs).
- `next build`, `next dev`, Playwright : **interdits** (conflit `.next/`, poste à 8 Go).
- Écrire dans `data/app.db` (base de démo) : lecture seule (`new Database(path, { readonly: true })`) pour vérifier des chiffres ; tests sur bases temporaires comme les tests existants.

## Vérification

- `npx vitest run tests/<ton-dossier> --maxWorkers=2` (tests neufs dans ton propre dossier sous `tests/`).
- `npx eslint <tes fichiers>`.
- `npx tsc --noEmit` **une fois** à la fin (deux au plus) ; ne retenir que les erreurs de tes fichiers.

## Périmètres (fichiers que chaque agent peut créer ou modifier)

**A — Export CSV et synthèse imprimable**
- Créer : `src/lib/dal/export.ts`, `src/lib/export/*` (sérialisation CSV), `src/app/api/export/[kind]/route.ts`, `src/components/export/*`, `tests/export/*`.
- Insérer seulement : bouton d'export dans `src/app/(app)/employees/(liste)/page.tsx`, `src/app/(app)/alerts/page.tsx`, `src/app/(app)/recommendations/page.tsx` ; bouton « Imprimer / PDF » et en-tête d'impression dans `src/app/(app)/synthese/page.tsx` ; **un bloc `@media print` ajouté à la fin** de `src/app/globals.css` ; libellé de l'action d'audit d'export dans `src/components/admin/audit-labels.ts` (table des actions, pas `PAGE_LABEL`).

**B — Filtrage croisé des graphiques + flèche ▲▼ des variations**
- Modifier : `src/components/charts/echart.tsx`, `src/components/charts/pbi.tsx`, `src/components/charts/builders.ts`, `src/components/insights/teams-treemap.tsx`, `src/components/insights/chart-options.ts`, `src/components/ai/absenteeism/chart.ts` ; insertions dans `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/absenteeism/page.tsx`, `src/app/(app)/equipes/page.tsx` ; variation des tuiles KPI (`KpiTile` de `src/components/ui/index.tsx` : insertion minimale seulement).
- Créer : `tests/charts/*`.
- Ne pas modifier la page Collaborateurs : cibler uniquement des filtres qui existent déjà (`src/components/pilotage/filters.tsx`, `filter-fields.tsx`).

**C — Palette de commandes Ctrl+K**
- Créer : `src/components/ux/command-palette.tsx` (et fichiers voisins `command-palette-*.ts(x)`), `src/lib/dal/search.ts`, `src/app/api/search/route.ts`, `tests/search/*`.
- Insérer seulement : montage de la palette et bouton d'ouverture dans `src/app/(app)/layout.tsx`.

**D — Rétention par cohorte d'embauche (Kaplan-Meier)**
- Créer : `src/lib/retention/*` (calcul pur, testé), `src/lib/dal/retention.ts`, `src/app/(app)/retention/*` (`page.tsx`, `loading.tsx`, `error.tsx`), `src/components/retention/*`, `tests/retention/*`.
- Insérer seulement : définitions dans `src/lib/help/terms.ts` / `src/lib/help/content.ts` (seul agent autorisé à toucher l'aide dans ce chantier).

**E — Organigramme interactif**
- Créer : `src/lib/dal/org-chart.ts`, `src/app/(app)/organigramme/*` (`page.tsx`, `loading.tsx`, `error.tsx`), `src/components/org-chart/*`, `tests/org-chart/*`.

Besoin d'un fichier hors de ton périmètre : **ne pas le modifier**, l'écrire ci-dessous (agent, fichier, changement voulu, pourquoi). L'intégrateur s'en charge.

## Demandes hors périmètre

<!-- format : - [A] chemin/fichier — changement — raison -->
- [A] `src/app/(app)/employees/(liste)/page.tsx`, `alerts/page.tsx`, `recommendations/page.tsx`, `synthese/page.tsx` — brancher `ExportButton`, `PrintButton` et `PrintHeader` — insertions exactes dans [BRANCHEMENTS_4E.md](BRANCHEMENTS_4E.md) § A1 à A4 (pages en cours de réécriture par e0).
- [A] `src/components/admin/audit-labels.ts` — libellé de l'action `export.csv` et famille « Exports de listes » — code dans BRANCHEMENTS_4E.md § A5.
- [A] `src/app/(app)/layout.tsx` — `import "@/components/export/print.css";` — impression propre de toutes les pages, pas seulement la synthèse (demande aussi dans DEMANDES_COMPOSANTS.md, « Vague design system »).
- [A] `src/lib/dal/employees.ts` (`listEmployees`), `src/lib/dal/recommendations.ts` (`listRecommendations`) — option facultative `pageSize` (défaut 25) — l'export parcourt aujourd'hui les pages de 25 (une requête par page, et 5 requêtes d'indicateurs par page pour les recommandations) ; correct jusqu'à quelques milliers de lignes, une seule requête avec cette option. Non bloquant.
- [C] `src/app/(app)/layout.tsx` — `import { CommandPalette, CommandPaletteTrigger } from "@/components/ux/command-palette";`, `<CommandPaletteTrigger />` juste avant `<ThemeToggle />`, `<CommandPalette role={ctx.role} />` une fois (ex. avant `</header>`) — fichier réservé à e0 depuis la mise à jour ; insertion exacte dans [BRANCHEMENTS_4E.md](BRANCHEMENTS_4E.md) § C, demande aussi dans DEMANDES_COMPOSANTS.md (« Vague design system »).
- [B] `src/app/(app)/dashboard/page.tsx`, `absenteeism/page.tsx`, `equipes/page.tsx` — appels `withDrill` / `withDrillSpec` (graphiques cliquables) — insertions exactes dans [BRANCHEMENTS_4E.md](BRANCHEMENTS_4E.md) § B1 à B3 (pages réservées à e0).
- [B] `src/components/charts/echart.tsx`, `src/components/charts/pbi.tsx`, `tests/components/ui.test.ts` — clic → `router.push(data.href)`, mention « Cliquer pour voir … » dans l’infobulle, liens dans « Voir les données », `useRouter` dans le mock `next/navigation` — code dans DEMANDES_COMPOSANTS.md (« Vague design system », `[aziz-pfe-4e]` agent B) ; sans cela les href posés restent sans effet.
- [B] `src/lib/dal/absenteeism.ts` + `absenteeism/page.tsx` — filtre facultatif `manager` (équipe) — un clic sur une équipe ouvre aujourd’hui sa liste de collaborateurs faute de vue « absentéisme d’une équipe » ; non bloquant.
- [E] `src/app/(app)/employees/[id]/page.tsx` — ajouter `"/organigramme": "Organigramme"` à `ORIGINS` — les liens de l'organigramme ouvrent la fiche avec `?retour=/organigramme` ; le fil d'Ariane ramènerait à l'organigramme au lieu de « Collaborateurs » (aujourd'hui le paramètre est ignoré, sans erreur).
- [E] `src/components/admin/audit-labels.ts`, `src/app/(app)/equipes/page.tsx`, `src/app/(app)/employees/(liste)/page.tsx` — libellé d'audit `org_chart.view`, lien « Voir l'organigramme », retour vers l'organigramme — insertions exactes dans [BRANCHEMENTS_4E.md](BRANCHEMENTS_4E.md) § E1 à E3 (fichiers réservés à e0) ; non bloquant.
- [E] `tests/e2e/*` — ajouter `/organigramme` aux parcours RH et MANAGER (ADMIN → `/interdit`) ; sélecteurs : `getByRole("heading", { name: "Organigramme", level: 1 })`, `getByRole("group", { name: "Colorer selon" })`, bouton `getByRole("button", { name: "Liste" })`, champ `getByLabel("Trouver une personne")`, panneau `getByRole("region", { name: … })` (titre `#org-detail-title`).
- [D] `src/app/(app)/dashboard/page.tsx`, `src/components/admin/audit-labels.ts` — lien « Voir la rétention des embauchés » sur la carte Turnover, libellé `retention.view` dans `VIEWS` — insertions exactes dans [BRANCHEMENTS_4E.md](BRANCHEMENTS_4E.md) § D1 et D2 (fichiers réservés à e0) ; non bloquant.
- [D] `tests/e2e/*` — ajouter `/retention` aux parcours RH et MANAGER (ADMIN → `/interdit`) ; sélecteurs dans [BRANCHEMENTS_4E.md](BRANCHEMENTS_4E.md) § D3.
