# Ergonomie — compte, aide, connexion, administration des comptes (agent COMPTE, 04/10/2026)

Périmètre : `/login`, `/activation`, `/interdit`, 404, `/compte`, `/aide`, `/confidentialite`, `/admin/users`, `/admin/audit`, composants `auth/**`, `help/**`, `privacy/**`, `admin/**` (hors `settings-*`, `admin-ui.tsx`), `ux/{breadcrumb,on-this-page,mobile-collapse,auto-refresh}.tsx`. Audit écran par écran et rôle par rôle contre la grille de [CHANTIER_ERGONOMIE.md](../CHANTIER_ERGONOMIE.md) ; gravité Nielsen 1 à 4.

## Frictions et corrections

| # | Écran | Rôle | Gravité | Friction | Statut |
|---|---|---|---|---|---|
| C1 | Mon compte, mot de passe | tous | 3 | Règle « lettres et chiffres », confirmation identique et « différent de l'actuel » contrôlées seulement par le serveur : au moindre écart, les trois champs étaient vidés et tout était à ressaisir ; message en bas du formulaire, aucun champ désigné, focus laissé sur le bouton. | **Corrigé** : vérification avant envoi (`noValidate` + `onSubmit`), erreur sous le champ concerné (seul ce champ en `aria-invalid`), curseur dans le premier champ à corriger ; rien n'est envoyé ni vidé. Refus du serveur restant (mot de passe actuel incorrect, trop d'essais) : message conservé, curseur ramené au premier champ. |
| C2 | Mon compte, mot de passe | tous | 2 | Case globale « Afficher les mots de passe saisis » et champs différents de la connexion et de l'activation (pas d'alerte Verr. Maj.). | **Corrigé** : `PasswordField` pour les trois champs (bouton œil par champ, `aria-pressed`, alerte Verr. Maj.), mêmes champs sur les trois écrans. |
| C3 | Activation | nouvel utilisateur | 2 | Mêmes règles vérifiées par le serveur seul, bulle native du navigateur pour la longueur (langue du navigateur), les deux champs marqués en erreur pour toute erreur, y compris « lien expiré ». | **Corrigé** : vérification avant envoi, messages en français sous le champ, focus sur le premier champ ; une erreur serveur (lien, limite d'essais) n'accuse plus les champs. Règles partagées : `src/components/auth/password-rules.ts` (mêmes seuils que `passwordPolicyError`). |
| C4 | Connexion (et tous les champs mot de passe) | tous | 2 | Au clavier, Tab passait de « Identifiant » au lien « Mot de passe oublié ? » avant le champ mot de passe. | **Corrigé** dans `PasswordField` : le lien reste affiché à droite du libellé mais suit le champ et le bouton œil dans le DOM. |
| C5 | Utilisateurs et accès | ADMIN | 2 | Bouton « Lien de nouveau mot de passe » (sans verbe) alors que l'aide (« générez un nouveau lien d'activation »), la page de connexion et la boîte du lien parlent de lien d'activation. | **Corrigé** : « Générer un lien d'activation » pour tous les comptes ; la boîte de confirmation précise le cas « déjà un mot de passe » (le mot de passe actuel reste valable jusqu'à l'usage du lien). |
| C6 | Utilisateurs et accès | ADMIN | 2 | Compte verrouillé ou avec échecs : 3 actions visibles dans la ligne (grille : ≤ 2). | **Non fait** : un menu `MoreActions` (position absolue) serait coupé par le conteneur `overflow-x-auto` du tableau et la carte `overflow-hidden` ; cas rare (comptes à traiter, en tête de liste), chaque action y est utile. |
| C7 | Journal d'audit, 390 px | ADMIN | 2 | Cinq champs de filtre empilés avant le premier résultat (un écran entier). | **Corrigé** : champs dans `MobileCollapse` « Filtres (n actifs) » sous 640 px ; période rapide et boutons restent visibles ; squelette aligné. |
| C8 | Aide | tous | 2 | Douze rubriques, des dizaines de questions et le glossaire : aucun moyen de chercher un mot, sauf Ctrl+F. | **Corrigé** : « Rechercher dans l'aide » (`?q=`, côté serveur) dans les questions fréquentes, le glossaire, les indicateurs et les écrans **du rôle** (mêmes contenus filtrés que la page : un manager qui cherche « lift » n'obtient rien) ; réponses affichées directement, lien vers la rubrique, état vide avec « Effacer la recherche ». |
| C9 | Bulles « ? » (`InfoTip`), 390 px | tous | 2 | Bulle de 288 px centrée sur le bouton : coupée au bord gauche ou débordant à droite quand le « ? » est près du bord. | **Corrigé** : décalage mesuré à l'ouverture (marge, l'animation utilisant `transform`) pour rester à 8 px des bords. |
| C10 | `OnThisPage` (pages de la session 40) | ADMIN, RH | 2 | Sommaire sans indication de la section affichée et qui disparaît au défilement. | **Corrigé** (API inchangée) : section visible en `aria-current` et mise en évidence ; collant à partir de 1 024 px, `scroll-padding-top` posé pendant l'affichage pour que ancres et éléments focalisés ne passent pas dessous. |
| C11 | Droit d'accès | RH | 1 | Étapes en composant local ; états vides avec point final (règle du catalogue). | **Corrigé** : `Steps` commun (« Étape n : », état écrit, étape en cours annoncée) ; titres d'états vides sans point. |
| C12 | Mon compte, Aide | tous | 1 | Pas de `loading.tsx` (aucun retour au clic dans le menu) ; pas d'`error.tsx` pour Mon compte. | **Corrigé** : `AccountSkeleton`, `HelpSkeleton` (forme des pages) ; `RouteError` « Impossible d'afficher Mon compte ». |
| C13 | Mon compte | tous | 1 | « Si ce n'était pas vous, changez votre mot de passe ci-dessous » sans lien ; activité vide en simple texte. | **Corrigé** : lien vers le panneau mot de passe ; `EmptyState` (quoi + pourquoi). |
| C14 | `AutoRefresh` (santé des données) | ADMIN, RH | 1 | Bouton « Suspendre l'actualisation » de 32 px ; suspension non annoncée. | **Corrigé** : cible 40 px, phrase d'état en `aria-live="polite"` (ne change qu'à la suspension ou la reprise). |

Vérifiés sans changement : connexion (`autocomplete` username / current-password / new-password, bouton en cours « Connexion… », focus sur le mot de passe après échec, erreur reliée au champ, aide « Mot de passe oublié » repliable, 390 px, scène 3D et repli statique intacts) ; `/interdit` et 404 (raison + action selon le rôle, administrateur jamais renvoyé vers lui-même) ; Utilisateurs (compteurs-filtres, tri annoncé, pagination `Pagination`, `ConfirmButton` avec conséquence pour désactiver et générer un lien, toasts au retour de chaque action, lien d'activation copiable en un clic avec repli Ctrl+C, cartes sous 1 024 px) ; Journal (phrases, filtres communs, période rapide, pagination) ; Droit d'accès (statuts en mots, échéances, confirmations) ; `Breadcrumb`, `MobileCollapse` (API et rendu inchangés).

## Fichiers modifiés

- `src/components/auth/password-field.tsx` : ordre de tabulation (lien d'aide après le champ), prop additive `error` (message sous le champ, `${id}-erreur`).
- `src/components/auth/password-rules.ts` (nouveau) : règles et messages du nouveau mot de passe.
- `src/app/activation/activation-form.tsx`, `src/app/(app)/compte/password-form.tsx` : vérification avant envoi, `PasswordField`, focus.
- `src/app/(app)/compte/page.tsx`, `loading.tsx`, `error.tsx` (nouveaux).
- `src/app/(app)/aide/page.tsx`, `search.tsx` (nouveau), `loading.tsx` (nouveau).
- `src/app/(app)/confidentialite/page.tsx`.
- `src/app/(app)/admin/audit/page.tsx`.
- `src/components/admin/user-actions.tsx`, `src/components/admin/skeletons.tsx` (`AccountSkeleton`, `HelpSkeleton`, journal et droit d'accès alignés).
- `src/components/help/info-tip.tsx`, `src/components/ux/on-this-page.tsx`, `src/components/ux/auto-refresh.tsx`.
- Tests : `tests/ergo-compte/composants.test.ts`, `tests/ergo-compte/aide.test.ts`.

## Libellés E2E

Aucun libellé, rôle ARIA ni sélecteur visé par `tests/e2e/*.spec.ts` ou `tests/ui-admin/pages.test.ts` n'a changé (« Identifiant », « Mot de passe », « Afficher le mot de passe », « Se connecter », « Nouveau mot de passe », « Confirmation… », « Définir le mot de passe », « Créer un compte », « Déverrouiller … », « Générer un lien d'activation », « Désactiver le compte … », « Appliquer les filtres », « Réinitialiser les filtres », « Accès refusé », « Page introuvable »). Seul libellé retiré : « Lien de nouveau mot de passe » (absent des tests). Tests « Connexion 3D » et axe en sombre non concernés (scène 3D non modifiée).

## Vérification

- `npx vitest run tests/help tests/privacy tests/ergo-compte tests/ui-admin/pages.test.ts --maxWorkers=2` : 8 fichiers, 88 tests verts. En lecture : `tests/components tests/ui-admin tests/monitoring-admin tests/monitoring-model` (utilisateurs de `OnThisPage`, `AutoRefresh`, `MobileCollapse`) : 173 verts, 1 ignoré.
- `npx eslint` sur les 19 fichiers touchés : 0 erreur.
- `npx tsc --noEmit` : 0 erreur dans le périmètre ; 4 erreurs hors périmètre (session 40, en cours) : `src/app/(app)/derive/page.tsx:255`, `src/components/monitoring/data-options.ts:508`, `src/components/monitoring/model-options.ts:426`, `tests/monitoring-admin/page.test.ts:90`.
- Pas de rendu navigateur (consigne) : `OnThisPage` collant, décalage des bulles et repli mobile du journal restent à voir à l'écran (1 440 et 390 px).

## Demandes

Aucune demande hors périmètre.
