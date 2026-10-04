# Branchements « insights » (à faire par l'intégrateur)

Quatre écrans et trois composants de fiche ont été livrés **sans modifier aucun fichier existant**. Ce document liste les
lignes exactes à ajouter pour les rendre accessibles. Rien d'autre n'est nécessaire : pas de migration (tout est calculé à la
volée), pas de nouveau paquet.

Fichiers livrés :

| Rôle | Fichiers |
|---|---|
| Pages | `src/app/(app)/{synthese,equipes,interventions,derive}/{page,loading,error}.tsx` |
| DAL | `src/lib/dal/synthesis.ts`, `teams.ts`, `interventions.ts`, `drift.ts` |
| Calcul pur | `src/lib/drift/psi.ts` (PSI), `src/lib/drift/labels.ts` |
| Composants | `src/components/insights/` (`index.ts`, `whats-new.tsx`, `journey.tsx`, `intervention-effects.tsx`, `ui.tsx`, `labels.ts`, `chart-options.ts`) |
| Tests | `tests/insights/` (32 tests : `psi.test.ts`, `insights.test.ts`, `pages.test.ts`, base `fixture.ts`) |

## 1. Menu : `src/components/layout/sidebar.tsx`

### Entrées de `NAV`

Section « Pilotage » : insérer après la ligne `/dashboard`

```ts
      { href: "/synthese", label: "Synthèse du mois", roles: PILOTAGE },
```

puis après la ligne `/employees`

```ts
      { href: "/equipes", label: "Mes équipes", roles: PILOTAGE },
```

puis après la ligne `/recommendations`

```ts
      { href: "/interventions", label: "Interventions", roles: ["RH"] },
```

Section « Données et modèle » : insérer après la ligne `/transparency`

```ts
      { href: "/derive", label: "Dérive des données", roles: ["ADMIN", "RH"] },
```

Rôles appliqués côté serveur (le menu n'est qu'un raccourci) : `/synthese` et `/equipes` → `pageContext(PILOTAGE_ROLES)` ;
`/interventions` → `pageContext(["RH"])` ; `/derive` → `pageContext(["RH", "ADMIN"])`. Chaque fonction DAL refait le
contrôle (`ensurePilotage` ou `ensureRole`, refus audité).

Le titre de la page `/equipes` est « Mes équipes » pour un manager et « Équipes » pour la RH. Pour aligner le menu, la
variante suivante est possible à la place de la ligne ci-dessus :
`{ href: "/equipes", label: "Mes équipes", roles: PILOTAGE, labels: { RH: "Équipes" } },`

### Tracés de la table `ICONS` (24 px, au trait, `strokeWidth` 1.8 comme les autres)

À ajouter dans l'objet `ICONS` :

```ts
  "/synthese": "M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M8 12l2 2 4-4 M8 17h8",
  "/equipes": "M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M5 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M12 8v4 M12 12l-6 4 M12 12l6 4",
  "/interventions": "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  "/derive": "M3 20h18 M4 20c2.5 0 3-11 6-11s3.5 11 6 11 M10 20c2.5 0 3-7 5.5-7s3 7 5.5 7",
```

(presse-papiers coché, organigramme, cible, deux courbes de distribution décalées)

## 2. Fiche collaborateur : `src/app/(app)/employees/[id]/page.tsx`

Les trois composants sont des composants serveur. Chacun reçoit le DTO d'une fonction DAL qui prend l'`AccessContext`,
renvoie 404 si le collaborateur n'existe pas, 403 audité s'il est hors périmètre, et audite la lecture (OK).

| Composant | Fonction DAL | Action d'audit | Vue manager |
|---|---|---|---|
| `WhatsNew` (« Quoi de neuf ») | `getEmployeeNews(ctx, id, meta)` (`@/lib/dal/synthesis`) | `employee.news.view` | ni augmentation, ni facteur Absences (ni Rémunération avec un score à règles), ni absence ni heure sup individuelle, ni action RH |
| `Journey` (« Parcours ») | `getEmployeeJourney(ctx, id, meta)` (`@/lib/dal/synthesis`) | `employee.journey.view` | ni augmentation, ni absence longue, ni intervention datée, ni motif de sortie, ni `REVISION_SALARIALE` |
| `InterventionEffects` (« Avant / après ») | `getEmployeeInterventionEffects(ctx, id, meta)` (`@/lib/dal/interventions`) | `employee.effects.view` | actions issues d'une recommandation visible, au mois près, niveaux de risque seulement |

### Imports à ajouter

```ts
import { InterventionEffects, Journey, WhatsNew } from "@/components/insights";
import { getEmployeeJourney, getEmployeeNews, type EmployeeJourneyDto, type EmployeeNewsDto } from "@/lib/dal/synthesis";
import { getEmployeeInterventionEffects, type EmployeeEffectsDto } from "@/lib/dal/interventions";
```

