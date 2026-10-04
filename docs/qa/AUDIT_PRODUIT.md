# Audit produit — People Analytics & Predictive Turnover (AJIR)

Date : 04/10/2026. Session aziz-pfe-1d, à la demande d'Aymen.

**Méthode.** Sept audits en lecture seule menés en parallèle sur le code du 04/10 après-midi et sur les captures finales de la vérification d'ae (`captures/design-system/final/`, base E2E) :

| Annexe | Périmètre |
|---|---|
| [A — Sécurité et permissions](audit-produit/A-securite-permissions.md) | Routes, pages, Server Actions, périmètre manager, en-têtes |
| [B — Écrans de pilotage](audit-produit/B-pilotage-simplification.md) | Tableau de bord, Synthèse, Absentéisme, Charge, Formations, Équipes, Prévisions, Rétention, Organigramme, Interventions, Recommandations |
| [C — Collaborateurs, données, admin, navigation](audit-produit/C-collab-donnees-admin-navigation.md) | Liste, fiche, alertes, écrans techniques, administration, menu, Ctrl+K, états |
| [D — Suivi des constats et cohérence](audit-produit/D-suivi-constats-coherence.md) | 76 constats antérieurs revérifiés, cohérence transverse, accessibilité |
| [E — Technique](audit-produit/E-technique.md) | Architecture, duplication, code mort, performances, SQLite |
| [F — Turnover, recommandations, alertes](audit-produit/F-turnover-recos-alertes.md) | Parcours du risque, crédibilité, moteur de recommandations, alertes |
| [G — Fonctionnel](audit-produit/G-fonctionnel.md) | Couverture du sujet v2 (MoSCoW), fonctions en trop |

Les audits déjà faits n'ont pas été refaits : ACCESSIBILITE, ERGONOMIE, CLARTE, REVUE_TRANSVERSE, SECURITE_PERF, MESSAGES_SERVEUR, DESIGN_SYSTEM, CHARTE_UI. Ils n'ont été repris que pour vérifier si leurs constats sont encore ouverts.

