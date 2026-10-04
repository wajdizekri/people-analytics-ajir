-- y6 = 1 aussi pour une démission déjà posée à as_of mais saisie après (recorded_at > as_of) : le salarié est alors
-- éligible (la démission n'est pas visible à t) et part dans l'horizon ; l'étiqueter 0 bruitait l'entraînement et le backtest.
DROP VIEW IF EXISTS v_label_panel;
--> statement-breakpoint
-- Seule définition des étiquettes, lue par Python (entraînement) et par le backtest.
-- Événement = démission ou abandon ; date = date de démission, sinon sortie - 1 mois de préavis.
-- y6 = 1 si l'événement tombe dans ]as_of, as_of + 6 mois], ou s'il est antérieur à as_of mais inconnu à as_of
-- (saisie postérieure) avec une sortie effective dans ]as_of, as_of + 6 mois].
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
    WHEN ee.id IS NOT NULL
         AND ee.reason IN ('DEMISSION','ABANDON')
         AND COALESCE(ee.resignation_date, date(ee.exit_date, '-1 month')) <= fs.as_of
         AND ee.recorded_at > fs.as_of
         AND ee.exit_date > fs.as_of
         AND ee.exit_date <= date(fs.as_of, '+6 months') THEN 1
    ELSE 0
  END AS y6,
  CASE
    WHEN date(fs.as_of, '+6 months') <= COALESCE((SELECT value FROM app_setting WHERE key = 'data_end_date'), '0000-00-00') THEN 1
    ELSE 0
  END AS followup_complete
FROM feature_snapshot fs
LEFT JOIN exit_event ee ON ee.employee_id = fs.employee_id;