### Chargement des données

Remplacer le bloc `let d … try { d = getEmployeeDetail(…) } catch …` par (même gestion 404 / 403) :

```ts
  let d: EmployeeDetailDto;
  let news: EmployeeNewsDto;
  let journey: EmployeeJourneyDto;
  let effects: EmployeeEffectsDto;
  try {
    const meta = { source: "page" as const, ip: clientIp(await headers()) };
    d = getEmployeeDetail(ctx, id.data, meta);
    news = getEmployeeNews(ctx, id.data, meta);
    journey = getEmployeeJourney(ctx, id.data, meta);
    effects = getEmployeeInterventionEffects(ctx, id.data, meta);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    if (e instanceof HttpError && e.status === 403) redirect("/interdit");
    throw e;
  }
```

### Emplacements dans le JSX

1. « Quoi de neuf », juste sous l'en-tête : après `<EmployeeHeader d={d} />`

   ```tsx
   <WhatsNew data={news} className="mt-4" />
   ```

2. « Parcours », sous les observations dans la colonne de gauche : remplacer
   `<ObservationsZone d={d} className="lg:col-span-7" />` par

   ```tsx
   <div className="min-w-0 space-y-4 lg:col-span-7">
     <ObservationsZone d={d} />
     <Journey data={journey} />
   </div>
   ```

3. « Avant / après intervention », sous les suggestions : après la ligne `<SuggestionsZone … />`

   ```tsx
   {effects.items.length > 0 && <InterventionEffects data={effects} className="mt-4" />}
   ```

## 3. Compléments facultatifs

- **Libellés d'audit du droit d'accès** (`src/lib/privacy/export.ts`, objet `ACTION_LABEL`) :
  `"employee.news.view": "Consultation « Quoi de neuf »"`, `"employee.journey.view": "Consultation du parcours"`,
  `"employee.effects.view": "Consultation de l'avant / après intervention"`. Actions de page non nominatives par
  collaborateur : `synthesis.view`, `teams.view`, `interventions.view` ; `drift.view` n'est audité qu'en refus.
- **Période d'entraînement du champion** : `/derive` lit `train_from` / `train_to` dans le manifeste enregistré, puis dans
  `metrics_json`, puis dans `model.json` sur disque (`bundle_path`, chemin confiné au projet), sinon prend les 12 premiers
  mois de `feature_snapshot`. Le schéma zod de `src/lib/scoring/model.ts` retire aujourd'hui ces deux champs du manifeste
  enregistré : les y ajouter (`train_from: z.string().optional()`, `train_to: z.string().optional()`) évite la lecture disque.
- **Tests E2E** : parcours RH (4 pages), manager (`/synthese`, `/equipes` ; `/interventions` et `/derive` → `/interdit`),
  ADMIN (`/derive` seul).

## 4. Règles appliquées (rappel pour la relecture)

- ADMIN : `/derive` uniquement, en vue agrégée (PSI par variable, répartitions par classe, rapport observé / prévu) ; les
  taux de démission observés et prévus sont retirés du DTO ADMIN ; aucun nom ni matricule.
- MANAGER : sa hiérarchie seulement (`scopeFilter`) ; jamais de probabilité, lift, salaire, phrase chiffrée RH, signal
  d'absence ou d'heures sup individuel. Petits groupes : sorties, absentéisme et heures sup à `null` sous 5 personnes, et
  masquage secondaire des équipes (`smallGroupMask`) pour qu'aucune ne soit déductible du total du périmètre ; un
  indicateur masqué ne produit jamais de signal de tension.
- Salariés opposés au traitement prédictif : exclus des listes de risque (synthèse), des mesures avant / après, de la
  dérive et du suivi observé / prévu.
- Maladie et maternité : jamais comptées (absentéisme hors santé non planifié, absences longues du parcours hors santé et
  hors congés annuels).
- « Observation, pas un effet causal » affiché sur `/interventions` et dans le composant avant / après.

## 5. Vérification

```
npx tsc --noEmit
npx eslint "src/app/(app)/synthese" "src/app/(app)/equipes" "src/app/(app)/interventions" "src/app/(app)/derive" src/components/insights src/lib/drift src/lib/dal/{synthesis,teams,interventions,drift}.ts tests/insights
npx vitest run tests/insights
```

Temps mesurés sur une copie de `data/app.db` (2 445 salariés, 70 947 lignes de variables) : synthèse RH 0,4 s, équipes RH
0,1 s, dérive 0,3 s au premier calcul puis mise en cache (clé : variables, champion, fin des données, oppositions ; 10 min),
composants de fiche < 15 ms.