**Limites.** Aucun serveur ni test lancé pendant l'audit (vérification finale d'ae en cours) : les constats viennent du code et des captures. Les exemples tirés de la base de démonstration sont marqués « à vérifier ». Le chantier IA de la session 1a (`wt\`) n'est pas audité.

---

## A. Résumé exécutif

| Dimension | Note | En une phrase |
|---|---|---|
| Fonctionnalités | 8/10 | Tous les Must et Should du sujet sont présents et prouvés dans le code ; points perdus pour la dispersion. |
| UX | 6,5/10 | Parcours et retours contextuels solides, mais 20 entrées de menu RH et un tableau de bord qui ne dit pas par où commencer. |
| UI | 7,5/10 | Kit visuel cohérent, clair et sombre ; hiérarchie plate, réglages au-dessus de la ligne de flottaison. |
| Lisibilité | 6,5/10 | Titres-messages utiles, mais un même indicateur prend 3 à 5 valeurs selon l'écran. |
| Contenu RH | 6/10 | Prudent et éthique, mais recommandations génériques, fiche sans « Que faire », indicateur d'adoption trompeur. |
| IA / prédictions | 7/10 | Estimation datée, versionnée, calibrée, non causale ; le manager lit des facteurs protecteurs comme des raisons. |
| Sécurité | 8/10 | Gardes serveur partout, aucune fuite exploitable ; campagne HTTP non rejouée depuis le 30/09. |
| Architecture | 7/10 | Séparation UI / DAL / calcul exemplaire ; logique recopiée par sujet d'IA, avec des règles qui divergent. |
| Professionnalisme | 7/10 | Rendu soigné, E2E 153/153, axe 0 violation ; quelques contradictions visibles en démonstration. |

**Note globale : 7/10.**

Le socle est solide : sujet couvert, rôles cloisonnés côté serveur, accessibilité vérifiée, tests verts. Ce qui coûte des points n'est pas un manque mais l'excès et l'incohérence. L'application a grossi à chaque chantier (26 pages, 5 flux de recommandations) sans qu'on se demande quelle décision chaque écran permet. Résultat : deux écrans se contredisent sur l'état du modèle, deux « Équipes en tension » donnent deux chiffres, et le manager voit des facteurs qui font baisser le risque présentés comme des raisons. La plupart de ces défauts se corrigent en peu de temps ; aucun ne demande de nouvelle fonction.

---

## B. Fonctionnalités manquantes

Décompte sur 48 fonctionnalités (annexe G) : ✅ 37 · ⚠️ 3 · ❌ 3 · 🔄 5. Les trois ❌ ne sont pas exigés : compétences (absentes de l'export AJIR), horizons 3 et 12 mois (Could), PDF de la fiche (Could).

| Fonctionnalité | État | Priorité | Pourquoi | Solution |
|---|---|---|---|---|
| Vue d'ensemble des recommandations | 🔄 | P1 · moyen | `/recommendations` ne lit que le turnover (`recommendations/page.tsx:63`). Les 86 recommandations d'absentéisme, d'effectifs, de formation et de charge se décident sur 4 autres pages, sans compteur central. | Court terme : un raccourci par sujet dans « À traiter ». Ensuite : boîte unique avec filtre « Sujet ». |
| Catalogue de recommandations paramétrable | ⚠️ | P1 · faible | Exigé par le sujet (p. 8). `ACTION_BY_GROUP` est une constante (`engine/recommendations.ts:7-11`), rien dans `settings.ts`. | Clé `app_setting` groupe → action (activée oui/non), réglable dans Paramètres. |
| « Que faire » sur la fiche | ⚠️ | P1 · faible | Les suggestions n'affichent que « Déclenchée par : Rémunération » (`employee-detail.tsx:797-802`). Les phrases « Pourquoi / Que faire » n'existent que sur `/recommendations`. | Afficher la phrase chiffrée du facteur déclencheur (déjà chargée) et l'action. |
| Écran « prédictions » | 🔄 | P2 · faible | La liste Collaborateurs triée par risque en tient lieu ; « Rétention » se lit comme « risque de départ » alors qu'il s'agit des cohortes d'embauche. | Renommer « Rétention des embauchés » ; le dire en démo. |
| Retards | ⚠️ | P3 | `agg_kpi_monthly.late_count` calculé mais jamais lu ; les retards ne sont visibles que dans la phrase d'un facteur. | Ne rien ajouter. Les montrer dans « Faits » de la fiche (voir F2). |
| Composition de l'effectif (âge, ancienneté) | 🔄 | P3 | Filtres seulement, aucune répartition ; non exigé. | Seulement si l'encadrant le demande, dans le tableau de bord existant. |

---

## C. Problèmes UX

| Problème | Écran | Gravité | Impact | Recommandation |
|---|---|---|---|---|
| Deux verdicts contraires sur le modèle : Dérive en rouge « envisager un réentraînement », Transparence en vert « Modèle dans ses cibles », alors que démissions observées / prévues = 1,01 (`derive/page.tsx:36-46`) | Dérive, Transparence | **P0** · faible | Le jury ou la RH conclut que le modèle n'est pas fiable | Rouge seulement si observé / prévu sort de la cible ; dérive des variables seule = « À surveiller ». Même phrase sur les deux écrans. |
| « Équipes en tension » : deux définitions, deux chiffres (T1, ouvert depuis le 01/10) (`charge/page.tsx:142`, `equipes/page.tsx:38`) | Charge, Équipes | **P0** · faible | Chiffres contradictoires dans le parcours de démo | Sur Charge : « Équipes en surcharge prévue ». |
| Menu RH de 20 entrées, 5 hors écran à 1440 × 900 (dont Aide et Mon compte) ; manager : « Mon équipe », « Mes équipes », « Organigramme » à la suite (`sidebar.tsx:17-73`) | Menu | P1 · faible à moyen | Écrans annexes au même niveau que le pilotage ; hésitation à chaque visite | Menu cible 14 / 9 / 7 (section H). Minimum : RH 20 → 17, « Mes collaborateurs » côté manager. |
| Tableau de bord : premier KPI vers 630 px, sous l'encart d'aide, « À traiter » et 6 filtres ; 7 KPI de même poids, aucun désigné comme premier | Tableau de bord | P1 · moyen | La situation n'est pas visible à l'ouverture | Hiérarchie en 4 niveaux (section I). |
| Rôle par défaut « Responsable RH » à la création de compte, alors que 156 comptes sur 159 sont des managers (`user-create-form.tsx:21`) | Utilisateurs | P1 · faible | Un oubli donne accès à tous les salaires | Rôle obligatoire, sans valeur par défaut. |
| Fiche : estimation vers 2 500 px à 390 px (6 859 px au total) ; 9 blocs au lieu des 3 zones prévues | Fiche | P2 · moyen | Le manager fait défiler trois écrans avant le niveau de risque | Ordre : en-tête compact, En bref, Faits, Estimation, Suggestions, Simulation ; Quoi de neuf, Parcours, Avant / après repliés. |
| Alerte « Passage au niveau Élevé » et recommandation « Entretien de rétention » nées du même évènement, traitées séparément, comptées deux fois dans « À traiter » (`engine/recommendations.ts:110-128`) | Alertes, Fiche | P1 · faible | Double travail, compteurs gonflés | Lien croisé ; l'action proposée par l'alerte devient « décider l'entretien proposé ». |
| Badge d'alertes = ouvertes (37), mais le lien mène à tous les statuts (`sidebar.tsx:190`) | Menu, Alertes | P2 · faible | Le nombre du menu n'est pas celui de la liste | Statut « Ouvertes » dans le filtre, cible du badge. |
| Absentéisme : deux contrôles de périmètre (filtre Département et « Périmètre affiché » de la prévision) | Absentéisme | P2 · faible | On ne sait pas lequel s'applique | La prévision suit le filtre de la page. |
| En-tête non collant : sur mobile, Menu et recherche disparaissent au défilement (`layout.tsx:39`) | Gabarit | P2 · faible | Sur une fiche longue, il faut remonter pour naviguer | `sticky top-0` ; fermeture du menu mobile au toucher extérieur. |

Plus 30 constats UX P2-P3 dans les annexes B (§ 5) et C (§ 5).

---

## D. Problèmes UI

| Problème | Écran | Gravité | Recommandation |
|---|---|---|---|
| Colonne Actions coupée à 1440 px, « Désactiver » tronqué (`users/page.tsx:277`) | Utilisateurs | P1 | Actions empilées dans la cellule, ou e-mail fusionné sous l'identifiant. |
| Courbe d'effectif sur un axe de 1 068 à 1 078 : une baisse de 0,8 % ressemble à une chute (`dashboard/page.tsx:164`) | Tableau de bord | P2 | Supprimer la courbe (la mini-courbe du KPI suffit) ou partir de 0. |
| Noms de départements tronqués (« Direction des systèmes d'i… »), T26 ouvert hors tableau de bord | Charge, Absentéisme | P2 | `shortDepartment` dans `departmentBars` et `groupBars`. |
| Couleur « Moyen » : pastille brune `#92400e` (badge), barre ambre `#d97706` (graphique) ; « À surveiller » en bleu alors que le bleu signifie « neutre » | Global | P2 | `RiskBadge` lit `RISK_COLORS` ; « À surveiller » en ambre. |
| KPI de 1 000 ou plus sans séparateur visible (« 1069 ») alors que le texte affiche « 1 168 » | Tableau de bord, Organigramme | P2 · à vérifier | Rendu de l'espace fine avec `tabular-nums` ; sinon espace insécable. |
| Date des données affichée trois fois au-dessus de la ligne de flottaison (en-tête, pied du menu, sous-titre) | Gabarit | P3 | `xl:hidden` sur le pied du menu ; une seule mention. |
| Sous-titres de visuels sur 2-3 lignes qui listent les couleurs | Charge, Tableau de bord, Formations | P3 | Couleurs dans la légende ; sous-titre = mesure, unité, périmètre, période. |
| Deux composants KPI (`KpiCard` sur 9 pages, `KpiTile` sur 6) | Global | P3 | Converger, ou documenter l'usage de chacun. |

---

## E. Problèmes de contenu

| Texte / élément | Problème | Proposition |
|---|---|---|
| Manager, En bref : « Risque Faible — 3 facteurs principaux : rémunération, évolution de carrière… » (`employees.ts:553`, `employee-detail.tsx:224-232`) | **P0.** Les facteurs qui font baisser le risque sont présentés comme des raisons ; contredit l'alerte et « Quoi de neuf », déjà filtrées à la hausse | Filtrer `direction = 'HAUSSE'` dans le DTO manager ; sans facteur : « aucun domaine ne fait nettement monter le risque ». |
| « Taux d'adoption 0 % — 0 réalisée sur 110 décidées » ; « Rejetées » à 55-70 % sur Interventions | Les 110 recommandations remplacées par le recalcul comptent comme des refus de la RH | Statut « Remplacée », hors du dénominateur, affiché à part. |
| « …mettre en service la nouvelle version depuis la console d'administration » (`derive/page.tsx:44`, `compte/page.tsx:19`, aussi `charge/page.tsx:77`, `forecast-section.tsx:65`) | Faux : aucun bouton ne le permet ; Transparence dit « hors de l'interface » (T16) | « La mise en service se fait hors de l'interface, par une procédure tracée. » |
| « Probabilité à 6 mois : 15,2 % » sans repère (`employee-detail.tsx:592-596`) | Le RH voit un pourcentage nu ; les bulles `probabilite` et `niveauEleve` existent mais ne sont pas posées | « Sur 100 collaborateurs avec cette estimation, environ 15 partent d'ici fin février 2027 et 85 restent. » + bulles. |
| « 19 collaborateurs en risque élevé, soit 1,9 % des évalués » (`dashboard/messages.ts:53`) | La part Élevé est fixée par la capacité d'entretiens (2 %) : elle se lit comme un taux mesuré | « 19 collaborateurs à recevoir en priorité (capacité d'entretiens : 2 % des 987 évalués) ». |
| « Niveau en hausse : passé de Faible à Élevé en août 2026 » ; « Nouveau facteur associé : 9 retards » | Juillet = score à règles, août = modèle statistique : une partie des « hausses » et des 17 alertes vient du changement de méthode | Mention sur la fiche, ou au minimum l'expliquer à l'oral. |
| « IC à 95 % », « Test du log-rank : χ² = … p = … », « censurées » (`retention/page.tsx:144, 167, 193`) | Vocabulaire de statisticien | « Fourchette probable à 95 % » ; « encore présents à la date des données » ; détail dans « Comment lire ». |
| Statut d'une recommandation : « Proposée », « En attente de décision », « à décider », « N en attente » | Quatre mots pour un état (T3, ouvert) | « En attente de décision » partout. |
| « Prénom Nom » dans les alertes, la palette, Charge, Formations ; « Nom Prénom » dans la liste et la fiche | T4 ouvert ; `fmt.person` existe mais n'est jamais appelé | `Nom Prénom` partout via `fmt.person`. |
| « Heures sup par ETP », « Heures supplémentaires par personne », « Heures sup. par pers. / mois » | T2 ouvert : 2 calculs, 2 unités, 3 écritures | « Heures supplémentaires par ETP et par mois ». |
| « Précision au niveau Élevé », « Rappel au niveau Élevé » (`backtesting/page.tsx:330, 342`) | Jargon | « Part des classés Élevé qui ont démissionné », « Part des démissions repérées ». |
| « celui de août 2026 » (`synthese/page.tsx:116`) | Élision fautive sur le premier écran de la démo (T13) | « celui d'août 2026 » ; mois en toutes lettres dans les phrases. |

