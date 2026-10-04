# Démonstration — People Analytics AJIR

Base de démo : `data/app.db`, alimentée par l'export simulé `data/sim/mixte_medium_s1` (≈ 2 450 salariés sur 72 mois, 1,56 M pointages, fin des données au 31/08/2026). Contenu de la base décrit au 30/09/2026, après la promotion du modèle LOGREG et des quatre IA par sujet. Parcours de soutenance mis à jour le 04/10/2026 avec les fonctions livrées depuis : thème clair/sombre, palette Ctrl+K, filtrage croisé, rétention, organigramme, cinq fonctions IA et assistant d'aide. Libellés relevés dans le code du 04/10 (vague « titres seuls » : plus d'encart « À quoi sert cette page », explications dans les bulles « ? »).

## Démarrage (base déjà prête)

```powershell
npm run build          # une fois après chaque modification du code
npm run start          # http://localhost:3000
npm run worker         # file de jobs + batch mensuel ; sans lui, tuile « Service de calcul » en rouge (console, santé des données) et /api/health « dégradé » (503 si arrêté depuis plus de 10 min)
```

Ouvrir `http://localhost:3000` (pas l'adresse IP : en production le cookie de session est `Secure`, les navigateurs ne l'acceptent en HTTP que sur `localhost`). Pour une démo sur le réseau local en HTTP : `$env:INSECURE_COOKIES="1"; npm run start`. Une session se ferme après 2 h sans activité (10 h au plus).

## Préparer la soutenance

La veille, sur la base de démo :

```powershell
npm run backup                                           # avant toute écriture
npx tsx scripts/demo-passwords.ts --manager mgr.M12037   # MgrDemo2026pfe pour mgr.M12037 (et rh.demo), audité user.password.demo
npm run rag:index                                        # seulement si l'aide ou un document indexé a changé depuis le dernier index
npm run topic-model -- list                              # modèles v2 calibrés promus ? sinon voir « Points de vigilance »
npm run build
```

Puis, avec le serveur lancé : ouvrir chaque écran du parcours une fois ; poser les questions prévues à l'assistant et relire les réponses ; lancer « Trouver les leviers les plus efficaces » sur `/employees/79` et noter les pistes obtenues.

Le jour J, 15 min avant : port 3000 libre (arrêter le serveur de développement), `npm run start` et `npm run worker`, poste allégé (voir « Points de vigilance »). Une fenêtre par compte (profils de navigateur distincts ou fenêtre privée), connectée moins de 2 h avant le passage : `rh.demo`, `mgr.M10451`, `mgr.M12037`, `admin`. Tour de chauffe : une question à l'assistant (index construit au premier appel), `/retention` (profils calculés à l'affichage, mis en cache 10 min).

## Reconstruire la base de zéro

```powershell
npm run db:migrate                                   # crée data/app.db et les paramètres par défaut
npm run seed:admin -- admin Admin2026pfe
npm run sim -- --config medium --scenario mixte --seed 1   # seulement si data/sim/mixte_medium_s1 n'existe pas (Python, ~35 s)
npm run import -- data/sim/mixte_medium_s1          # ~30 s, statut OK, qualité 98,1 %
npm run pipeline -- --backtest                       # agrégats, 72 mois de variables, 72 runs B0, anomalies, alertes

# modèle turnover (golden rejoué) puis IA par sujet
npx tsx scripts/model.ts register models/turnover/logreg-v1-20260930
npx tsx scripts/model.ts verify logreg-v1-20260930
npx tsx scripts/model.ts promote logreg-v1-20260930
npm run topic-model -- register ABSENTEISME models/absenteeism/abs-ridge-v1-20260930
npm run topic-model -- register EFFECTIF models/workforce/effectif-v1-20260930
npm run topic-model -- register MASSE_SALARIALE models/workforce/masse-v1-20260930
npm run topic-model -- register FORMATION models/training/formation-logreg-v1-20260930
npm run topic-model -- register CHARGE_TRAVAIL models/workload/workload-ridge-v1-20260930
npm run topic-model -- promote abs-ridge-v1-20260930        # idem : effectif-v1-20260930, masse-v1-20260930,
                                                            # formation-logreg-v1-20260930, workload-ridge-v1-20260930
npm run pipeline                                     # ~15 s : republie le 31/08/2026 avec LOGREG + étapes IA
npm run runs -- supersede --apply --user 1           # effets du run B0 du même mois non reproposés par LOGREG : rejetés (audité)
npx tsx scripts/demo-passwords.ts                    # mots de passe connus pour rh.demo et le premier manager
npx tsx scripts/demo-passwords.ts --manager mgr.M12037   # compte de l'organigramme
```

