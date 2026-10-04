# Installation on-premise — People Analytics AJIR

Guide d'installation sur un serveur Windows du client, sans Docker ni Python. Exploitation courante (imports, batch, incidents, sauvegardes) : [EXPLOITATION.md](EXPLOITATION.md).

## 1. Architecture cible

```
Postes RH / managers ──HTTPS 443──► Caddy (service PeopleAnalyticsProxy)
                                        │  en-têtes de sécurité, certificat PKI interne
                                        ▼  http://127.0.0.1:3000 (boucle locale)
                                   Next.js (service PeopleAnalyticsWeb)
                                        │
                                        ▼
         C:\PeopleAnalytics\data\app.db (SQLite WAL) ◄── worker (service PeopleAnalyticsWorker)
                                        │                 file de jobs, batch mensuel le 10 à 02:00 (Tunis)
                                        ▼
         tâche planifiée « PeopleAnalytics\Sauvegarde » (01:00) ──► D:\Sauvegardes\PeopleAnalytics (30 jours)
```

Arborescence de référence (à adapter, en reportant les chemins dans les fichiers XML, le Caddyfile et `.env`) :

```
C:\PeopleAnalytics\
  app\        code livré (remplacé à chaque mise à jour) : .next, node_modules, drizzle, models, scripts, src, .env
  data\       app.db et data\inbox\ (exports téléversés) — jamais dans app\
  logs\       journaux des services et de Caddy
  services\   WinSW : PeopleAnalyticsWeb.exe/.xml, PeopleAnalyticsWorker.exe/.xml, PeopleAnalyticsProxy.exe/.xml
  caddy\      caddy.exe, Caddyfile, certs\, data\
  imports\    exports AJIR déposés pour un import en ligne de commande
D:\Sauvegardes\PeopleAnalytics\   sauvegardes quotidiennes (autre volume ou partage réseau)
```

## 2. Prérequis

