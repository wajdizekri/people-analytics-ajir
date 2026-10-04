# Procédure d'exercice des droits : accès, opposition, rectification

Procédure type pour le service RH de l'entreprise cliente, fondée sur l'écran **Droits des personnes** du module (`/confidentialite`, menu « Droit d'accès », rôle RH seulement). Elle participe à l'**analyse de conformité** du traitement à la loi organique n° 2004-63 (art. 32 à 42) ; elle est à adapter à l'organisation du client.

## 1. Principes

- **Qui instruit** : le service RH désigné dans la [note d'information](note-information.md). Le manager et l'administrateur de l'outil n'ont pas accès à l'écran (refus 403, tracé dans le journal d'audit).
- **Réception** : toute demande, écrite ou orale, est enregistrée dans l'outil **le jour de sa réception**, avec la date et le mode de réception dans la note.
- **Identité** : vérifier que le demandeur est bien le salarié concerné (ou son représentant mandaté) avant toute remise de données.
- **Délai** : un mois pour répondre (art. 38). L'outil calcule l'échéance, signale les demandes « Hors délai » et les compte sur le tableau de l'écran.
- **Traçabilité** : chaque opération est inscrite dans le journal d'audit, en ajout seul :

| Action tracée | Déclencheur |
|---|---|
| `privacy.view` | Ouverture du dossier d'un salarié dans l'écran |
| `privacy.request.create` | Enregistrement d'une demande |
| `privacy.request.close` | Clôture (traitée ou refusée) |
| `privacy.opposition.record` | Opposition enregistrée, avec le nombre d'éléments supprimés |
| `privacy.opposition.lift` | Levée (retrait du salarié ou refus motivé) |
| `privacy.export` | Téléchargement de la copie d'accès (ou refus) |
| `whatif.run` avec `reason: opposition` | Simulation refusée pour un salarié opposé |

- **Source de vérité** : AJIR. Le module ne modifie jamais une donnée source ; il en importe une copie.

## 2. Enregistrer une demande

1. Ouvrir **Droits des personnes**, rechercher le salarié par matricule ou par nom (salariés actifs et sortis).
2. Dans « Nouvelle demande », choisir le type : **Accès**, **Opposition au traitement prédictif** ou **Rectification**.
3. Noter la date et le mode de réception, le motif invoqué, et pour une rectification la donnée contestée et la valeur attendue (obligatoire).
4. Enregistrer. La demande apparaît dans l'historique du salarié et dans le **registre des demandes** (filtrable par statut et par type).

## 3. Droit d'accès (art. 32)

1. Enregistrer la demande d'accès (section 2).
2. Dans l'historique du salarié, sur la demande, cliquer **Télécharger (CSV zippé)** ou **Télécharger (JSON)**, puis confirmer. Le téléchargement passe par une route authentifiée, réservée à la RH, liée à cette demande d'accès, et il est tracé (`privacy.export`, format, nombre de lignes par rubrique, adresse du poste).
3. Contenu de la copie, lisible et commentée (fichier `LISEZMOI.txt`) : identité et poste ; contrats ; sortie ; événements de carrière ; paie ; pointages ; absences et totaux par catégorie ; formations ; évaluations ; variables calculées ; estimations du risque de départ ; facteurs associés ; recommandations ; interventions ; alertes le concernant ; risques de formation et recommandations thématiques individuelles ; signaux d'absentéisme ; compte applicatif (sans mot de passe) ; demandes d'exercice des droits ; état de l'opposition ; **journal des accès** le visant, avec le rôle de l'auteur (RH, manager, système) mais sans identifiant ni adresse IP des agents. Le CSV est en UTF-8 avec séparateur « ; » (ouvrable dans Excel) ; les cellules commençant par `=`, `+`, `-` ou `@` sont neutralisées.
4. Remettre la copie **au seul salarié**, en main propre ou par un canal sûr ; ne pas en conserver de copie (le fichier contient la rémunération et les catégories d'absence, santé comprise).
5. Clôturer la demande « Traitée (copie remise) », en notant la date de remise.

Refus possible seulement pour une demande manifestement abusive ou d'un tiers non mandaté : clôturer « Refusée » avec le motif (obligatoire), à communiquer par écrit. L'export n'est plus possible sur une demande refusée.

## 4. Droit d'opposition (art. 42)

L'article 42 prévoit que « l'opposition suspend immédiatement le traitement ». L'outil applique donc la suspension **dès l'enregistrement** de la demande, avant son instruction :

1. Enregistrer une demande de type **Opposition** et confirmer.
2. Effets immédiats et tracés :
   - le salarié est inscrit comme opposé (mention « Opposition au traitement prédictif » dans l'écran et, pour la RH, sur sa fiche) ;
   - ses estimations, facteurs et variables calculées sont supprimés, ainsi que ses recommandations encore proposées, ses alertes de risque de départ, ses risques individuels de formation et ses recommandations thématiques individuelles ouvertes ; les recommandations déjà réalisées ou rejetées (décisions RH) sont conservées ;
   - aux calculs suivants, il n'est plus scoré (ni prédiction ni facteur), aucune recommandation individuelle ni alerte de risque ne le concerne, et la simulation what-if est refusée (409, tracée) ;
   - le manager ne voit que l'absence d'estimation, sans en connaître la raison.
3. Instruire la demande :
   - motif légitime, ou pas de raison de s'y opposer : clôturer **Traitée (opposition maintenue)** ;
   - absence de motif légitime (ou traitement imposé par la loi) : clôturer **Refusée** avec le motif, à notifier par écrit au salarié avec la mention de la possibilité de saisir l'INPDP. Le refus lève la suspension : le salarié est de nouveau évalué au calcul suivant.
4. **Retrait** par le salarié : bouton **Lever l'opposition**, avec l'origine de la levée (obligatoire). Une demande d'opposition « Traitée » est ajoutée au registre pour la trace ; le salarié est de nouveau évalué au calcul suivant. Rien de ce qui a été supprimé n'est restauré.

Limite connue : l'extraction du panel d'entraînement (`scripts/export-panel.ts`) et le recalcul des variables historiques ne tiennent pas encore compte de l'opposition. Avant tout réentraînement, exécuter `scripts/retention.ts --apply`, qui supprime les variables résiduelles des salariés opposés, et vérifier l'extraction avec le consultant.

## 5. Droit de rectification

1. Enregistrer une demande de type **Rectification** en décrivant la donnée contestée et la valeur attendue.
2. Faire la correction **dans AJIR**, qui reste la source de vérité ; elle est reprise dans le module au prochain import mensuel, puis dans les variables et estimations du calcul suivant.
3. Clôturer la demande « Traitée (corrigée dans AJIR) » avec la date de correction, ou « Refusée » avec le motif si la donnée est exacte.
4. Une estimation déjà publiée n'est pas recalculée rétroactivement ; si la donnée corrigée pèse sur l'estimation en cours, la RH peut demander un recalcul du mois (écran Santé des données).

## 6. Conservation et archivage du journal d'audit

### 6.1 Purges

Le script `scripts/retention.ts` applique les durées de conservation. Il fonctionne **en simulation par défaut** : il affiche ce qui serait purgé, sans rien modifier.

```powershell
npx tsx scripts/retention.ts                       # simulation
npx tsx scripts/retention.ts --apply               # application, tracée retention.apply
npx tsx scripts/retention.ts --inbox-days 60 --predictions-months 24 --apply
```

Il purge : les sessions expirées ; les prédictions, facteurs et risques de formation plus anciens que la durée (24 mois par défaut), **sauf le calcul publié en cours** ; les exports AJIR déposés dans `data/inbox` au-delà de la durée (90 jours par défaut), sauf un import en file ou en cours ; les données prédictives résiduelles des salariés opposés. Durées : option de la ligne de commande, sinon variables `RETENTION_INBOX_DAYS` et `RETENTION_PREDICTION_MONTHS` (fichier `.env`), sinon paramètres `retention_inbox_days` et `retention_prediction_months`, sinon valeurs par défaut. À planifier chaque mois après le batch, par une tâche planifiée Windows analogue à la sauvegarde ([EXPLOITATION.md](../EXPLOITATION.md)). Les exports déposés hors de `data/inbox` (par exemple `C:\PeopleAnalytics\imports\`) restent à purger selon la commande de la section 7 d'EXPLOITATION.md.

### 6.2 Archivage du journal d'audit

Le journal d'audit n'est **jamais supprimé** : la base l'interdit (triggers d'ajout seul) et il constitue la traçabilité exigée par l'article 19. Le script indique chaque mois le nombre d'entrées de plus de 12 mois. Au-delà, elles sont **archivées**, pas supprimées :

1. Une fois par an, à partir de la dernière sauvegarde vérifiée (`scripts/backup.ts`, contrôle d'intégrité et empreinte sha256), extraire les entrées de l'année écoulée en JSON :
   ```powershell
   node -e "const D=require('better-sqlite3');const db=new D(process.argv[1],{readonly:true});console.log(JSON.stringify(db.prepare('SELECT * FROM audit_log WHERE at < ? ORDER BY id').all(process.argv[2])))" C:\PeopleAnalytics\backups\<sauvegarde>\app.db 2025-10-01 > audit-2025.json
   ```
2. Chiffrer l'extraction (archive AES-256, par exemple `7z a -p -mhe=on audit-2025.7z audit-2025.json`), mot de passe remis au responsable du traitement et conservé séparément ; calculer et noter l'empreinte sha256 de l'archive ; supprimer le JSON en clair.
3. Conserver l'archive **hors ligne** (support amovible sous clé, coffre), en deux exemplaires, pour la durée fixée par le client ; consigner la date, l'empreinte et le lieu de conservation dans le registre des traitements.
4. Les entrées restent aussi dans la base : l'archivage garantit leur conservation hors du serveur, il ne réduit pas le journal en ligne.

## 7. Cas particuliers

- **Salarié sorti** : mêmes droits ; il est retrouvé par la recherche (badge « Sorti »).
- **Demande pour le compte d'autrui** : exiger un mandat écrit ; sinon, refuser avec motif.
- **Demandes répétées** : chaque demande est enregistrée ; un refus pour abus doit être motivé.
- **Représentants du personnel** : bilan annuel à partir du registre (nombre de demandes par type, délais, oppositions en vigueur).
