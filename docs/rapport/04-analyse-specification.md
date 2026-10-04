# Chapitre 4 — Analyse et spécification des besoins

Ce chapitre identifie les acteurs du module, décrit les cas d'utilisation, puis énonce les besoins fonctionnels et non fonctionnels. Les besoins non fonctionnels sont chiffrés pour être vérifiables. Il se termine par la priorisation MoSCoW et la liste de ce qui est volontairement exclu.

## 4.1 Sources des besoins

Les besoins proviennent de trois sources :

1. le **sujet initial** du stage (document « README — Module intelligent RH »), qui définit les quatre blocs fonctionnels (accès et sécurité, données et tableaux de bord, prédiction, portail), les trois rôles et les règles d'API ;
2. le **cahier des charges révisé v2** (28 septembre 2026), qui fige la cible du modèle, le protocole d'évaluation, les critères d'acceptation chiffrés et le périmètre MoSCoW ;
3. les **décisions de conception** prises en cours de projet et consignées dans les fiches ADR ([docs/adr/](../adr/)), par exemple la séparation des tâches entre l'administrateur et la RH (ADR-007) ou les gardes de petites populations côté manager (ADR-011).

> **À COMPLÉTER (stagiaire)** : synthèse des entretiens avec des responsables RH de clients AJIR prévus au sprint S0 (nombre de personnes interrogées, profils, principaux irritants, parcours types, personas). Aucun compte rendu d'entretien ne figure dans le dépôt ; si les entretiens n'ont pas eu lieu, l'indiquer et préciser que les besoins reposent sur le cahier des charges et les échanges avec l'encadrant entreprise.

## 4.2 Acteurs

Le module distingue trois acteurs humains et deux acteurs systèmes (tableau 4.1).

*Tableau 4.1 — Acteurs du système.*

| Acteur | Type | Périmètre | Responsabilités |
|---|---|---|---|
| Administrateur | Humain | Outil, sans donnée nominative | Comptes et rôles, paramètres (capacité RH, seuils), imports, supervision du worker, journal d'audit, transparence du modèle |
| Responsable RH | Humain | Toute l'entreprise | Tableau de bord complet, fiches avec facteurs chiffrés, estimations, alertes, recommandations, simulation *what-if*, backtesting |
| Manager | Humain | Sa hiérarchie (récursive) | Indicateurs de son équipe hors rémunération, niveau de risque et catégories de facteurs de ses collaborateurs, alertes de son périmètre |
| AJIR | Système | — | Produit l'export CSV mensuel (données RH, comptes et hiérarchie) ; reste la source de vérité |
| Worker planifié | Système | — | Exécute les imports mis en file, le calcul mensuel (variables, scoring, publication, anomalies), la reprise après arrêt |

La **séparation des tâches** entre administrateur et RH va au-delà du cahier des charges. Celui-ci donnait à l'administrateur un périmètre « global ». Nous avons choisi que celui qui administre l'outil ne voie pas les données nominatives qu'il protège. Ce principe de minimisation s'est imposé en cours de projet (ADR-007).

## 4.3 Cas d'utilisation

Le diagramme de cas d'utilisation complet et les descriptions textuelles des huit cas majeurs figurent dans [docs/architecture/CAS_UTILISATION.md](../architecture/CAS_UTILISATION.md). La figure 4.1 en reprend le diagramme ; le tableau 4.2 résume les cas et les droits associés.

*Figure 4.1 — Diagramme de cas d'utilisation par acteur (source : [CAS_UTILISATION.md](../architecture/CAS_UTILISATION.md), section « Diagramme »).*

*Tableau 4.2 — Cas d'utilisation et droits par rôle.*

