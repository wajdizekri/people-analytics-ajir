# Branchements du chantier « enrichissement » (session aziz-pfe-4e)

> **État au 04/10 (intégration finale) : tout est branché.** A1–A5 (export CSV sur Collaborateurs, Alertes, Recommandations ; « Imprimer la synthèse » + en-tête d'impression ; libellé d'audit `export.csv` et famille « Exports de listes »), A6 (print.css dans le gabarit), B1–B3 (filtrage croisé du tableau de bord, de l'absentéisme et de la carte des équipes, hrefs passés à `TeamsTreemap`), C (palette Ctrl+K), D1–D2 (lien « Voir la rétention des embauchés » sur la carte Turnover, `retention.view`), E1–E3 (`org_chart.view`, « Voir l'organigramme » sur /equipes, retour `/organigramme` accepté par la liste, fil d'Ariane « Organigramme »). Écarts assumés : `PrintButton` accepte une prop `label` (« Imprimer la synthèse ») ; `EChart` monte la navigation aussi pour des cibles imbriquées (équipes de la carte côté manager).

Les pages et fichiers cœur ci-dessous sont en cours de migration par la session aziz-pfe-e0 (design system). Les agents de 4e livrent des **composants autonomes** dans leurs propres dossiers et décrivent ici l'insertion exacte à faire, intégrée à la fin par e0 ou par 4e une fois la migration terminée.

Format d'une entrée : fichier cible, endroit (repère textuel stable, pas un numéro de ligne), code à insérer (import + JSX), condition (rôle, données).

Fichiers concernés : `src/app/(app)/{employees/(liste),alerts,recommendations,dashboard,absenteeism,equipes,synthese}/page.tsx`, `src/app/(app)/layout.tsx`, `src/components/admin/audit-labels.ts`. Les changements de `echart.tsx`, `pbi.tsx`, `globals.css`, `sidebar.tsx` sont demandés dans [DEMANDES_COMPOSANTS.md](DEMANDES_COMPOSANTS.md), section « Vague design system », préfixe `[aziz-pfe-4e]`.

Déjà fait par 4e avant la coordination (laissé en l'état, relu par e0) : entrées de menu `/organigramme` et `/retention` + icônes dans `sidebar.tsx`, `PAGE_LABEL` de ces deux routes dans `audit-labels.ts`, liste du menu manager dans `tests/components/ui.test.ts`.

## A — Export CSV et impression

Livré (autonome, testé : `tests/export/*`) : route `GET /api/export/[kind]` (`employees` | `alerts` | `recommendations`), DAL `src/lib/dal/export.ts`, sérialisation `src/lib/export/*`, composants `src/components/export/` (`ExportButton`, `PrintButton`, `PrintHeader`, `print.css`). Les boutons sont masqués à l'impression (`print:hidden`). Rien n'est encore branché dans les pages.

**A1. Collaborateurs** — `src/app/(app)/employees/(liste)/page.tsx` (RH et MANAGER ; le serveur choisit les colonnes du rôle)
- Import : `import { ExportButton } from "@/components/export/export-button";`
- Repère : le `<PageHeader` du composant `EmployeesPage` (props `title={title}`, `scope=…`, `period=…`). Ajouter la prop :
  ```tsx
  actions={list.total > 0 ? <ExportButton kind="employees" searchParams={raw} total={list.total} /> : undefined}
  ```
  `raw` = `const raw = await searchParams;` déjà présent en tête de la page.

**A2. Alertes** — `src/app/(app)/alerts/page.tsx` (tous les rôles ; filtrage par rôle fait par la DAL)
- Import : `import { ExportButton } from "@/components/export/export-button";`
- Repère : dans `AlertsContent`, juste après `<ActiveFilters filters={active} />`, insérer :
  ```tsx
  {total > 0 && (
    <div className="mb-4 flex justify-end">
      <ExportButton kind="alerts" searchParams={sp} total={total} />
    </div>
  )}
  ```
  (`sp` et `total` existent déjà dans `AlertsContent`. Variante en en-tête : `actions={<ExportButton kind="alerts" searchParams={await searchParams} />}` sur le `<PageHeader` d'`AlertsPage`, sans le total.)

**A3. Recommandations** — `src/app/(app)/recommendations/page.tsx` (RH seule, comme la page)
- Import : `import { ExportButton } from "@/components/export/export-button";`
- Repère : remplacer `parseQuery(recommendationListSchema, await searchParams, "lenient")` par `const raw = await searchParams;` puis `parseQuery(recommendationListSchema, raw, "lenient")` ; sur le `<PageHeader` (`title="Recommandations"`), ajouter :
  ```tsx
  actions={l.total > 0 ? <ExportButton kind="recommendations" searchParams={raw} total={l.total} /> : undefined}
  ```

**A4. Synthèse imprimable** — `src/app/(app)/synthese/page.tsx` (RH et MANAGER)
- Imports :
  ```tsx
  import { PrintButton } from "@/components/export/print-button";
  import { PrintHeader } from "@/components/export/print-header";
  ```
- Repère 1 : juste avant `<PageHeader` (titre « Synthèse du mois »), insérer :
  ```tsx
  <PrintHeader title="Synthèse du mois" dataDate={s.referenceDate} login={ctx.login} role={ctx.role} scope={rh ? "Toute l'entreprise" : "Votre équipe (périmètre hiérarchique)"} />
  ```
- Repère 2 : la prop `actions={` du même `PageHeader` (bouton « Ouvrir le tableau de bord ») devient :
  ```tsx
  actions={
    <div className="flex flex-wrap gap-2">
      <PrintButton />
      <ButtonLink href="/dashboard" variant="secondary" iconEnd="arrow-right">
        Ouvrir le tableau de bord
      </ButtonLink>
    </div>
  }
  ```

**A5. Libellé d'audit** — `src/components/admin/audit-labels.ts` (action `export.csv`, cible `export` / `employees|alerts|recommendations`, détail `{ format, rows, total, truncated, view, filters, ignored? }`)
- Repère : après la constante `const ALERT_STATUS: Record<string, string> = …`, ajouter :
  ```ts
  const EXPORT_LIST: Record<string, string> = { employees: "la liste des collaborateurs", alerts: "la liste des alertes", recommendations: "la liste des recommandations" };
  ```
- Repère : dans `phrase()`, avant `case "auth.ajir_launch":`, insérer :
  ```ts
  case "export.csv": {
    const rows = typeof d.rows === "number" ? `${d.rows} ligne${d.rows > 1 ? "s" : ""}${d.truncated ? ", plafond de 10 000 atteint" : ""}` : undefined;
    return { verb: V.exporter, object: `${EXPORT_LIST[e.targetId ?? ""] ?? "une liste"} au format CSV`, extra: rows };
  }
  ```
  Rendu : « rh.demo a exporté la liste des collaborateurs au format CSV (124 lignes). » ; refus : « admin a tenté d'exporter la liste des collaborateurs au format CSV : accès refusé. »
- Repère : dans `AUDIT_CATEGORIES`, après `{ prefix: "privacy.", … }`, ajouter `{ prefix: "export.", label: "Exports de listes" },`.

**A6. Impression de toutes les pages** — le CSS d'impression (`src/components/export/print.css`) n'est chargé que sur les pages qui montent `PrintHeader` ou `PrintButton`. Pour une impression propre partout (Ctrl+P sur le tableau de bord…), demandé dans DEMANDES_COMPOSANTS.md : `import "@/components/export/print.css";` dans `src/app/(app)/layout.tsx`.

## B — Graphiques cliquables

Livré (testé : `tests/charts/*`) : `src/components/charts/drill.ts` — `withDrill(option, (name, seriesName) => href | undefined, hint)` (option ECharts déjà construite), `withDrillSpec(spec, …)` (`ChartSpec` des helpers : ajoute aussi `table.hrefs` pour le tableau « Voir les données »), cibles typées sur les schémas zod des pages (`employeesHref`, `absenteeismHref`, `teamsHref`) et `levelFromLabel` (« Élevé » → `ELEVE`…). La carte des équipes (`teams-treemap.tsx`) accepte `href` par équipe et par département. **Le clic, la mention dans l'infobulle et les liens du tableau n'agissent qu'une fois la demande `[aziz-pfe-4e]` agent B de DEMANDES_COMPOSANTS.md faite dans `echart.tsx` / `pbi.tsx`** ; d'ici là, les insertions ci-dessous sont sans effet visible et sans risque. Seuls des filtres existants sont visés ; les résolveurs ne rendent cliquables que des groupes déjà affichés au rôle (groupes masqués du manager : absents des graphiques, donc jamais liés). Les trois insertions ont été compilées (`tsc`) sur une copie des pages au 02/10 12 h 30.

**B1. Tableau de bord** — `src/app/(app)/dashboard/page.tsx` (RH et MANAGER ; graphiques de départements : RH seule, comme aujourd'hui)
- Import : `import { levelFromLabel, withDrill, withDrillSpec } from "@/components/charts/drill";`
- Repère : juste avant le `return (` du composant `DashboardPage` (après `const deptAbsenteeismChart = …`), insérer :
  ```tsx
  // Filtrage croisé : un clic sur une barre ouvre la liste ou l'analyse filtrée ; équivalent clavier : tableau « Voir les données »
  const deptIdOf = (short: string) => (d.view === "RH" ? d.departments : []).find((x) => shortDepartment(x.name) === short)?.departmentId ?? undefined;
  const toLevelList = (name: string) => {
    const l = RISK_LEVELS.find((x) => x.label === name);
    return l && risk && risk.totals[l.key] > 0 ? toList({ niveau: levelFromLabel(name) }) : undefined;
  };
  const toDeptLevelList = (name: string, series?: string) => {
    const r = riskByDept.find((x) => shortDepartment(x.name) === name);
    const niveau = levelFromLabel(series);
    return r?.departmentId && (niveau === "ELEVE" || niveau === "MOYEN") && r[niveau] > 0 ? toList({ departement: r.departmentId, niveau }) : undefined;
  };
  const toDeptList = (name: string) => {
    const id = deptIdOf(name);
    return id ? toList({ departement: id, niveau: undefined }) : undefined;
  };
  const toDeptAbsenteeism = (name: string) => {
    const id = deptIdOf(name);
    return id ? toAbsenteeism({ departement: String(id), axe: "equipe" }) : undefined;
  };
  ```
- Remplacements (une occurrence chacun) :
  - `chart={riskLevels ?? undefined}` → `chart={riskLevels ? withDrillSpec(riskLevels, toLevelList, "Cliquer pour voir les collaborateurs de ce niveau") : undefined}` — niveau de risque → `/employees?niveau=ELEVE|MOYEN|FAIBLE|NON_EVALUE` + filtres de population + `retour` (barre à 0 non liée).
  - `option={riskByDepartmentOption(riskByDept)}` → `option={withDrill(riskByDepartmentOption(riskByDept), toDeptLevelList, "Cliquer pour voir les collaborateurs concernés")}` — barre Élevé / Moyen d'un département → `/employees?departement=…&niveau=…` (mêmes cibles que les nombres du tableau « Détail des niveaux de risque par département », qui reste l'équivalent clavier).
  - `chart={deptHeadcountChart ?? undefined}` → `chart={deptHeadcountChart ? withDrillSpec(deptHeadcountChart, toDeptList, "Cliquer pour voir les collaborateurs du département") : undefined}` — département → `/employees?departement=…` (sans filtre de niveau : l'effectif compte tout le monde).
  - `chart={deptAbsenteeismChart ?? undefined}` → `chart={deptAbsenteeismChart ? withDrillSpec(deptAbsenteeismChart, toDeptAbsenteeism, "Cliquer pour analyser l'absentéisme du département") : undefined}` — département → `/absenteeism?departement=…&axe=equipe&granularite=mois&retour=…` (barre « Moyenne » non liée).

**B2. Absentéisme** — `src/app/(app)/absenteeism/page.tsx` (RH : département → ses équipes, équipe → ses collaborateurs ; MANAGER : équipe affichée → ses collaborateurs)
- Import : `import { absenteeismHref, employeesHref, withDrillSpec } from "@/components/charts/drill";`
- Repère : juste après `const averageLabel = …;`, insérer :
  ```tsx
  // Filtrage croisé : département → ses équipes ; équipe → ses collaborateurs. Seuls les groupes affichés (non masqués) sont cliquables.
  const groupKey = new Map(ranked.map((g) => [g.label, Number(g.key)]));
  const drillGroup = (name: string) => {
    const key = groupKey.get(name);
    if (!key) return undefined;
    return a.axis === "departement" ? absenteeismHref({ granularite: q.granularite, axe: "equipe", departement: key, retour }) : employeesHref({ manager: key });
  };
  const drillGroupHint = a.axis === "departement" ? "Cliquer pour voir les équipes du département" : "Cliquer pour voir les collaborateurs de l'équipe";
  ```
- Repère : dans le second `VisualCard` (comparaison des groupes), `chart={groupBars({` devient `chart={withDrillSpec(groupBars({`, et la fermeture `categoryName: a.axis === "equipe" ? "Équipe" : "Département",` + `})}` devient `}), drillGroup, drillGroupHint)}`.
- Cibles : `/absenteeism?granularite=…&axe=equipe&departement=…&retour=…` (le fil d'Ariane vers le tableau de bord est conservé) ; `/employees?manager=…` (même cible que les noms d'équipe de /equipes). « Sans département » (clé 0) : non lié.

**B3. Équipes** — `src/app/(app)/equipes/page.tsx` (équipe : RH et MANAGER ; bandeau de département : RH seule, filtre « Département du manager »)
- Import : `import { employeesHref, teamsHref } from "@/components/charts/drill";`
- Repère : dans la boucle `for (const team of t.teams)`, l'objet passé à `list.push({ … reason: reasons.get(team.key) ?? "" })` reçoit en plus :
  ```tsx
  href: team.managerId != null ? employeesHref({ manager: team.managerId }) : undefined,
  ```
- Repère : juste avant `const map = [...byDept].map(([name, teams]) => ({ name, teams }))`, insérer :
  ```tsx
  // Filtrage croisé : département de la carte → équipes du département (RH, filtre « Département du manager »)
  const deptHref = (name: string) => {
    const id = t.teams.find((x) => x.department.name === name)?.department.id;
    return rh && !t.filters.departement && id != null ? teamsHref({ departement: id, tension: t.filters.tension ? "oui" : undefined }) : undefined;
  };
  ```
  puis, dans cette même ligne, `({ name, teams })` devient `({ name, teams, href: deptHref(name) })`.
- Équivalent clavier : le tableau « Équipes triées par niveau de tension » (noms d'équipe déjà liés à `/employees?manager=…`) et le filtre « Département du manager ».

**B4. Non branché** (pas de filtre cible existant) : courbes mensuelles (effectif, turnover, absentéisme, prévision) — aucun filtre « mois » sur les pages cibles ; KPI : déjà liés par `href` / `detailHref`.

## C — Palette Ctrl+K

Composant autonome livré : `src/components/ux/command-palette.tsx` (+ `command-palette-items.ts`), données par `GET /api/search?q=` (`src/lib/dal/search.ts`). Une seule insertion, dans `src/app/(app)/layout.tsx`, pour **tous les rôles** (le serveur décide du contenu : ADMIN = pages, actions et ses alertes d'administration, jamais de collaborateur ni d'alerte RH). Mise à jour du 04/10 (chantier visuels, agent NAV) : le formulaire `#recherche-entete` a été retiré ; le déclencheur de la palette est désormais le seul contrôle de recherche de l'en-tête.

1. Import, à côté de `import { ThemeToggle } from "@/components/ui/theme";` :
   ```tsx
   import { CommandPalette, CommandPaletteTrigger } from "@/components/ux/command-palette";
   ```
2. Bouton d'ouverture (icône loupe + « Recherche rapide » visible à partir de `xl` + indice `Ctrl K` / `⌘K` à partir de `sm`) : dans le bloc d'actions de l'en-tête (repère `<div className="flex shrink-0 items-center gap-1 md:gap-2">`), juste **avant** `<ThemeToggle />` :
   ```tsx
   <CommandPaletteTrigger />
   ```
3. Montage, une seule fois (raccourci clavier global + dialogue), par exemple juste avant `</header>` :
   ```tsx
   <CommandPalette role={ctx.role} />
   ```
   Dialogue natif `<dialog>` ouvert en `showModal()` (couche supérieure) : l'emplacement dans l'arbre n'a pas d'effet sur l'affichage. Seule prop : `role`.

Comportement : Ctrl/⌘+K partout (même dans un champ), « / » hors champ de saisie ; Échap, clic sur le fond ou « Fermer » referment et rendent le focus au déclencheur. Sélecteurs E2E suggérés : `page.keyboard.press("Control+K")`, `page.getByRole("dialog", { name: "Recherche rapide" })`, `getByRole("combobox")`, `getByRole("option", { name: /Absentéisme/ })`, bouton `getByRole("button", { name: "Recherche rapide" })`.

## D — Rétention

La page `/retention` est autonome (DAL `src/lib/dal/retention.ts`, calcul pur `src/lib/retention/*`, composants `src/components/retention/*`, tests `tests/retention/*`) ; l'entrée de menu existe déjà. Définitions ajoutées dans `src/lib/help/terms.ts` (`retention`, `kaplanMeier`, `censure`, `dureeMediane`) et `src/lib/help/content.ts` (écran `/retention` dans `SCREENS`, 3 entrées du glossaire). Insertions facultatives :

**D1 — Lien depuis le tableau de bord** (`src/app/(app)/dashboard/page.tsx`, RH et MANAGER) : repère `<KpiCard label="Turnover glissant 12 mois"`, ajouter les props
```tsx
detailHref="/retention"
detailLabel="Voir la rétention des embauchés"
```

**D2 — Libellé d'audit** (`src/components/admin/audit-labels.ts`, table `VIEWS`, après `workforce: "les prévisions d'effectifs",`) : l'action `retention.view` n'est journalisée qu'en cas de refus (`ensurePilotage`) ; elle se lit alors « a tenté de consulter la rétention ».
```ts
  retention: "la rétention",
```

**D3 — Parcours E2E** (`tests/e2e/*`, intégrateur) : `/retention` pour RH et MANAGER, ADMIN → `/interdit`. Sélecteurs : `getByRole("heading", { name: "Rétention", level: 1 })`, `getByLabel("Sorties comptées")`, `getByLabel("Comparer par")`, bouton `getByRole("button", { name: "Appliquer les filtres" })`, graphique `getByRole("img", { name: /Courbe de maintien en escalier/ })`, `getByText("Voir les données")`, titres `Comment lire` et `Limites` ; avec `?segment=departement` : `getByRole("heading", { name: "Détail par département" })`.

## E — Organigramme

La page `/organigramme` est autonome (aucun branchement requis pour fonctionner). Trois insertions facultatives :

**E1 — Libellé d'audit** (`src/components/admin/audit-labels.ts`, table `VIEWS`, après la ligne `teams: "les équipes",`) : l'action `org_chart.view` (consultation, détail `{ source, view, nodes }`) se lit alors « a consulté l'organigramme ».
```ts
  org_chart: "l'organigramme",
```

**E2 — Lien depuis Équipes** (`src/app/(app)/equipes/page.tsx`, nouvelle prop `actions` du `<PageHeader eyebrow="Collaborateurs" …/>` en tête de page) : RH et MANAGER.
```tsx
import { ButtonLink } from "@/components/ui"; // ajouter à l'import existant de @/components/ui
// …
actions={<ButtonLink href="/organigramme" variant="secondary" icon="users">Voir l'organigramme</ButtonLink>}
```

**E3 — Retour vers l'organigramme depuis la liste filtrée** (`src/app/(app)/employees/(liste)/page.tsx`, repère `const retour = safeReturn(raw.retour, ["/dashboard"]);`) : le lien « Voir l'équipe » de l'organigramme ouvre `/employees?manager=<id>&retour=/organigramme` ; sans cette insertion le paramètre est simplement ignoré.
```tsx
const retour = safeReturn(raw.retour, ["/dashboard", "/organigramme"]);
```