Fourchettes calibrées (facultatif, modèles `*-v2-20261004`) : commandes `register` et `promote` de [RESULTATS_IA_CONFORME.md § 6](RESULTATS_IA_CONFORME.md) ; retour arrière par `promote` des versions `*-v1-20260930`. Profils de départs : bundle `models/typology/typo-kmeans-v1-20261004` chargé à l'affichage, aucune commande ([RESULTATS_IA_TYPOLOGIE.md](RESULTATS_IA_TYPOLOGIE.md)). Assistant d'aide : `npm run rag:index` régénère `src/lib/rag/corpus.json` ([EXPLOITATION.md § 11](EXPLOITATION.md)).

Pour une autre base : `$env:DATABASE_PATH="data/dev-x.db"` avant chaque commande. Sauvegarde avant toute manipulation : `npm run backup`.

## Comptes

| Identifiant | Mot de passe | Rôle | Périmètre |
|---|---|---|---|
| `admin` | `Admin2026pfe` | ADMIN | administration de l'outil (comptes, paramètres, audit, imports, modèle, dérive), aucune donnée RH |
| `rh.demo` | `RhDemo2026pfe` | RH | tous les salariés, salaires, probabilités, prévisions, droit d'accès |
| `mgr.M10451` | `MgrDemo2026pfe` | MANAGER | Souad Zribi (Direction qualité), 9 collaborateurs actifs, sans salaire ni probabilité |
| `mgr.M12037` | `MgrDemo2026pfe` (après `demo-passwords.ts --manager mgr.M12037`) | MANAGER | hiérarchie large : 325 personnes sous M12037 dans l'organigramme ([qa/ergonomie/COLLAB.md](qa/ergonomie/COLLAB.md)) ; compte sans mot de passe dans `app.db` tant que la commande n'est pas passée |

Les autres comptes manager issus de `users.csv` n'ont qu'un lien d'activation (affiché à l'import, valable 7 jours) ; l'admin peut en régénérer un dans *Utilisateurs et accès*. `scripts/demo-passwords.ts --manager <login>` fixe le mot de passe démo d'un autre manager.

## Ce que contient la base

