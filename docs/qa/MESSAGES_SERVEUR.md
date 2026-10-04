# Messages produits par le serveur

Date : 01/10/2026. Complète [CHARTE_UI.md](CHARTE_UI.md) § 3 et [CLARTE.md](CLARTE.md). Règle : **ce qui s'est passé + quoi faire**, vouvoiement, périmètre et période, unités écrites, statuts en mots, vocabulaire de CLARTE § 2 (collaborateur, calcul des risques, service de calcul, traitement).

## 1. Règles retenues

- Un message d'erreur finit par une action : « Rechargez la page », « Importez d'abord un export AJIR », « Demandez-le à l'administrateur de l'outil ».
- Les nombres sont au format français (`toLocaleString("fr-FR")`, espace insécable avant « % ») et accordés (« 1 ligne rejetée », « 3 lignes rejetées »).
- Les dates affichées sont au format jj/mm/aaaa, **sauf dans les messages de rejet d'import**. Le masquage administrateur (`src/lib/privacy/mask.ts`) repère les dates ISO et les montants « 123.45 TND » ; changer ce format exposerait des données d'absence ou des montants.
- Un code interne n'est jamais affiché brut. Exemples : NOUVELLE → « Nouvelle » ; IMPORT → « Import » ; AUTRE → « Autre ».
- Un filet de sécurité traduit en français les messages zod par défaut (`z.config(z.locales.fr())` dans `src/lib/dal/errors.ts`). Les champs affichés gardent des messages explicites, listés au § 3.

## 2. Textes revus

### Alertes

| Source | Avant | Après |
|---|---|---|
| Passage au niveau Élevé (manager) | titre « Risque de départ élevé : X » | « Passage au niveau de risque Élevé : X ». Message : estimation parmi les plus fortes de l'entreprise, facteurs associés, puis « Prévoyez un échange pour comprendre sa situation : c'est une estimation, pas une certitude ». |
| Anomalie collective (manager) | « Absentéisme inhabituel dans l'équipe » | « Absentéisme inhabituel : l'équipe de X ». Le message nomme le taux d'absence et finit par « Échangez avec l'équipe pour en comprendre la cause… ». Accord « prises en compte » corrigé. |
| Signal de Bradford (RH) | « salarié », « 12.5 jours », pas de date | Période datée (« sur les 12 mois au 31/08/2026 »), pluriels accordés, explication du facteur, « Signal à vérifier : échangez avec le collaborateur… ou contrôlez la saisie dans AJIR ». |
| Import (RH) | « ligne(s) rejetée(s) », « calcul des scores », « Erreur inconnue. » | Pluriels accordés et séparateur de milliers. Bloqué : « calcul des risques suspendu, faites corriger l'export puis importez-le de nouveau ». Échec : cause, puis action. |
| Service de calcul (administrateur) | « Worker de calcul arrêté », « batch » | « Service de calcul arrêté » ; « calcul mensuel » ; procédure de redémarrage. |
| Traitement en échec ou relancé | « Le traitement IMPORT (x) n° 12 » | « Le traitement « Import » (x) n° 12 » ; action (« consultez Santé des données, corrigez la cause, puis relancez-le »). |
| Calcul des risques | « Échec du scoring », dates ISO | « Échec du calcul des risques », date jj/mm/aaaa, action. |
| Modèle illisible | « Modèle champion refusé… rollback » | « Modèle en service illisible… retour à la version précédente ». |

### Recommandations

