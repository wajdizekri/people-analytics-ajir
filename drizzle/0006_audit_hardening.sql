-- B3 : INSERT OR REPLACE (ou REPLACE INTO) sur un id existant supprime puis réinsère la ligne ; la suppression
-- implicite ne déclenche pas audit_log_no_delete (recursive_triggers désactivé). On refuse donc toute insertion
-- dont l'id existe déjà, avant la résolution du conflit. Coût : une recherche par clé primaire par insertion.
CREATE TRIGGER audit_log_no_replace BEFORE INSERT ON audit_log
WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM audit_log WHERE id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'audit_log est en ajout seul');
END;
