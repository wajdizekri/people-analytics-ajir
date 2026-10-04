# Charge le .env de l'application dans la session PowerShell courante, pour les commandes manuelles du runbook
# (npm run db:migrate, npm run import, npx tsx scripts\model.ts ...), qui ne lisent pas .env d'elles-memes.
# Usage :  . C:\PeopleAnalytics\app\deploy\windows\env.ps1   (point + espace : execution dans la session)
$appDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envFile = Join-Path $appDir ".env"
if (-not (Test-Path $envFile)) {
  Write-Warning "Fichier .env introuvable : $envFile"
  return
}
foreach ($line in Get-Content -Encoding UTF8 $envFile) {
  if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
    $name = $Matches[1]
    $value = $Matches[2]
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "Env:$name" -Value $value
  }
}
Set-Location $appDir
Write-Host "Variables de $envFile chargees ; DATABASE_PATH=$env:DATABASE_PATH"
