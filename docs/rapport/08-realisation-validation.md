# Chapitre 8 — Réalisation et validation

Ce chapitre présente d'abord la réalisation : environnement, organisation du travail des derniers jours et état des modules (section 8.1), puis écrans par rôle et travail mené sur l'interface, du design system à l'audit produit (section 8.2). Il décrit ensuite la validation : stratégie et résultats des tests unitaires, d'intégration et de bout en bout, sécurité, performance, accessibilité, vérification finale et relecture des captures (sections 8.3 et 8.4), évaluation de la détection d'anomalies (section 8.5) et déploiement (section 8.6).

## 8.1 Environnement, organisation et état de réalisation

### 8.1.1 Environnement technique

Le module est développé en TypeScript strict sur Node.js 24 : Next.js 16.3 (App Router), React 19, better-sqlite3 et Drizzle ORM, zod 4, Tailwind CSS 4, Apache ECharts 6, croner, pino. La page de connexion utilise en outre three et React Three Fiber, ajoutés pendant la vague design system pour un décor 3D chargé en différé ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 4). Le volet hors ligne utilise Python 3.13 (numpy, pandas, scipy, scikit-learn, LightGBM, holidays, pytest). Le code, les migrations, le simulateur, les scripts d'exploitation et la documentation sont réunis dans un seul dépôt ([README.md](../../README.md)), versionné sous git depuis le 04/10/2026 ([VERIFICATION_FINALE.md](../qa/VERIFICATION_FINALE.md), « Dépôt git »).

### 8.1.2 Organisation du travail du 01 au 04/10/2026

Les derniers chantiers ont été menés avec un assistant de programmation fondé sur un grand modèle de langage, utilisé sous la forme de plusieurs agents qui travaillent en parallèle au sein d'une même session. Les règles, les arbitrages et la validation des résultats restent humains. La méthode tient en cinq principes.

- **Des périmètres de fichiers disjoints.** Chaque chantier commence par un document de règles communes (`docs/qa/CHANTIER_*.md`) qui attribue à chaque agent une liste exclusive de fichiers. Un agent qui a besoin d'un fichier hors de son périmètre ne le modifie pas : il écrit une demande dans la section « Demandes hors périmètre » du document, traitée par le propriétaire du fichier ou par l'intégrateur ([CHANTIER_ERGONOMIE.md](../qa/CHANTIER_ERGONOMIE.md), [CHANTIER_VISUELS.md](../qa/CHANTIER_VISUELS.md)).
- **Le socle commun d'abord.** Les éléments partagés sont posés avant le travail parallèle et n'évoluent ensuite que par ajout : jetons et composants du design system avant la migration des pages ; API « additive et rétro-compatible » du cœur des composants, dont l'agent traite en priorité les demandes des autres ; types et signatures de l'assistant d'aide figés avant que ses cinq agents ne commencent ([CHANTIER_RAG.md](../qa/CHANTIER_RAG.md), « Contrat commun »). Le chantier « enrichissement » du 02/10, mené pendant la migration des pages, a livré des composants autonomes accompagnés de la description exacte de leur branchement, appliquée ensuite par l'intégrateur ([BRANCHEMENTS_4E.md](../qa/BRANCHEMENTS_4E.md)).
- **Des copies de travail isolées.** Une fois le dépôt git créé, les cinq fonctions d'analyse du 04/10 puis l'assistant d'aide ont été développés chacun dans une copie de travail git (*worktree*) et une branche propres, hors du dossier de l'application, puis fusionnés ([CHANTIER_IA.md](../qa/CHANTIER_IA.md)). Cette isolation répond à un incident relevé le 01/10 : sur le serveur de développement partagé, une erreur de compilation dans un fichier en cours d'édition mettait toutes les pages en erreur 500 ([REVUE_TRANSVERSE.md](../qa/REVUE_TRANSVERSE.md), « Rôles, console, performance »).
- **Une seule vérification finale.** Le poste de développement (8 Go de mémoire) ne supporte pas plusieurs compilations de production ni plusieurs suites de bout en bout simultanées. Les agents ne lancent donc ni build, ni serveur, ni navigateur automatisé : ils vérifient leur travail par des tests de rendu statique, ESLint et le vérificateur de types. Le build, la suite de bout en bout et les captures sont exécutés une seule fois, sur l'état intégré, par une session dédiée ([VERIFICATION_FINALE.md](../qa/VERIFICATION_FINALE.md)).
- **Un bilan écrit par agent.** Chaque agent rend un bilan : constats, fichiers modifiés, tests ajoutés, libellés visés par les tests de bout en bout et préservés ([docs/qa/ergonomie/](../qa/ergonomie/), `docs/RESULTATS_IA_*.md`).

Les chantiers se sont enchaînés ainsi :

- **01/10** : revue transverse de cohérence (parcours des trois rôles, captures à 1 440 et 390 px, 27 constats dont 8 majeurs) et reprise des messages produits par le serveur ([REVUE_TRANSVERSE.md](../qa/REVUE_TRANSVERSE.md), [MESSAGES_SERVEUR.md](../qa/MESSAGES_SERVEUR.md)) ;
- **02 au 04/10** : design system et connexion 3D ; chantier « enrichissement » à cinq agents (export CSV et impression, filtrage croisé, palette Ctrl+K, rétention, organigramme) ;
- **04/10** : visuels, menu et Paramètres (six agents), ergonomie des pages métier (six agents), marques des graphiques, vérification finale, cinq fonctions d'analyse (cinq agents), audit produit (sept audits en lecture seule), assistant d'aide (cinq agents), vague « titres seuls ».

> **À VALIDER (stagiaire)** : formulation de l'usage d'un assistant de programmation, à aligner sur les règles de l'établissement et de l'entreprise d'accueil.

### 8.1.3 État de réalisation

Le tableau 8.1 récapitule l'état des modules du cahier des charges et des extensions au 04/10/2026.

