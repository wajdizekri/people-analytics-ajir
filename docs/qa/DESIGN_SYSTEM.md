# Design system — jetons, thème clair/sombre, mouvement, retours

Complète [CHARTE_UI.md](CHARTE_UI.md) (boutons, textes, visuels) : la charte dit **quoi** afficher, ce document dit **avec quels jetons**. Les jetons sont définis dans `src/app/globals.css` (variables `--pa-*`, exposées à Tailwind).

## 1. Couleurs : toujours des jetons sémantiques
| Usage | Classe | Remplace |
|---|---|---|
| Fond de page | `bg-canvas` | `bg-slate-50`, `bg-[#f3f5f8]` |
| Carte, panneau, champ | `bg-surface` | `bg-white` |
| Zone secondaire (en-tête de tableau, encart) | `bg-surface-2` | `bg-slate-50` dans une carte |
| Survol de ligne, puce | `bg-surface-3` | `bg-slate-100` |
| Texte principal | `text-fg` | `text-slate-900/800` |
| Titre (page, section, carte, valeur de KPI) | `text-heading` (marine en clair, quasi blanc en sombre) | `text-brand-navy` |
| Texte secondaire | `text-fg-muted` | `text-slate-600/700` |
| Texte discret (aide, méta) | `text-fg-subtle` | `text-slate-500/400` |
| Bordure de carte / séparateur | `border-line` | `border-slate-200/100` |
| Bordure de champ (≥ 3:1) | `border-line-strong` | `border-slate-300/400/500` |
| Action principale | `bg-primary text-primary-fg hover:bg-primary-hover` | `bg-sky-800 text-white` |
| Fond d'accent doux | `bg-primary-soft` | `bg-sky-50` |
| Lien | `text-link` | `text-sky-800` |
| Accent ArabSoft (orange) | `bg-accent text-accent-fg` | `bg-brand-orange` |
| Action destructive | `bg-danger-solid text-white hover:bg-danger-solid-hover` | `bg-red-700` |
| Statuts | `text-danger bg-danger-soft`, `text-warning bg-warning-soft`, `text-success bg-success-soft`, `text-info bg-info-soft` | `text-red-700 bg-red-50`, `amber`, `emerald`… |
| Menu latéral | `bg-nav` | `bg-brand-navy` |
Exceptions tolérées : texte blanc sur `bg-nav` ou sur un fond de statut plein (bouton destructif `bg-danger-solid`, étape terminée) ; couleurs des graphiques (palette sémantique de `src/components/charts/theme.ts`, remappée en sombre par `EChart` ; en HTML, `style={{ background: cssChartColor(SEMANTIC.favorable) }}`). Classes prêtes : `cardCls`, `tableCls`, `fieldCls` (`@/components/ui`).

## 2. Thème clair / sombre
- Attribut `data-theme="light|dark"` sur `<html>`, posé **avant affichage** par un petit script en ligne (pas de flash) d'après le choix enregistré (`localStorage` `pa-theme` = `light` | `dark` | `system`, défaut `system` → `prefers-color-scheme`).
- Variante Tailwind `dark:` disponible pour les rares cas non couverts par les jetons.
- Bascule « Thème : clair / sombre / système » dans l'en-tête (et dans Mon compte), accessible au clavier, annonçant l'état.
- Graphiques ECharts, carte 3D de connexion, images : relisent les couleurs au changement de thème.
- Contrastes WCAG AA vérifiés dans les **deux** thèmes.

## 3. Typographie, espacements, formes
- Police : `font-sans` (Segoe UI / system-ui). Échelle : titre de page `text-2xl font-semibold`, titre de section `text-lg font-semibold`, titre de carte `text-base font-semibold`, corps `text-sm`, méta `text-xs`. Chiffres : `tabular-nums`.
- Espacements : grille de 4 px ; entre sections `space-y-6` (24 px), dans une carte `p-4`/`p-5`, entre champs `gap-4`.
- Rayons : cartes `rounded-card` (12 px), champs et boutons `rounded-control` (8 px), puces `rounded-full`.
- Ombres : cartes `shadow-card`, éléments flottants (menus, dialogues, toasts) `shadow-pop`.