- Import n° 1 `mixte_medium_s1` : OK, 98,1 % de qualité, 15 448 lignes rejetées (doublons de pointage, matricules inconnus, salaires sous le SMIG…), toutes issues des défauts injectés par le simulateur.
- Effectifs : la tuile « Effectif fin … » du tableau de bord compte 1 069 salariés au 31/08/2026 (CDI et CDD, hors SIVP et stages, [RESULTATS_IA_EFFECTIFS.md § 1](RESULTATS_IA_EFFECTIFS.md)) ; 1 168 = actifs tous contrats ([RESULTATS_IA_CHARGE.md](RESULTATS_IA_CHARGE.md)) ; 987 = salariés évalués par le modèle. Ne pas les confondre ([qa/audit-produit/G-fonctionnel.md](qa/audit-produit/G-fonctionnel.md)).
- Modèle champion : `logreg-v1-20260930` (régression logistique calibrée, golden reproduit à 1,1e-16). Démarrage à froid : 484 démissions observées (seuil 30) : le LOGREG est utilisé et sa probabilité n'est pas « indicative » (seuil 150). `b0-v1` reste enregistré (retiré).
- Run courant n° 73 au 31/08/2026 : 987 salariés éligibles scorés, probabilité moyenne 4,05 % (0,9 % à 33,9 %), **19 ÉLEVÉ** (2 % = `capacity_rate`), 30 MOYEN, 938 FAIBLE. 72 runs B0 plus anciens (backtest et ancien run courant) : jusqu'en juillet 2026, les niveaux viennent du score à règles.
- Recommandations turnover proposées : 72 (55 créées par le run LOGREG, 17 du run B0 reproposées par LOGREG et rattachées à son calcul). Les 110 autres recommandations du run B0 sont « Rejetée » avec le commentaire « Remplacée : recalcul avec le modèle entraîné » (`npm run runs -- supersede`, audité `scoring.supersede` le 30/09/2026). Alertes nouvelles : 17 TURNOVER (les 17 salariés passés Élevé au 31/08/2026 ; 2 alertes du run B0 devenues sans objet rejetées, 2 autres mises à jour avec les facteurs du LOGREG), 17 absentéisme (collectives et signaux Bradford RH), 1 données.
- IA par sujet au 31/08/2026 : 489 prévisions d'absentéisme (163 unités), 216 prévisions d'effectif et de masse salariale (effectif 1 069 → 1 055 à 12 mois [1 022 ; 1 088] avec les modèles v1), 187 formations obligatoires ouvertes évaluées (29 à risque élevé), 486 prévisions de charge (154 équipes, 8 départements) ; 86 recommandations par sujet (7 absentéisme, 18 effectifs, 30 formation, 31 charge dont 14 surcharges individuelles RH).
- Interventions : une seule action enregistrée (entretien du 02/10/2026, postérieur à la fin des données) : la comparaison appariée affiche « Effectif insuffisant pour comparer » pour chaque type ([RESULTATS_IA_INTERVENTIONS.md § 6](RESULTATS_IA_INTERVENTIONS.md)).
- Vérification a posteriori (backtesting) : origine par défaut au 28/02/2026, 983 salariés suivis 6 mois, 37 démissions ; les 19 ÉLEVÉ en comptent 6 (précision 32 %, lift 8,4 — date vue à l'entraînement, signalée par un bandeau).

## Parcours de soutenance (≈ 12 min)

Pour chaque étape : rôle, URL, quoi cliquer, la phrase à dire, le risque à éviter. Naviguer par Ctrl+K plutôt que par le menu RH (20 entrées, dont 5 hors écran à 1 440 × 900, [AUDIT_PRODUIT § C](qa/AUDIT_PRODUIT.md)).

### RH (`rh.demo`), 7 min 30

**1. Tableau de bord : assistant, thème, filtrage croisé** — `/dashboard`, 2 min
- Cliquer : dans le champ « Poser une question… » sous le titre, l'exemple « Comment est calculé le niveau de risque ? » (réponse + sources, Échap referme) ; bouton de thème en haut à droite → « Sombre » ; dans « Risques de départ », la barre « Élevé » du graphique « Collaborateurs par niveau de risque » → `/employees?niveau=ELEVE` : les 19 collaborateurs à prioriser, triés par rang.
- Dire : « L'assistant répond à partir de la documentation de mon rôle, jamais des données des collaborateurs, et sans aucun appel externe. »
- Éviter : annoncer 1 168 salariés (la tuile affiche 1 069, CDI et CDD) ; rester en sombre si le vidéoprojecteur rend mal : Ctrl+K « Passer au thème clair ».

**2. Fiche et leviers** — `/employees/79` (Omar Othmani, rang 6, ouvert depuis la liste), 2 min
- Cliquer : section « Estimation » (facteurs associés : « Taux d'absence hors santé de 12 % sur 3 mois », « Salaire à 90 % de la médiane du poste », « 9 retards sur 3 mois ») ; plus bas, « Simulation « et si ? » » → « Trouver les leviers les plus efficaces » → sur une carte, « Appliquer à la simulation » → « Simuler ces actions ».
- Dire : « L'outil teste 1 429 combinaisons dans les bornes de la simulation et propose les plus petites : des pistes à discuter, une estimation non causale, rien n'est enregistré » ([RESULTATS_IA_LEVIER.md](RESULTATS_IA_LEVIER.md)).
- Éviter : commenter la suggestion « Revue de la charge de travail » déclenchée par « 9 retards » (action choisie par famille de facteurs, incohérente ici, [F-turnover](qa/audit-produit/F-turnover-recos-alertes.md)) ; présenter « Niveau en hausse » comme une évolution : juillet = score à règles, août = modèle statistique.

**3. Synthèse du mois** — Ctrl+K « synthèse » → `/synthese`, 45 s
- Cliquer : encadré « Synthèse du mois » et sa pastille « Phrases types » (bulle « Comment ce texte est rédigé ») ; « Imprimer la synthèse », puis fermer l'aperçu.
- Dire : « Ces phrases viennent de gabarits déterministes ; la reformulation par IA générative existe mais reste désactivée par défaut, par choix de conformité » ([ADR-014](adr/014-ia-generative-facultative-hors-donnees-rh.md)).
- Éviter : dire « l'IA a écrit ce texte » ; lancer une vraie impression.

**4. Rétention et profils de départs** — Ctrl+K « rétention » → `/retention`, 1 min 15
- Cliquer : « Comparer par » → « Premier contrat » → « Appliquer les filtres » ; descendre à « Profils de départs ».
- Dire : « Courbe de maintien des embauchés (Kaplan-Meier) ; les 4 profils décrivent des familles de départs observées, avec une stabilité moyenne, sans étiqueter personne » ([RESULTATS_IA_TYPOLOGIE.md](RESULTATS_IA_TYPOLOGIE.md)).
- Éviter : présenter la page comme un « risque de départ » (c'est la rétention des embauchés) ; lire un profil comme une cause ou comme une tranche d'âge (V de Cramér 0,27 avec l'âge).

**5. Prévisions et charge : la fourchette** — `/previsions` puis `/charge`, 1 min 30
- Cliquer : « Projection à 12 mois » (effectif prévu et « fourchette probable à 80 % ») ; « Simulation de scénario » → « 1. Rythme des embauches » à 80 % → « Recalculer la projection » ; sous le graphique, la pastille « Fourchette calibrée · … (cible 80 %) » et sa bulle. Puis `/charge` : « Équipes en surcharge prévue », « Surcharges individuelles soutenues » (RH seule).
- Dire : « La fourchette à 80 % est vérifiée : on mesure sur une période de test la part des valeurs réelles qui y tombent, et l'écran l'écrit même sous la cible » ([RESULTATS_IA_CONFORME.md](RESULTATS_IA_CONFORME.md)).
- Éviter : chercher la pastille si les modèles v2 ne sont pas promus (elle n'existe pas) ; sur `/charge`, elle n'apparaît qu'après le calcul mensuel suivant la promotion.

### Manager, 2 min 15

**6. Petite équipe et cloisonnement** — `mgr.M10451`, `/dashboard` puis `/employees/79`, 1 min
- Cliquer : exemple « Que faire d'une recommandation ? » dans l'assistant ; mention « Hors rémunération », ni montant ni probabilité, pas de filtre contrat, âge ou ancienneté ; *Mon équipe* : niveaux et catégories de facteurs ; saisir `/employees/79` dans la barre d'adresse → `/interdit`.
- Dire : « Le manager ne voit que sa hiérarchie, aucun taux sous 5 personnes, et un accès hors périmètre est refusé par le serveur et journalisé » ([ADR-011](adr/011-gardes-petites-populations-cote-manager.md)).
- Éviter : chercher Omar Othmani dans Ctrl+K (absent du périmètre : rien ne s'affiche, temps perdu).

**7. Organigramme** — `mgr.M12037`, `/organigramme`, 1 min 15
- Cliquer : « Colorer selon » → « Risque de départ » ; un nœud du graphique → panneau de détail (« Équipe directe », « Ensemble rattaché ») → « Voir l'équipe » ; « Affichage » → « Liste », champ « Trouver une personne ».
- Dire : « 325 personnes, équipe par équipe, avec risque et absentéisme agrégés, sans rémunération et sans taux sur moins de 5 personnes. »
- Éviter : l'organigramme RH complet (trop dense à l'écran) ; naviguer au clavier dans le graphique (non prévu : la vue Liste est l'alternative).

### Administrateur (`admin`), 2 min 15

**8. Console** — `/admin`, 1 min
- Cliquer : exemple « Comment importer un export AJIR ? » dans l'assistant ; « État de l'outil » (tuile « Service de calcul ») ; « Derniers refus d'accès » : le refus du manager de l'étape 6 ; saisir `/dashboard` → `/interdit`.
- Dire : « L'administrateur surveille l'outil et les accès ; il ne voit aucune donnée RH nominative. »
- Éviter : ouvrir la console sans le worker (tuile rouge).

**9. Santé des données et transparence** — `/data-health` puis `/transparency`, 1 min 15
- Cliquer : « État des données en un coup d'œil », « Contrôles de l'import n° 1 » (98,1 %, 15 448 rejets ; seul le matricule reste visible dans les exemples) ; `/transparency` : « Le modèle en un coup d'œil », « Fonctionnement du modèle », « Fiabilité du modèle », « Équité entre groupes ».
- Dire : « Les rejets restent lisibles pour corriger AJIR, sans montant ni absence ; la transparence n'affiche que des mesures agrégées du modèle. »
- Éviter : affirmer que l'ADMIN ne voit « aucun chiffre RH » : `/transparency` montre des taux agrégés du modèle, exception relevée par l'audit et non arbitrée ([AUDIT_PRODUIT § G](qa/AUDIT_PRODUIT.md)).

### Si le temps le permet

- Fiche : « Marquer comme réalisée » sur « Revue de la rémunération » : intervention datée et auditée.
- Manager : demander « Qu'est-ce que le lift du modèle ? » : aucun passage réservé à la RH n'est lu.
- RH : *Vérification a posteriori* (28/02/2026) ; *Dérive des données* ; *Droit d'accès* (export, opposition qui exclut aussitôt de tout calcul prédictif).
- ADMIN : *Paramètres*, modifier « Capacité mensuelle d'entretiens » (badge « Modifié ») puis « Annuler les modifications », sans enregistrer.

## Points de vigilance pendant la démo

- **/interventions** : sur la base de démo, une seule intervention ; la section « Comparaison avec des profils similaires » affiche « Effectif insuffisant pour comparer » pour chaque type. Ne pas l'ouvrir ; montrer la validation semi-synthétique du rapport ([RESULTATS_IA_INTERVENTIONS.md § 5.3](RESULTATS_IA_INTERVENTIONS.md)) : sans biais notable quand le choix des suivis repose sur des variables observées (biais −0,1 point, couverture 93 %) ; signe inversé quand il repose sur une variable cachée (+3,9 points pour un effet de −4,9, couverture 23 %, alors que le verdict affiche « groupes comparables » dans 35 réplications sur 40).
- **Fourchette calibrée** : la pastille n'existe qu'avec les modèles `*-v2-20261004` promus (commandes de [RESULTATS_IA_CONFORME.md § 6](RESULTATS_IA_CONFORME.md), après `npm run backup`). Effet immédiat sur `/previsions` ; sur `/absenteeism` et `/charge`, au calcul mensuel suivant. Sans promotion, ne pas l'annoncer et le dire : modèles calibrés livrés, non encore promus sur la base de démo.
- **IA générative désactivée par défaut** : aucune clé sur le poste de démo ; synthèse en « Phrases types », assistant en extraits. Le présenter comme un choix : le cahier des charges classe l'assistant LLM en Won't et impose un traitement sur site ([ADR-014](adr/014-ia-generative-facultative-hors-donnees-rh.md)). Ne pas activer de clé pour la démo : transfert hors de Tunisie, avis du juriste requis ([conformite/aipd.md § 7-8](conformite/aipd.md)).
- **Serveur et mémoire du poste** (8 Go, ~250 Mo libres lors de la vérification finale, [qa/VERIFICATION_FINALE.md](qa/VERIFICATION_FINALE.md)) : serveur et worker lancés avant l'arrivée du jury ; serveur de développement arrêté ; VS Code, sessions Claude et navigateurs inutiles fermés ; aucun build ni test pendant la démo.
- **Assistant** : recherche par mots et synonymes, pas sémantique. S'en tenir aux questions préparées (vérifiées par `tests/rag/real-corpus.test.ts` : au moins un passage trouvé, lien vers l'aide). Une question libre du jury peut recevoir « L'aide ne couvre pas cette question » : c'est voulu, pas d'invention. Quota : 30 questions par compte sur 15 minutes.
- **Leviers** : durée et résultat non mesurés dans l'application sur la base de démo ([RESULTATS_IA_LEVIER.md § 3](RESULTATS_IA_LEVIER.md)). Si « Aucune piste dans les limites de la simulation » s'affiche, c'est un résultat (facteurs hors leviers : absences, retards) ; prévoir un autre collaborateur Élevé testé la veille.
- **Changement de méthode** : les 17 alertes « Passage au niveau Élevé » du 31/08 et l'historique des fiches comparent le modèle statistique d'août au score à règles de juillet ; une partie des « passages » vient de ce changement ([F-turnover](qa/audit-produit/F-turnover-recos-alertes.md), A2 et C4).
- **Chiffres de sécurité** : la campagne HTTP « 60/60 » date du 30/09 et ne couvre pas les points d'entrée récents (export, recherche, assistant…) ; donner la date si on la cite ([AUDIT_PRODUIT § G](qa/AUDIT_PRODUIT.md)).

## Questions probables du jury et réponses courtes

1. **« Vos facteurs sont-ils des causes ? »** Non : facteurs associés au départ. La simulation et les leviers sont des estimations du modèle, non causales ; la comparaison appariée des interventions l'est aussi, et notre validation montre qu'un facteur caché peut inverser son signe sans alerter les diagnostics ([RESULTATS_IA_INTERVENTIONS.md § 5.3](RESULTATS_IA_INTERVENTIONS.md)). Aucun « départ évité » n'est calculé.
2. **« Ces résultats valent-ils pour une vraie entreprise ? »** Pas encore : les données sont simulées. Le simulateur n'est pas circulaire (départs par engagement latent, offres externes, événements personnels, vérité terrain jamais importée, [ADR-010](adr/010-simulateur-verite-terrain-non-circulaire.md)) : il valide la méthode (protocole, absence de fuite, calibration), pas une valeur métier ([RESULTATS_ML.md](RESULTATS_ML.md)). Tout est à revalider sur un export client.
3. **« Un manager ne peut-il pas deviner qui est absent ou qui part ? »** Aucun taux ni nombre de sorties sous 5 personnes, masquage secondaire contre la déduction par différence, filtres fins ignorés ([ADR-011](adr/011-gardes-petites-populations-cote-manager.md)) ; ni salaire, ni probabilité, ni signal individuel d'absentéisme ; profils de départs réservés à la RH.
4. **« Le cahier des charges exclut l'assistant LLM : pourquoi un assistant ? »** Le cœur n'utilise aucun LLM : recherche plein texte dans la documentation, filtrée par rôle, et phrases types pour la synthèse. La reformulation par IA générative est facultative, désactivée par défaut, et ne porte jamais sur des données individuelles : la synthèse ne transmet que des agrégats RH non nominatifs (liste blanche typée, chaque nombre généré vérifié) ; l'assistant ne transmet que la question et des extraits de documentation, aucune donnée RH. Écart assumé et documenté ([ADR-014 — IA générative facultative, désactivée par défaut, jamais sur des données individuelles](adr/014-ia-generative-facultative-hors-donnees-rh.md)).
5. **« Pourquoi l'administrateur ne voit-il aucune donnée RH ? »** Séparation des tâches : il gère comptes, paramètres, imports et modèle ; la couche d'accès aux données le refuse sur tout écran de pilotage, et les rejets d'import lui arrivent masqués, matricule seul ([CONVENTIONS.md](CONVENTIONS.md), [ADR-007](adr/007-couche-acces-donnees-au-lieu-rls.md)). Limite : sur `/transparency`, il voit des taux agrégés du modèle.
6. **« Vos profils de départs sont-ils stables ? »** Moyennement, et nous le disons : aucune partition de 3 à 6 profils ne passe la règle (ARI ≥ 0,6 et Jaccard ≥ 0,6) ; repli sur la plus stable, 4 profils, ARI 0,51 [0,25 ; 0,86], silhouettes 0,13 à 0,17. Les profils sont descriptifs : ils ne retrouvent pas les mécanismes simulés (ARI 0,016) ([RESULTATS_IA_TYPOLOGIE.md](RESULTATS_IA_TYPOLOGIE.md)).
7. **« Vos fourchettes à 80 % contiennent-elles vraiment 80 % ? »** Mesuré sur une fenêtre de test jamais utilisée pour caler : absentéisme 93,1 % (entreprise), 86,1 % (départements), 83,3 % (équipes) ; charge 83,0 % (équipes) mais 79,5 % pour les départements, sous la cible et affiché comme tel ; effectifs et masse 88 à 99 %. La garantie suppose que les erreurs futures ressemblent au passé ([RESULTATS_IA_CONFORME.md § 3 et 7](RESULTATS_IA_CONFORME.md)).

## Vérifications faites

29/09/2026, `next start` sur `data/app.db` (avant la promotion du LOGREG) : `/login` 200, `/api/dashboard` sans cookie 401 ; connexion par la Server Action pour les trois comptes ; toutes les pages en 200 pour ADMIN et RH ; pour le manager, `/data-health`, `/transparency` et `/admin/*` → `/interdit`, fiche hors périmètre → `/interdit`, API hors périmètre 403, aucune clé de salaire, probabilité, lift ou `phrase_rh` dans `/api/employees/[id]`, `/api/employees`, `/api/dashboard`, `/api/alerts`.

30/09/2026, sur une copie de `data/app.db` après promotion : DAL Transparence (démarrage à froid inactif, run publié LOGREG n° 73), Dérive (référence « période d'entraînement du modèle », 66 mois), Backtesting (aucune démission datée avant l'origine) ; campagne Playwright de bout en bout : [docs/qa/BUGS_E2E.md](qa/BUGS_E2E.md).

30/09/2026, vérification finale (build de production isolé, copie de `data/app.db`) : les 22 écrans ouverts avec les trois comptes dans Chromium, aucune erreur 500, aucune donnée RH nominative pour l'admin, ni salaire, ni probabilité, ni opposition, ni signal individuel d'absentéisme pour le manager ; Playwright 113/113, campagne de sécurité 60/60 ; détails dans [docs/qa/SECURITE_PERF.md](qa/SECURITE_PERF.md) § 9.

04/10/2026, vérification du design system (avant fusion des fonctions IA et de l'assistant) : tsc 0, ESLint 0, Vitest 1 079 réussis et 1 ignoré, build sans avertissement (42 pages), E2E 153 tests sans échec, axe 0 violation (43/43 en clair, 21/21 en sombre, 1/1 menu réduit) ; [qa/LIVRABLE_DESIGN_SYSTEM.md § 6.1](qa/LIVRABLE_DESIGN_SYSTEM.md) (au 04/10/2026, avant la passe finale). Assistant d'aide : `tests/e2e/assistant.spec.ts` (trois rôles), à rejouer à la passe finale.
