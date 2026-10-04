# Ergonomie — agent CHARTS (marques des graphiques)

Chantier du 04/10/2026, session aziz-pfe-1a (ex-e9). Demandes [KIT→1a] et [MODEL] de [CHANTIER_VISUELS.md](../CHANTIER_VISUELS.md) sur `echart.tsx` et `builders.ts`, traitées selon la compétence dataviz (marques, aucune teinte recyclée, étiquette dans une marque seulement si elle tient). API additive : forme de `ChartSpec` et exports inchangés.

## Changements

- **Courbes** : trait de 2 px, repère plein de 8 px cerclé de la surface, visible au survol seulement (thème du wrapper et `lineChart`). Une série qui a un point isolé (un seul point, ou une valeur entourée de manques) garde ses repères, sinon elle serait invisible. Les options écrites à la main qui règlent `symbol`, `symbolSize` ou un repère par point (mini-courbes des tuiles, statuts par point) gardent leurs repères : `localizeOption` leur rend `showSymbol: true`.
- **Barres** : 24 px au plus, bout arrondi de 4 px côté valeur (`barChart`, `stackedBarChart`, `shareChart` : sur le dernier segment non nul de la pile) ; colonnes d'histogramme arrondies en haut ; segment nul sans bordure ; anneau à 56–72 %.
- **Au-delà de 6 séries sans ton** (palette passée de 8 à 6 teintes) : plus de recyclage. Les parts d'un total (`stackedBarChart`, `shareChart`) au-delà de la 6e sont additionnées dans « Autres » en gris de contexte, le tableau garde le détail. Une seule part en trop reste sous son nom, en gris. Les courbes (`lineChart`, somme sans objet) passent en gris de contexte avec un motif de trait chacune, et leur entrée de légende dessine le trait. Aucune page ne dépasse 3 séries aujourd'hui.
- **Mobile (< 640 px)** : libellés de catégories coupés après deux lignes, entre deux mots, seconde ligne terminée par « … ». Le texte entier reste dans l'infobulle et le tableau. Sur ordinateur, la troncature d'une ligne utilise aussi « … » (au lieu de « ... »).
- **`shareChart`** : étiquettes intérieures masquées quand la barre fait moins de 16 px d'épaisseur (estimation fidèle au rendu ECharts à moins de 1 px près).
- **`histogramChart`** avec `reference` : marge haute de 25 %, et la valeur de la classe traversée par la ligne n'est pas écrite (axe, infobulle, tableau).
- Encres : `LIGHT_TOKENS` et les encres de `builders.ts` lisent `CHART_INK` / `CHART_SURFACE` de theme.ts (mêmes valeurs).
- Conservé : infobulle de 260 px et `hideOverlap: false` sous 640 px, squelette avant hydratation, résumés de `barChart` / `stackedBarChart`.

## Nouvelles options (une ligne chacune)

- `stackedBarChart({ …, orientation: "vertical" })` : colonnes sur un axe du temps, dans l'ordre fourni (`sort: "desc"` possible). Total écrit au-dessus, valeurs des segments dans l'infobulle et le tableau, `minInterval: 1` si toutes les valeurs sont entières, hauteur 300 par défaut.
- `hasIsolatedPoint(data)` (builders.ts) : vrai si une courbe a un point sans voisin renseigné (points de raccord `skip` exclus).
- `twoLineLabel(text, width, font)` (echart.tsx) : texte en deux lignes au plus avec « … ».
- a7 peut revenir aux options du kit : `levelShareChart` → `shareChart({ …, height: 260 })`, `resignationTimelineChart` → `stackedBarChart({ …, orientation: "vertical" })`, `estimateHistogramChart` → `histogramChart({ bins, reference })` (sauf la position fractionnaire de la moyenne dans sa classe).

## Fichiers modifiés

`src/components/charts/echart.tsx`, `src/components/charts/builders.ts` ; doc : lignes marquées dans [CHANTIER_VISUELS.md](../CHANTIER_VISUELS.md), plus une demande [e9-CHARTS] : déplacer `MARK` dans theme.ts. Aujourd'hui, builders.ts et echart.tsx ne peuvent pas l'importer de pbi.tsx sans cycle, d'où des constantes locales de mêmes valeurs. `drill.ts`, theme.ts, pbi.tsx : inchangés.

## Tests ajoutés

`tests/charts-marks/marks.test.ts` (22 tests) :
- marques égales à `MARK` du kit ;
- point isolé (options et rendu SVG ECharts) ;
- règle des options écrites à la main ;
- « Autres » et motifs au-delà de 6 séries ;
- seuil de 16 px de `shareChart` comparé au rendu ECharts ;
- variante verticale (options et rendu) ;
- marge de l'histogramme au rendu (≥ 20 px sous le haut du tracé, 200 et 260 px) ;
- `twoLineLabel` et rendu mobile à 360 px avec « … ».

Aucun test existant modifié.

## Effets visibles sur les pages (à contrôler en capture)

- Courbes du tableau de bord (effectif, turnover, absentéisme), de /absenteeism, de /charge, de la console admin (connexions), de /transparency (collaborateurs évalués) : plus de points sur la courbe hors survol, trait plus fin. Les maximums étiquetés de la console restent.
- Fiche collaborateur : courbe de probabilité sans points, sauf s'il n'y a qu'un calcul. L'escalier de niveau garde ses points colorés, trait de 2 px.
- Courbes écrites à la main qui ne précisaient pas `symbol` (pilotage/chart-options.ts, insights/chart-options.ts, vue « plusieurs équipes » de /charge) : points pleins au lieu de cercles vides.
- Barres triées : 24 px au lieu de 22, bout arrondi de 4 px. Barres 100 % de /interventions : 24 px au lieu de 34, dernier segment arrondi. Barres empilées de /formations et de la console : dernier segment arrondi.
- Mobile : noms longs (départements, équipes, actions refusées) sur deux lignes avec « … ».