## 4. Mouvement et micro-interactions
- Durée par défaut 200 ms (`transition`, `transition-colors`), courbe douce ; 150–250 ms maximum.
- Tous les éléments interactifs ont `hover`, `focus-visible` (anneau `--pa-focus`), `active` (léger enfoncement `active:translate-y-px` ou assombrissement) et `disabled`.
- Apparition des toasts, dialogues et menus : fondu + léger glissement ; aucune animation si `prefers-reduced-motion: reduce` (déjà neutralisé globalement).

## 5. Retours utilisateur
- **Toasts** : composant `Toaster` monté une fois dans la mise en page, API `toast.success|error|info(message, { description })`, annoncés aux lecteurs d'écran (`aria-live`), fermeture automatique (5 s, 8 s pour une erreur) et manuelle. Chaque Server Action qui modifie quelque chose renvoie un résultat que le formulaire transforme en toast (succès ou erreur explicite).
- **Squelettes** : `loading.tsx` de chaque page = squelette ayant la forme de la page (`Skeleton`, `SkeletonCard`, `SkeletonTable`, `SkeletonChart`).
- **États vides** : `EmptyState` (quoi + pourquoi + action).
- **Actions destructives** : `ConfirmButton` (boîte de dialogue avec conséquence, motif si besoin).

## 6. Tableaux
Composant commun (`DataTable` ou classes `tableCls`) : en-tête collant, tri annoncé, filtres au-dessus, pagination « 1–25 sur N », nombres à droite, ligne survolée en `bg-surface-3`, vue en cartes sous 640 px.

## 7. Contrastes vérifiés (WCAG 2.2 AA)
Calculés sur les valeurs de `globals.css` (formule de luminance relative WCAG) ; test de non-régression : `tests/components/design-system.test.ts` (« contrastes WCAG AA dans les deux thèmes »). Texte : 4,5:1 ; bordures de champ, anneau de focus, aplats : 3:1.

| Texte / fond | Seuil | Clair | Sombre |
|---|---|---|---|
| `fg` / `canvas` | 4,5:1 | 16,35 | 15,89 |
| `fg` / `surface` | 4,5:1 | 17,85 | 14,77 |
| `fg` / `surface-3` | 4,5:1 | 15,88 | 11,97 |
| `heading` / `canvas` | 4,5:1 | 12,97 | 17,11 |
| `heading` / `surface` | 4,5:1 | 14,17 | 15,91 |
| `fg-muted` / `canvas` | 4,5:1 | 6,94 | 10,18 |
| `fg-muted` / `surface` | 4,5:1 | 7,58 | 9,47 |
| `fg-muted` / `surface-2` | 4,5:1 | 7,24 | 8,63 |
| `fg-muted` / `surface-3` | 4,5:1 | 6,74 | 7,67 |
| `fg-subtle` / `canvas` | 4,5:1 | 5,32 | 7,30 |
| `fg-subtle` / `surface` | 4,5:1 | 5,81 | 6,79 |
| `fg-subtle` / `surface-2` | 4,5:1 | 5,55 | 6,19 |
| `link` / `surface` | 4,5:1 | 7,20 | 8,10 |
| `link` / `canvas` | 4,5:1 | 6,60 | 8,71 |
| `link` / `primary-soft` | 4,5:1 | 6,51 | 7,35 |
| `primary-fg` / `primary` | 4,5:1 | 7,20 | 4,89 |
| `primary-fg` / `primary-hover` | 4,5:1 | 9,70 | 6,01 |
| `accent-fg` / `accent` | 4,5:1 | 5,96 | 7,87 |
| `danger` / `danger-soft` | 4,5:1 | 5,91 | 8,60 |
| `warning` / `warning-soft` | 4,5:1 | 6,84 | 9,62 |
| `success` / `success-soft` | 4,5:1 | 5,21 | 9,64 |
| `info` / `info-soft` | 4,5:1 | 6,51 | 7,35 |
| `danger` / `surface` | 4,5:1 | 6,47 | 9,17 |
| `warning` / `surface` | 4,5:1 | 7,09 | 12,07 |
| `success` / `surface` | 4,5:1 | 5,48 | 11,42 |
| `info` / `surface` | 4,5:1 | 7,20 | 8,10 |
| `fg` / `danger-soft` | 4,5:1 | 16,32 | 13,85 |
| `fg` / `warning-soft` | 4,5:1 | 17,22 | 11,77 |
| `fg` / `success-soft` | 4,5:1 | 16,95 | 12,47 |
| `fg` / `info-soft` | 4,5:1 | 16,13 | 13,40 |
| `line-strong` / `surface` | 3:1 | 4,76 | 4,98 |
| `line-strong` / `canvas` | 3:1 | 4,36 | 5,36 |
| `focus` / `surface` | 3:1 | 7,20 | 7,32 |
| `focus` / `canvas` | 3:1 | 6,60 | 7,87 |
| `primary` / `surface` | 3:1 | 7,20 | 3,56 |
| blanc / `nav` (menu) | 4,5:1 | 14,17 | 19,45 |
| blanc / `danger-solid` (bouton destructif) | 4,5:1 | 6,47 | 4,83 |

