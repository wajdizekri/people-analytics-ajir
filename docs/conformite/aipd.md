# Analyse d'impact relative à la protection des données (AIPD simplifiée)

Module People Analytics & Predictive Turnover du progiciel RH AJIR. Version 1 du 30/09/2026, à relire et à compléter par le responsable du traitement (l'entreprise cliente) et son juriste ou délégué à la protection des données.

Ce document est une **analyse de conformité** : il décrit le traitement, en évalue la nécessité et la proportionnalité, identifie les risques pour les salariés et les mesures qui les réduisent. Il ne constitue pas un avis juridique et ne délivre aucun label au logiciel : la conformité s'apprécie pour un traitement mis en œuvre par un responsable dans un contexte donné, pas pour un logiciel.

Référentiels : loi organique tunisienne n° 2004-63 du 27 juillet 2004 (texte applicable) ; Convention 108 du Conseil de l'Europe ; RGPD (art. 9, 22, 35, 88) et règlement européen sur l'IA, utilisés comme **référentiels de bonnes pratiques** (voir [chapitre 9 du rapport](../rapport/09-ethique-conformite.md)).

## 1. Contexte

| Élément | Description |
|---|---|
| Responsable du traitement | L'entreprise cliente d'AJIR (raison sociale, adresse, représentant : **à compléter**) |
| Éditeur | ArabSoft : fournit le logiciel ; ne traite pas les données dans une installation sur site ; sous-traitant s'il y accède (réentraînement du modèle par un consultant) |
| Installation | Serveur de l'entreprise (sur site), base SQLite locale, accès HTTPS interne ([docs/EXPLOITATION.md](../EXPLOITATION.md)) |
| Personnes concernées | Salariés en poste et salariés sortis dont l'historique est importé depuis AJIR ; utilisateurs de l'outil (RH, managers, administrateur) |
| Nature | Profilage au sens large : estimation d'un comportement probable (démission dans les 6 mois) à partir de données de gestion RH |
| Pourquoi une AIPD | Évaluation systématique d'aspects personnels de salariés, dans une relation de subordination, avec un modèle statistique : critères de risque élevé du RGPD (art. 35) et de l'annexe III du règlement IA, retenus ici comme référentiels |

## 2. Description du traitement

### 2.1 Finalités

- **Aide à la décision RH en matière de rétention** : repérer, chaque mois, les salariés dont l'exposition au risque de démission est la plus élevée, pour proposer un entretien ou une action favorable (révision salariale, examen de la charge, plan de formation).
- **Suivi collectif de l'absentéisme** et des indicateurs RH (effectifs, turnover, formation, charge), par département et par équipe.
- **Pilotage par le manager** de son équipe, dans les limites de la section 4.

Finalités **exclues** et interdites par conception : décision automatique (aucune action n'est déclenchée sans décision humaine), sanction, évaluation de la performance individuelle, détection de fraude ou d'abus d'absence, proposition automatique de rémunération, reconnaissance des émotions, surveillance de l'activité.

### 2.2 Données

| Catégorie | Données | Source | Utilisation dans les calculs individuels |
|---|---|---|---|
| Identification | Matricule, nom, prénom, compte applicatif | AJIR | Non (identifiants) |
| Caractéristiques personnelles | Sexe, date de naissance, gouvernorat, situation familiale | AJIR | **Non** : exclues des variables ; sexe et âge servent seulement au rapport d'équité agrégé |
| Vie professionnelle | Département, poste, famille de métier, grade, manager, contrats, carrière, sortie | AJIR | Oui (ancienneté, contrat, promotion, mobilité, changement de manager) |
| Rémunération | Salaire de base et brut mensuels, heures supplémentaires payées | AJIR | Oui (position salariale relative, évolution) |
| Temps de travail | Pointages journaliers (arrivée, départ, minutes, retards) | AJIR | Oui (heures supplémentaires, retards, jours sans pointage hors absences justifiées) |
| Absences | Dates, durée, **catégorie** (congé, maladie, maternité, injustifiée, sans solde, autre) | AJIR | Seulement absences injustifiées, sans solde et « autre » ; **maladie et maternité jamais utilisées** ([ADR-009](../adr/009-exclusion-des-donnees-de-sante.md)) |
| Formation et évaluation | Formations, heures, statut, échéances ; note d'évaluation annuelle | AJIR | Oui |
| Données produites | Variables mensuelles, estimation de risque, niveau, facteurs explicatifs, recommandations, alertes, interventions, demandes d'exercice des droits | Module | — |
| Traces | Journal d'audit (consultations de fiche, exports, simulations, décisions, refus d'accès) | Module | Non |

Aucun motif médical n'est importé : la maladie et la maternité ne sont connues que comme catégorie d'absence.

### 2.3 Destinataires

- **RH** : toutes les données et estimations de l'entreprise, simulation what-if, recommandations, droits des personnes.
- **Manager** : sa hiérarchie seulement ; niveau de risque et catégories de facteurs, sans probabilité, sans salaire, sans signal individuel d'absentéisme ; indicateurs d'équipe masqués sous 5 personnes ([ADR-011](../adr/011-gardes-petites-populations-cote-manager.md)).
- **Administrateur** de l'outil : comptes, paramètres, imports, santé des données, modèle ; **aucune donnée RH nominative** ; dans les rejets d'import, seul le matricule reste visible (nécessaire pour corriger la donnée dans AJIR) : montants, valeurs brutes sensibles et, pour les absences, dates, catégories et durées sont masqués (`src/lib/privacy/mask.ts`) ; la RH voit le détail.
- **Consultant de l'éditeur** (sous-traitant), seulement pour un réentraînement du modèle, sur autorisation écrite, à partir d'un panel identifié par un numéro interne ([EXPLOITATION.md, § 9](../EXPLOITATION.md)).
- Aucun transfert hors de Tunisie n'est prévu par le module.

### 2.4 Durées de conservation (proposées, à valider)

| Données | Durée proposée | Outillage |
|---|---|---|
| Données sources importées | Durée fixée par le client pour les salariés sortis (historique nécessaire aux variables et à l'entraînement) | À définir |
| Prédictions, facteurs, risques individuels de formation | 24 mois, sauf calcul publié en cours | `scripts/retention.ts` |
| Exports AJIR déposés (`data/inbox`) | 90 jours | `scripts/retention.ts` |
| Sessions | 10 heures, purge des sessions expirées | `scripts/retention.ts` |
| Sauvegardes | 30 jours | `scripts/backup.ts` |
| Journal d'audit | Jamais supprimé (ajout seul) ; archivage chiffré hors ligne au-delà de 12 mois | [Procédure, § 6](procedure-exercice-des-droits.md#6-conservation-et-archivage-du-journal-daudit) |

## 3. Nécessité et proportionnalité

- **Minimisation** : les variables du modèle sont limitées à 25 indicateurs de gestion (carrière, rémunération relative, temps de travail, absences hors santé, formation et évaluation, contexte d'équipe) ; les caractéristiques personnelles sont exclues ; les vues sont filtrées par rôle en liste blanche côté serveur ([ADR-007](../adr/007-couche-acces-donnees-au-lieu-rls.md)).
- **Capacité humaine** : le niveau « Élevé » est plafonné à la capacité d'entretiens de la RH (2 % par défaut), pour éviter un étiquetage massif ([ADR-006](../adr/006-niveaux-de-risque-par-capacite-rh.md)).
- **Exactitude** : contrôles de qualité à l'import, rejets motivés, blocage du calcul sous le seuil de qualité, visibilité des données à leur date de saisie ([ADR-005](../adr/005-visibilite-as-of-par-date-de-saisie.md)) ; la rectification se fait dans AJIR et se propage au prochain import.
- **Transparence** : page Transparence (modèle, variables, métriques, calibration, équité) ; note d'information aux salariés et aux instances représentatives ([modèle](note-information.md)).
- **Droits** : accès, opposition et rectification outillés dans l'écran « Droits des personnes » ([procédure](procedure-exercice-des-droits.md)).
- **Alternative moins intrusive examinée** : un score à règles (B0) transparent est livré comme référence et comme repli ; il reste un traitement individuel et relève des mêmes mesures.

## 4. Risques pour les personnes et mesures

Échelle : vraisemblance et gravité de 1 (négligeable) à 4 (maximale), estimées **après** mesures.

| # | Risque | Mesures dans le module | Mesures à la charge du client | V | G |
|---|---|---|---|---|---|
| R1 | **Stigmatisation** : un salarié classé « Élevé » écarté d'un projet, d'une formation ou d'une promotion | Manager sans probabilité ni chiffre ; vocabulaire « exposition au risque », « estimation à confirmer » ; actions proposées uniquement favorables ; niveau plafonné | Charte d'usage ; formation des managers ; usage prévu inscrit dans la note d'information | 2 | 3 |
| R2 | **Décision exclusivement automatisée** | Aucune action automatique ; recommandations proposées puis réalisées ou rejetées par la RH, tracées | Interdire l'usage du score dans une décision disciplinaire, de rémunération ou de licenciement | 1 | 4 |
| R3 | **Erreur ou biais du modèle** (faux positifs, écarts par sexe ou âge) | Calibration et backtest publiés ; rapport d'équité ; promotion d'un modèle par un humain ; explication par facteurs | Revoir l'équité sur les données réelles du pilote avant généralisation | 2 | 3 |
| R4 | **Accès illégitime ou fuite** (salaires, catégories d'absence) | Autorisation côté serveur, DTO par rôle, sessions révocables, verrouillage, TLS, audit des lectures sensibles et des refus, sauvegardes vérifiées ; administrateur sans donnée RH ; rejets d'import masqués | Durcissement du serveur, gestion des comptes, revue périodique du journal | 2 | 3 |
| R5 | **Détournement de finalité** (surveillance, évaluation individuelle) | Pas de détection de fraude ni de motif d'absence individuel qualifié ; signal d'absentéisme individuel réservé à la RH et formulé sans présumer de la cause | Déclaration de finalités à l'INPDP ; information des instances représentatives | 2 | 3 |
| R6 | **Traitement de données de santé** | Maladie et maternité réduites à une catégorie et exclues de tout calcul individuel (propriété testée) | Ne jamais importer de motif médical | 1 | 4 |
| R7 | **Conservation excessive** | Purge outillée (prédictions 24 mois, exports déposés 90 jours, sessions) en simulation par défaut | Valider les durées ; planifier `retention.ts --apply` | 2 | 2 |
| R8 | **Droits non effectifs** | Registre des demandes ; export d'accès complet (JSON, CSV zippé) ; opposition appliquée immédiatement au scoring, au what-if, aux recommandations et alertes de risque ; suivi des rectifications ; échéance à un mois signalée | Désigner le service qui instruit les demandes ; vérifier l'identité du demandeur | 1 | 3 |
| R9 | **Copie d'accès remise à un tiers** | Export lié à une demande d'accès enregistrée, confirmation, audit `privacy.export` | Remise en main propre ou par canal sûr ; pas de copie conservée | 2 | 3 |
| R10 | **Réentraînement hors site** (panel de variables) | Panel identifié par un numéro interne, extraction en lecture seule | Autorisation écrite, transfert chiffré, suppression après usage, clause de sous-traitance | 2 | 2 |

## 5. Risques résiduels et plan d'action

Les risques résiduels principaux tiennent à l'**usage** plus qu'au logiciel : stigmatisation (R1), biais sur les données réelles (R3), détournement de finalité (R5). Ils se traitent par l'organisation du client.

Points ouverts identifiés par cette analyse :

1. **Opposition et réentraînement** : l'opposition exclut le salarié du scoring, du what-if, des recommandations et des alertes de risque. L'extraction du panel d'entraînement (`scripts/export-panel.ts`) et le recalcul des variables historiques (`backfillFeatures`) ne l'excluent pas encore ; la purge `retention.ts` supprime les variables résiduelles des salariés opposés. À intégrer avant tout réentraînement.
2. **Déclaration à l'INPDP** (art. 7 et 8) : recommandée par prudence, l'exception de l'article 16 n'étant pas certaine pour une estimation prédictive ; à la charge du client.
3. **Base juridique** : à qualifier par le juriste du client (consentement ou exception légale) ; pas sûr que l'exception de l'article 16 couvre ce traitement.
4. **Information préalable** des salariés et des instances représentatives avant la mise en service ([note type](note-information.md)).
5. **Durées de conservation** à valider, notamment pour les salariés sortis.
6. **Revue d'équité** sur les données du pilote, décision humaine documentée.

## 6. Validation

| Rôle | Nom | Avis | Date |
|---|---|---|---|
| Responsable du traitement | à compléter | | |
| Juriste ou délégué à la protection des données | à compléter | | |
| Représentants du personnel (information) | à compléter | | |
| Responsable sécurité du système d'information | à compléter | | |

L'AIPD est à revoir à chaque changement substantiel : nouveau modèle en production, nouvelle source de données, nouvelle catégorie de destinataires, nouvelle finalité.
