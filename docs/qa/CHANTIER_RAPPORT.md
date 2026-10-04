# Chantier « rapport et démo à jour » (04/10/2026) — règles communes

Session aziz-pfe-1a. Le rapport PFE (`docs/rapport/`) et la démo (`docs/DEMO.md`) datent du 30/09. Depuis : design system (thème clair/sombre, composants), ergonomie (6 domaines), visuels « style Power BI », filtrage croisé, palette Ctrl+K, rétention Kaplan-Meier, organigramme, 5 fonctions IA (meilleur levier, comparaison appariée non causale des interventions, typologie des départs, synthèse rédigée, fourchettes conformes), assistant d'aide (RAG documentaire), audit produit, vérification finale (E2E, axe clair/sombre, captures). Cinq agents mettent le rapport et la démo à jour, chacun sur ses fichiers.

## Règles absolues

- **Écrire uniquement dans le worktree** `C:\Users\stagiaire1\Desktop\aziz-pfe\wt\rag\` (branche ia/rag). `people-analytics\` est en lecture seule (vague de textes de la session ae en cours). Pas de git, pas de `npm`, pas de build ni de tests (documentation seulement).
- **Aucun chiffre inventé** : chaque nombre vient d'un fichier du dépôt (`docs/RESULTATS_*.md`, `docs/qa/**`, `docs/adr/**`, bilans `docs/qa/ergonomie/*.md`), cité en lien relatif. Les chiffres de la vérification finale sont ceux de `docs/qa/VERIFICATION_FINALE.md` et `docs/qa/LIVRABLE_DESIGN_SYSTEM.md` (lecture dans people-analytics si absents du worktree) ; marquer `(au 04/10/2026, avant la passe finale)` quand un chiffre peut encore changer.
- **Style du rapport existant** : français académique, vouvoiement absent (rapport à la 3e personne ou « nous » comme les chapitres existants — relire le chapitre avant d'écrire), titres numérotés cohérents avec la table des matières de `docs/rapport/README.md`, figures/tableaux numérotés à la suite des existants. Modifier en place (sections ajoutées ou réécrites), pas de nouveau fichier de chapitre.
- **Éthique (le sujet fait foi)** : vocabulaire « facteurs associés », aucune lecture causale, aucun « départ évité » ; IA générative = extension **facultative, désactivée par défaut**, écart assumé au cahier des charges (ADR-014) ; l'ADMIN ne voit aucune donnée RH.
- **Honnêteté** : écrire les limites (stabilité moyenne de la typologie, couverture sous la cible pour la charge par département, base de démo avec une seule intervention, modèles v2 calibrés non encore promus, résultats sur données simulées).

## Périmètres

| Agent | Fichiers |
|---|---|
| SPEC | `docs/rapport/04-analyse-specification.md`, `docs/rapport/05-conception.md` |
| IA | `docs/rapport/07-prediction-explication.md` |
| VALID | `docs/rapport/08-realisation-validation.md` |
| ETHIQUE | `docs/rapport/09-ethique-conformite.md`, `docs/rapport/10-conclusion-perspectives.md`, `docs/rapport/00-resume.md` |
| DEMO | `docs/DEMO.md`, `README.md` (racine de l'app, section fonctionnalités) |

`docs/rapport/README.md` (table des matières) et `bibliographie.md` : demandes à écrire ci-dessous, l'orchestrateur les applique.

## Demandes

<!-- format : - [AGENT] fichier — changement — raison -->
- [IA] docs/rapport/README.md (« Liste des tableaux », chapitre 7) — après « 7.9 rapport d'équité », ajouter : 7.10 absentéisme, 7.11 effectifs et masse salariale, 7.12 formations, 7.13 charge de travail (déjà dans le chapitre, absents de la liste), 7.14 temps de la recherche du meilleur levier, 7.15 validation semi-synthétique de la comparaison appariée, 7.16 choix du nombre de profils de départs, 7.17 profils de départs, 7.18 couverture conforme absentéisme et charge, 7.19 couverture conforme effectifs et masse salariale — raison : sections 7.13 à 7.17 ajoutées. **[FAIT]**
- [IA] docs/rapport/README.md (« Captures d'écran ») — ajouter 7.5 pistes du meilleur levier (`rh.demo`, `/employees/<id>` d'un salarié Élevé, bouton « Trouver les leviers les plus efficaces ») ; 7.6 section « Profils de départs » (`rh.demo`, `/retention`) ; 7.7 encadré « Synthèse du mois en quelques phrases » en mode phrases types (`rh.demo`, `/synthese`) — raison : figures appelées en 7.13, 7.15 et 7.17. **[FAIT]**
- [IA] docs/rapport/bibliographie.md — ajouter les références citées en 7.14 à 7.16 (DOI de mémoire, à vérifier sur source primaire avant insertion, comme le reste de la bibliographie) — raison : nouvelles citations du chapitre 7 : **[FAIT]**
  - Abadie, A., & Imbens, G. W. (2008). On the failure of the bootstrap for matching estimators. *Econometrica, 76*(6), 1537–1557. https://doi.org/10.3982/ECTA6474
  - Austin, P. C. (2011). Optimal caliper widths for propensity-score matching when estimating differences in means and differences in proportions in observational studies. *Pharmaceutical Statistics, 10*(2), 150–161. https://doi.org/10.1002/pst.433
  - Austin, P. C., & Small, D. S. (2014). The use of bootstrapping when using propensity-score matching without replacement: A simulation study. *Statistics in Medicine, 33*(24), 4306–4319. https://doi.org/10.1002/sim.6276
  - Hennig, C. (2007). Cluster-wise assessment of cluster stability. *Computational Statistics & Data Analysis, 52*(1), 258–271. https://doi.org/10.1016/j.csda.2006.11.025
  - Hubert, L., & Arabie, P. (1985). Comparing partitions. *Journal of Classification, 2*(1), 193–218. https://doi.org/10.1007/BF01908075
  - Lei, J., G'Sell, M., Rinaldo, A., Tibshirani, R. J., & Wasserman, L. (2018). Distribution-free predictive inference for regression. *Journal of the American Statistical Association, 113*(523), 1094–1111. https://doi.org/10.1080/01621459.2017.1307116
  - Rosenbaum, P. R., & Rubin, D. B. (1983). The central role of the propensity score in observational studies for causal effects. *Biometrika, 70*(1), 41–55. https://doi.org/10.1093/biomet/70.1.41
  - Rousseeuw, P. J. (1987). Silhouettes: A graphical aid to the interpretation and validation of cluster analysis. *Journal of Computational and Applied Mathematics, 20*, 53–65. https://doi.org/10.1016/0377-0427(87)90125-7
  - Rubin, D. B. (2001). Using propensity scores to help design observational studies: Application to the tobacco litigation. *Health Services and Outcomes Research Methodology, 2*(3–4), 169–188. https://doi.org/10.1023/A:1020363010465
  - Stuart, E. A. (2010). Matching methods for causal inference: A review and a look forward. *Statistical Science, 25*(1), 1–21. https://doi.org/10.1214/09-STS313
  - Vovk, V., Gammerman, A., & Shafer, G. (2005). *Algorithmic learning in a random world*. Springer. https://doi.org/10.1007/b106715
- [IA] information pour SPEC, VALID, ETHIQUE — chapitre 7 : nouvelles sections 7.13 meilleur levier, 7.14 comparaison appariée des interventions, 7.15 typologie des départs, 7.16 fourchettes conformes, 7.17 synthèse rédigée et assistant d'aide (ADR-014) ; la conclusion devient 7.18. Les sections 7.1 à 7.12 gardent leur numéro (renvois existants à 7.12 inchangés).
- [SPEC] docs/rapport/README.md (« Liste des figures à produire », diagrammes) — après la ligne 5.9, ajouter : « 5.10 | Chaîne de l'assistant d'aide : corpus (`npm run rag:index`) → index FTS5 en mémoire filtré par rôle → réponse extraite ou reformulée vérifiée → `POST /api/assistant` | [RESULTATS_ASSISTANT.md](../RESULTATS_ASSISTANT.md), section « Architecture » (à dessiner) » — raison : figure appelée en 5.4.6. **[FAIT]**
- [SPEC] docs/rapport/README.md (« Liste des figures à produire », ligne 5.1) — contenu : ajouter « + flux sortant facultatif (désactivé par défaut) vers l'API d'IA générative » et la source [ADR-014](../adr/014-ia-generative-facultative-hors-donnees-rh.md) — raison : légende de la figure 5.1 mise à jour. **[FAIT]**
- [SPEC] docs/rapport/README.md (« Liste des tableaux », chapitre 4) — après « 4.5 MoSCoW », ajouter « 4.6 état du périmètre au 04/10/2026 (périmètre initial et extensions) » — raison : nouveau tableau en 4.6. **[FAIT]**
- [SPEC] information pour IA, VALID, ETHIQUE, DEMO — chapitres 4 et 5 : numéros de sections existants inchangés. Ajouts : 4.6 « État au 04/10/2026 » (tableau 4.6) ; 4.7 « Écart assumé : l'IA générative, facultative et désactivée par défaut » (renvoi ADR-014) ; 5.1.4 design system, 5.1.5 pages et composants ajoutés, 5.4.5 fonctions d'analyse, 5.4.6 assistant d'aide (figure 5.10). Corrigés au passage : 5.3.1 passe de 28 à 34 tables (6 tables des migrations 0004/0005, absentes de MODELE_DONNEES.md), 5.6 jeton AJIR désormais « réalisé » (était « non réalisé », contraire au ch. 8).
- [SPEC] docs/architecture/CAS_UTILISATION.md, MODELE_DONNEES.md (hors chantier, facultatif) — diagramme des cas sans les 10 cas ajoutés du 02 au 04/10 ; modèle de données à 28 tables au lieu de 34 — le rapport signale l'écart (4.3, 5.3.1).
- [VALID] docs/rapport/README.md (« Liste des tableaux », chapitre 8) — après « 8.5 rappel par type d'anomalie », ajouter « 8.6 frictions de la vague d'ergonomie, 8.7 récapitulatif des vérifications » — raison : nouveaux tableaux en 8.2.7 et 8.4.8. **[FAIT]**
- [VALID] docs/rapport/README.md (« Captures d'écran ») — en tête du paragraphe d'instructions, signaler que les captures finales du 04/10 existent dans [docs/qa/captures/design-system/final/](../qa/captures/design-system/final/) (nommage rôle-page-thème-menu-largeur) mais précèdent la vague « titres seuls » ; ajouter 8.14 (option) « Tableau de bord RH en thème sombre, menu réduit » (`rh.demo`, `/dashboard`, fichier `rh-tableau-de-bord-sombre-rail-1440.png`) et 8.15 (option) « Organigramme » (`mgr.M12037` ou `rh.demo`, `/organigramme`, fichier `rh-organigramme-clair-menu-1440.png`) — raison : illustrer 8.2.5 et 8.2.2 ; à reprendre après la passe finale. **[FAIT]**
- [VALID] docs/rapport/bibliographie.md — ajouter les deux références citées en 8.2.7 et 8.4.5 (à vérifier sur source primaire avant insertion) : **[FAIT]**
  - Nielsen, J. (1994). Heuristic evaluation. In J. Nielsen & R. L. Mack (Eds.), *Usability inspection methods* (pp. 25–62). John Wiley & Sons.
  - W3C. (2023). *Web Content Accessibility Guidelines (WCAG) 2.2* (W3C Recommendation). https://www.w3.org/TR/WCAG22/
- [VALID] information pour ETHIQUE (docs/rapport/10-conclusion-perspectives.md, tableau 10.1, ligne BNF-7) — la ligne cite encore les chiffres du 30/09 (655 Vitest, 113 de bout en bout, 39 pages axe) ; chapitre 8 (8.4.1, 8.4.5, tableau 8.7) : 1 079 Vitest / 126 fichiers à 13 h, 1 396 / 161 fichiers après fusions, 153 E2E, axe 43 clair + 21 sombre + 1 menu réduit, tous « (au 04/10/2026, avant la passe finale) » — à aligner ou à renvoyer au tableau 8.7.
- [VALID] information pour tous — chapitre 8 : numéros de sections existants inchangés (8.1 à 8.7, dont 8.5.6). Ajouts : 8.1.1 à 8.1.3 (environnement, organisation du travail, état de réalisation), 8.2 renommée « Écrans et interface » avec 8.2.5 à 8.2.9 (fonctions communes, design system, ergonomie, visuels, audit produit et « titres seuls »), 8.4.7 vérification finale et relecture des captures, 8.4.8 récapitulatif (tableau 8.7).
