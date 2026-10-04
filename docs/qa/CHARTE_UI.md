# Charte UI — clarté des boutons, des textes et des visuels

Objectif : un RH non spécialiste comprend chaque écran en 5 secondes, sait quoi faire ensuite, et lit chaque graphique sans aide. Complète [CLARTE.md](CLARTE.md) (vocabulaire) et [ERGONOMIE.md](ERGONOMIE.md) (parcours).

## 0. Règle « titres seuls » (vague du 04/10/2026)
L'écran ne montre pas de phrases : **titres, libellés, valeurs, légendes, axes, en-têtes de tableau, boutons**.
- **Titre** (écran, section, carte, visuel) = groupe nominal de 2 à 6 mots qui nomme le contenu, unité entre parenthèses si utile : « Effectif fin de mois », « Turnover sur 12 mois (%) », « Absentéisme par département (%) ». Jamais de titre-message ni de phrase (« L'effectif recule de 9 personnes… »).
- **Retirés de l'écran** : sous-titres explicatifs, paragraphes d'introduction, notes sous les visuels, encarts « À quoi sert cette page ».
- **Détail utile** : dans la bulle « ? » (InfoTip / TermTip), fermée par défaut, jamais en clair. Les composants communs le font seuls : `subtitle`, `measure`/`unit`/`scope`/`period` et `footnote` de VisualCard, `subtitle` de PageHeader, `description` de SectionHeader et Card, `period` et `hint` de KpiCard et KpiTile, `children` d'EmptyState (voir [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) § 5).
- **Mentions obligatoires** (éthique, confidentialité) : badge court (« Estimation non causale », « Prévision indicative », « Données anonymisées ») via `badge` de PageHeader ou de VisualCard.
- **Restent écrits** : messages d'erreur, états vides réduits à un titre et une action, confirmations nécessaires (boîte de dialogue).

## 1. Structure d'un écran (toujours dans cet ordre)
1. **Titre** (nom de l'écran) + bulle « ? » (à quoi sert l'écran) + ligne courte périmètre · période (« Votre équipe — 9 collaborateurs », « au 31/08/2026 »).
2. **Actions principales** en haut à droite (au plus 2 boutons visibles, le reste dans « Plus d'actions »).
3. **Filtres** sur une seule ligne, repliables sur mobile, avec les filtres actifs affichés en puces retirables.
4. **Indicateurs clés** (3 à 5 cartes maximum par ligne).
5. **Visuels** qui expliquent les indicateurs.
6. **Détail** (tableaux, listes).
Pas plus de 2 niveaux de titres sous le titre de page. Pas de paragraphe : un lien discret « Aide » vers la rubrique de /aide (PageIntro) suffit.

## 2. Boutons
- **Libellé = verbe à l'infinitif + objet** : « Enregistrer les paramètres », « Importer un export AJIR », « Marquer comme réalisée ». Jamais « OK », « Valider », « Soumettre », « Go ».
- **Hiérarchie** : un seul bouton **primaire** (plein, bleu ArabSoft) par zone ; **secondaire** (contour) pour les alternatives ; **tertiaire** (lien) pour « Annuler », « Voir le détail » ; **destructif** (rouge) uniquement pour supprimer, rejeter, désactiver, toujours avec confirmation qui rappelle la conséquence.
- **Icône + texte** pour les actions fréquentes (icône seule interdite sauf menu/fermer, avec libellé accessible).
- **États** : survol, focus visible, désactivé (avec la raison en infobulle ou texte), en cours (« Enregistrement… » + bouton désactivé), succès (message vert annoncé, 4 s ou persistant si important).
- Zone cliquable ≥ 40 px de haut ; pas deux boutons primaires côte à côte ; les boutons d'un formulaire en bas à droite, primaire à droite.

## 3. Textes
- À l'écran, des groupes nominaux et des libellés ; les phrases (≤ 20 mots, voix active, vouvoiement) vivent dans les bulles « ? », les messages et /aide. Aucun sigle non expliqué (CDD, SIVP, KPI → bulle ou glossaire).
- **Périmètre et période toujours accessibles** : ligne courte sous le titre de page, bulle « ? » des cartes et des visuels.
- **Chiffres** : format français (1 234,5 ; 12,4 % ; 1 717 368 TND), arrondis utiles (pas plus d'une décimale pour un pourcentage), unité toujours écrite.
- Statuts et niveaux en mots, jamais en code (« Risque élevé », pas « ELEVE »).
- Messages d'erreur : ce qui s'est passé + comment corriger, en peu de mots (« Fichier employees.csv manquant. Ajoutez-le puis relancez l'import. »).
- États vides : titre + action (« Aucune alerte nouvelle » + « Voir toutes les alertes ») ; le pourquoi dans la bulle « ? ».

## 4. Indicateurs (cartes KPI)
- Visibles : libellé (ce qui est compté) + valeur en grand + unité + variation ; statut, tendance et lien « Voir le détail » si utiles.
- Variation : flèche **et** texte (« +1,2 pt vs mois précédent ») **et** couleur ; préciser si la hausse est favorable ou non (« en hausse — à surveiller »), pour ne pas dépendre de la couleur.
- Comparaison de référence explicite (mois précédent, même mois N-1, moyenne entreprise).
- Bulle « ? » : définition et formule en mots, période, précision ou motif d'absence de valeur.

## 5. Visuels (graphiques)
- **Titre seul** = groupe nominal qui nomme le contenu (« Absentéisme mensuel (%) », « Effectif par département ») ; mesure, unité, périmètre, période et note dans la bulle « ? » après le titre. Le titre nomme le visuel pour les lecteurs d'écran.
- **Choix du graphique** : évolution → courbe ; comparaison entre catégories → barres horizontales triées ; part d'un tout (≤ 4 parts) → barre empilée 100 % ou donut ; distribution → histogramme ; jamais de 3D ni de camembert > 4 parts.
- **Axes nommés avec unité**, graduations lisibles, axe Y qui commence à 0 pour les barres.
- **Couleurs** : au plus 5 ; sémantique fixe — rouge = risque élevé / défavorable, ambre = moyen / à surveiller, vert = faible / favorable, bleu ArabSoft = valeur neutre principale, gris = référence (moyenne, N-1, prévision). Mettre en valeur la donnée importante, griser le reste.
- **Légende** en haut ou en bas, dans l'ordre des séries ; légende directe en bout de courbe si ≤ 3 séries.
- **Valeurs affichées** sur les barres quand il y en a ≤ 12 ; **lignes de référence** annotées (moyenne, seuil, capacité RH).
- **Incertitude** (prévisions) : bande claire + badge « Prévision indicative » ; « fourchette probable à 80 % » dans la légende ou la bulle.
- Infobulles au format français, avec unité et période.
- Alternative accessible : tableau de données repliable « Voir les données ».
- Sur mobile : hauteur réduite, légende en bas, pas de débordement horizontal.

## 6. Tableaux
- ≤ 7 colonnes visibles ; nombres alignés à droite ; en-têtes explicites avec unité ; tri annoncé ; ligne cliquable vers le détail quand c'est le cas (avec un lien réel) ; badges de niveau avec texte ; pagination « 1–25 sur 987 ».

## 7. Vérification visuelle
- Serveur partagé : `http://localhost:3000` (déjà lancé, rechargement à chaud). Ne pas lancer d'autre serveur.
- Captures : script Playwright à soi (Chromium headless, déjà installé), connexion avec les comptes de docs/DEMO.md, captures 1440 px et 390 px dans `docs/qa/captures/<domaine>/avant|apres/`. Un seul navigateur à la fois, fermé aussitôt (mémoire du poste limitée).