---

## F. Problèmes techniques

| Problème | Fichier / module | Priorité | Solution |
|---|---|---|---|
| Recommandations choisies par groupe de facteurs, pas par signal : « Revue de la charge » déclenchée par « 9 retards » sur la fiche de démo d'Omar Othmani, dont les heures sup baissent | `engine/recommendations.ts:7-11, 62-70` | P1 · moyen | Choisir l'action selon `top_feature` (heures sup → charge ; retards → horaires ; jours sans pointage → vérifier la saisie AJIR). |
| Mise à jour des recommandations IA codée 4 fois, règles divergentes ; côté effectifs, un changement de statut efface le commentaire | `dal/ai-workforce.ts:237`, `ai-workload.ts`, `ai-training.ts`, `ai-absenteeism.ts` | P1 · faible | Avant soutenance : `COALESCE(@comment, comment)` et trancher motif / périmètre. Factoriser après. |
| Matrice rôle → page dans 3 sources, déjà divergentes : après reconnexion, l'ADMIN perd `/derive`, le manager tombe sur `/interdit` | `app/login/next-path.ts:7-8` | P2 · faible | Ajouter les 2 entrées ; à terme une table `ROUTE_ROLES` unique. |
| Deux API de formatage aux défauts différents (`fmt.pct` 1 décimale, `fr.rate` 2 ; « sept. 2025 » contre « sept. 25 »), plus une vingtaine de copies locales | `ui/index.tsx:428`, `ai/workload/insight-kit.tsx:12` | P2 · moyen | `src/lib/format.ts` commun, après la soutenance (touche les libellés E2E). |
| Index manquants sur `intervention` et `recommendation` (≈ 2 445 `UPDATE` en parcours complet au recalcul) | `db/schema.ts:302-327`, `scoring/score.ts:147-150` | P2 · faible | Migration additive `CREATE INDEX`. |
| Cache des surcharges individuelles non versionné : liste périmée après réimport jusqu'au redémarrage | `dal/ai-workload.ts:158-167` | P2 · faible | Empreinte des données dans la clé, comme `dashboard.ts:466`. |
| Erreurs avalées sans journal dans la DAL | `dal/ai-workload.ts:89`, `imports.ts:488`, `drift.ts:90`, `model.ts:138` | P2 · faible | `logger.warn({ err }, …)` sans changer le comportement. |
| Cibles du modèle écrites 10 fois en dur dans la page | `transparency/page.tsx` | P2 · faible | Constante `MODEL_TARGETS` + `modelVerdict()` testable. |
| `/equipes` et `/organigramme` recalculent tout à chaque affichage ; latence non mesurée | `dal/teams.ts:76-114`, `dal/org-chart.ts:310` | P2 · à vérifier | Mesurer en build de production avant d'agir. |
| Code mort : `date-fns`, `insights/fr-chart.tsx`, `monitoring/tones.ts`, `insights/chart-options.ts`, ≈ 130 lignes dépréciées de `pbi.tsx`, instance Drizzle `db` | annexe E § 3 | P3 · faible | Supprimer après la soutenance. |

