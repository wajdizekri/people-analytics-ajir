# Démonstration — People Analytics AJIR

Base de démo : `data/app.db`, alimentée par l'export simulé `data/sim/mixte_medium_s1` (≈ 2 450 salariés sur 72 mois, 1,56 M pointages, fin des données au 31/08/2026). État décrit au 30/09/2026, après la promotion du modèle LOGREG et des quatre IA par sujet.

## Démarrage (base déjà prête)

```powershell
npm run build          # une fois après chaque modification du code
npm run start          # http://localhost:3000
npm run worker         # facultatif : file de jobs + batch mensuel (sinon /api/health indique « dégradé » ; 503 si le worker s'est arrêté depuis plus de 10 min)
```

Ouvrir `http://localhost:3000` (pas l'adresse IP : en production le cookie de session est `Secure`, les navigateurs ne l'acceptent en HTTP que sur `localhost`). Pour une démo sur le réseau local en HTTP : `$env:INSECURE_COOKIES="1"; npm run start`. Une session se ferme après 2 h sans activité (10 h au plus).

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
```

Pour une autre base : `$env:DATABASE_PATH="data/dev-x.db"` avant chaque commande. Sauvegarde avant toute manipulation : `npm run backup`.

## Comptes

| Identifiant | Mot de passe | Rôle | Périmètre |
|---|---|---|---|
| `admin` | `Admin2026pfe` | ADMIN | administration de l'outil (comptes, paramètres, audit, imports, modèle, dérive), aucune donnée RH |
| `rh.demo` | `RhDemo2026pfe` | RH | tous les salariés, salaires, probabilités, prévisions, droit d'accès |
| `mgr.M10451` | `MgrDemo2026pfe` | MANAGER | Souad Zribi (Direction qualité), 9 collaborateurs actifs, sans salaire ni probabilité |

Les 155 autres comptes manager issus de `users.csv` n'ont qu'un lien d'activation (affiché à l'import, valable 7 jours) ; l'admin peut en régénérer un dans *Utilisateurs*. `scripts/demo-passwords.ts --manager <login>` fixe le mot de passe démo d'un autre manager.

## Ce que contient la base

- Import n° 1 `mixte_medium_s1` : OK, 98,1 % de qualité, 15 448 lignes rejetées (doublons de pointage, matricules inconnus, salaires sous le SMIG…), toutes issues des défauts injectés par le simulateur.
- Modèle champion : `logreg-v1-20260930` (régression logistique calibrée, golden reproduit à 1,1e-16). Démarrage à froid : 484 démissions observées (seuil 30) : le LOGREG est utilisé et sa probabilité n'est pas « indicative » (seuil 150). `b0-v1` reste enregistré (retiré).
- Run courant n° 73 au 31/08/2026 : 987 salariés éligibles scorés, probabilité moyenne 4,05 % (0,9 % à 33,9 %), **19 ÉLEVÉ** (2 % = `capacity_rate`), 30 MOYEN, 938 FAIBLE. 72 runs B0 plus anciens (backtest et ancien run courant).
- Recommandations turnover proposées : 72 (55 créées par le run LOGREG, 17 du run B0 reproposées par LOGREG et rattachées à son calcul). Les 110 autres recommandations du run B0 sont « Rejetée » avec le commentaire « Remplacée : recalcul avec le modèle entraîné » (`npm run runs -- supersede`, audité `scoring.supersede` le 30/09/2026). Alertes nouvelles : 17 TURNOVER (les 17 salariés passés Élevé au 31/08/2026 ; 2 alertes du run B0 devenues sans objet rejetées, 2 autres mises à jour avec les facteurs du LOGREG), 17 absentéisme (collectives et signaux Bradford RH), 1 données.
- IA par sujet au 31/08/2026 : 489 prévisions d'absentéisme (163 unités), 216 prévisions d'effectif et de masse salariale (effectif 1 069 → 1 055 à 12 mois [1 022 ; 1 088]), 187 formations obligatoires ouvertes évaluées (29 à risque élevé), 486 prévisions de charge (154 équipes, 8 départements) ; 86 recommandations par sujet (7 absentéisme, 18 effectifs, 30 formation, 31 charge dont 14 surcharges individuelles RH).
- Vérification a posteriori (backtesting) : origine par défaut au 28/02/2026, 983 salariés suivis 6 mois, 37 démissions ; les 19 ÉLEVÉ en comptent 6 (précision 32 %, lift 8,4 — date vue à l'entraînement, signalée par un bandeau).

## Parcours de démonstration (≈ 12 min)

**RH (`rh.demo`), 7 min**

1. *Synthèse du mois* (30 s) : les constats du mois en phrases, dont les passages en risque élevé.
2. *Tableau de bord* (1 min) : effectif 1 168, turnover glissant 12 mois, absentéisme hors santé, niveaux de risque du run publié ; clic sur « Élevé » → *Collaborateurs* filtrés : les 19 salariés à prioriser, triés par rang.
3. *Fiche d'Omar Othmani* (M10079, `/employees/79`, rang 6, probabilité 15 %) (1 min 30) : observations, estimation et facteurs (« Taux d'absence hors santé de 12 % sur 3 mois », « Salaire à 90 % de la médiane du poste », « 9 retards sur 3 mois »), panneau *what-if* (hausse de salaire, baisse des heures sup, formation, promotion : estimation non causale), puis marquer « Revue de la rémunération » réalisée : intervention datée et auditée.
4. *Absentéisme* puis *Charge de travail* (1 min 30) : séries hebdomadaires et anomalies (Ramadan, ponts, maladie exclue), prévision à 3 mois avec fourchette ; charge : heures sup par ETP, équipes en tension, surcharges individuelles soutenues (RH seulement).
5. *Formations* et *Prévisions effectifs* (1 min 30) : formations à risque de dépasser l'échéance et relances ; projection à 12 mois, modifier le scénario (embauches à 80 %, budget) : recalcul immédiat sans écriture, mention « projection indicative ».
6. *Transparence du modèle* et *Vérification a posteriori* (1 min) : champion LOGREG, coefficients par groupe, calibration, équité, état du démarrage à froid ; vérification au 28/02/2026 (démissions toutes datées après l'origine).

**Manager (`mgr.M10451`), 2 min 30**

7. *Mon équipe* : ses 9 collaborateurs (6 scorés, tous Faible ce mois-ci), niveaux et catégories de facteurs, jamais de salaire, de probabilité ni de signal individuel d'absentéisme ; *Charge de travail* limitée à ses équipes d'au moins 5 personnes, *Formations* de son équipe sans probabilité. Ouvrir `/employees/79` (hors périmètre) → `/interdit` ; `GET /api/employees/79` → 403.

**Administrateur (`admin`), 2 min 30**

8. *Console* : comptes, sessions, connexions, refus d'accès (dont celui du manager), worker, jobs. `/dashboard` → `/interdit`.
9. *Paramètres* : capacité, seuils de démarrage à froid, rétention, seuils IA ; *Santé des données* : lot `mixte_medium_s1`, règles déclenchées, exemples de rejets où seul le matricule reste visible (ni montant, ni date ou catégorie d'absence) ; *Dérive des données* : PSI par variable entre la période d'entraînement du LOGREG (09/2020 → 02/2026) et août 2026 ; *Journal d'audit* : filtrer `employee.view` REFUSE.

Si le temps le permet : *Droit d'accès* (RH) : rechercher un salarié, enregistrer une demande d'accès et télécharger l'export ; une opposition l'exclut aussitôt de tout calcul prédictif.

## Vérifications faites

29/09/2026, `next start` sur `data/app.db` (avant la promotion du LOGREG) : `/login` 200, `/api/dashboard` sans cookie 401 ; connexion par la Server Action pour les trois comptes ; toutes les pages en 200 pour ADMIN et RH ; pour le manager, `/data-health`, `/transparency` et `/admin/*` → `/interdit`, fiche hors périmètre → `/interdit`, API hors périmètre 403, aucune clé de salaire, probabilité, lift ou `phrase_rh` dans `/api/employees/[id]`, `/api/employees`, `/api/dashboard`, `/api/alerts`.

30/09/2026, sur une copie de `data/app.db` après promotion : DAL Transparence (démarrage à froid inactif, run publié LOGREG n° 73), Dérive (référence « période d'entraînement du modèle », 66 mois), Backtesting (aucune démission datée avant l'origine) ; campagne Playwright de bout en bout : [docs/qa/BUGS_E2E.md](qa/BUGS_E2E.md).

30/09/2026, vérification finale (build de production isolé, copie de `data/app.db`) : les 22 écrans ouverts avec les trois comptes dans Chromium, aucune erreur 500, aucune donnée RH nominative pour l'admin, ni salaire, ni probabilité, ni opposition, ni signal individuel d'absentéisme pour le manager ; Playwright 113/113, campagne de sécurité 60/60 ; détails dans [docs/qa/SECURITE_PERF.md](qa/SECURITE_PERF.md) § 9.
