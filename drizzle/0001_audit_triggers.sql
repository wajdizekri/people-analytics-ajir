CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log est en ajout seul');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log est en ajout seul');
END;
--> statement-breakpoint
-- Seule définition des étiquettes, lue par Python (entraînement) et par le backtest.
-- Événement = démission ou abandon ; date = date de démission, sinon sortie - 1 mois de préavis.
-- Les autres sorties sont des risques concurrents : elles comptent 0 (pas de démission dans l'horizon).
-- followup_complete = 0 si l'horizon de 6 mois dépasse la fin des données (à exclure de l'entraînement).
CREATE VIEW v_label_panel AS
SELECT
  fs.employee_id,
  fs.as_of,
  fs.fsv,
  ee.reason AS exit_reason,
  COALESCE(ee.resignation_date, date(ee.exit_date, '-1 month')) AS event_date,
  CASE
    WHEN ee.id IS NOT NULL
         AND ee.reason IN ('DEMISSION','ABANDON')
         AND COALESCE(ee.resignation_date, date(ee.exit_date, '-1 month')) > fs.as_of
         AND COALESCE(ee.resignation_date, date(ee.exit_date, '-1 month')) <= date(fs.as_of, '+6 months') THEN 1
    ELSE 0
  END AS y6,
  CASE
    WHEN date(fs.as_of, '+6 months') <= COALESCE((SELECT value FROM app_setting WHERE key = 'data_end_date'), '0000-00-00') THEN 1
    ELSE 0
  END AS followup_complete
FROM feature_snapshot fs
LEFT JOIN exit_event ee ON ee.employee_id = fs.employee_id;