- Windows Server 2019, 2022 ou 2025, x64. Indicatif pour 800 salariés : 2 vCPU, 4 Go de RAM, 10 Go libres pour l'application et la base, plus 30 × la taille de la base pour les sauvegardes. Référence mesurée : la base de démonstration (2 450 salariés, 72 mois, 1,56 M pointages) pèse 155 Mo.
- Node.js **24 LTS x64** (installeur MSI officiel). Pas de Python, pas de Docker, pas de compilateur si l'archive est livrée avec ses `node_modules`.
- [WinSW 2.12](https://github.com/winsw/winsw/releases) : `WinSW-x64.exe` (ou `WinSW-net461.exe` si .NET Framework 4.6.1+ est présent).
- [Caddy 2.7+](https://caddyserver.com/download) pour Windows amd64 (un seul exécutable). Alternative si le client impose IIS : IIS + ARR avec les mêmes en-têtes (non décrit ici).
- Un nom DNS interne (ex. `people-analytics.client.local`) pointant vers le serveur, et un certificat serveur de la PKI du client au format PEM (sinon autorité interne de Caddy, voir § 3.9).
- Ports : 443 entrant (et 80 pour la redirection HTTP → HTTPS). Le port 3000 reste local. Si IIS (AJIR) occupe déjà 80/443, prévoir un autre port (voir le Caddyfile).
- BitLocker sur les volumes de la base et des sauvegardes (données RH : salaires, absences).
- Un compte administrateur local du serveur pour l'installation.

## 3. Installation pas à pas

Toutes les commandes se lancent dans **PowerShell en administrateur**.

### 3.1 Node.js

Installer `node-v24.x.x-x64.msi` (options par défaut ; « Tools for native modules » inutile), rouvrir PowerShell puis :

```powershell
node -v    # v24.x
npm -v     # 11.x
```

### 3.2 Compte de service et arborescence

Un compte local dédié exécute les trois services et la tâche de sauvegarde (le même compte pour tous : la base WAL et ses fichiers `-wal`/`-shm` doivent être accessibles en écriture par chacun).

```powershell
$pw = Read-Host -AsSecureString "Mot de passe du compte svc-peopleanalytics"
New-LocalUser -Name "svc-peopleanalytics" -Password $pw -PasswordNeverExpires -UserMayNotChangePassword -Description "Services People Analytics AJIR"

$root = "C:\PeopleAnalytics"
"app","data","logs","services","caddy\certs","caddy\data","imports" | ForEach-Object { New-Item -ItemType Directory -Force "$root\$_" | Out-Null }
New-Item -ItemType Directory -Force "D:\Sauvegardes\PeopleAnalytics" | Out-Null

icacls "$root" /grant "svc-peopleanalytics:(OI)(CI)RX"
icacls "$root\data" /grant "svc-peopleanalytics:(OI)(CI)M"
icacls "$root\logs" /grant "svc-peopleanalytics:(OI)(CI)M"
icacls "$root\caddy\data" /grant "svc-peopleanalytics:(OI)(CI)M"
icacls "D:\Sauvegardes\PeopleAnalytics" /grant "svc-peopleanalytics:(OI)(CI)M"
```

Sauvegardes sur un partage réseau : utiliser plutôt un compte de domaine (ou gMSA) ayant le droit Modification sur le partage, et l'indiquer partout à la place de `svc-peopleanalytics`.

### 3.3 Code de l'application

**Option A — archive hors ligne (recommandée, serveur sans Internet).** Sur un poste de build **Windows x64 avec la même version majeure de Node** (les modules natifs `better-sqlite3` et `@node-rs/argon2` sont compilés pour une plateforme et une ABI données) :

```powershell
npm ci
npm run build
tar -czf people-analytics-0.1.0-win-x64.tgz --exclude=./data --exclude=./.env --exclude=./.next/cache --exclude=./.git .
```

Sur le serveur :

```powershell
tar -xzf people-analytics-0.1.0-win-x64.tgz -C C:\PeopleAnalytics\app
```

**Option B — build sur le serveur** (accès Internet ou miroir npm interne) : copier les sources dans `C:\PeopleAnalytics\app`, puis `npm ci` et `npm run build`.

Dans les deux cas : **pas de `npm ci --omit=dev`** sur le poste qui construit (`next build` a besoin des devDependencies : TypeScript, Tailwind). `tsx`, requis en production par le worker et les scripts, fait partie des `dependencies`. `next.config.ts` lit `NEXT_DIST_DIR` (dossier de build, `.next` par défaut) : si un build est produit ailleurs, la même valeur doit figurer dans `.env` pour le service web.

Le serveur web écrit son cache dans le dossier de build :

```powershell
icacls "C:\PeopleAnalytics\app\.next" /grant "svc-peopleanalytics:(OI)(CI)M"
```

### 3.4 Configuration (.env)

```powershell
cd C:\PeopleAnalytics\app
Copy-Item deploy\env.example .env
notepad .env        # DATABASE_PATH, APP_URL, TRUST_PROXY, BACKUP_DIR, BACKUP_RETENTION_DAYS, PORT (AJIR_LAUNCH_SECRET si ouverture depuis AJIR)
# lecture réservée aux administrateurs (S-1-5-32-544), à SYSTEM (S-1-5-18) et au compte de service
icacls .env /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" "svc-peopleanalytics:R"
```

Variables à ne pas oublier : `TRUST_PROXY=1` derrière le Caddy du § 3.9 (adresse client fiable pour la limitation de débit par IP et l'audit ; à laisser absent si le port 3000 était joignable sans le proxy), `APP_URL` en `https` (liens d'activation, contrôle d'origine), `AJIR_LAUNCH_SECRET` (32 caractères aléatoires au moins) seulement si l'ouverture depuis AJIR par jeton signé est utilisée ([INTEGRATION_AJIR.md](INTEGRATION_AJIR.md)).

`.env` est lu par Next.js, par le worker (`node --env-file=.env`) et par les scripts de sauvegarde, restauration, vérification et rétention. Les autres commandes (`npm run db:migrate`, `import`, `seed:admin`, `scripts/model.ts`) ne le lisent pas : dans chaque session PowerShell d'exploitation, charger d'abord l'environnement :

```powershell
. C:\PeopleAnalytics\app\deploy\windows\env.ps1     # point + espace ; se place aussi dans le dossier app
```

### 3.5 Base de données et compte administrateur

```powershell
. C:\PeopleAnalytics\app\deploy\windows\env.ps1
npm run db:migrate                     # crée DATABASE_PATH et les paramètres par défaut
npm run seed:admin -- admin            # sans mot de passe : un mot de passe aléatoire est affiché une seule fois
```

Conserver ce mot de passe dans le coffre du client (ne pas le passer en argument : il resterait dans l'historique PowerShell).

### 3.6 Premier import (historique AJIR)

Déposer l'export complet dans `C:\PeopleAnalytics\imports\<AAAA-MM>\` (contrat CSV : `docs/CONVENTIONS.md`), puis :

```powershell
npm run import -- C:\PeopleAnalytics\imports\2026-08     # statut OK attendu, sinon voir EXPLOITATION.md § Import bloqué
npm run pipeline                                        # variables, scoring publié, recommandations, anomalies, étapes IA
```

Ordre de grandeur mesuré sur la base de démonstration (30/09/2026) : import ≈ 30 s, pipeline ≈ 15 s (agrégats 4,5 s, variables des 72 mois 7,9 s, scoring 0,2 s, anomalies 0,2 s, 4 étapes IA 1 s ; `--backtest` ajoute l'historique des scores). Les exports mensuels suivants passent par l'interface (EXPLOITATION.md § 2).

### 3.6 bis Modèles livrés

Sans modèle enregistré, le premier scoring enregistre et promeut le score à règles `b0-v1`. Les bundles livrés dans `models\` s'enregistrent puis se promeuvent explicitement (décision tracée dans le journal d'audit pour le modèle turnover) :

```powershell
npx tsx scripts/model.ts register models/turnover/logreg-v1-20260930
npx tsx scripts/model.ts verify logreg-v1-20260930      # golden rejoué, empreinte des fichiers
npx tsx scripts/model.ts promote logreg-v1-20260930
npm run topic-model -- register ABSENTEISME models/absenteeism/abs-ridge-v1-20260930
npm run topic-model -- register EFFECTIF models/workforce/effectif-v1-20260930
npm run topic-model -- register MASSE_SALARIALE models/workforce/masse-v1-20260930
npm run topic-model -- register FORMATION models/training/formation-logreg-v1-20260930
npm run topic-model -- register CHARGE_TRAVAIL models/workload/workload-ridge-v1-20260930
npm run topic-model -- promote abs-ridge-v1-20260930      # idem pour chacune des 5 versions
npm run pipeline                                          # recalcul avec les champions
```

**Démarrage à froid.** Le LOGREG livré est entraîné sur des données simulées : chez un client, il doit être réentraîné sur son historique (`ml/README.md`) et promu seulement si son backtest le justifie. La règle de démarrage à froid protège le client entre-temps : tant que l'historique compte moins de `min_events_for_model` démissions observées (30 par défaut, écran Paramètres), le scoring retombe sur le score à règles B0 même si un LOGREG est champion, et la page *Transparence* en affiche la raison ; sous `indicative_until_events` (150), la probabilité est signalée comme indicative. Les chemins des bundles sont enregistrés relativement au dossier `app\` : le dossier `models\` doit suivre l'application à chaque mise à jour (§ 4).

### 3.7 Services web et worker (WinSW)

```powershell
$s = "C:\PeopleAnalytics\services"
Copy-Item C:\Téléchargements\WinSW-x64.exe "$s\PeopleAnalyticsWeb.exe"
Copy-Item C:\Téléchargements\WinSW-x64.exe "$s\PeopleAnalyticsWorker.exe"
Copy-Item C:\PeopleAnalytics\app\deploy\windows\PeopleAnalyticsWeb.xml, C:\PeopleAnalytics\app\deploy\windows\PeopleAnalyticsWorker.xml $s
# adapter si besoin : chemin de node.exe, dossiers, port (3000 = PORT de .env = Caddyfile)
& "$s\PeopleAnalyticsWeb.exe" install
& "$s\PeopleAnalyticsWorker.exe" install
```

Affecter le compte de service à chaque service (services.msc > Propriétés > Connexion, qui accorde aussi le droit « Ouvrir une session en tant que service »), ou :

```powershell
sc.exe config PeopleAnalyticsWeb obj= ".\svc-peopleanalytics" password= "<mot de passe>"
sc.exe config PeopleAnalyticsWorker obj= ".\svc-peopleanalytics" password= "<mot de passe>"
Start-Service PeopleAnalyticsWeb, PeopleAnalyticsWorker
Invoke-RestMethod http://127.0.0.1:3000/api/health     # status "ok" une fois le worker démarré (≈ 15 s)
```

Ce que font les fichiers XML : démarrage automatique différé, redémarrage automatique en cas d'arrêt anormal (10 s, 30 s, puis 2 min ; compteur remis à zéro après 1 h), arrêt par Ctrl+C (le worker termine son job en cours, 120 s maximum), journaux `C:\PeopleAnalytics\logs\<service>.out.log` / `.err.log` avec rotation 10 Mo × 8. Le worker est lancé par `node --env-file=.env --import tsx src\worker\index.ts`, équivalent de `npm run worker` sans passer par `npm.cmd` (dont l'invite « Terminer le programme de commandes ? » empêcherait l'arrêt propre).

### 3.8 Pare-feu

```powershell
New-NetFirewallRule -DisplayName "People Analytics HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443,80 -Action Allow
```

Ne jamais ouvrir le port 3000 (Next.js n'écoute de toute façon que sur 127.0.0.1).

### 3.9 Reverse proxy HTTPS (Caddy)

```powershell
Copy-Item C:\Téléchargements\caddy.exe C:\PeopleAnalytics\caddy\
Copy-Item C:\PeopleAnalytics\app\deploy\caddy\Caddyfile C:\PeopleAnalytics\caddy\
notepad C:\PeopleAnalytics\caddy\Caddyfile       # nom DNS, chemins du certificat
```

Certificat (option A, recommandée) : placer `people-analytics.crt` (certificat + chaîne intermédiaire, PEM) et `people-analytics.key` (PEM, non chiffrée) dans `C:\PeopleAnalytics\caddy\certs\`. Un `.pfx` se convertit avec OpenSSL (fourni avec Git pour Windows) : `openssl pkcs12 -in cert.pfx -clcerts -nokeys -out people-analytics.crt` puis `openssl pkcs12 -in cert.pfx -nocerts -nodes -out people-analytics.key`. Restreindre la clé :

```powershell
icacls C:\PeopleAnalytics\caddy\certs\people-analytics.key /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" "svc-peopleanalytics:R"
```

Option B : `tls internal` dans le Caddyfile ; Caddy crée sa propre autorité, dont la racine (`C:\PeopleAnalytics\caddy\data\caddy\pki\authorities\local\root.crt`) doit être déployée par GPO sur les postes.

```powershell
C:\PeopleAnalytics\caddy\caddy.exe validate --config C:\PeopleAnalytics\caddy\Caddyfile --adapter caddyfile
$s = "C:\PeopleAnalytics\services"
Copy-Item C:\Téléchargements\WinSW-x64.exe "$s\PeopleAnalyticsProxy.exe"
Copy-Item C:\PeopleAnalytics\app\deploy\windows\PeopleAnalyticsProxy.xml $s
& "$s\PeopleAnalyticsProxy.exe" install
sc.exe config PeopleAnalyticsProxy obj= ".\svc-peopleanalytics" password= "<mot de passe>"
Start-Service PeopleAnalyticsProxy
```

Contrôle depuis un poste : `https://people-analytics.client.local/api/health` sans alerte de certificat, puis la page de connexion. Les en-têtes (HSTS, CSP, X-Frame-Options, Permissions-Policy) se vérifient dans l'onglet Réseau du navigateur ; la console ne doit afficher aucune violation CSP sur le tableau de bord, une fiche collaborateur et la page Absentéisme.

### 3.10 Sauvegarde quotidienne

`deploy\windows\backup.cmd` lance `scripts\backup.ts` : copie à chaud cohérente (`VACUUM INTO` sur une connexion en lecture seule, sans arrêt des services), `PRAGMA integrity_check` sur la copie, manifeste (sha256, comptages par table, migrations), rétention `BACKUP_RETENTION_DAYS` (30 jours), journal `<BACKUP_DIR>\sauvegardes.log`. Tâche planifiée à 01:00, sous le compte de service :

```powershell
schtasks /Create /TN "PeopleAnalytics\Sauvegarde" /TR "C:\PeopleAnalytics\app\deploy\windows\backup.cmd" /SC DAILY /ST 01:00 /RU ".\svc-peopleanalytics" /RP * /RL LIMITED /F
schtasks /Run /TN "PeopleAnalytics\Sauvegarde"
schtasks /Query /TN "PeopleAnalytics\Sauvegarde" /V /FO LIST | Select-String "Dernier résultat|Last Result"    # 0 = OK
Get-Content D:\Sauvegardes\PeopleAnalytics\sauvegardes.log -Tail 3
```

`/RP *` demande le mot de passe. Si la tâche échoue avec 0x80070569, accorder au compte le droit « Ouvrir une session en tant que tâche » (secpol.msc > Stratégies locales > Attribution des droits utilisateur). L'heure évite le batch mensuel (le 10 à 02:00, heure de Tunis) ; la sauvegarde n'arrête rien et n'est pas bloquée par le worker.

### 3.10 bis Rétention des données (mensuelle)

`npm run retention` (`scripts/retention.ts`) simule par défaut et n'applique qu'avec `--apply` (trace `retention.apply` dans le journal d'audit) : sessions expirées, prédictions et facteurs de plus de 24 mois hors calcul publié, exports déposés dans `data\inbox` depuis plus de 90 jours, résidus prédictifs des salariés opposés ; le journal d'audit n'est jamais supprimé. Durées : option de la commande, sinon `RETENTION_INBOX_DAYS` / `RETENTION_PREDICTION_MONTHS` de `.env`, sinon paramètres `retention_inbox_days` / `retention_prediction_months`. Tâche planifiée le 15 de chaque mois (après le batch du 10) :

```powershell
schtasks /Create /TN "PeopleAnalytics\Retention" /TR "cmd /c cd /d C:\PeopleAnalytics\app && npx tsx scripts\retention.ts --apply >> C:\PeopleAnalytics\logs\retention.log 2>&1" /SC MONTHLY /D 15 /ST 03:00 /RU ".\svc-peopleanalytics" /RP * /RL LIMITED /F
```

### 3.11 Vérification finale

```powershell
. C:\PeopleAnalytics\app\deploy\windows\env.ps1
npm run check-install                     # = npx tsx scripts/check-install.ts ; --full : integrity_check complet ; --json : supervision
```

Attendu : **0 échec**. Contrôles : version de Node, modules natifs chargeables, build présent, variables d'environnement (`DATABASE_PATH`, `APP_URL` en https, pas d'`INSECURE_COOKIES`, `LOG_LEVEL` valide, `BACKUP_DIR` sur un autre volume), droits d'écriture sur `data\` et le dossier des sauvegardes, espace disque, intégrité de la base, migrations appliquées, compte ADMIN actif, champion chargeable (golden rejoué), âge du heartbeat du worker, jobs en échec, dernier import, âge de la dernière sauvegarde, réponse de `/api/health`. Code de sortie 1 en cas d'échec.

Puis : connexion `admin`, page *Santé des données* (worker « Actif »), *Transparence* (champion chargé).

## 4. Mise à jour de version

1. Lire les notes de version (migrations, nouveau modèle, changement de `.env`).
2. Sauvegarde manuelle : `C:\PeopleAnalytics\app\deploy\windows\backup.cmd` (noter le nom affiché).
3. Arrêter le worker puis le web (le proxy peut rester : il répond 502 pendant la maintenance) :
   ```powershell
   Stop-Service PeopleAnalyticsWorker; Stop-Service PeopleAnalyticsWeb
   ```
4. Mettre l'ancienne version de côté et déployer la nouvelle :
   ```powershell
   Rename-Item C:\PeopleAnalytics\app app-0.1.0
   New-Item -ItemType Directory C:\PeopleAnalytics\app | Out-Null
   tar -xzf people-analytics-0.2.0-win-x64.tgz -C C:\PeopleAnalytics\app
   Copy-Item C:\PeopleAnalytics\app-0.1.0\.env C:\PeopleAnalytics\app\ ; icacls C:\PeopleAnalytics\app\.env /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" "svc-peopleanalytics:R"
   # bundles de modèles ajoutés sur place par un consultant (turnover et IA par sujet), absents de l'archive
   robocopy C:\PeopleAnalytics\app-0.1.0\models C:\PeopleAnalytics\app\models /E /XC /XN /XO
   icacls C:\PeopleAnalytics\app\.next /grant "svc-peopleanalytics:(OI)(CI)M"
   ```
5. Migrer : `. C:\PeopleAnalytics\app\deploy\windows\env.ps1` puis `npm run db:migrate`.
6. Si les fichiers XML ont changé : services arrêtés, `PeopleAnalyticsWeb.exe uninstall`, recopier le XML, `install`, réaffecter le compte (idem worker). Si le Caddyfile a changé : le recopier, `caddy.exe validate` puis `caddy.exe reload` (voir EXPLOITATION.md § 8).
7. Redémarrer : `Start-Service PeopleAnalyticsWeb, PeopleAnalyticsWorker`, puis `npm run check-install` (0 échec) et une connexion.

**Retour arrière** : arrêter les services, renommer `app` en `app-echec` et `app-0.1.0` en `app`, restaurer la sauvegarde de l'étape 2 (`npm run restore -- <nom>` : les migrations ne se défont pas), redémarrer. Garder `app-<ancienne version>` jusqu'à la mise à jour suivante.

## 5. Désinstallation

1. Sauvegarde finale (`backup.cmd`) et archivage selon la politique du client (données personnelles RH).
2. Services et tâche :
   ```powershell
   Stop-Service PeopleAnalyticsProxy, PeopleAnalyticsWorker, PeopleAnalyticsWeb
   "PeopleAnalyticsProxy","PeopleAnalyticsWorker","PeopleAnalyticsWeb" | ForEach-Object { & "C:\PeopleAnalytics\services\$_.exe" uninstall }
   schtasks /Delete /TN "PeopleAnalytics\Sauvegarde" /F
   Remove-NetFirewallRule -DisplayName "People Analytics HTTPS"
   ```
3. Suppression des dossiers `C:\PeopleAnalytics` et des sauvegardes (effacement sécurisé selon la politique du client ; les CSV de `data\inbox` et `imports\` contiennent des salaires).
4. `Remove-LocalUser svc-peopleanalytics` ; retrait de l'entrée DNS ; révocation du certificat auprès de la PKI ; désinstallation de Node.js s'il ne sert à rien d'autre.