*Tableau 8.1 — État de réalisation des modules (d'après le code et [docs/qa/BACKLOG_INTEGRATION.md](../qa/BACKLOG_INTEGRATION.md)).*

| Module | État | Écarts |
|---|---|---|
| M1 Données et intégration AJIR | Réalisé (import, contrôles qualité, lien profond `/go/collaborateur/<matricule>`, import depuis l'interface avec calendrier et agrégats reconstruits) | Périmètre manager selon la hiérarchie du dernier import, pas à date |
| M2 Simulateur RH | Réalisé (2 scénarios, 3 tailles) | Calage non validé sur des statistiques réelles |
| M3 Accès, sécurité, audit | Réalisé (y compris export audité du droit d'accès, opposition, refus à l'entrée des pages journalisés) | — |
| M4 Tableau de bord exécutif | Réalisé | — |
| M5 Moteur de prédiction | Réalisé : champion `logreg-v1-20260930` promu le 30/09/2026, repli automatique sur B0 sous 30 démissions observées (démarrage à froid), registre et retour arrière du calcul publié | Porte de promotion sur backtest client non automatisée |
| M6 Fiche collaborateur | Réalisé (trois zones) | — |
| M7 Alertes et recommandations | Réalisé | État « Obsolète » des objets d'un run annulé non implémenté ; quand un mois est recalculé avec un autre modèle, les recommandations et alertes du calcul remplacé qui ne sont pas reproposées sont rejetées avec un commentaire par une commande auditée (`npm run runs -- supersede`) |
| M8 Absentéisme | Réalisé (collectif robuste, Bradford individuel, prévision à 3 mois) | — |
| *Should* : what-if, backtesting, Transparence | Réalisés | — |
| *Should* : jeton AJIR, retour sur recommandations | Réalisés (jeton HMAC-SHA256 à usage unique, retour « pertinente / non pertinente ») | — |
| Au-delà du cahier : IA par sujet | Réalisé : absentéisme, effectifs et masse salariale, formations, charge de travail (chapitre 7, section 7.12) ; pages de pilotage Synthèse, Équipes, Interventions, Dérive | Résultats sur données simulées seulement |
| Au-delà du cahier : enrichissement (02/10) | Réalisé : export CSV audité, synthèse imprimable, filtrage croisé depuis les graphiques, palette Ctrl+K, rétention des embauchés (Kaplan-Meier), organigramme ([BRANCHEMENTS_4E.md](../qa/BRANCHEMENTS_4E.md)) | — |
| Au-delà du cahier : fonctions d'analyse (04/10) | Réalisé : meilleur levier, comparaison appariée des interventions (estimation non causale), typologie des départs, fourchettes de prévision conformes (chapitre 7, sections 7.13 à 7.16) | Données simulées ; typologie de stabilité moyenne ; une seule intervention sur la base de démonstration ; versions conformes des modèles de prévision non encore promues (au 04/10/2026, avant la passe finale) |
| Au-delà du cahier : IA générative facultative (04/10) | Réalisé : synthèse du mois rédigée, assistant d'aide filtré par rôle (chapitre 7, section 7.17) | Écart assumé au cahier des charges ([ADR-014](../adr/014-ia-generative-facultative-hors-donnees-rh.md)) : reformulation désactivée par défaut |
| Interface : design system, ergonomie, visuels | Réalisé (section 8.2) | Menu à simplifier ([AUDIT_PRODUIT.md](../qa/AUDIT_PRODUIT.md), section H) ; vague « titres seuls » à revérifier de bout en bout (au 04/10/2026, avant la passe finale) |

> **À COMPLÉTER (stagiaire)** : indiquer le commit de référence du rendu (dépôt git créé le 04/10/2026 ; retenir le commit de la passe finale).

## 8.2 Écrans et interface

La navigation est organisée par rôle : chaque utilisateur ne voit que les entrées auxquelles il a droit, et une URL saisie à la main hors de son rôle le redirige vers une page « Accès interdit ». L'application compte 26 pages, plus la connexion, l'activation, l'accès refusé et la page introuvable ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 2). Les écrans sont décrits ci-dessous (sections 8.2.1 à 8.2.5), puis le travail mené sur l'interface (sections 8.2.6 à 8.2.9). Les figures peuvent être tirées des captures finales du 04/10/2026, nommées par rôle, page, thème, état du menu et largeur ([docs/qa/captures/design-system/final/](../qa/captures/design-system/final/)) ; elles précèdent la vague « titres seuls » (section 8.2.9) et seront reprises après la passe finale sur la base de démonstration ([docs/DEMO.md](../DEMO.md), comptes `admin`, `rh.demo` et `mgr.M10451`, et `mgr.M12037` pour l'organigramme).

### 8.2.1 Écrans communs

- **Connexion** (figure 8.1) : identifiant et mot de passe, message d'erreur identique pour un identifiant inconnu et un mot de passe faux, verrouillage progressif annoncé. À partir de 1 024 px, un décor 3D discret (une constellation) occupe le panneau de gauche. Il n'est chargé qu'une fois la page au repos et cède la place à une image vectorielle fixe sur écran étroit, sur un appareil modeste, sans accélération graphique ou quand l'utilisateur demande un mouvement réduit. Le formulaire, utilisable avant le décor, permet d'afficher le mot de passe, signale le verrouillage des majuscules et indique sous le champ un identifiant ou un mot de passe non saisi ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 2, étape 2).
- **Activation de compte** : un compte créé par la synchronisation AJIR ou par l'administrateur s'active par un lien à usage unique, valable 7 jours, qui fixe le mot de passe. Les règles du mot de passe sont vérifiées avant l'envoi, avec un message sous le champ concerné.
- **Mon compte** : informations du compte, nombre de sessions ouvertes, choix du thème, changement de mot de passe (qui ferme les autres sessions), vérifié avant l'envoi sans vider les champs.
- **Alertes** (figure 8.2) : liste filtrable par type, statut et sévérité, exportable en CSV, détail, transitions Nouvelle → En cours → Traitée ou Rejetée avec commentaire. Chaque rôle ne voit que les alertes de son audience et de son périmètre, et le filtre « Type » ne propose que les types qu'il peut recevoir. Depuis le détail, « alerte suivante » reste dans la sélection de la liste d'origine.
- **Aide** : questions fréquentes, glossaire et description des écrans du rôle, avec une recherche limitée aux contenus de ce rôle ([ergonomie/COMPTE.md](../qa/ergonomie/COMPTE.md), C8).

### 8.2.2 Responsable RH

- **Tableau de bord** (figure 8.3) : indicateurs de la période choisie (3 à 24 mois), notamment effectif, entrées, sorties, turnover glissant sur 12 mois total et volontaire, absentéisme hors santé non planifié, formations obligatoires réalisées et masse salariale. S'y ajoutent les séries mensuelles, l'absentéisme par département, et les niveaux de risque du calcul publié par département avec la part non évaluée et le lift moyen. Les filtres portent sur le département, le contrat, l'âge, l'ancienneté et le niveau. Un clic sur un département ou un niveau ouvre la liste filtrée : c'est le passage « indicateur → liste → fiche ». Sous le titre, l'assistant d'aide (section 8.2.5) et le bandeau « À traiter » précèdent les filtres.
- **Collaborateurs** (figure 8.4) : liste paginée et triable (matricule, nom, poste, département, contrat, ancienneté, niveau de risque, probabilité à 6 mois ou score à règles, lift), avec les mêmes filtres et un export CSV qui les reprend.
- **Fiche collaborateur** (figure 8.5), en trois zones :
  - *Observations* : contrat et fin de CDD prévue, carrière, paie sur 12 mois, absences hors santé par catégorie, total des jours d'absence pour santé sur 12 mois (fait observé, jamais utilisé dans un calcul), formations, évaluations ;
  - *Estimation* : niveau de risque avec libellé, probabilité à 6 mois (ou « score à règles » en points avec B0) accompagnée d'un repère en fréquence (« sur 100 collaborateurs »), rang, lift, version du modèle, date du calcul, facteurs associés par groupe avec phrase chiffrée, historique des 12 derniers calculs, rappel qu'une prédiction est une estimation ;
  - *Suggestions* : recommandations avec la raison chiffrée qui les déclenche et l'action proposée, à marquer réalisées (avec une date, ce qui crée une intervention) ou rejetées (avec un commentaire), et un retour « pertinente / non pertinente ».

  Le panneau *what-if* (figure 7.4) complète la fiche RH ; son bouton « Trouver les leviers les plus efficaces » propose les plus petites combinaisons d'actions qui font baisser le niveau (chapitre 7, section 7.13). Ouverte depuis un autre écran (organigramme, charge, formations, interventions, synthèse, alerte), la fiche y ramène par son fil d'Ariane.
- **Recommandations** : toutes les recommandations ouvertes, par action et par salarié, exportables en CSV. Les recommandations remplacées par un recalcul sont comptées à part, hors du taux d'adoption et des rejets.
- **Absentéisme** (figure 8.6) : taux hebdomadaires d'absence hors santé non planifiée par département ou par équipe, avec le taux attendu corrigé du calendrier. Viennent ensuite les anomalies collectives détectées (période, écart, classe de semaine prise en compte) et les signaux individuels « à vérifier » (facteur de Bradford), réservés à la RH. La prévision porte une fourchette dont la couverture est mesurée (chapitre 7, section 7.16).
- **Backtesting** (figure 8.7) : pour une date passée dont le suivi à 6 mois est complet, les salariés classés Élevé ou Moyen confrontés aux démissions observées ensuite (dates strictement postérieures à l'origine). On y lit par exemple combien de démissions le modèle aurait signalées, et combien de mois à l'avance, avec un bandeau quand la date a été vue à l'entraînement.
- **Synthèse du mois** : constats du mois (passages en risque élevé, évolutions, alertes), point d'entrée du pilotage. Un encadré résume le mois en quelques phrases rédigées par phrases types ; leur reformulation par IA générative est facultative et désactivée par défaut (chapitre 7, section 7.17.2). La synthèse s'imprime avec un en-tête qui rappelle le périmètre.
- **Équipes** : tableau de bord par équipe et carte des équipes (surface proportionnelle à l'effectif, couleur selon la tension), avec un lien vers l'organigramme.
- **Organigramme** : hiérarchie complète, en graphique ou en liste parcourable au clavier, colorée au choix par effectif, niveau de risque ou absentéisme ; le panneau de détail ouvre la fiche ou la liste de l'équipe ([BRANCHEMENTS_4E.md](../qa/BRANCHEMENTS_4E.md), § E ; [ergonomie/COLLAB.md](../qa/ergonomie/COLLAB.md)).
- **Rétention** : part des embauchés encore présents après 6 à 48 mois, en courbes de maintien de Kaplan-Meier, par cohorte d'embauche, département, premier contrat ou famille de métier ; la section « Profils de départs » décrit, pour la RH seule, des familles de démissions sans étiqueter personne (chapitre 7, section 7.15).
- **Formations** : formations obligatoires, taux de réalisation, échéances à venir, retards, formations à risque de dépasser l'échéance (niveau et facteurs) et relances proposées.
- **Charge de travail** : heures supplémentaires par ETP des départements et des équipes, 12 mois observés et 3 mois prévus avec fourchette, équipes en surcharge prévue, surcharges individuelles soutenues (lecture auditée), recommandations. Le libellé « équipes en tension » a été réservé à l'écran Équipes, qui le définit autrement (cumul de signaux) : la revue transverse du 01/10 avait relevé deux chiffres différents sous le même nom ([REVUE_TRANSVERSE.md](../qa/REVUE_TRANSVERSE.md), T1).
- **Prévisions des effectifs et de la masse salariale** : projection à 12 mois par département avec intervalle à 80 %, scénario modifiable (rythme d'embauche, hausse de janvier, budget) recalculé côté serveur sans écriture, décomposition des sorties, effectif par grade, recommandations RH ; mention « projection indicative ».
- **Interventions** : taux de réalisation par type d'action et niveau de risque avant / après, sans prétention causale. Une comparaison avec des collaborateurs similaires non suivis, présentée comme une estimation non causale, s'y ajoute (chapitre 7, section 7.14). La base de démonstration ne compte qu'une action enregistrée : chaque type y affiche « Effectif insuffisant pour comparer » ([RESULTATS_IA_INTERVENTIONS.md](../RESULTATS_IA_INTERVENTIONS.md)).
- **Droit d'accès** : recherche d'un salarié, enregistrement d'une demande d'accès, d'opposition ou de rectification, export des données détenues, registre des demandes.
- **Santé des données**, **Transparence du modèle** et **Dérive des données**, partagées avec l'administrateur (ci-dessous).

### 8.2.3 Manager

Le manager dispose des mêmes écrans de pilotage, restreints à sa hiérarchie et épurés de toute donnée sensible :

- **Tableau de bord** : indicateurs de son équipe sans masse salariale ni lift ; les filtres contrat, âge et ancienneté sont ignorés et signalés ; les taux et les nombres de sorties sont masqués sous 5 personnes (ADR-011) ;
- **Mon équipe** : ses collaborateurs avec le niveau de risque seul ;
- **Fiche** : observations sans rémunération ni détail d'absences, niveau de risque avec les **catégories** des seuls facteurs qui font monter le risque (sans chiffre), historique des niveaux, recommandations en lecture hors révision salariale (figure 8.8, à comparer à la figure 8.5). Jusqu'à l'audit produit du 04/10, les facteurs qui font baisser le risque apparaissaient aussi, présentés comme des raisons ([AUDIT_PRODUIT.md](../qa/AUDIT_PRODUIT.md), section E) ;
- **Absentéisme** : séries de ses équipes, petits groupes masqués, anomalies collectives, prévision de son équipe directe si elle compte au moins 5 personnes, aucun signal individuel ;
- **Synthèse** (avec l'encadré rédigé), **Équipes**, **Organigramme**, **Rétention** (sans les profils de départs), **Formations** (niveau de risque sans probabilité) et **Charge de travail** (équipes d'au moins 5 personnes, recommandations collectives), restreints à sa hiérarchie ; ni prévisions d'effectifs, ni interventions, ni droit d'accès. L'export CSV de « Mon équipe » ne contient ni salaire ni probabilité.

### 8.2.4 Administrateur

- **Console d'administration** (figure 8.9) : connexions réussies et échouées par jour, comptes actifs par rôle, refus d'accès par action, jobs par type et par statut, derniers refus, sans aucune donnée RH nominative. L'assistant d'aide y est placé sous le titre.
- **Utilisateurs et accès** : création (le rôle doit être choisi explicitement, sans valeur par défaut), désactivation, changement de rôle, génération d'un lien d'activation.
- **Paramètres** (figure 8.12) : capacité RH (part classée Élevé), seuil de lift Moyen, seuils de démarrage à froid, seuil de qualité, SMIG et son barème daté, seuil de Bradford, seuils des recommandations d'absentéisme et de la surcharge de travail, durées de rétention, budgets annuels de masse salariale ; chaque modification est auditée et s'applique au calcul suivant. La page, refaite le 04/10, regroupe les réglages par thème avec une navigation qui suit le défilement ; elle signale chaque valeur modifiée, permet de rétablir la valeur par défaut et refuse une valeur hors limites avant l'envoi ([CHANTIER_VISUELS.md](../qa/CHANTIER_VISUELS.md), agent SET).
- **Journal d'audit** (figure 8.10) : filtres par utilisateur, action (par préfixe), résultat (OK, REFUSÉ, ÉCHEC) et période.
- **Santé des données** (figure 6.1) : dépôt d'un export, lots, score de qualité, rejets motivés, relance du calcul.
- **Transparence du modèle** (figure 8.11) : champion, type, version du jeu de variables, règles ou coefficients, métriques et calibration, rapport d'équité (lignes sous l'effectif minimal masquées), statut du golden, historique des versions, règle de décision et état du démarrage à froid (modèle réellement utilisé par le calcul publié, nombre de démissions observées, probabilité indicative).
- **Dérive des données** : indice de stabilité de population (PSI) de chaque variable entre la période d'entraînement du champion et le dernier mois, calibration récente, conseil de réentraînement. Le verdict n'est rouge que si le rapport entre démissions observées et prévues sort de la cible, comme sur la page Transparence ; une dérive des seules variables est signalée « à surveiller ».

### 8.2.5 Fonctions communes aux trois rôles

- **Thème** clair, sombre ou système, choisi dans l'en-tête, dans Mon compte ou par la palette de commandes, appliqué dès le premier affichage ; l'impression repasse toujours en clair.
- **Menu réductible** en rail d'icônes de 64 px, avec le libellé en bulle au survol et au focus ; le choix est mémorisé.
- **Palette de commandes** (Ctrl+K, ou « / » hors d'un champ) : pages, collaborateurs du périmètre, alertes ouvertes et actions ; l'administrateur n'y trouve jamais de collaborateur ([BRANCHEMENTS_4E.md](../qa/BRANCHEMENTS_4E.md), § C).
- **Export CSV** des listes de collaborateurs, d'alertes et de recommandations, avec les colonnes du rôle, journalisé dans l'audit ; **impression** de toute page sans le menu ni l'en-tête, avec un pied paginé, et en-tête d'impression dédié pour la synthèse.
- **Bulles « ? »** : définitions, périmètre, période et précisions de chaque titre, carte ou visuel, fermées par défaut (section 8.2.9).
- **Assistant d'aide** : un champ « Poser une question… », replié sur une ligne sous le titre du tableau de bord (RH, manager) et de la console (ADMIN). La réponse est extraite de la documentation et de l'aide filtrées par rôle, jamais des données des collaborateurs, et cite ses sources ; sa reformulation par IA générative est facultative et désactivée par défaut ([RESULTATS_ASSISTANT.md](../RESULTATS_ASSISTANT.md) ; chapitre 7, section 7.17.3 ; chapitre 5, section 5.4.6).

### 8.2.6 Design system

Les choix de conception du design system sont présentés au chapitre 5 (section 5.1.4). Leur réalisation, du 02 au 04/10/2026, a suivi un plan en sept étapes, chacune assortie d'un critère de sortie : jetons et thème, connexion 3D, composants, pages métier, visuels, ergonomie, accessibilité ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 2).

- **Jetons et thème.** Les couleurs sont des variables `--pa-*` définies pour les deux thèmes et exposées à Tailwind ; plus aucune couleur fixe ne subsiste dans les composants partagés. Les contrastes de chaque paire de jetons texte / fond (4,5:1) et composant / fond (3:1) sont calculés dans les deux thèmes et figés par un test ([DESIGN_SYSTEM.md](../qa/DESIGN_SYSTEM.md), § 7). Ce calcul a fait corriger le survol du bouton principal en thème sombre, où le texte blanc n'atteignait que 3,35:1 (6,01:1 après correction).
- **Composants communs** (`@/components/ui`, `@/components/ux`) : boutons à états (en cours, désactivé avec sa raison), confirmation qui énonce la conséquence et garde le focus, notifications annoncées aux lecteurs d'écran (5 s, 8 s pour une erreur), squelettes, états vides, tableau triable qui passe en cartes sous 640 px, en-têtes de page, tuiles d'indicateurs, fil d'Ariane, sommaire de page. Leur API n'évolue que par ajout ; le catalogue sert de mode d'emploi ([DEMANDES_COMPOSANTS.md](../qa/DEMANDES_COMPOSANTS.md)).
- **Pages.** Les 26 pages ont été migrées sur les jetons et les composants communs ; 23 routes ont un squelette de chargement à la forme de la page et 25 une page d'erreur.
- **Mouvement.** Les transitions durent 150 ou 200 ms et sont neutralisées quand l'utilisateur demande un mouvement réduit. Seul le fondu du décor de connexion (700 ms) sort de cette plage : c'est l'apparition d'un fond décoratif, non la réponse à une action, et il est absent en mouvement réduit ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 7, point 4).

Le design system ne touche ni à la base (aucune migration), ni à la logique métier, ni aux routes d'API existantes ; seules `/api/export` et `/api/search`, du chantier « enrichissement », sont nouvelles ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 6.5). Il est documenté par [DESIGN_SYSTEM.md](../qa/DESIGN_SYSTEM.md) (jetons, thème, mouvement, contrastes), [CHARTE_UI.md](../qa/CHARTE_UI.md) (structure d'écran, boutons, textes, visuels) et [LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md) (plan, fichiers par domaine, mode de test par rôle, liste de contrôle chiffrée).

### 8.2.7 Ergonomie

La vague d'ergonomie du 04/10/2026 a audité six domaines en parallèle : cœur des composants ; tableau de bord et synthèse ; collaborateurs ; alertes, recommandations et interventions ; pages d'analyse ; compte, aide et administration des comptes. Chaque agent a parcouru ses écrans rôle par rôle avec une grille commune tirée de la charte : structure d'écran, boutons, retours, navigation, visuels, mobile et clavier ([CHANTIER_ERGONOMIE.md](../qa/CHANTIER_ERGONOMIE.md)). Les frictions sont cotées sur l'échelle de gravité de Nielsen, de 1 (défaut cosmétique) à 4 (défaut bloquant), et le plus souvent rapportées à l'une de ses heuristiques (Nielsen, 1994). Les frictions de gravité 3 et 2 passaient avant le cosmétique, et aucun libellé visé par les tests de bout en bout ne devait changer.

*Tableau 8.6 — Frictions relevées par la vague d'ergonomie du 04/10/2026 (décompte des tableaux des six bilans de [docs/qa/ergonomie/](../qa/ergonomie/)).*

| Domaine (bilan) | Constats | Gravité 3 | Gravité 2 | Gravité 1 | Corrigés | Non faits |
|---|---|---|---|---|---|---|
| Cœur des composants ([UI.md](../qa/ergonomie/UI.md)) | 19 | 0 | 10 | 9 | 16 | 3 |
| Tableau de bord et synthèse ([PILOT.md](../qa/ergonomie/PILOT.md)) | 16 | 0 | 8 | 8 | 14 | 2 |
| Collaborateurs ([COLLAB.md](../qa/ergonomie/COLLAB.md)) | 21 | 1 | 7 | 13 | 15 | 5 |
| Alertes, recommandations, interventions ([ACTION.md](../qa/ergonomie/ACTION.md)) | 27 | 0 | 8 | 19 | 24 | 3 |
| Pages d'analyse ([IA.md](../qa/ergonomie/IA.md)) | 19 | 2 | 7 | 10 | 13 | 6 |
| Compte, aide, comptes ([COMPTE.md](../qa/ergonomie/COMPTE.md)) | 14 | 1 | 9 | 4 | 13 | 1 |
| **Total** | **116** | **4** | **49** | **63** | **95** | **20** |

Toutes les frictions de gravité 3 sont corrigées. L'une d'elles, relevée par l'agent des pages d'analyse, est la même que celle du domaine Collaborateurs, qui l'a corrigée : elle est comptée deux fois. Dans le domaine Collaborateurs, un constat était déjà traité, d'où 15 corrigés et 5 non faits sur 21. Les frictions de gravité 3 étaient les suivantes :

- **Retour perdu vers l'écran d'origine.** Une fiche ouverte depuis l'organigramme, la charge, les formations, les interventions, la synthèse ou une alerte renvoyait à la liste des collaborateurs : le paramètre de retour posé par ces écrans était rejeté par la fiche. Elle ramène désormais à l'écran et à la section d'origine.
- **Budget refusé.** Sur les prévisions, le champ « Budget annuel » refusait tout montant rond, y compris celui de l'exemple affiché, avec un message du navigateur incompréhensible.
- **Mot de passe à ressaisir.** Dans Mon compte, les règles du nouveau mot de passe n'étaient contrôlées que par le serveur ; au moindre écart, les trois champs étaient vidés. Elles sont vérifiées avant l'envoi, avec l'erreur sous le champ concerné et le curseur dans ce champ.

Parmi les frictions de gravité 2 corrigées : un double repli des filtres sous 640 px, ramené à un seul bouton « Afficher les filtres (n actifs) » ; les deux boutons de décision d'une recommandation qui restaient actifs pendant l'envoi, au risque d'une double décision ; « Marquer comme traitée » sans état en cours après la confirmation ; le menu « Plus d'actions » qui perdait le focus ; l'organigramme en liste, parcourable seulement par tabulation parmi des centaines de personnes, désormais aux flèches. Les 20 constats non faits sont de gravité 1, sauf deux de gravité 2 : la marge réservée aux étiquettes de référence des courbes à 390 px et les trois actions par ligne de certains comptes. Chaque bilan en donne la raison, par exemple le canevas de l'organigramme non parcourable au clavier, dont la vue en liste est l'alternative ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 7, point 7).

Ces corrections ont été vérifiées par des tests de rendu statique (dossiers `tests/ergo-*`), sans navigateur ; leur rendu à 390 et 1 440 px a ensuite été contrôlé, en partie, sur les captures finales et par les tests de bout en bout (section 8.4.7).

### 8.2.8 Visuels « style Power BI » et filtrage croisé

Les graphiques passent par un kit commun : tuiles d'indicateurs et cartes de visuels ([src/components/charts/pbi.tsx](../../src/components/charts/pbi.tsx)), constructeurs d'options et un composant ECharts unique qui applique les formats français, le thème et l'adaptation mobile. Chaque visuel offre un tableau « Voir les données » qui sert d'alternative accessible. Le chantier du 04/10 (six agents : menu et en-tête, Paramètres, kit de visuels, console d'administration, santé des données et dérive, transparence et vérification a posteriori) a repris ces écrans de suivi et le kit ([CHANTIER_VISUELS.md](../qa/CHANTIER_VISUELS.md)) :

- **Couleurs.** La palette catégorielle passe de 8 à 6 teintes, contrôlées par un validateur en vision normale et daltonienne, sans teinte chaude ni verte réservée au sens (défavorable, favorable). Au-delà de 6 séries, les dernières sont regroupées dans « Autres » plutôt que de réutiliser une teinte. En thème sombre, les couleurs sont remappées à l'affichage, chacune à 3:1 au moins sur la surface sombre ([DESIGN_SYSTEM.md](../qa/DESIGN_SYSTEM.md), § 7).
- **Marques communes.** Courbe de 2 px avec repère au survol seulement, barres de 24 px au plus à bout arrondi, anneaux à 56–72 % ; sous 640 px, libellés de catégories coupés après deux lignes avec « … », le texte entier restant dans l'infobulle et le tableau ([ergonomie/CHARTS.md](../qa/ergonomie/CHARTS.md) ; 22 tests dans `tests/charts-marks/`).
- **Filtrage croisé.** Un clic sur une barre (département, niveau de risque) ou sur une équipe de la carte ouvre la liste ou l'analyse filtrée ; l'infobulle l'annonce, et le tableau « Voir les données » porte les mêmes liens pour le clavier. Seuls des filtres existants sont visés, et seuls des groupes déjà affichés au rôle sont cliquables : un groupe masqué au manager n'est jamais lié ([BRANCHEMENTS_4E.md](../qa/BRANCHEMENTS_4E.md), § B).
- **Impression.** En thème sombre, graphiques et pastilles repassent en couleurs claires le temps de l'impression.

Les tests des suites de ce chantier passaient tous (376 sur 376) à sa clôture, le 04/10 ([VERIFICATION_FINALE.md](../qa/VERIFICATION_FINALE.md)).

### 8.2.9 Audit produit et vague « titres seuls »

**Audit produit.** Le 04/10/2026, sept audits en lecture seule ont été menés en parallèle sur le code et sur les captures finales : sécurité et permissions ; écrans de pilotage ; collaborateurs, données, administration et navigation ; suivi des constats antérieurs ; technique ; parcours du risque, recommandations et alertes ; couverture fonctionnelle du sujet ([AUDIT_PRODUIT.md](../qa/AUDIT_PRODUIT.md) et ses annexes). Aucun serveur ni test n'a été lancé pendant l'audit. Les principaux résultats :

- **Couverture fonctionnelle** : sur 48 fonctionnalités, 37 sont complètes, 3 partielles, 5 présentes mais améliorables et 3 absentes, toutes trois non exigées (compétences, absentes de l'export AJIR ; horizons de 3 et 12 mois ; fiche en PDF) ; tous les *Must* et les *Should* du sujet sont présents ([annexe G](../qa/audit-produit/G-fonctionnel.md)) ;
- **Suivi des audits antérieurs** : sur 76 constats revérifiés, 29 corrigés, 18 partiels, 26 ouverts et 3 devenus sans objet ;
- **Diagnostic** : le socle est jugé solide ; les défauts tiennent moins à un manque qu'à l'accumulation d'écrans et aux incohérences entre eux (26 pages, cinq flux de recommandations, 20 entrées de menu pour la RH) ;
- **Trois défauts prioritaires** : deux verdicts contraires sur le modèle (Dérive en rouge, Transparence en vert, pour un rapport des démissions observées aux prévues de 1,01) ; « Équipes en tension » sous deux définitions ; des facteurs qui font baisser le risque présentés au manager comme des raisons.

Ces trois défauts sont corrigés, ainsi que les textes qui annonçaient une mise en service du modèle depuis la console (elle se fait hors de l'interface, par une procédure tracée), le comptage des recommandations remplacées par un recalcul comme des refus, la fiche sans « pourquoi » chiffré ni « que faire », et le rôle proposé par défaut à la création d'un compte. Restent ouverts la réduction du menu (20 entrées pour la RH, 14 proposées), à décider avec l'encadrant, la campagne de tests HTTP étendue (section 8.4.2) et les améliorations de fond, comme le tableau de bord en quatre niveaux ([AUDIT_PRODUIT.md](../qa/AUDIT_PRODUIT.md), « Plan d'action final »).

**Vague « titres seuls ».** Le même soir, une règle de rédaction a été fixée pour tout l'écran : un titre d'écran, de section, de carte ou de visuel est un groupe nominal de deux à six mots qui nomme son contenu (« Effectif fin de mois », « Absentéisme par département (%) »). Les sous-titres explicatifs, les paragraphes d'introduction, les notes sous les visuels et l'encart « À quoi sert cette page » sont retirés. Leur contenu utile passe dans une bulle « ? » fermée par défaut, qui est un bouton accessible au clavier. Les mentions obligatoires d'éthique et de confidentialité deviennent des badges courts (« Estimation non causale », « Prévision indicative ») ([CHARTE_UI.md](../qa/CHARTE_UI.md), § 0 ; [DESIGN_SYSTEM.md](../qa/DESIGN_SYSTEM.md), § 5). Seuls restent écrits les messages d'erreur, les états vides réduits à un titre et une action, et les confirmations ; la page d'aide garde ses explications. Cette règle remplace celle du « titre qui dit le message » (« L'absentéisme baisse depuis mars »), appliquée jusque-là. La vague est intégrée au code le 04/10 ; ses effets sur les tests de bout en bout, l'accessibilité et les captures sont mesurés par la passe finale (section 8.4.7). Son effet sur la compréhension des écrans n'a pas été mesuré auprès d'utilisateurs (section 8.4.6).

## 8.3 Stratégie de test

La validation combine plusieurs niveaux (tableau 8.2). Les tests TypeScript s'exécutent avec Vitest sur de vraies bases SQLite temporaires, construites par les mêmes migrations que la production ; le module `server-only` y est remplacé par un module vide. Les composants et les pages sont aussi rendus hors navigateur (`renderToStaticMarkup`), ce qui permet aux agents de vérifier leur travail sans serveur (section 8.1.2). Les tests de bout en bout pilotent un navigateur avec Playwright, sur un build isolé et une copie de la base. Enfin, un script de captures produit une revue visuelle de chaque écran par rôle, en thème clair et sombre, menu déployé et réduit, à 1 440 et 390 px.

*Tableau 8.2 — Niveaux de test.*

| Niveau | Outil | Portée | Emplacement |
|---|---|---|---|
| Unitaire et propriétés | Vitest, fast-check | Calendrier, import et règles, agrégats, variables (anti-fuite, masquage santé, cohérence des modes de calcul), scoring (golden, niveaux, ex-æquo, explication), anomalies, jobs, worker | `src/lib/**/*.test.ts`, [tests/unit/](../../tests/unit/) |
| Intégration DAL et pages | Vitest | Périmètre manager, DTO par rôle, petits groupes, pages rendues sans données sensibles, API ; rétention, organigramme, recherche, export | [tests/pilotage/](../../tests/pilotage/), [tests/ui-admin/](../../tests/ui-admin/), [tests/whatif/](../../tests/whatif/), [tests/retention/](../../tests/retention/), [tests/org-chart/](../../tests/org-chart/), [tests/search/](../../tests/search/), [tests/export/](../../tests/export/) |
| Interface et design system | Vitest (rendu statique) | Thème et contrastes AA dans les deux thèmes, graphiques sombres, marques et défauts corrigés des graphiques, notifications, squelettes, tableau, menu et rail, Paramètres, écrans de suivi, frictions d'ergonomie corrigées | [tests/components/](../../tests/components/), [tests/layout/](../../tests/layout/), [tests/charts/](../../tests/charts/), [tests/charts-marks/](../../tests/charts-marks/), [tests/charts-fix/](../../tests/charts-fix/), [tests/settings/](../../tests/settings/), `tests/monitoring-*/`, `tests/ergo-*/` |
| Sécurité | Vitest | Matrice d'autorisation par route et par rôle, attaques (injection, CSRF, énumération, contournement) | [tests/security/](../../tests/security/) |
| Exploitation | Vitest | Sauvegarde et restauration | [tests/ops/](../../tests/ops/) |
| Bout en bout | Playwright | Authentification et connexion 3D, tableaux de bord RH et manager, fiche, navigation par rôle et menu réduit, Paramètres côté navigateur, assistant d'aide, accessibilité (axe-core) en thème clair, en thème sombre et en menu réduit | [tests/e2e/](../../tests/e2e/) |
| Revue visuelle | Script de captures (Playwright) | Écrans par rôle, clair et sombre, menu déployé et réduit, 1 440 et 390 px, impression | [docs/qa/captures/design-system/final/](../qa/captures/design-system/final/) |
| IA par sujet | Vitest | Parité Python / TypeScript sur les golden, étapes idempotentes, santé ignorée, périmètres et petits groupes, transitions et audit des recommandations | [tests/ai/](../../tests/ai/) |
| Fonctions d'analyse et assistant (04/10) | Vitest, pytest | Meilleur levier (oracle exhaustif, budget de temps), appariement (golden scikit-learn, effet connu), typologie (parité du golden), fourchettes conformes, synthèse rédigée (API simulée, contrôle des nombres), assistant (filtre par rôle avant classement, questions piégées, audit sans texte) | [tests/ia-levier/](../../tests/ia-levier/), [tests/ia-causal/](../../tests/ia-causal/), [tests/ia-typologie/](../../tests/ia-typologie/), [tests/ia-conforme/](../../tests/ia-conforme/), [tests/ia-synthese/](../../tests/ia-synthese/), [tests/rag/](../../tests/rag/) |
| Protection des données et durcissement | Vitest | Opposition (scoring, variables, panel), export du droit d'accès, rétention, masquage des rejets ; sessions glissantes, limitation de débit, en-têtes, règle ESLint, audit des refus | [tests/privacy/](../../tests/privacy/), [tests/security-hardening/](../../tests/security-hardening/) |
| Hors ligne | pytest | Contrat et réalisme du simulateur ; protocole, métriques, modèles et bundle d'entraînement ; IA par sujet | [ml/sim/tests/](../../ml/sim/tests/), [ml/train/tests/](../../ml/train/tests/), `ml/<sujet>/tests/` |

## 8.4 Résultats des tests

### 8.4.1 Tests unitaires et d'intégration

La suite Vitest s'exécute hors `tests/security`, qui attaque un serveur lancé à part et s'exécute par `npm run test:security`. Au 30/09, son unique test ignoré portait sur la parité des variables de la charge de travail, conditionnée à la présence de la base d'entraînement hors dépôt. Trois mesures jalonnent la fin du projet :

- **30/09/2026** (vérification finale de la première version) : **656 tests dans 79 fichiers, 655 réussis, 1 ignoré** ; vérificateur de types et ESLint sans erreur ; build de production sans avertissement ; **67 tests Python** (`python -m pytest ml`), tous réussis ;
- **04/10/2026, 13 h** (vérification finale du design system, des visuels et de l'ergonomie) : **1 079 tests réussis et 1 ignoré dans 126 fichiers**, vérificateur de types et ESLint sans erreur ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 6.1) ;
- **04/10/2026, soir**, après la fusion des cinq fonctions d'analyse, de l'assistant d'aide et de la vague « titres seuls » : **1 396 tests réussis et 1 ignoré dans 161 fichiers**, vérificateur de types sans erreur (au 04/10/2026, avant la passe finale). Ce décompte est consigné dans [VERIFICATION_FINALE.md](../qa/VERIFICATION_FINALE.md), section « Passe finale du 04/10 au soir ».

Les chantiers du 04/10 ont aussi ajouté des tests Python (typologie des départs, fourchettes conformes : [RESULTATS_IA_TYPOLOGIE.md](../RESULTATS_IA_TYPOLOGIE.md), [RESULTATS_IA_CONFORME.md](../RESULTATS_IA_CONFORME.md)) ; la suite Python complète n'a pas été relancée depuis le 30/09 et le sera à la passe finale. La couverture mesurée par V8 le 30/09 ([docs/qa/COUVERTURE.md](../qa/COUVERTURE.md)) dépasse largement le critère BNF-7 (≥ 70 %) sur les trois modules visés (tableau 8.2 bis). Elle n'a pas été remesurée depuis, alors que la couche d'accès aux données a reçu des ajouts (fonctions d'analyse, assistant, corrections de l'audit produit) : elle est à remesurer.

*Tableau 8.2 bis — Couverture des modules critiques (instructions / branches, source : [COUVERTURE.md](../qa/COUVERTURE.md)).*

| Module | Instructions | Branches |
|---|---|---|
| `src/lib/features` | 99,6 % | 92,9 % |
| `src/lib/dal` | 97,8 % | 90,5 % |
| `src/lib/scoring` | 100 % | 98,5 % |

La campagne de couverture a mis au jour quatre défauts de faible gravité (cache du champion insensible à une altération de même longueur, audit contournable par `INSERT OR REPLACE`, redirection ouverte dans un lien d'alerte, minimum d'un salarié Élevé), corrigés ou arbitrés.

Parmi les propriétés vérifiées, quatre portent directement sur les exigences du cahier des charges :

- **anti-fuite** (BNF-13) : ajouter des lignes datées ou saisies après t ne modifie aucune variable ;
- **masquage de la santé** : un arrêt maladie laisse les variables identiques à celles d'une fenêtre sans ces jours ;
- **fidélité du scorer** (BNF-12) : le golden du bundle est reproduit, et un bundle altéré est refusé à l'enregistrement, à la promotion et au chargement ;
- **niveau indépendant du matricule** : des ex-æquo à la frontière de la capacité restent tous hors Élevé.

### 8.4.2 Autorisation et confidentialité

Une campagne de tests en boîte grise, au niveau HTTP, a été menée sur un serveur de production isolé (copie de la base de démonstration, port dédié). Elle est décrite dans [docs/qa/SECURITE_PERF.md](../qa/SECURITE_PERF.md). Elle compte une soixantaine de tests Vitest regroupant plus de 350 cas HTTP (rôles × routes × charges utiles), tous réussis.

La matrice d'autorisation observée est conforme à l'attendu pour les cinq profils testés (anonyme, administrateur, RH, manager dans son périmètre, manager hors périmètre) sur les treize routes de l'API (tableau 8.3).

*Tableau 8.3 — Extrait de la matrice d'autorisation observée (source : [SECURITE_PERF.md](../qa/SECURITE_PERF.md), § 3).*

| Route | Anonyme | Admin | RH | Manager (périmètre) | Manager (hors) |
|---|---|---|---|---|---|
| `GET /api/dashboard` | 401 | 403 | 200 | 200 | — |
| `GET /api/employees/[id]` | 401 | 403 | 200 | 200 | 403 (existe) / 404 (inexistant) |
| `POST /api/employees/[id]/what-if` | 401 | 403 | 200 / 409 | 403 | 403 |
| `GET /api/imports` | 401 | 200 | 200 | 403 | — |
| `GET /api/admin/users` | 401 | 200 | 403 | 403 | — |
| `POST /api/predictions/run` | 401 | 202 / 400 / 409 | 202 / 400 / 409 | 403 | — |

Côté pages, un utilisateur anonyme est redirigé vers la connexion, et un rôle non autorisé vers la page « Accès interdit ». Pour les pages dotées d'un état de chargement diffusé en flux (*streaming*), la réponse HTTP vaut 200 et la redirection est transportée dans le flux ; la réponse ne contient alors que la coque de chargement, sans aucune donnée métier. Ce comportement, classé informationnel, peut tromper un outil de supervision qui ne regarde que le code HTTP.

La détection de fuite parcourt récursivement toutes les réponses destinées au manager (`/api/employees`, `/api/employees/[id]`, `/api/dashboard`, `/api/alerts`). Elle y cherche les clés interdites, les valeurs connues de salaire, de probabilité, de lift et de masse salariale, les phrases chiffrées de facteurs, les noms hors périmètre et la mention « TND ». **Aucune fuite** n'a été trouvée (critère BNF-2), ni aucun montant ou probabilité dans les réponses destinées à l'administrateur. Deux points restent à arbitrer :

- la liste des comptes renvoie à l'administrateur le nom et le matricule du salarié lié à chaque compte, ce qui est nécessaire pour rattacher un manager mais s'écarte du principe « aucune donnée nominative » ;
- la différence entre 403 (salarié existant hors périmètre) et 404 (inexistant) révèle l'existence d'un identifiant. C'est un choix des conventions du projet, sans donnée nominative exposée.

Les treize routes privées de l'API figurant dans la matrice sont toutes testées pour les cinq profils ; les pages ajoutées ensuite (IA par sujet, pilotage, droit d'accès) sont couvertes par des tests de rôle au niveau de la DAL et des pages, et les refus à l'entrée d'une page ou d'une route sont désormais journalisés (`access.page`, `access.api`).

La campagne a été **rejouée le 30/09/2026 sur le build final** (copie fraîche de la base, modèle LOGREG) : **60 tests HTTP sur 60** réussis, 102 sur 102 avec les tests de durcissement. Les treize routes privées de l'API sont testées pour les cinq profils (**100 %** des routes de la matrice, critère BNF-1). Les 22 écrans ont en outre été ouverts dans un navigateur avec les trois comptes de démonstration (82 pages vues, texte affiché et flux de données du rendu serveur contrôlés) : aucune erreur 500 ; aucune donnée RH nominative pour l'administrateur hors des deux exceptions documentées ; ni salaire, ni probabilité, ni opposition, ni signal individuel d'absentéisme pour le manager. Les 22 réponses « 200 avec redirection diffusée » contrôlées ne contiennent aucune donnée. Cette vérification a conduit à corriger une fuite : l'opposition d'un collaborateur au traitement prédictif apparaissait dans les données « Quoi de neuf » et « Avant / après » transmises au manager, alors que seule la RH doit la connaître ; elle est retirée à la source, dans la couche d'accès aux données. Reste un point mineur à arbitrer : le parcours d'un collaborateur montre au manager le nom de ses anciens managers (information d'organigramme).

**Depuis le 30/09.** Cette campagne HTTP n'a pas été rejouée. L'audit produit du 04/10, mené par lecture du code, ne trouve aucune fuite exploitable : les 26 pages passent par le contrôle d'accès commun, les 19 Server Actions par une garde de la couche d'accès aux données et une validation zod, l'export du manager retire les estimations et la recherche ne renvoie aucun collaborateur à l'administrateur ([AUDIT_PRODUIT.md](../qa/AUDIT_PRODUIT.md), section G). Il souligne en revanche que le résultat « 60 sur 60 » ne couvre pas cinq points d'entrée (export, recherche, export du droit d'accès, ouverture depuis AJIR, `/go`) ni treize pages ajoutées ensuite, et propose quinze cas HTTP à ajouter avant de rejouer la campagne sur un build isolé (annexe A, § 4) ; la route de l'assistant d'aide, livrée après l'audit, s'y ajoute. Ces points d'entrée sont aujourd'hui couverts par des tests de rôle au niveau de la couche d'accès et des routes (par exemple [tests/rag/](../../tests/rag/) pour l'assistant), pas par la campagne en boîte grise. La protection CSRF des Server Actions qui modifient des données n'est par ailleurs prouvée que sur la connexion. Les écarts à la séparation des tâches relevés par le même audit sont discutés au chapitre 9 (section 9.7.6).

### 8.4.3 Sécurité applicative

Le rapport de sécurité ne relève **aucune vulnérabilité critique, élevée ni moyenne**. Les attaques testées sont les suivantes :

- **injection SQL** : 9 charges sur une douzaine de paramètres, sans erreur 500 ni message SQL divulgué ;
- **XSS stocké** dans les alertes : contenu échappé, liens dangereux neutralisés ;
- **CSRF** : 403 sur toute mutation portant une origine étrangère, aucune session émise par la connexion depuis une origine étrangère ;
- **fixation de session**, rejeu après déconnexion, jeton falsifié ;
- **énumération des comptes et verrouillage** ;
- **jeton d'activation** : format strict, usage unique, expiration ;
- **téléversement** : traversée de chemin, extension interdite, en-tête invalide, taille excessive.

Deux points faibles et quatre observations informationnelles avaient été relevés. Le premier était l'**absence d'en-têtes CSP et HSTS** sur le serveur Next.js testé sans reverse proxy (sévérité faible, CVSS indicatif 3,1) : ils sont désormais posés aussi par l'application (CSP toujours, HSTS en production), en plus du reverse proxy. Le second était la latence du tableau de bord sous charge (section 8.4.4).

La campagne a conduit à un **durcissement** livré ensuite :

- **sessions glissantes** : fermeture après 2 h d'inactivité, plafond de 10 h après la connexion, purge des sessions expirées ;
- **limitation de débit** des échecs de connexion et d'activation, par compte et par adresse IP quand celle-ci est fiable (`TRUST_PROXY=1` derrière le reverse proxy) ;
- **règle ESLint** interdisant l'accès direct à la base hors de la couche d'accès aux données, des moteurs, du worker et des scripts ;
- **journalisation des refus** décidés à l'entrée des pages et des routes ;
- `/api/health` en **503** quand la base ou le worker sont hors service ;
- **audit infalsifiable** : un trigger refuse l'écrasement d'une entrée existante ;
- **masquage** : l'administrateur ne voit que le matricule dans les rejets d'import (ni montant, ni valeur brute sensible, ni date ou catégorie d'absence).

La vérification finale a ajouté trois durcissements : limitation des essais du mot de passe actuel lors d'un changement de mot de passe, lecture bornée du corps d'un téléversement même sans en-tête de taille, et retour à la page demandée après une session expirée. `npm audit` ne relève **aucune vulnérabilité dans les dépendances de production** ; les quatre vulnérabilités modérées restantes concernent `drizzle-kit`, un outil de développement qui génère les migrations et n'est pas déployé ([SECURITE_PERF.md](../qa/SECURITE_PERF.md), § 9.4). Cette analyse date du 30/09 : elle est à relancer après l'ajout de three et React Three Fiber.

Les fonctions du 04/10 qui reçoivent un texte libre ou peuvent appeler un service externe ont leurs propres garde-fous, couverts par des tests automatisés. L'assistant d'aide exige une session, borne le corps de la requête à 2 ko et limite chaque compte à 30 questions par quart d'heure. Il journalise chaque question sans son texte et ne transmet pas à l'IA générative une question qui contient un matricule ou une adresse électronique ([RESULTATS_ASSISTANT.md](../RESULTATS_ASSISTANT.md)). Sans clé dédiée, ni la synthèse rédigée ni l'assistant n'émettent de flux sortant (chapitre 9, section 9.7.1).

> **À COMPLÉTER (stagiaire)** : scan OWASP ZAP (critère BNF-7 : aucune alerte haute), outil non disponible sur le poste de développement.

### 8.4.4 Performance et robustesse

Les mesures de performance ont été faites sur le même serveur isolé, avec la base de démonstration (environ 2 445 salariés). La charge était de 20 utilisateurs virtuels pendant 60 secondes par point d'accès. Le tableau 8.4 donne la mesure finale, sur le build livré, après la mise en cache des agrégats du tableau de bord ; le tableau 8.4 bis rappelle la première mesure.

*Tableau 8.4 — Latences sous charge, 20 utilisateurs virtuels × 60 s, mesure finale du 30/09/2026 (source : [SECURITE_PERF.md](../qa/SECURITE_PERF.md), § 9.3).*

| Point d'accès | Requêtes | Erreurs | p50 | p95 | p99 |
|---|---|---|---|---|---|
| `GET /api/dashboard` | 16 512 | 0 | 71 ms | 103 ms | 136 ms |
| `GET /api/employees` | 8 209 | 0 | 143 ms | 193 ms | 215 ms |

Le critère BNF-3 (p95 < 500 ms) est **tenu** avec une large marge, et le tableau de bord sert 4,5 fois plus de requêtes qu'à la première mesure. La liste des collaborateurs, paginée, n'a pas eu besoin d'optimisation.

*Tableau 8.4 bis — Première mesure, avant la mise en cache (source : [SECURITE_PERF.md](../qa/SECURITE_PERF.md), § 6).*

| Point d'accès | Requêtes | Erreurs | p50 | p95 | p99 |
|---|---|---|---|---|---|
| `GET /api/dashboard` | 3 633 | 0 | 299 ms | 554 ms | 984 ms |
| `GET /api/employees` | 2 859 | 0 | 385 ms | 750 ms | 1 077 ms |

Une seconde mesure avait donné un p95 de 424 ms pour le tableau de bord et de 427 ms pour la liste : le critère était alors **à la limite**. Deux facteurs y contribuaient :

- **la charge de la machine** : d'autres compilations tournaient en parallèle pendant la première mesure (maximum de 1 581 ms contre 712 ms à la seconde) ;
- **un facteur structurel** : better-sqlite3 est synchrone, et vingt requêtes concurrentes qui exécutent chacune plusieurs requêtes d'agrégation se sérialisent sur l'unique fil d'exécution de Node.js.

En charge légère, la réponse était inférieure à 40 ms. La correction retenue est une mise en cache des agrégats en mémoire, indexée sur le périmètre, les filtres et la version des données (calcul publié, dernier import, recalcul des agrégats), qui ne changent qu'au calcul mensuel : c'est elle que mesure le tableau 8.4.

Le **calcul mensuel complet** (calendrier, agrégats, variables sur 72 mois, scoring, anomalies, alertes) a duré **1,06 minute** sur une copie isolée de la base lors de la première campagne ; lors de la vérification finale, le calcul du dernier mois a pris **16,8 s** sur une copie isolée. Sur la base de démonstration, après la promotion du modèle LOGREG, `npm run pipeline` a pris **14 s** le 30/09/2026 : agrégats 4,5 s, variables des 72 mois 7,9 s, scoring 0,2 s, anomalies 0,2 s, quatre étapes IA 1,0 s. Le critère BNF-4 (< 15 min) est largement tenu.

La **restauration** d'une sauvegarde de la base de démonstration (155 Mo) prend de 16 à 58 s de traitement selon la charge du poste, de 19 s à 1 min 30 lancement compris ([docs/EXPLOITATION.md](../EXPLOITATION.md), § 5) : le critère BNF-6 (< 5 min) est tenu. Pour la **reprise** (BNF-5), un job interrompu est remis en file une fois au redémarrage du worker puis passe en échec, un run en préparation orphelin passe en échec sans toucher au calcul publié, et un import interrompu est marqué en échec ; ces cas sont couverts par des tests automatisés, pas par une mesure d'arrêt réel sur le serveur cible.

Ces mesures datent du 30/09/2026 et n'ont pas été refaites après les chantiers d'interface et d'analyse. L'audit produit signale deux écrans, Équipes et Organigramme, qui recalculent tout à chaque affichage et dont la latence reste à mesurer sur un build de production ([AUDIT_PRODUIT.md](../qa/AUDIT_PRODUIT.md), section F). La recherche du meilleur levier, plus coûteuse, est bornée : ses tests vérifient un budget de moins de 10 s et de 46 recalculs au plus ([RESULTATS_IA_LEVIER.md](../RESULTATS_IA_LEVIER.md), § 3).

### 8.4.5 Accessibilité et tests de bout en bout

Un audit d'accessibilité selon les WCAG 2.1 niveau AA, complété par les règles d'interface du projet, a d'abord été mené par relecture du code et calcul des contrastes ([docs/qa/ACCESSIBILITE.md](../qa/ACCESSIBILITE.md)). Il a conduit à corriger une cinquantaine de constats, parmi lesquels :

- un **lien d'évitement** vers le contenu ;
- un **menu mobile** accessible au clavier (focus déplacé à l'ouverture, fermeture par Échap), qui manquait sous la largeur tablette ;
- des **contrastes** insuffisants : titres de section, bordures de champs, textes secondaires, portés à au moins 4,5:1 pour le texte et 3:1 pour les composants ;
- des **erreurs de formulaire** reliées aux champs (`aria-invalid`, `aria-describedby`) et annoncées ;
- des **tableaux de données** en alternative à chaque graphique, avec légende et en-têtes de ligne ;
- des **confirmations** avant les actions irréversibles (rejet d'une recommandation, clôture d'une alerte, recalcul, changement de paramètre) ;
- un formatage des dates dans le fuseau `Africa/Tunis` pour éviter les décalages d'un jour.

La règle « une couleur de risque toujours accompagnée d'un libellé » et les états chargement, vide et erreur sont vérifiés. L'audit automatisé par **axe-core** (WCAG 2 A et AA), intégré à la suite de bout en bout, couvrait au 30/09 **39 pages** des quatre profils, en thème clair, sans aucune violation sur le build final.

Le design system a ensuite visé le niveau AA des WCAG 2.2 (W3C, 2023) dans les deux thèmes et en menu réduit : focus visible partout, cibles de 40 px (24 px au moins pour les liens denses), notifications annoncées, statuts en mots, alternative « Voir les données » à chaque graphique, animations neutralisées en mouvement réduit. Au 04/10/2026, axe-core couvre **43 pages en thème clair, 21 en thème sombre et une en menu réduit, sans aucune violation** (au 04/10/2026, avant la passe finale) ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 6.1). Des quatre points laissés ouverts le 30/09, deux sont réglés : une variation d'indicateur porte désormais son sens en mots (« favorable », « à surveiller ») en plus de la couleur, et les confirmations passent par une boîte de dialogue commune qui énonce la conséquence, garde le focus et se ferme par Échap. Les deux autres, le focus après une navigation et la taille des petits boutons du tableau des comptes, n'ont pas été revérifiés. Le canevas de l'organigramme n'est pas parcourable au clavier ; sa vue en liste sert d'alternative.

La campagne Playwright de bout en bout ([docs/qa/BUGS_E2E.md](../qa/BUGS_E2E.md)) comptait **113 tests** au 30/09, sur un build isolé et une copie de la base. Une première campagne (93 tests) avait relevé 4 défauts fonctionnels (formulaires de rejet qui perdent le choix après un refus serveur, message de confirmation absent, dates de démission antérieures à l'origine dans le backtesting) et 11 violations d'accessibilité (contrastes de 4,3 à 4,47:1 pour 4,5:1 attendus, liste de définitions mal structurée dans la fiche), tous corrigés. La vérification finale du 30/09/2026 s'est faite en trois passes : la première a révélé une zone défilante inaccessible au clavier et trois tests devenus obsolètes ; l'audit axe étendu aux nouvelles pages a ensuite relevé 10 violations (contraste des notes de bas de page, zones défilantes), corrigées dans l'application. La dernière passe donne **113 tests réussis sur 113**, dont un contrôle de la politique de sécurité du contenu (CSP) dans le navigateur : aucune ressource bloquée sur les écrans des trois rôles. Sont couverts : authentification des trois rôles, menus et accès refusés, tableaux de bord, liste et fiche avec DTO par rôle, workflow des alertes, recommandation réalisée devenant une intervention, santé des données, transparence, backtesting, what-if et administration.

Au 04/10/2026, la suite compte **153 tests, tous réussis** : une passe complète de 152 tests en 13,2 minutes, puis 15 sur 15 pour l'authentification après l'ajout d'un test (au 04/10/2026, avant la passe finale) ([VERIFICATION_FINALE.md](../qa/VERIFICATION_FINALE.md), « Résultat du 04/10 »). Elle ajoute aux parcours du 30/09 :

- **la connexion 3D** (3 tests sur 3) : formulaire utilisable avant le décor à 1 440 px, repli statique à 390 px et en mouvement réduit, sans erreur de console ni violation de la politique de sécurité du contenu ;
- **le menu réduit** : rail de 60 à 68 px, bulles au survol et au focus, choix appliqué avant l'affichage au rechargement, aucun débordement à 390 px ;
- **les Paramètres côté navigateur**, sans enregistrement : valeur signalée comme modifiée, valeur par défaut rétablie, erreurs avant l'envoi, barème du SMIG ; le test vérifie qu'aucune écriture n'a lieu ;
- **la passe axe en thème sombre et en menu réduit** (section ci-dessus).

Cette passe a fait mettre à jour des sélecteurs rendus obsolètes par les vagues d'interface et a conduit à une correction de l'application : une connexion avec un champ vide affichait la bulle native du navigateur ; elle affiche désormais un message sous le champ, sans envoi ni échec compté. Toutes les hypothèses posées par les nouveaux tests, écrits sans navigateur, ont été confirmées. Une limite demeure : à 1 440 px, le test accepte aussi bien la scène 3D que son repli, selon le rendu graphique du navigateur sans interface ; il ne prouve donc pas que la scène s'affiche, ce que montrent seulement les captures, et le repli « appareil modeste » n'est couvert que par un test unitaire ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 7, point 3). Le parcours de l'assistant d'aide (trois rôles, sources internes, fermeture par Échap, audit sans le texte de la question, aucun appel d'IA générative sans clé) a été ajouté ensuite : avec la vague « titres seuls », il relève de la passe finale (section 8.4.7).

### 8.4.6 Test utilisateur

> **À COMPLÉTER (stagiaire)** : test scénarisé de 6 tâches (BNF-14 : ≥ 80 % de réussite, SUS indicatif) — participants (RH de clients AJIR ou consultants ArabSoft jouant des personas, limite à signaler), tâches, taux de réussite, temps, erreurs, score SUS. Aucun résultat de test utilisateur ne figure dans le dépôt.

Les vagues d'ergonomie et la règle « titres seuls » reposent sur une inspection par heuristiques et sur des choix de charte, sans participation d'utilisateurs : elles ne remplacent pas ce test.

### 8.4.7 Vérification finale et relecture des captures

**Procédure.** La vérification finale est unique et ne commence qu'une fois les chantiers en cours annoncés terminés (section 8.1.2). Ses étapes sont fixées à l'avance : vérificateur de types, ESLint et Vitest ; build de production ; suite de bout en bout sur un build isolé et une copie de la base, en corrigeant l'application pour chaque vrai défaut et les sélecteurs pour les libellés changés ; captures ; rédaction du livrable ([VERIFICATION_FINALE.md](../qa/VERIFICATION_FINALE.md), « Étapes »).

**Résultat du 04/10/2026, de 12 h 28 à 13 h** (au 04/10/2026, avant la passe finale) : vérificateur de types et ESLint sans erreur ; Vitest 1 079 réussis et 1 ignoré ; build sans erreur ni avertissement (42 pages) ; 153 tests de bout en bout réussis ; axe-core sans violation sur 43 pages en clair, 21 en sombre et une en menu réduit ; connexion 3D, 3 tests sur 3 (section 8.4.5).

**Captures.** Le script prévoit 136 prises de vue, dont 8 refus de rôle attendus (par exemple la RH sur la console d'administration) ([VERIFICATION_FINALE.md](../qa/VERIFICATION_FINALE.md), étape 5 ; [README des captures](../qa/captures/design-system/final/README.md)). L'exécution a d'abord été reportée : il ne restait qu'environ 250 Mo de mémoire libre sur le poste. Lancée ensuite, elle a écrit **124 captures** en 11,6 minutes, sans avertissement de stabilité ni erreur de page, et journalisé 6 refus de rôle ; les 4 captures de la page de connexion ont été sautées par un défaut du script, corrigé depuis, et restent à refaire ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 6.1).

**Relecture.** La relecture des captures a relevé **18 défauts : 1 majeur, 6 moyens et 11 mineurs** ([LIVRABLE_DESIGN_SYSTEM.md](../qa/LIVRABLE_DESIGN_SYSTEM.md), § 7, point 1) :

- majeur : à l'impression, les en-têtes des tableaux disparaissaient, masqués par la règle d'impression qui retire les boutons du contenu ;
- moyens : libellés de catégories coupés sans « … » à 390 px (transparence, interventions) ; aide de la palette Ctrl+K collée au bord ; bouton « Désactiver » coupé dans la liste des comptes ; identifiant vidé après le message « déjà utilisé » ; libellés des prévisions qui se chevauchent à 390 px ; ligne de référence qui traverse les étiquettes des barres ;
- mineurs : par exemple une flèche de variation seule sur sa ligne, des graduations 0, 30, 60, 90 sur un axe en pourcentage à 390 px, ou des contrastes insuffisants en thème sombre (légende de l'organigramme, fourchette).

Les défauts des graphiques ont été corrigés ensemble par le commit `5d9b422` (« Graphiques : 10 défauts relevés sur les captures finales ») : libellés coupés terminés par « … » selon la même mesure qu'ECharts, valeurs des barres détourées au-dessus de la ligne de référence, axes de 0 à 100 % gradués par 25 sous 640 px, nom d'axe des prévisions placé au-dessus du séparateur entre observé et projection, bornes de la fourchette tracées, flèche et écart insécables, étiquette de la durée médiane de rétention hors de la courbe, échelle de l'organigramme plus visible en sombre. Ce correctif apporte ses propres tests ([tests/charts-fix/](../../tests/charts-fix/), [tests/charts-fix-options/](../../tests/charts-fix-options/)), qui s'ajoutent aux règles de marques de [ergonomie/CHARTS.md](../qa/ergonomie/CHARTS.md). Les autres défauts (impression, comptes, Mon compte, transparence, palette, organigramme, scénario des effectifs) ont été corrigés par le commit `afa48b8`. Les captures confirment par ailleurs les corrections attendues de la vérification : menu réduit et sa bulle, courbes sans points hors survol, barres de 23 px au plus, impression en thème sombre repassée en clair, sélecteur de thème, organigramme d'un manager de 325 personnes, palette et notifications, écrans de suivi. Restent non capturés les bulles « ? » à 390 px, le squelette du *what-if* et les graphiques situés sous la ligne de flottaison des écrans de suivi.

Cette relecture montre la limite des tests automatisés : les 18 défauts sont apparus alors que toutes les suites étaient vertes. Les tests de rendu statique vérifient la structure et les libellés, pas la mise en page réelle à une largeur donnée.

**Passe finale.** Depuis ce point, les cinq fonctions d'analyse, l'assistant d'aide (branché sous le titre du tableau de bord et de la console) et la vague « titres seuls » ont été fusionnés. Le dernier état mesuré est le suivant : vérificateur de types sans erreur, Vitest 1 396 réussis et 1 ignoré dans 161 fichiers (au 04/10/2026, avant la passe finale). La passe finale (build, suite de bout en bout dont l'assistant d'aide, axe-core en clair et en sombre, captures) est en cours au moment de la rédaction. Tous les chiffres de build, de bout en bout, d'accessibilité et de captures de cette section seront remesurés sur l'état fusionné et reportés dans [VERIFICATION_FINALE.md](../qa/VERIFICATION_FINALE.md).

### 8.4.8 Récapitulatif des vérifications

Le tableau 8.7 rassemble les vérifications, avec leur date. Les lignes marquées « à remesurer » seront mises à jour par la passe finale.

*Tableau 8.7 — Récapitulatif des vérifications (sources : sections 8.4.1 à 8.4.7).*

| Vérification | Outil | Périmètre | Résultat | Date |
|---|---|---|---|---|
| Types | `tsc --noEmit` | Tout le projet | 0 erreur | 04/10/2026, après les fusions |
| Style de code | ESLint | Tout le projet | 0 problème | 04/10/2026, avant la vague « titres seuls » ; à remesurer |
| Unitaires et intégration | Vitest | Hors `tests/security` | 1 396 réussis, 1 ignoré, 161 fichiers (1 079 et 126 fichiers à 13 h) | 04/10/2026 ; à remesurer |
| Couverture | Vitest (V8) | Variables, couche d'accès, scoring | ≥ 97,8 % des instructions, ≥ 90,5 % des branches | 30/09/2026 ; à remesurer |
| Hors ligne | pytest | `ml/` | 67 réussis | 30/09/2026 ; tests ajoutés depuis, à remesurer |
| Build | `next build` | 42 pages | 0 erreur, 0 avertissement | 04/10/2026 ; à remesurer |
| Bout en bout | Playwright | Parcours des trois rôles, connexion 3D, menu réduit, Paramètres | 153 réussis | 04/10/2026 ; à remesurer avec l'assistant |
| Accessibilité | axe-core | 43 pages en clair, 21 en sombre, 1 en menu réduit | 0 violation | 04/10/2026 ; à remesurer |
| Revue visuelle | Script de captures | 136 prises de vue prévues | 124 écrites ; 18 défauts relevés, corrigés | 04/10/2026 ; à refaire après la vague « titres seuls » |
| Autorisation HTTP | Vitest, boîte grise | 13 routes × 5 profils | 60 sur 60 (102 sur 102 avec le durcissement) | 30/09/2026 ; non rejouée |
| Écrans par rôle | Navigateur | 22 écrans, 3 comptes | Aucune fuite, aucune erreur 500 | 30/09/2026 |
| Revue de code | Audit produit (7 volets, lecture seule) | Code et captures | Aucune fuite exploitable ; 3 défauts prioritaires corrigés | 04/10/2026 |
| Ergonomie | Inspection par heuristiques | 6 domaines | 116 constats, 95 corrigés | 04/10/2026 |
| Dépendances | `npm audit` | Production | 0 vulnérabilité | 30/09/2026 ; à relancer |
| Performance | 20 utilisateurs virtuels × 60 s | Tableau de bord, liste | p95 de 103 et 193 ms | 30/09/2026 |
| Calcul mensuel | `npm run pipeline` | Base de démonstration | 14 s | 30/09/2026 |
| Test utilisateur | — | 6 tâches | Non réalisé | — |

## 8.5 Évaluation de la détection d'anomalies d'absentéisme

### 8.5.1 Méthode de détection

La détection collective ([src/lib/anomalies/index.ts](../../src/lib/anomalies/index.ts)) suit, pour chaque équipe et chaque département d'au moins 5 actifs, le taux hebdomadaire d'absence hors santé non planifiée. Pour chaque semaine, le taux attendu est la **médiane** des 26 semaines précédentes, chacune ramenée à une semaine normale par un facteur de classe calendaire, puis multipliée par le facteur de la semaine courante. Quatre classes sont distinguées : Ramadan, semaine avec férié ou pont, séance unique, normale. Chaque facteur est le rapport du taux de l'entreprise dans cette classe à son taux en semaine normale.

La dispersion est estimée de façon robuste par l'écart absolu médian (MAD), avec un plancher binomial pour les petits effectifs. Un signal est émis quand le score z robuste dépasse 3,5 **deux semaines de suite**. Le message chiffre l'écart (« +x points ») et nomme la classe de semaine prise en compte.

Le signal individuel utilise le facteur de Bradford (S² × D) sur 12 mois, hors santé, avec un seuil réglable (250 par défaut). Il est réservé à la RH et formulé « à vérifier avec le salarié, sans présumer de sa cause ».

### 8.5.2 Protocole d'évaluation

La détection a été évaluée contre la vérité terrain du simulateur ([docs/RESULTATS_ANOMALIES_QUALITE.md](../RESULTATS_ANOMALIES_QUALITE.md)). Le jeu principal est `mixte_medium_s1`, dans lequel 112 anomalies injectées sont évaluables : 31 pics d'équipe, 25 rotations d'équipe, 22 motifs lundi-vendredi, 11 motifs autour des ponts et 23 dérives. La rotation d'équipe est un type **réservé à l'évaluation**, jamais utilisé pour régler la méthode. Le jeu `mixte_medium_s2` sert de validation hors échantillon.

Une détection correspond à une anomalie si les périodes se chevauchent et si au moins un salarié touché appartient au groupe signalé. Comme cet appariement est permissif pour les anomalies longues, le rappel « dû au hasard » est estimé en décalant les détections de ±26 et ±52 semaines. La règle a été réimplémentée en Python sur les scores exportés par le code TypeScript : les deux donnent des détections identiques (64 sur 64).

### 8.5.3 Détection collective

*Tableau 8.5 — Rappel par type d'anomalie, réglage nominal (z > 3,5 deux semaines de suite), mode batch (source : [RESULTATS_ANOMALIES_QUALITE.md](../RESULTATS_ANOMALIES_QUALITE.md), § 3.1).*

| Type injecté | Événements | Détectés | Rappel | Délai médian |
|---|---|---|---|---|
| Pic d'équipe | 31 | 27 | 87,1 % | 16 j |
| Rotation d'équipe (réservé à l'évaluation) | 25 | 18 | 72,0 % | 18 j |
| Lundi-vendredi | 22 | 2 | 9,1 % | 80 j |
| Ponts | 11 | 0 | 0,0 % | — |
| Dérive | 23 | 1 | 4,3 % | 156 j |

Sur 66 mois, les 64 détections collectives comptent 48 vraies, soit une **précision de 75,0 %**, et **0,24 fausse détection par mois** pour environ 155 équipes suivies. Quatre des seize fausses détections coïncident avec la phase de pré-départ simulée d'un membre de l'équipe : un phénomène réel du simulateur, mais non étiqueté comme anomalie. Rejouée mois par mois comme le ferait le worker, la détection donne une précision de 75,9 % et 0,21 fausse détection par mois. Le délai opérationnel médian, jusqu'au calcul du 10 du mois suivant, est de 35 jours pour les pics et de 41 jours pour les rotations.

La méthode détecte les deux types **collectifs**, y compris la rotation qu'elle n'avait jamais vue. Elle ne détecte **pas** les trois types **individuels** (lundi-vendredi, ponts, dérive) : quelques jours d'absence d'une personne ne suffisent pas à faire franchir le seuil au taux d'une équipe. Leurs rares « détections » ne dépassent guère ce que le hasard produit. Le rapport montre aussi que 99,05 % des semaines d'équipe ont un attendu nul. Le score se réduit alors à un test binomial contre le plancher de 2 % : z > 3,5 revient à plus de 8,7 % d'absence, soit environ trois jours d'absence non planifiée dans la semaine pour une équipe de six à sept personnes, deux semaines de suite. C'est ce plancher, et non la médiane, qui fixe la sensibilité à l'échelle d'une équipe.

**La règle des deux semaines consécutives est ce qui rend la méthode exploitable.** À seuil égal (z = 3,5), exiger une seule semaine produit 7,91 fausses détections par mois et une précision de 18,8 %. En exiger deux divise les faux positifs par 33 (0,24 par mois). Le coût est de 13 points de rappel sur les pics, 28 sur les rotations, et 7 à 9 jours de délai. Exiger trois semaines coûte encore une semaine de délai (tableau 3.2 du rapport de résultats).

Les PR-AUC au niveau des événements, avec deux semaines consécutives et un seuil variable, valent 0,850 pour les pics, 0,687 pour les rotations et 0,512 toutes anomalies confondues.

### 8.5.4 Apport du calendrier tunisien

Les facteurs de classe estimés sur les données simulées sont proches de 1 : 1,086 pour le Ramadan, 0,983 pour les semaines avec férié ou pont, 0,819 pour la séance unique. Le simulateur module en effet peu l'absentéisme non planifié selon le calendrier. Au réglage nominal, retirer la correction ne change presque rien, car le plancher de 2 % domine la variance des petites équipes.

Pour mesurer l'apport de la correction quand l'effet existe, deux scénarios de stress ajoutent des absences d'un jour pendant le Ramadan et autour des fériés. Dans le scénario le plus marqué (Ramadan × 2, jours collés aux fériés × 3) avec un seuil abaissé à z = 3, la correction **évite 10 fausses détections sur 46**. Elle fait disparaître 10 des 11 fausses détections du Ramadan et 5 des 7 de l'Aïd, sans perdre aucune anomalie d'équipe (27 pics et 24 rotations détectés dans les deux cas). Le calendrier tunisien est donc une protection dont l'effet dépend de la force de la saisonnalité réelle. Il faudra le mesurer sur les données d'un client.

### 8.5.5 Signal individuel (Bradford)

Recalculé chaque mois comme le ferait le worker (66 calculs), le facteur de Bradford au seuil de 250 signale en moyenne 1,70 % des salariés par mois, avec une précision de 78,7 %. Il retrouve 77 % des motifs lundi-vendredi, 73 % des motifs autour des ponts et 74 % des dérives, mais tard : délai médian de 75, 198 et 163 jours. Il ne dit pas non plus de quel motif il s'agit, puisqu'il mesure un volume d'absences courtes. Il complète ainsi la détection collective sur les types qu'elle manque. Le tableau de sensibilité au seuil (100 à 600) figure dans le rapport de résultats (§ 5).

### 8.5.6 Une amélioration écartée pour raison éthique

Des tests individuels « typés » ont été prototypés en Python : un test binomial sur la part des absences courtes tombant un lundi ou un vendredi, ou collées à un pont. Ils sont nettement plus précis que Bradford. À rappel égal sur le motif lundi-vendredi (77 %), ils signalent environ trente fois moins de salariés, et ils nomment le motif. Nous avons pourtant choisi de **ne pas les porter en production**. Un signal individuel qui qualifie un motif du type « absences collées aux week-ends » s'apparente à une détection d'abus, que le cahier des charges exclut explicitement (*Won't* : détection de fraude). Il présume en outre d'une intention que les données ne permettent pas d'établir. Ce choix illustre la position du chapitre 9 : un gain de performance ne justifie pas à lui seul un traitement plus intrusif.

Une règle collective combinée (« z > 4 deux semaines ou z > 2,5 trois semaines ») a aussi été testée. Son gain, net sur la graine qui a servi à la choisir, se réduit sur la seconde graine à +4 points de rappel, sans baisse des faux positifs : il n'a pas été retenu.

### 8.5.7 Limites de l'évaluation

- Les taux mesurés dépendent des intensités d'anomalies choisies dans le simulateur : ils **classent** les méthodes plus qu'ils ne prédisent la production.
- La composition des équipes est **statique** : chaque salarié est rattaché à son manager actuel. Or 22 % des salariés touchés par une anomalie d'équipe ont aujourd'hui un autre manager qu'au moment de l'injection. Reconstruire la hiérarchie à date depuis les changements de manager corrigerait ce point.
- La détection lit toutes les absences importées, **sans appliquer la règle de visibilité à la date de saisie** : une absence saisie après le calcul mensuel manquerait à ce calcul en production.
- Les réglages ont été choisis sur la graine 1 : seuls les résultats de la graine 2 sont hors échantillon.

## 8.6 Déploiement

Le déploiement cible un serveur Windows du client, sans accès Internet, décrit dans le guide d'installation ([docs/INSTALLATION.md](../INSTALLATION.md)) et le manuel d'exploitation ([docs/EXPLOITATION.md](../EXPLOITATION.md)) :

1. installation de Node.js et d'un compte de service, copie de l'application avec ses modules natifs précompilés ;
2. fichier de configuration `.env` protégé par ACL ;
3. création de la base par les migrations et du premier administrateur ;
4. premier import de l'historique AJIR et premier calcul ;
5. enregistrement des services web et worker (WinSW) ;
6. ouverture du pare-feu ;
7. reverse proxy HTTPS (Caddy) avec le certificat de la PKI interne ;
8. sauvegarde quotidienne planifiée ;
9. vérification finale par `/api/health`.

Les fichiers de déploiement sont fournis dans [deploy/](../../deploy/) : définitions des services WinSW (web, worker, proxy), configuration Caddy avec en-têtes de sécurité, modèle de fichier `.env` et script de sauvegarde planifiée. Le manuel d'exploitation couvre le calendrier mensuel, l'import, la surveillance du calcul, la conduite à tenir en cas d'import bloqué, de worker arrêté ou de modèle refusé au chargement. Il traite aussi de la sauvegarde et de la restauration, de la rotation des journaux, de la rétention et du réentraînement par un consultant.

Le guide couvre aussi l'enregistrement des modèles livrés (turnover et IA par sujet), la règle de démarrage à froid, la purge mensuelle de rétention (`npm run retention`) et un contrôle global de l'installation (`npm run check-install`).

> **À COMPLÉTER (stagiaire)** — durée d'installation mesurée en suivant le guide sur un serveur sans Internet (objectif du plan : < 30 min), problèmes rencontrés. D'après le backlog d'intégration ([docs/qa/BACKLOG_INTEGRATION.md](../qa/BACKLOG_INTEGRATION.md)), la configuration Caddy et les services WinSW sur un vrai Windows Server n'ont pas encore été validés faute d'environnement cible ; la CSP a été validée dans Chromium par la suite de bout en bout, et `npm run check-install` ne relève aucun échec sur le poste de développement (6 avertissements liés à l'environnement : `.env`, variables de production, worker non démarré).

## 8.7 Conclusion

Le module couvre les huit modules *Must*, les *Should* et, au-delà du cahier des charges, quatre IA par sujet, cinq fonctions d'aide à l'analyse et un assistant d'aide, avec des écarts identifiés et tracés, dont l'IA générative facultative et désactivée par défaut (ADR-014). Les derniers jours ont surtout porté sur l'interface : un design system en thème clair et sombre, une vague d'ergonomie qui a corrigé 95 des 116 frictions relevées, dont toutes celles de gravité 3, des visuels homogènes et une règle de rédaction plus sobre. Ce travail a été mené par agents parallèles sur des périmètres disjoints, avec une seule vérification finale sur l'état intégré.

La validation s'appuie d'abord sur des tests automatisés qui vérifient les propriétés critiques (anti-fuite, masquage de la santé, fidélité du scorer, cloisonnement des rôles), complétés par des tests de bout en bout et un audit d'accessibilité dans les deux thèmes. La relecture des captures en a montré la limite : 18 défauts visuels sont apparus alors que toutes les suites étaient vertes. Les critères chiffrés de performance, de robustesse et d'utilisabilité sont confrontés aux mesures de la section 8.4. Plusieurs de ces mesures datent du 30/09 ou précèdent les dernières fusions : elles seront reprises par la passe finale. Restent ouverts le test utilisateur, le scan OWASP ZAP, la campagne HTTP étendue et la validation sur le serveur cible.