| Cas | Administrateur | Responsable RH | Manager |
|---|---|---|---|
| UC-01 S'authentifier, UC-09 Activer son compte | oui | oui | oui |
| UC-04 Piloter par le tableau de bord | non | entreprise | sa hiérarchie, sans masse salariale ni lift |
| UC-21 Lister les collaborateurs | non | tous, avec estimation | sa hiérarchie, niveau seul |
| UC-05 Consulter une fiche collaborateur | non | complète | restreinte (liste blanche) |
| UC-10 Suivre l'absentéisme et ses anomalies | non | tout, signaux individuels compris | ses équipes, petits groupes masqués |
| UC-06 Traiter une alerte | alertes Système et Données | toutes sauf audience Administrateur | alertes de sa hiérarchie, jamais d'absentéisme individuel |
| UC-07 Décider d'une recommandation | non | oui | lecture, hors révision salariale |
| UC-08 Simuler un *what-if*, UC-13 Consulter le backtesting | non | oui | non |
| UC-11 Santé des données, UC-12 Transparence du modèle | oui | oui | non |
| UC-02 Importer un export AJIR, UC-17 Demander un recalcul | oui | scoring d'un mois seulement | non |
| UC-14 Comptes, UC-15 Paramètres, UC-16 Journal d'audit | oui | non | non |
| UC-18 Cycle de vie du modèle | exploitant, en ligne de commande | non | non |

Trois cas structurent le produit ; nous les résumons ici.

**UC-02 — Importer un export AJIR avec contrôle de qualité.** L'administrateur dépose les fichiers CSV, ou l'exploitant lance l'import en ligne de commande. Le système valide chaque ligne, applique 24 contrôles, écrit les lignes valides, conserve les rejets motivés et calcule un score de qualité. Sous le seuil (95 % par défaut), le lot est « bloqué » : une alerte Données est créée et tout calcul de score est refusé jusqu'à un import conforme.

**UC-03 — Exécuter le calcul mensuel.** Le 10 de chaque mois à 2 h (heure de Tunis), le worker met en file le calcul du dernier mois complet. Il rafraîchit les agrégats, calcule les variables, score, publie d'un coup, crée les recommandations et les alertes, puis détecte les anomalies d'absentéisme. Si le calcul échoue, l'interface reste sur le calcul précédent.

**UC-05 — Consulter une fiche collaborateur.** La fiche présente trois zones : les **observations** (faits datés, dont la fin de CDD prévue), l'**estimation** (niveau, probabilité ou score à règles, facteurs, historique) et les **suggestions** (recommandations). Le contenu dépend du rôle. Toute consultation est journalisée, et une tentative hors périmètre renvoie 403 et est tracée.

## 4.4 Besoins fonctionnels

Les besoins fonctionnels sont regroupés selon les huit modules *Must* du cahier des charges (tableau 4.3). Les besoins *Should* sont listés à la section 4.6.

*Tableau 4.3 — Besoins fonctionnels par module.*

