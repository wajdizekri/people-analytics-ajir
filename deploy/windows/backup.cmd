@echo off
rem Sauvegarde quotidienne People Analytics - lancee par la tache planifiee "PeopleAnalytics\Sauvegarde".
rem Lit .env (DATABASE_PATH, BACKUP_DIR, BACKUP_RETENTION_DAYS) ; journal : <BACKUP_DIR>\sauvegardes.log
rem Code de sortie 0 = OK, 1 = echec (Planificateur de taches, "Resultat de la derniere execution").
rem Arguments transmis a scripts\backup.ts (ex. : backup.cmd --retention 60).
setlocal
cd /d "%~dp0..\.."
"%ProgramFiles%\nodejs\node.exe" --import tsx scripts\backup.ts %*
exit /b %ERRORLEVEL%
