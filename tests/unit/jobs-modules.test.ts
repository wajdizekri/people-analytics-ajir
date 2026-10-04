import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Module d'un autre contributeur présent mais en erreur au chargement.
vi.mock("@/lib/calendar", () => {
  throw new Error("SyntaxError: Unexpected token dans calendar");
});

import { createTestDb, type TestDb } from "../fixtures/engine/db";
import { ensureCalendar, loadCalendar } from "@/lib/jobs/handlers";

let db: TestDb;
beforeAll(() => (db = createTestDb()));
afterAll(() => db.close());

describe("modules optionnels", () => {
  it("module présent mais en erreur : l'erreur remonte (pas masquée en « module indisponible »)", async () => {
    await expect(loadCalendar()).rejects.toThrow(/error when mocking a module/);
    await expect(ensureCalendar(db.sqlite, 2025, 2025)).rejects.toThrow();
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM dim_date").get()).toEqual({ n: 0 });
  });
});
