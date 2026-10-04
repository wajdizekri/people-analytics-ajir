# Ergonomie — agent UI (cœur du design system)

Chantier du 04/10/2026 ([CHANTIER_ERGONOMIE.md](../CHANTIER_ERGONOMIE.md)). Périmètre : `src/components/ui/**`, `src/components/charts/echart.tsx`, `builders.ts`, `drill.ts`, `tests/components/*`. API additive : aucun export renommé ni retiré.

## Frictions (gravité Nielsen 1-4)

| Composant | Friction | Gravité | Suite |
|---|---|---|---|
| `MenuButton danger`, `ConfirmButton menuItem` | Libellé destructif affiché en encre normale et survol gris : `text-fg` et `hover:bg-surface-3` l'emportaient sur `text-danger` / `hover:bg-danger-soft` dans le CSS généré (H4, H5) | 2 | Corrigé : `menuItemClass(danger)` sans classes concurrentes |
| `MoreActions` | Menu aligné à droite d'un bouton placé à gauche : sort de l'écran à 390 px | 2 | Corrigé : recalage à l'ouverture s'il dépasse le bord |
| `MoreActions` | Focus perdu (renvoyé au `body`) après le choix d'un élément | 2 | Corrigé : focus rendu au bouton ; Flèche haut ouvre sur le dernier élément ; bouton surligné quand le menu est ouvert |
| `ActionBar` | Actions en ligne qui débordent sous 640 px | 2 | Corrigé : une action par ligne, pleine largeur, sous 640 px |
| `DataTable` | Vue en cartes (mobile) sans aucun moyen de trier | 2 | Corrigé : liste « Trier par » (colonne + sens en mots) sous 640 px |
| `DataTable` | Aucune ligne et pas d'`empty` : tableau muet | 2 | Corrigé : « {légende} : aucune ligne à afficher. » |
| `DataTable` | Sélectionner du texte dans une ligne cliquable ouvrait le détail ; pagination aux états différents des boutons | 1 | Corrigé : pas de navigation si texte sélectionné ; pagination en `buttonClass("secondary")` |
| `KpiTile` | Lien `<a>` : rechargement complet de la page au clic | 2 | Corrigé : `Link` (navigation client), « Voir le détail » souligné au survol |
| `KpiTile` | Pas de variation : les pages écrivent « baisse favorable » dans `hint` (charte § 4) | 2 | Corrigé : prop `delta` (flèche, sens écrit, jugement), même contrat que `KpiCard` |
| `Notice` | L'action à droite écrase le texte à 390 px | 2 | Corrigé : l'action passe sous le texte sous 640 px |
| Toasts | Bouton « Fermer la notification » de 32 px (cible tactile) ; pas de fermeture au clavier | 1 | Corrigé : 40 px ; Échap ferme la notification qui a le focus |
| `Button` | Un `aria-describedby` fourni écrasait le lien vers la raison de désactivation ; tertiaire désactivé gardait son survol | 1 | Corrigé : identifiants fusionnés ; survol neutralisé |
| `PageHeader`, `SectionHeader`, `Card` | Titre sans coupure de mot long ; plusieurs actions de `Card` éclatées dans l'en-tête | 1 | Corrigé : `break-words`, actions de `Card` groupées |
| Badges, `StatusSummary`, `QuestionAnswer`, `Steps` | Pastilles et liserés en couleurs Tailwind fixes (`bg-sky-800`, `red-700`, `emerald-700`…) | 1 | Corrigé : jetons `bg-danger|warning|success|info`, `border-l-*`, liseré `border-accent` ; étape terminée `bg-success text-surface` (lisible en sombre) |
| `ConfirmDialog` | Titre en `text-fg` au lieu de `text-heading` | 1 | Corrigé |
| `EChart` | Infobulle de 320 px sur un graphique de ~330 px de large (mobile) : masque le point survolé | 1 | Corrigé : 260 px sous 640 px |
| `lineChart` (références) | À 390 px, la marge droite réservée à l'étiquette de référence (jusqu'à 116 px) réduit le tracé | 2 | Non fait : la placer dans le tracé réintroduirait le chevauchement avec la courbe corrigé à l'intégration ; à revoir avec une capture |
| `ButtonLink` | Pas d'indicateur pendant une navigation lente | 1 | Non fait : `useLinkStatus` casserait les simulations `next/link` (export `default` seul) de nombreuses suites hors périmètre ; la plupart des pages ont un `loading.tsx` |
| `PageHeader` (640-1023 px) | Avec 3 actions, le titre se resserre | 1 | Non fait : changerait la mise en page desktop ; `ActionBar` (2 actions + menu) suffit |

Déjà conformes (vérifiés) : `ConfirmDialog` (focus initial, piège Tab, Échap, focus rendu), toasts (pile de 3, pause au survol/focus, deux zones annoncées), `DataTable` (en-tête collant, tri annoncé, cartes, `rowHref`), `EChart` (hauteur et légende mobiles, formats français, axes de catégories non formatés), `FormActions` (colonne sous 640 px, primaire en haut).

## Nouvelles API (une ligne chacune)

- `KpiTile delta={{ value: -0.4, label: "−0,4 pt", reference: "vs avant l'action", good: "down" }}` : flèche, « En baisse » pour lecteur d'écran, texte, pastille « favorable » / « à surveiller » / « stable » ; `good: "neutral"` sans jugement (type `TileDelta`).
- `MenuLink download` (et tout attribut de lien : `className`, `onClick`…) : `<MenuLink href="/api/export/…" icon="download" download>Exporter (CSV)</MenuLink>` rendu en `<a download>`.
- `menuItemClass(danger?, extra?)` : classe d'un élément de menu sans conflit de couleur (`menuItemCls` inchangé = `menuItemClass()`).
- `Badge tone="neutral|info|success|warning|danger"` (anciens `slate|sky|emerald|amber|red` acceptés).
- `chartTheme(tokens, dark, narrow?)` : 3e paramètre facultatif (infobulle étroite sur mobile).
- Rendus améliorés sans changement d'appel : `ActionBar` en colonne sous 640 px, liste « Trier par » et message de repli de `DataTable`, action de `Notice` sous le texte sur mobile.

## Fichiers modifiés

`src/components/ui/button.tsx`, `more-actions.tsx`, `confirm.tsx`, `toast.tsx`, `index.tsx`, `insight.tsx`, `data-table.tsx`, `src/components/charts/echart.tsx` ; test neuf `tests/components/ergonomie-ui.test.ts` (16 tests) ; catalogue : une ligne ajoutée dans [DEMANDES_COMPOSANTS.md](../DEMANDES_COMPOSANTS.md). `builders.ts`, `drill.ts`, `tests/components/ui.test.ts` : inchangés.

## Demandes traitées

Aucune demande adressée à UI dans « Demandes hors périmètre » au moment de conclure (section relue au début, au milieu et à la fin).