Graphiques en sombre (`DARK_COLORS`, sur `surface` #111a2b) : défavorable #f87171 6,29:1 · attention #fbbf24 10,43:1 · favorable #4ade80 9,99:1 · neutre #5b8fcf 5,20:1 · référence #94a3b8 6,79:1 · prévision #8b9ab0 6,09:1 · contexte #65696f 3,2:1 (écart de 16 avec le bleu neutre). Palette catégorielle depuis le 04/10 (`CHART_PALETTE`, 6 teintes validées en vision normale et daltonienne, sans chaud ni vert réservés à la sémantique ; au-delà de 6 séries, regrouper dans « Autres ») : clair #1e56a3 · #93006a · #8a4ada · #1ba0aa · #4987ff · #a76088 ; sombre #5b8fcf 5,2 · #c21d7d 3,1 · #8550d6 3,4 · #04aaa0 6,0 · #0f60fa 3,4 · #a86b9f 4,4 (objets graphiques ≥ 3:1). L'ancienne palette (#c25e00…) reste mappée dans `DARK_COLORS` pour les options déjà écrites. Couleurs des pastilles HTML : `cssChartColor(hex)` → `var(--pa-chart-<hex>)` (globals.css). Ajustement fait pendant la vague : `--pa-primary-hover` sombre #5b8fcf → #2663b0 (texte blanc 3,35:1 → 6,01:1).

## 8. Mise en œuvre (cœur du design system)
- Thème : `src/components/ui/theme-script.ts` (script avant affichage), `theme.tsx` (`ThemeToggle`, `useTheme`, `setTheme`, `ThemeSync`). Pendant la bascule, la classe `pa-theme-switching` coupe les transitions (pas de fondu dépareillé).
- Menu réduit : `src/components/layout/nav-script.ts` (script avant affichage : `localStorage` `pa-nav=rail` → `html[data-nav="rail"]`, pas de saut au chargement) et `nav-rail.tsx` (`NavRailScript`, bascule « Réduire le menu » / « Déployer le menu », `aria-expanded`). Rail de 64 px à partir de md, libellés en bulle au survol et au focus ; variantes Tailwind `in-data-[nav=rail]:…`. Sous md : menu mobile, bascule masquée.
- Mouvement : `animate-pop-in` (menus, bulles, 150 ms), `animate-dialog-in` (dialogues, 200 ms), `animate-toast-in|out` (200 ms), `animate-fade-in` ; fond des dialogues en fondu. Tout est neutralisé par `prefers-reduced-motion`.
- Retours : `Toaster` monté une fois dans `src/app/layout.tsx` ; squelettes `SkeletonPage` / briques ; `DataTable`. Mode d'emploi : catalogue de [DEMANDES_COMPOSANTS.md](DEMANDES_COMPOSANTS.md).