- **Absentéisme** :
  - « collaborateurs en poste » (au lieu de « personnes ») ;
  - articles corrects (« dans l'équipe de X », « pour le département Y ») ;
  - élision (« d'avril ») ;
  - majuscule en début de phrase ;
  - « Anticipez » au lieu de « Anticiper » ;
  - action « Construire un plan de prévention… ».
- **Charge de travail** :
  - « heures supplémentaires » écrit en entier, sigle ETP expliqué ;
  - « fourchette probable à 80 % » ;
  - titres « répartissez les tâches ou prévoyez un renfort temporaire » et « proposez un entretien sur la charge ».
- **Formations** : « planifiez », « Réservez », « 12 jours avant l'échéance » (au lieu de « 12 j »), « h par mois ».
- **Effectifs et masse salariale** :
  - nom du département au lieu de son code ;
  - « dans 3 mois » ;
  - « modèle de risque de départ » ;
  - « collaborateurs » ;
  - « par rapport au budget » (au lieu de « vs ») ;
  - « millions de TND ».

### Rejets et contrôles d'import

- Format attendu indiqué (« date invalide pour hire_date : « … » (format attendu AAAA-MM-JJ) »).
- Le fichier en cause est nommé : « absent des collaborateurs importés (employees.csv) », « absent de departments.csv ».
- Fichier obligatoire absent ou en-tête invalide : la cause est suivie de l'action « Corrigez l'export puis relancez l'import ».
- Libellés de règle :
  - « Collaborateur actif sans paie du mois » ;
  - « Sortie sans motif valide (motif « Autre » retenu) » ;
  - « SMIG (salaire minimum légal) » ;
  - « Fin des données avancée de plus de 45 jours » ;
  - « Pointage sans heure de sortie ».
- Volume : nombres au format français, suivis de « vérifiez que l'export est complet ».

### Erreurs d'API et de traitement

| Code | Message |
|---|---|
| 401 NON_AUTHENTIFIE | Session expirée ou absente. Reconnectez-vous pour continuer. |
| 403 INTERDIT | Accès refusé : cette donnée ou cette action ne fait pas partie de votre périmètre. |
| 403 ORIGINE_INVALIDE | Requête refusée : elle ne provient pas de cette application. Rechargez la page puis réessayez. |
| 404 INTROUVABLE | « X introuvable. Rechargez la page ou revenez à la liste. » (« Collaborateur » au lieu de « Salarié »). |
| 400 VALIDATION | Saisie invalide. Corrigez les champs signalés puis réessayez. |
| 400 CORPS_INVALIDE | Requête illisible : données JSON attendues (ou fichiers de l'export). Rechargez la page puis réessayez. |
| 500 ERREUR_INTERNE | Erreur inattendue du serveur. Réessayez dans un instant ; si le problème persiste, signalez-le à l'administrateur de l'outil. |
| 409 TRANSITION_INVALIDE (alerte) | Passage du statut « Nouvelle » au statut « Traitée » impossible. Rechargez la page : l'alerte a peut-être déjà été traitée. |
| 409 SCORING_BLOQUE | … le calcul des risques reste suspendu. Faites corriger l'export dans AJIR, puis importez-le de nouveau. |
| 409 MOIS_NON_COUVERT / MOIS_ANTERIEUR | Dates jj/mm/aaaa, puis action. |
| Traitements | « Aucune donnée importée : … Importez d'abord un export AJIR. » ; « Import n° 12 en échec : … » (au lieu de « lot ») ; « Mois invalide : … (format attendu AAAA-MM) ». |
| Transparence (fichiers du modèle) | « Fichiers du modèle introuvables ou illisibles : les détails de la méthode ne peuvent pas être affichés. Le modèle doit être réenregistré. » |

## 3. Inventaire des messages de validation affichés

| Écran | Champ ou cas | Message |
|---|---|---|
| Connexion | identifiant vide | Saisissez votre identifiant. |
| Connexion | mot de passe vide | Saisissez votre mot de passe. |
| Connexion | échec | Identifiant ou mot de passe incorrect. Vérifiez votre saisie, majuscules comprises, puis réessayez. |
| Connexion | verrou | Compte temporairement verrouillé après plusieurs essais infructueux. Réessayez dans quelques minutes ou demandez à l'administrateur de le déverrouiller. |
| Connexion | limite par poste | Trop de tentatives. Réessayez dans N minutes. |
| Activation | mot de passe vide | Saisissez un nouveau mot de passe. |
| Activation | trop long | Mot de passe trop long : 200 caractères au plus. |
| Activation | confirmation différente | Les deux mots de passe saisis sont différents. Saisissez le même mot de passe dans les deux champs. |
| Activation | politique | Le mot de passe doit contenir au moins 10 caractères. / … des lettres et des chiffres. Règles affichées et cochées en direct sous le champ. |
| Activation | lien | Ce lien d'activation est invalide, expiré ou déjà utilisé. Demandez-en un nouveau à l'administrateur. |
| Mon compte | mot de passe actuel vide, trop long | Saisissez votre mot de passe actuel. / Mot de passe actuel trop long : 200 caractères au plus. |
| Mon compte | confirmation | Les deux mots de passe saisis sont différents : saisissez le même mot de passe dans les deux champs. |
| Utilisateurs | identifiant | Identifiant : 3 à 50 caractères (lettres, chiffres, . _ -). / Cet identifiant est déjà utilisé. Choisissez-en un autre. |
| Utilisateurs | matricule | Matricule trop long : 50 caractères au plus. / Un compte manager doit être lié à un collaborateur : renseignez son matricule. / Aucun collaborateur ne porte ce matricule dans le dernier import AJIR. Vérifiez la saisie. / Ce collaborateur a quitté l'entreprise : un compte manager doit être lié à un collaborateur en poste. |
| Utilisateurs | e-mail | Adresse e-mail invalide : vérifiez la saisie (exemple : prenom.nom@entreprise.tn). / Adresse e-mail trop longue : 200 caractères au plus. |
| Paramètres | nombre | Saisissez un nombre (virgule ou point pour les décimales). / Saisissez un nombre entier, sans décimale. |
| Paramètres | bornes | « Minimum 1 départs : saisissez une valeur plus grande. » / « Maximum 0,2 : saisissez une valeur plus petite. » (unité du paramètre quand il en a une, TND pour les budgets). |
| Paramètres | barème et budgets | Date d'effet invalide (AAAA-MM-JJ). / Deux périodes ont la même date d'effet. / Une même année est saisie deux fois. / Tableau illisible : rechargez la page puis saisissez de nouveau les valeurs. |
| Santé des données | téléversement | Aucun fichier reçu : sélectionnez les fichiers CSV de l'export AJIR. / Trop de fichiers : l'export AJIR en compte N au plus. / Un même fichier est présent deux fois : retirez le doublon puis réessayez. / Fichier non prévu par le contrat d'export : x. / Export trop volumineux : N Mo au plus… |
| Alertes | statut | Choisissez le nouveau statut de l'alerte : En cours, Traitée ou Rejetée. |
| Alertes | commentaire | Commentaire trop long : 1 000 caractères au plus. / Un commentaire est obligatoire pour rejeter une alerte. Expliquez la décision en quelques mots (3 caractères au moins). |
| Recommandations (toutes) | commentaire | Commentaire trop long : 1 000 caractères au plus. / Un commentaire est obligatoire pour rejeter une recommandation : expliquez la décision en quelques mots (3 caractères au moins). |
| Recommandation réalisée | date | Indiquez la date de réalisation de l'action. / Date de réalisation invalide : choisissez une date dans le calendrier. / La date de réalisation ne peut pas être dans le futur : indiquez la date à laquelle l'action a eu lieu. |
| Formations | identifiant, statut | Recommandation non précisée : rechargez la page puis réessayez. / Choisissez le nouveau statut de la recommandation. |
| Droit d'accès | recherche | Saisissez au moins 2 caractères : nom, prénom ou matricule. / Recherche trop longue : 100 caractères au plus. |
| Droit d'accès | demande | Choisissez le type de demande. / Collaborateur non précisé : recherchez-le puis ouvrez son dossier avant d'enregistrer la demande. / Décrivez la donnée à rectifier et la valeur attendue (3 caractères au moins). / Note trop longue : 1 000 caractères au plus. |
| Droit d'accès | clôture, levée | Choisissez l'issue de la demande. / Le motif du refus est obligatoire : indiquez-le en 3 caractères au moins. / Indiquez l'origine de la levée (retrait du collaborateur, date du courrier…), en 3 caractères au moins. |

Les schémas des filtres de pages (`parseQuery` en mode tolérant) n'affichent rien : la clé fautive est ignorée. Leur message, désormais en français, n'apparaît que dans la réponse JSON des routes `/api/*`.

## 4. Restes et points d'attention

- **Données existantes** : les alertes, recommandations et rejets déjà enregistrés gardent leur ancien texte. Exceptions :
  - un recalcul du même mois (`npm run runs -- supersede`) met à jour le message des alertes « niveau Élevé » encore nouvelles ;
  - les recommandations formation, effectifs et charge encore « Proposée » sont réécrites au prochain calcul.
- **Laissé tel quel** :
  - le préfixe « Repris après arrêt du worker » (`src/lib/jobs/index.ts`) : le code le teste (`startsWith`) sur les traitements déjà en base ;
  - les messages de rejet d'import gardent les dates ISO et les montants au format « 123.45 TND » (contrainte du masquage, § 1) ;
  - les libellés de variables de `shared/features.json` (« h/mois », « point(s) »), partagés avec l'entraînement Python.
- **À corriger par leurs propriétaires** :
  - « le salarié » dans `src/app/(app)/confidentialite/actions.ts` et `page.tsx` ;
  - « Authentification requise. » dans `src/proxy.ts`, à aligner sur « Session expirée ou absente. Reconnectez-vous pour continuer. ».
