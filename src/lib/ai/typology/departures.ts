import type Database from "better-sqlite3";
import spec from "./queries.json";

// Départs volontaires visibles à la référence et variables à la veille du départ : requête partagée avec
// ml/typology/data.py (queries.json), même population par construction.
export type DepartureRow = {
  exitId: number;
  employeeId: number;
  exitDate: string;
  reason: string;
  eventDate: string;
  asOf: string | null;
  valuesJson: string | null;
  departmentName: string | null;
  jobFamily: string | null;
};

export const DEPARTURES_SQL = spec.departures.join("\n");

export function departureRows(sqlite: Database.Database, ref: string, fsv: string): DepartureRow[] {
  return sqlite.prepare(DEPARTURES_SQL).all({ ref, fsv }) as DepartureRow[];
}