| Réf. | Module | Besoin |
|---|---|---|
| BF-1.1 | M1 Données et intégration | Importer l'export CSV AJIR (11 fichiers, contrat fixé) de façon idempotente |
| BF-1.2 | M1 | Appliquer des contrôles de qualité (matricule unique, dates cohérentes, salaire ≥ SMIG, doublons de pointage, hiérarchie sans cycle, etc.) et motiver chaque rejet |
| BF-1.3 | M1 | Calculer un score de qualité et bloquer le calcul des scores sous un seuil réglable |
| BF-1.4 | M1 | Présenter un écran « Santé des données » : lots, score par fichier, règles déclenchées, lignes rejetées |
| BF-1.5 | M1 | Synchroniser les comptes, les rôles et la hiérarchie depuis AJIR ; activer les comptes par un lien à usage unique |
| BF-1.6 | M1 | Construire le calendrier tunisien (fériés, Ramadan, séance unique, ponts) |
| BF-2.1 | M2 Simulateur RH | Générer une population fictive au format de l'export AJIR, avec causes de départ connues, anomalies et défauts de qualité injectés et étiquetés |
| BF-3.1 | M3 Accès, sécurité, audit | Connexion, déconnexion, sessions révocables, verrouillage progressif |
| BF-3.2 | M3 | Contrôle d'accès à trois rôles et périmètre hiérarchique appliqués côté serveur |
| BF-3.3 | M3 | Journal d'audit en ajout seul des écritures et des lectures sensibles (fiche, score, salaire, export, what-if, paramètres) |
| BF-3.4 | M3 | Administration des utilisateurs et des paramètres |
| BF-3.5 | M3 | Export audité des données d'un salarié (droit d'accès) |
| BF-4.1 | M4 Tableau de bord | Effectif, entrées et sorties, turnover glissant sur 12 mois (total et volontaire), absentéisme hors maladie, formations, masse salariale (RH), nombre de salariés à risque élevé par département |
| BF-4.2 | M4 | Filtres (période, département, contrat, âge, ancienneté, niveau) et navigation indicateur → liste → fiche |
| BF-5.1 | M5 Moteur de prédiction | Calculer les variables en TypeScript à la date de coupure, avec la règle de visibilité à la date de saisie |
| BF-5.2 | M5 | Scorer chaque mois avec le modèle champion ; se replier sur le score à règles B0 en l'absence de modèle validé |
| BF-5.3 | M5 | Gérer des bundles de modèles versionnés et vérifiés (enregistrer, vérifier, promouvoir, revenir en arrière) |
| BF-6.1 | M6 Fiche collaborateur | Afficher trois zones : observations datées, estimation (niveau, version, limites), suggestions reliées aux facteurs |
| BF-7.1 | M7 Alertes et recommandations | Quatre types d'alertes (turnover, absentéisme, données, système), dédoublonnées, routées par rôle |
| BF-7.2 | M7 | Cycle de vie des alertes : Nouvelle → En cours → Traitée ou Rejetée, avec commentaire |
| BF-7.3 | M7 | Recommandations déclenchées par un groupe de facteurs actionnable du top 3 ; une recommandation réalisée crée une action RH datée (intervention) |
| BF-8.1 | M8 Absentéisme | Détecter les dérives collectives (équipe, département) corrigées du calendrier tunisien |
| BF-8.2 | M8 | Signal individuel réservé à la RH, formulé « à vérifier » |

## 4.5 Besoins non fonctionnels

Le cahier des charges remplace les critères qualitatifs du sujet initial par des critères chiffrés (tableau 4.4). La colonne « Vérification » indique comment chaque critère est contrôlé ; les résultats figurent au chapitre 8 et, pour le modèle, au chapitre 7.

*Tableau 4.4 — Besoins non fonctionnels et critères d'acceptation.*