À ne **pas** traiter avant la soutenance (risque supérieur au gain) : factorisation des recommandations IA, consolidation des formateurs, découpage des fichiers de plus de 1 000 lignes, passage au constructeur Drizzle, renommage des routes anglaises. Détail : annexe E § 4.

---

## G. Problèmes de sécurité

Aucune fuite exploitable trouvée : les 26 pages appellent `pageContext`, les 19 actions passent par une garde DAL et zod, l'export manager retire les estimations, la recherche ne renvoie aucun collaborateur à l'ADMIN. CSP et HSTS sont en place.

| Problème | Risque | Priorité | Solution |
|---|---|---|---|
| Campagne HTTP non rejouée depuis le 30/09 : 5 points d'entrée (export, recherche, export du droit d'accès, ouverture AJIR, `/go`) et 13 pages hors matrice | Le « 60/60 » cité en soutenance ne couvre pas les fonctions récentes | P1 · moyen | Ajouter les 15 cas de l'annexe A § 4, rejouer sur un build isolé. |
| Rétention côté manager : sorties mois par mois et bascule « départs volontaires » | Dater une sortie identifiable et en déduire le motif, que la fiche masque exprès | P2 · moyen | Retirer `events` et la bascule côté manager, ou consigner l'exception dans ADR-011. |
| Synthèse manager : « N sorties dont M départs volontaires » sur un mois | Avec une seule sortie, le motif se déduit | P2 · faible | Masquer la ventilation sous 5 sorties. |
| ADMIN : taux de démission visibles sur `/transparency`, retirés sur `/derive` | Séparation des tâches incohérente, relevable par le jury | P2 · faible | Arbitrer et aligner (masquer ou documenter l'exception « modèle »). |
| Budget de masse salariale saisi et vu par l'ADMIN dans Paramètres | Contredit « l'ADMIN ne voit aucune donnée RH » | P2 · faible | Arbitrer : saisie côté RH, ou paramètre d'outil documenté. |
| CSRF des 18 Server Actions mutantes vérifié sur `/login` seulement | Repose sur le contrôle d'origine de Next sans preuve | P2 · faible | Rejouer 3-4 actions avec un `Origin` étranger. |
| `tests/security/.fixtures.json` non exclu par `.gitignore` | 2 434 noms et des salaires (simulés) probablement sur GitHub | P3 · faible · à vérifier | `.gitignore` + retrait de l'index git (fichier régénérable). |
| URL complète journalisée sur une 500 | Un nom recherché ou une signature AJIR dans les journaux | P3 · faible | Journaliser le chemin seul, ou `redact` pino. |

---

## H. Fonctionnalités à supprimer ou simplifier

Aucune page n'est supprimée : les URL restent valides, seules les entrées de menu et les blocs visibles changent.

**Supprimer (blocs sans décision associée)**
- Tableau de bord : graphique « Répartition des niveaux » (répète le KPI), « Effectif par département », courbe d'effectif, filtre « Niveau de risque ».
- Charge : tableau « Départements » (doublon de « Voir les données »), KPI manager « Seuil de tension ».
- Absentéisme : sélecteur « Périmètre affiché » de la prévision.
- Menu : « Mon compte » (déjà l'avatar de l'en-tête).

**Fusionner**
- Synthèse dans le tableau de bord : son bloc « À traiter en priorité » devient le niveau 1. La Synthèse reste le rapport imprimable, hors menu.
- Organigramme dans Équipes, comme vue (Tableau / Organigramme).
- Interventions dans Recommandations, en partie « Suivi ».
- Dérive et Vérification a posteriori dans Transparence côté RH, avec un seul verdict sur le modèle.
- À terme : une seule boîte de recommandations pour les 5 flux.

**Déplacer**
- Aide et Mon compte dans l'en-tête ; Santé des données côté RH derrière la pastille « Données AJIR au … ».
- Droit d'accès hors de « Données et modèle », renommé « Droits des collaborateurs ».
- « À quoi sert cette page » dans le « ? » du titre (T10 ouvert).
- Colonne « Lift moyen » du tableau de bord vers Transparence.

**Masquer (repliés derrière « Voir… »)**
- Tableau de bord : courbes turnover et absentéisme, KPI Formations et Masse salariale, tableau par département, filtres Contrat / Âge / Ancienneté.
- Fiche : Quoi de neuf, Parcours, Avant / après.
- Prévisions : scénario et tableau par grade. Interventions : écarts tant qu'aucune mesure n'est complète.
- Utilisateurs : formulaire de création. Santé des données côté RH : tuile « Service de calcul ».

**Simplifier — menu cible**

| RH (20 → 14) | Manager (12 → 9) | ADMIN (10 → 7) |
|---|---|---|
| Vue d'ensemble : Tableau de bord, Alertes | Vue d'ensemble : Tableau de bord, Alertes | Console, Alertes, Utilisateurs, Paramètres, Journal |
| Collaborateurs : Collaborateurs, Équipes | Mon périmètre : Mes collaborateurs, Mes équipes | Santé des données, Modèle (Transparence + dérive) |
| Actions : Recommandations | Analyses : Absentéisme, Formations, Charge, Rétention | |
| Analyses : Absentéisme, Formations, Charge, Rétention des embauchés, Prévisions | | |
| Conformité : Transparence, Droits des collaborateurs | | |

Les agents B, C et G arrivent indépendamment au même menu à 14 entrées (à une ou deux entrées près). Prévisions et Charge ne sont exigées par aucune ligne du sujet : à garder si l'encadrant y tient, sinon à masquer. Coût commun : `NAV` et `tests/e2e/navigation.spec.ts`, puis une relance E2E.

---

## I. Améliorations design

Le design system existe ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), [CHARTE_UI.md](CHARTE_UI.md)) et il est appliqué : jetons clair et sombre, charte ArabSoft, kit Power BI, axe à 0 violation. Pas besoin d'en créer un autre ; voici les écarts observés.

