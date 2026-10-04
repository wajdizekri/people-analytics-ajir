# Charte UI — clarté des boutons, des textes et des visuels

Objectif : un RH non spécialiste comprend chaque écran en 5 secondes, sait quoi faire ensuite, et lit chaque graphique sans aide. Complète [CLARTE.md](CLARTE.md) (vocabulaire) et [ERGONOMIE.md](ERGONOMIE.md) (parcours).

## 1. Structure d'un écran (toujours dans cet ordre)
1. **Titre** (nom de l'écran) + **une phrase** qui dit à quoi il sert et pour quel périmètre (« Votre équipe — 9 collaborateurs, données au 31/08/2026 »).
2. **Actions principales** en haut à droite (au plus 2 boutons visibles, le reste dans « Plus d'actions »).
3. **Filtres** sur une seule ligne, repliables sur mobile, avec les filtres actifs affichés en puces retirables.
4. **Indicateurs clés** (3 à 5 cartes maximum par ligne).
5. **Visuels** qui expliquent les indicateurs.
6. **Détail** (tableaux, listes).
Pas plus de 2 niveaux de titres sous le titre de page. Pas de bloc de texte de plus de 3 lignes : au-delà, lien « En savoir plus » vers /aide.

## 2. Boutons
- **Libellé = verbe à l'infinitif + objet** : « Enregistrer les paramètres », « Importer un export AJIR », « Marquer comme réalisée ». Jamais « OK », « Valider », « Soumettre », « Go ».
- **Hiérarchie** : un seul bouton **primaire** (plein, bleu ArabSoft) par zone ; **secondaire** (contour) pour les alternatives ; **tertiaire** (lien) pour « Annuler », « Voir le détail » ; **destructif** (rouge) uniquement pour supprimer, rejeter, désactiver, toujours avec confirmation qui rappelle la conséquence.
- **Icône + texte** pour les actions fréquentes (icône seule interdite sauf menu/fermer, avec libellé accessible).
- **États** : survol, focus visible, désactivé (avec la raison en infobulle ou texte), en cours (« Enregistrement… » + bouton désactivé), succès (message vert annoncé, 4 s ou persistant si important).
- Zone cliquable ≥ 40 px de haut ; pas deux boutons primaires côte à côte ; les boutons d'un formulaire en bas à droite, primaire à droite.

## 3. Textes
- Phrases courtes (≤ 20 mots), voix active, tutoiement interdit (vouvoiement), aucun sigle non expliqué (CDD, SIVP, KPI → infobulle ou glossaire).
- **Toujours dire le périmètre et la période** : « sur 12 mois glissants », « au 31/08/2026 », « équipe de S. Zribi ».
- **Chiffres** : format français (1 234,5 ; 12,4 % ; 1 717 368 TND), arrondis utiles (pas plus d'une décimale pour un pourcentage), unité toujours écrite.
- Statuts et niveaux en mots, jamais en code (« Risque élevé », pas « ELEVE »).
- Messages d'erreur : ce qui s'est passé + comment corriger (« Le fichier employees.csv est manquant. Ajoutez-le à l'export puis relancez l'import. »).
- États vides : quoi + pourquoi + action (« Aucune alerte nouvelle. Les alertes apparaissent après le calcul mensuel. »).

## 4. Indicateurs (cartes KPI)
- Libellé clair (ce qui est compté) + valeur en grand + unité + période.
- Variation : flèche **et** texte (« +1,2 pt vs mois précédent ») **et** couleur ; préciser si la hausse est favorable ou non (« en hausse — à surveiller »), pour ne pas dépendre de la couleur.
- Comparaison de référence explicite (mois précédent, même mois N-1, moyenne entreprise).
- Lien « Voir le détail » sur la carte si un drill-down existe.
- Une infobulle « ? » avec la définition et la formule en mots.

## 5. Visuels (graphiques)
- **Titre = le message** (« L'absentéisme baisse depuis mars »), sous-titre = mesure, unité, périmètre, période.
- **Choix du graphique** : évolution → courbe ; comparaison entre catégories → barres horizontales triées ; part d'un tout (≤ 4 parts) → barre empilée 100 % ou donut ; distribution → histogramme ; jamais de 3D ni de camembert > 4 parts.
- **Axes nommés avec unité**, graduations lisibles, axe Y qui commence à 0 pour les barres.
- **Couleurs** : au plus 5 ; sémantique fixe — rouge = risque élevé / défavorable, ambre = moyen / à surveiller, vert = faible / favorable, bleu ArabSoft = valeur neutre principale, gris = référence (moyenne, N-1, prévision). Mettre en valeur la donnée importante, griser le reste.
- **Légende** en haut ou en bas, dans l'ordre des séries ; légende directe en bout de courbe si ≤ 3 séries.
- **Valeurs affichées** sur les barres quand il y en a ≤ 12 ; **lignes de référence** annotées (moyenne, seuil, capacité RH).
- **Incertitude** (prévisions) : bande claire + texte « fourchette probable à 80 % ».
- Infobulles au format français, avec unité et période.
- Alternative accessible : tableau de données repliable « Voir les données ».
- Sur mobile : hauteur réduite, légende en bas, pas de débordement horizontal.

## 6. Tableaux
- ≤ 7 colonnes visibles ; nombres alignés à droite ; en-têtes explicites avec unité ; tri annoncé ; ligne cliquable vers le détail quand c'est le cas (avec un lien réel) ; badges de niveau avec texte ; pagination « 1–25 sur 987 ».

## 7. Vérification visuelle
- Serveur partagé : `http://localhost:3000` (déjà lancé, rechargement à chaud). Ne pas lancer d'autre serveur.
- Captures : script Playwright à soi (Chromium headless, déjà installé), connexion avec les comptes de docs/DEMO.md, captures 1440 px et 390 px dans `docs/qa/captures/<domaine>/avant|apres/`. Un seul navigateur à la fois, fermé aussitôt (mémoire du poste limitée).