| Réf. | Domaine | Critère | Vérification |
|---|---|---|---|
| BNF-1 | Autorisation | 100 % des routes privées testées : 401 sans session, 403 hors périmètre, 404 si la ressource est absente | Tests automatisés par route |
| BNF-2 | Confidentialité | Aucune donnée salariale ni probabilité dans les réponses destinées au manager (API, HTML, payload des Server Components) | Parcours récursif des DTO et du rendu dans les tests |
| BNF-3 | Performance | Tableau de bord : p95 < 500 ms sur 2 500 salariés, 20 utilisateurs simultanés | Test de charge |
| BNF-4 | Performance | Calcul mensuel complet (import → publication) < 15 min | Mesure chronométrée |
| BNF-5 | Robustesse | Worker interrompu en plein calcul : l'interface reste sur le calcul précédent, puis le job reprend | Test d'arrêt du worker |
| BNF-6 | Exploitation | Restauration d'une sauvegarde < 5 min | Test de restauration |
| BNF-7 | Qualité du code | Couverture de tests ≥ 70 % sur les variables, l'accès aux données et le scoring ; aucune alerte haute au scan OWASP ZAP | Rapport de couverture, scan de sécurité |
| BNF-8 | Sécurité | Contrôles OWASP ASVS niveau 1 : sessions opaques révocables, argon2id, verrouillage progressif, CSRF, en-têtes de sécurité, validation de toutes les entrées, erreurs sans fuite d'information, audit en ajout seul, secrets hors dépôt | Revue et tests de sécurité |
| BNF-9 | Modèle | Le modèle bat B0 en AUC à 6 mois (l'intervalle de confiance de la différence exclut 0) | Protocole temporel (chapitre 7) |
| BNF-10 | Modèle | Calibration : ratio observé/prévu à 6 mois entre 0,8 et 1,25 | Idem |
| BNF-11 | Modèle | Utilité : lift ≥ 3 à la capacité RH par défaut | Idem |
| BNF-12 | Modèle | Fidélité TypeScript ↔ Python : écart < 10⁻⁶ sur 100 % du jeu golden (seuil appliqué dans le code : 10⁻⁹) | Contrôle golden à l'enregistrement, à la promotion et au chargement |
| BNF-13 | Modèle | Anti-fuite : ajouter des données saisies après la date de calcul ne modifie aucune variable | Test par propriétés (fast-check) |
| BNF-14 | Utilisabilité | Test scénarisé de 6 tâches avec des RH de clients AJIR : ≥ 80 % de réussite ; score SUS indicatif | Test utilisateur |
| BNF-15 | Utilisabilité | Une couleur de risque toujours accompagnée d'un libellé ; états chargement, vide et erreur sur chaque écran | Revue d'interface, audit d'accessibilité |
| BNF-16 | Exploitation | Fonctionnement sur un seul serveur, sans Internet, sans Python ni Docker ; sauvegarde quotidienne à chaud, rétention 30 jours | Guide d'installation, scripts de sauvegarde |

## 4.6 Priorisation MoSCoW

La méthode MoSCoW classe les exigences en *Must* (indispensable), *Should* (important si le planning le permet), *Could* (souhaitable) et *Won't* (exclu, assumé). Le cahier des charges plafonne les *Must* pour que le projet soit complet avec eux seuls (tableau 4.5).

*Tableau 4.5 — Priorisation MoSCoW (cahier des charges v2, section 4).*

| Priorité | Contenu |
|---|---|
| **Must** | M1 Données et intégration AJIR ; M2 Simulateur RH (≈ 2 500 salariés, 8 départements, 8 ans) ; M3 Accès, sécurité, audit ; M4 Tableau de bord exécutif ; M5 Moteur de prédiction ; M6 Fiche collaborateur augmentée ; M7 Alertes et recommandations ; M8 Absentéisme |
| **Should** | What-if RH (« +8 % de salaire, −10 h sup/mois » → nouvelle estimation, coût annuel en TND, mention « estimation non causale ») ; backtesting (« à telle date, le modèle aurait signalé X des Y démissions, N mois à l'avance ») ; page Transparence (fiche du modèle, métriques, calibration, rapport d'équité, suivi prévu/observé) ; ouverture depuis AJIR par jeton signé ; retour « pertinente / non pertinente » sur les recommandations |
| **Could** | LightGBM en production pour les gros clients ; horizons 3 et 12 mois ; prévision de l'absentéisme ; export PDF de la fiche ; interface en arabe ; chiffrement SQLCipher |
| **Won't** | Voir section 4.7 |

## 4.7 Hors périmètre (*Won't*)

Les exclusions suivantes sont assumées et motivées :

- **aucune décision automatisée**, aucune proposition automatique de salaire : le module est une aide à la décision, l'humain reste dans la boucle ;
- **aucune détection de fraude** : les signaux d'absentéisme individuels sont formulés « à vérifier » et réservés à la RH ;
- **aucune création ni modification** des salariés ou de la paie : AJIR reste la source de vérité ;
- **pas d'assistant conversationnel** (LLM), pas d'application mobile, pas de temps réel, pas de multi-entreprise (*multi-tenant*) ;
- **pas de second backend ni de Python en production** : la stack d'exploitation reste Node.js et SQLite ;
- pas de modèle de Cox, de forêt de survie ni d'apprentissage profond : trop peu de données chez un client, explicabilité faible, pas d'exécution simple en TypeScript.

## 4.8 Conclusion

Les besoins sont désormais identifiés, attribués à des acteurs et, pour les besoins non fonctionnels, chiffrés. Deux exigences traversent toutes les autres et orientent la conception du chapitre suivant. La première est l'**autorisation côté serveur** : un manager ne doit jamais recevoir une donnée qu'il n'a pas le droit de voir, même non affichée. La seconde est la **fiabilité temporelle** : une donnée n'est utilisée qu'à partir de sa date de saisie.
