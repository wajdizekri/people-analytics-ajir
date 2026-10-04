# Intégration avec AJIR : liens du menu et ouverture par jeton signé

Deux points d'entrée permettent d'ouvrir People Analytics depuis AJIR. Les liens profonds (Must) passent par la connexion habituelle ; le jeton signé (Should) évite de ressaisir le mot de passe quand AJIR a déjà authentifié l'utilisateur.

## 1. Liens profonds (menu AJIR)

| Lien | Effet |
|---|---|
| `/go/tableau-de-bord` | Accueil du rôle : `/dashboard` (RH, manager) ou `/admin` (ADMIN, sans données RH). |
| `/go/collaborateur/<matricule>` | Fiche du salarié si l'utilisateur la voit ; sinon page d'erreur. |

Règles de la fiche (contrôle côté serveur, [src/lib/dal/ajir.ts](../src/lib/dal/ajir.ts)) :

- sans session : redirection vers `/login` ;
- matricule inconnu (ou mal formé : `[A-Za-z0-9._-]`, 32 caractères au plus) : **404** ;
- matricule hors du périmètre du manager, ou utilisateur ADMIN : **403**, audité `employee.deeplink` / `REFUSE` ;
- sinon **303** vers `/employees/<id>` ; l'ouverture de la fiche est auditée par la page (`employee.view`).

Le périmètre suit la hiérarchie du dernier import AJIR. Après une connexion manuelle, l'utilisateur arrive sur son accueil et non sur la fiche demandée : la page de connexion ne mémorise pas encore la destination. Le jeton signé (§ 2) n'a pas cette limite.

## 2. Ouverture par jeton signé

```
GET /api/ajir/launch?login=<login>&ts=<horodatage>&sig=<signature>[&cible=<chemin>]
```

| Paramètre | Contenu |
|---|---|
| `login` | Identifiant du compte People Analytics, identique au `login` de `users.csv` (`[A-Za-z0-9._@-]`, 100 caractères au plus). |
| `ts` | Horodatage Unix en **secondes** (UTC) au moment où AJIR génère le lien. |
| `cible` | Facultatif : `/go/tableau-de-bord` (défaut) ou `/go/collaborateur/<matricule>`. Toute autre valeur est refusée. |
| `sig` | HMAC-SHA256, en hexadécimal minuscule (64 caractères), du message `login|ts|cible` encodé en UTF-8, avec le secret partagé. Quand `cible` est omis, le message contient la cible par défaut `/go/tableau-de-bord`. |

Contrôles, dans cet ordre : format, signature (comparaison en temps constant), fraîcheur (`|maintenant − ts| ≤ 60 s`), compte existant et **actif**, puis anti-rejeu. Chaque signature n'est acceptée **qu'une fois** : son empreinte SHA-256 est inscrite dans le journal d'audit (`auth.ajir_launch`, `OK`) dans la même transaction que la vérification ; une seconde utilisation est refusée (`rejeu`). Le compte n'a pas besoin d'avoir activé un mot de passe : l'authentification est celle d'AJIR.

Réponses :

- succès : la session courante du navigateur est fermée, une nouvelle session est ouverte pour le compte (cookie `pa_session` habituel, 10 h), puis **303** vers la cible ;
- refus : **401** avec une page « Lien AJIR invalide ou expiré » ; le motif (`format`, `signature`, `expire`, `compte_inactif`, `rejeu`) n'est écrit que dans le journal d'audit (`REFUSE`), jamais dans la réponse ;
- secret non configuré : **404** (fonctionnalité désactivée).

### Configuration

Variable d'environnement du service web (`.env`, voir [deploy/env.example](../deploy/env.example)) :

```
AJIR_LAUNCH_SECRET=<au moins 32 caractères aléatoires>
```

Moins de 32 caractères = fonctionnalité désactivée. Générer le secret, par exemple : `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Le même secret est saisi dans la configuration d'AJIR. Horloges des deux serveurs synchronisées (NTP) : un écart de plus de 60 s fait refuser tous les liens. Rotation : changer la valeur des deux côtés puis redémarrer le service web.

### Calcul côté AJIR

Vecteur de test : secret `0123456789abcdef0123456789abcdef`, `login=rh.demo`, `ts=1790000000`, cible par défaut → message `rh.demo|1790000000|/go/tableau-de-bord` → `sig=5f6b5d94c6eeda1f46154dc6742a0f5c4e4efce68bd21bc7cce18deb81e90fab`. Avec `login=mgr.M10451` et `cible=/go/collaborateur/M10477` : `2962203c66002daf84860b0c7c99532862ee389b1f738ade6d55298c82223488`.

Java :

```java
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
long ts = Instant.now().getEpochSecond();
String cible = "/go/collaborateur/" + matricule;
String sig = HexFormat.of().formatHex(mac.doFinal((login + "|" + ts + "|" + cible).getBytes(StandardCharsets.UTF_8)));
String url = baseUrl + "/api/ajir/launch?login=" + URLEncoder.encode(login, StandardCharsets.UTF_8)
    + "&ts=" + ts + "&cible=" + URLEncoder.encode(cible, StandardCharsets.UTF_8) + "&sig=" + sig;
```

C# :

```csharp
var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
var cible = "/go/tableau-de-bord";
using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
var sig = Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes($"{login}|{ts}|{cible}"))).ToLowerInvariant();
var url = $"{baseUrl}/api/ajir/launch?login={Uri.EscapeDataString(login)}&ts={ts}&sig={sig}";
```

PowerShell (test manuel) :

```powershell
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); $cible = "/go/tableau-de-bord"
$hmac = New-Object System.Security.Cryptography.HMACSHA256 (,[Text.Encoding]::UTF8.GetBytes($secret))
$sig = -join ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$login|$ts|$cible")) | ForEach-Object { $_.ToString("x2") })
"https://people-analytics.client.local/api/ajir/launch?login=$login&ts=$ts&sig=$sig"
```

Le lien est généré **au moment du clic** dans AJIR (pas à l'affichage du menu), côté serveur : le secret ne doit jamais atteindre le navigateur.

### Limites connues

- Le lien complet (signature comprise) peut figurer dans les journaux d'accès du reverse proxy : sans conséquence, car il expire en 60 s et ne sert qu'une fois.
- Un utilisateur AJIR qui ferait ouvrir son propre lien par un collègue dans la minute le connecterait sous son compte à lui (« login CSRF ») : impact faible, aucun accès aux données du collègue.
- La synchronisation des comptes (`users.csv`) reste la référence : un compte désactivé dans AJIR et resynchronisé est refusé au lancement.