- **Couleurs.** Une seule source pour les niveaux de risque : `RiskBadge` doit lire `RISK_COLORS` (aujourd'hui pastille Moyen brune, barre ambre). « À surveiller » en ambre partout (bleu en badge, jaune en pastille aujourd'hui). Magenta AJIR via un jeton `--pa-accent-2` au lieu des classes `fuchsia-*`. Rampes de l'organigramme et des équipes en hexadécimal → `--pa-chart-*`.
- **Hiérarchie du tableau de bord (niveaux 1 à 4).**
  1. Visible sans défiler : « À traiter en priorité » (3 à 5 constats avec bouton, repris de la Synthèse), filtres Période et Département.
  2. 4 KPI : Collaborateurs en risque élevé, Turnover 12 mois, Absentéisme hors santé, Effectif.
  3. 2 visuels cliquables : risques par département, absentéisme par département.
  4. Replié : courbes d'évolution, Formations, Masse salariale, tableau détaillé, filtres avancés.
  Résultat : 7 → 4 KPI visibles, 7 → 2 graphiques, 6 → 2 filtres.
- **Cartes KPI.** Utiliser `tone` / `status` (prévus dans `KpiCard`, jamais employés) pour distinguer le KPI d'alerte. Converger `KpiCard` et `KpiTile`.
- **Graphiques.** Axes à 0 pour les effectifs ; noms courts de département partout ; une seule précision par indicateur (titre « 1,0 % », barre « 0,98 % » aujourd'hui) ; seuil de couleur « à surveiller » à 1,2 × la moyenne au lieu de +0,01 pt.
- **Tableaux.** Supprimer le double défilement (`max-h-[70vh]` dans une page qui défile) sur Collaborateurs et Équipes ; recherche par manager sur Équipes (157 lignes) ; alertes à 25 par page.
- **Alertes.** Filtre « Ouvertes » relié au badge ; « Concerne » nomme l'équipe et pas seulement le département ; un seul fil d'Ariane comme sur la fiche.
- **Formulaires.** Création de compte repliée, rôle obligatoire ; filtre Utilisateur du journal en champ texte avec suggestions au lieu d'un `select` de 160 identifiants.
- **Progressive disclosure.** Intro « À quoi sert cette page » repliée après la première visite ; écrans techniques derrière Transparence ; blocs annexes de la fiche repliés.
- **Responsive.** Prioritaires sur mobile : Alertes, Fiche (niveau + 3 facteurs + suggestions), liste Collaborateurs. En-tête collant. Écrans d'administration et techniques : poste seulement.

---

## J. Améliorations du contenu

> **Mise à jour du 04/10 soir.** Aymen a fixé la règle « titres seuls » : titres courts descriptifs (groupe nominal de 2 à 6 mots), sans phrases d'explication, titres-messages, sous-titres ni intro. Elle prime sur les formulations en phrases proposées ci-dessous et dans les sections E et I. Les informations d'action restent, mais en champs « libellé : valeur » (« Facteur principal : … », « Action : … », « Départs estimés : environ N sur 100 »). Les mentions obligatoires deviennent des badges courts. Seule /aide garde des explications.

- **Un indicateur, un nom, une valeur.** Absentéisme : libellé « Absentéisme hors santé », 1 décimale, période écrite (5 valeurs de 0,6 à 0,8 % aujourd'hui). Heures sup : par ETP et par mois. Effectif : population écrite sous chaque chiffre (« CDI et CDD », « tous contrats »). Formations : « Réalisées à l'échéance » sur les trois écrans.
- **La fiche répond à quatre questions.** Quel risque (niveau + repère « sur 100 » + horizon daté) → pourquoi (les 3 phrases chiffrées à la hausse, pas les noms de groupe) → quels signaux (retards et pointage visibles dans « Faits ») → que faire (action liée au signal, avec « Pourquoi » chiffré).
- **Le manager sait quoi faire.** Remplacer « La décision revient à la RH » par « Le niveau sert à choisir avec qui échanger en premier, jamais à juger une personne. Parlez-en avec la RH. »
- **Plus de jargon côté RH.** Rétention (IC, χ², censure), Vérification a posteriori (précision, rappel), Transparence (« Régression logistique régularisée » → « Modèle statistique »), « Quoi de neuf » → « Depuis le dernier calcul ».
- **Phrases de facteurs.** « Horaires d'arrivée irréguliers (écart-type 4 min) » affiché même quand les horaires sont réguliers ; « point(s) » ; « Pas de contrat à durée déterminée » → « En CDI ».
- **Simulation.** « Testez l'effet estimé d'une action » contredit la mention non causale → « Voyez comment l'estimation changerait si… » (à transmettre au chantier LEVIER).

---

## K. Top 10 des améliorations (impact / effort)

1. **Facteurs manager filtrés à la hausse** (`employees.ts:553`) — impact élevé / effort faible.
2. **Un seul verdict sur le modèle** (Dérive alignée sur Transparence) — élevé / faible.
3. **« Équipes en surcharge prévue » sur Charge** — élevé / faible.
4. **Recommandations remplacées hors des rejets** — élevé / faible.
5. **Menu minimal** : RH 20 → 17, « Mes collaborateurs » côté manager — élevé / faible.
6. **Fiche : « Pourquoi / Que faire » chiffré + repère sur la probabilité** — élevé / faible à moyen.
7. **Textes de mise en service corrigés** (4 fichiers) — moyen / faible.
8. **Rôle obligatoire à la création de compte + colonne Actions** — moyen / faible.
9. **Tableau de bord niveau 1** : « À traiter en priorité » en tête, 2 filtres visibles — élevé / moyen.
10. **Un libellé et une précision par indicateur** (absentéisme, heures sup) — moyen / faible à moyen.

---

## Plan d'action final

**Dépendances.**
- Synthèse, Interventions, Rétention, Absentéisme, Charge et Prévisions sont en cours de modification par le chantier IA de 1a : les changements sur ces pages s'appliquent après sa fusion.
- La relecture des captures par ae (04/10 soir) a trouvé 18 défauts visuels, en correction jusqu'au build et à l'E2E final : `print.css`, palette Ctrl+K, `admin/users`, `compte`, `transparency`, `org-tree-list`, texte du curseur des prévisions. Les points de ce rapport qui touchent ces fichiers (colonne Actions, textes de Mon compte, verdict et cibles de Transparence, mots-clés de la palette) attendent la fin de cette passe ; certains seront peut-être déjà réglés.
- Toute modification de libellé visé par les E2E impose d'adapter la spec et de relancer la suite.

**Décision à prendre avant la fusion du chantier IA** (annexe G § 3) : CAUSAL (comparaison appariée des interventions) frôle la lecture causale, et SYNTHESE avec IA générative frôle le Won't « assistant LLM » du sujet. Recommandation : fusionner en priorité LEVIER et CONFORME, IA générative désactivée par défaut.

### 🔴 À faire absolument avant la soutenance

1. Filtrer les facteurs du manager à la hausse (`employees.ts:553`, `employee-detail.tsx:224`).
2. Aligner le verdict de Dérive sur la cible observé / prévu (`derive/page.tsx:36-46`).
3. Renommer « Équipes en tension » de Charge en « Équipes en surcharge prévue ».
4. Corriger les textes de mise en service du modèle (`derive:44`, `compte:19`, `charge:77`, `forecast-section:65`).
5. Sortir les recommandations « Remplacée » du taux d'adoption et des « Rejetées » (`dal/recommendations.ts:93`, Interventions).
6. Fiche : « Pourquoi » chiffré et « Que faire » sur les suggestions ; repère « sur 100 » et bulles sur la probabilité.
7. Menu minimal : retirer Dérive, Vérification a posteriori et Mon compte du menu RH ; « Mes collaborateurs » côté manager ; adapter `navigation.spec.ts`.
8. Rôle obligatoire à la création de compte ; colonne Actions des utilisateurs non coupée.
9. Préparer la démo : lancer `npm run worker` (tuile « Service de calcul » rouge sur les captures), corriger l'effectif de `DEMO.md:66` (1 168 tous contrats contre 1 069 CDI et CDD), préparer la phrase sur juillet (score à règles) contre août (modèle statistique).
10. Sécurité : `COALESCE` sur le commentaire (`ai-workforce.ts:237`), `.fixtures.json` dans `.gitignore`, campagne HTTP étendue rejouée (15 cas de l'annexe A).

**Suivi au 04/10 soir** (tsc 0, eslint 0, vitest ciblé au vert ; build et E2E à suivre dans la passe unique d'ae) :
- Fait : 1 (facteurs manager), 2 (verdict de Dérive : rouge seulement si observé / prévu sort de la cible), 3 (« surcharge prévue », par 1a), 4 (textes de mise en service : Dérive et Mon compte par 1d ; Charge, prévision d'absentéisme et Formations par 1a), 5 (« Remplacée » sur Recommandations, fiche et export CSV par 1d ; Interventions par 1a), 6 (Pourquoi / Que faire, repère « sur 100 », bulles), 8 (rôle obligatoire), 10 en partie (`COALESCE`, `.gitignore` ; `git rm --cached` à faire par a7).
- Reste : 7 (menu, décision à prendre sur les entrées retirées), 8 (colonne Actions : à vérifier après la passe d'ae sur `admin/users`), 9 (préparation de la démo), 10 (campagne HTTP étendue).

### 🟠 À faire pour rendre l'application professionnelle

1. Tableau de bord en 4 niveaux (section I).
2. Menu cible 14 / 9 / 7 avec les fusions de la section H.
3. Boîte unique de recommandations, filtre « Sujet ».
4. Recommandations choisies par signal (`top_feature`) et non par groupe.
5. Un indicateur, un nom, une valeur : absentéisme, heures sup, effectif, formations.
6. `Nom Prénom` partout (`fmt.person`) ; statut « En attente de décision » unique ; même style pour décider une recommandation.
7. Fiche réordonnée (Faits → Estimation → Suggestions, annexes repliées), signaux de pointage dans « Faits », état de chargement.
8. Arbitrages données en une ligne chacun dans CONVENTIONS : motif de sortie côté manager (Rétention, Synthèse), taux de démission vus par l'ADMIN, budget de masse salariale et capacité d'entretiens (qui les règle ?).
9. Catalogue de recommandations paramétrable (exigence du sujet, p. 8).
10. Mettre à jour les docs de suivi (statuts de REVUE_TRANSVERSE, ACCESSIBILITE, ERGONOMIE ; 29 points corrigés sur 76 n'y sont pas reportés). LIVRABLE_DESIGN_SYSTEM a été corrigé par ae le 04/10.

### 🟢 Nice-to-have

1. Index `intervention` / `recommendation` et `PRAGMA optimize` en fin de batch.
2. Module de formatage unique `src/lib/format.ts`.
3. Table `ROUTE_ROLES` unique (pages, menu, `next-path`).
4. Factoriser les 4 cycles de vie et les 4 Server Actions des recommandations IA.
5. Cache versionné pour `ai-workload` ; journaliser les erreurs attrapées dans la DAL.
6. Retirer le code mort (`date-fns`, `fr-chart.tsx`, `tones.ts`, `chart-options.ts`, fonctions dépréciées de `pbi.tsx`).
7. En-tête collant et menu mobile fermé au toucher extérieur.
8. Palette Ctrl+K : mots-clés par page, recherche en début de nom sous 4 caractères.
9. Péremption des recommandations dont le déclencheur a disparu ; signal de Bradford non recréé chaque mois ; règle des 90 jours pour l'alerte turnover.
10. Connexion 3D remplacée par la version SVG statique ; découpage de `transparency/page.tsx` (1 071 lignes) et `employee-detail.tsx` (807).
