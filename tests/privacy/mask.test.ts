import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getImportDetail } from "@/lib/dal/imports";
import { MASK, maskRejectionMessage } from "@/lib/privacy/mask";
import { buildWorld, openDalDb } from "../fixtures/unit/dal-world";

describe("masquage des messages de rejet", () => {
  it.each([
    ["Salaire de base 350.5 TND inférieur au SMIG (528.320 TND) en 2025-03", `Salaire de base ${MASK} TND inférieur au SMIG (528.320 TND) en 2025-03`],
    ["Valeur invalide pour base_salary : « 12a50 » ; date invalide pour month : « 2025-13 »", `Valeur invalide pour base_salary : « ${MASK} » ; date invalide pour month : « 2025-13 »`],
    ["Valeur invalide pour category : « MALADIE_LONGUE »", `Valeur invalide pour category : « ${MASK} »`],
    ["Valeur invalide pour old_value : « 1800 »", `Valeur invalide pour old_value : « ${MASK} »`],
    ["Date invalide pour birth_date : « 1990-02-30 »", `Date invalide pour birth_date : « ${MASK} »`],
    ["Valeur invalide pour score : « 7 »", `Valeur invalide pour score : « ${MASK} »`],
    ["Valeur invalide pour contract_type : « CDX »", "Valeur invalide pour contract_type : « CDX »"],
    ["Matricule M123 absent des salariés importés", "Matricule M123 absent des salariés importés"],
    ["Paie 2025-03 en double pour M123", "Paie 2025-03 en double pour M123"],
  ])("%s", (input, expected) => {
    expect(maskRejectionMessage(input)).toBe(expected);
  });
});

describe("absences.csv : seul le matricule reste visible pour l'ADMIN (arbitrage du 30/09)", () => {
  it.each([
    ["Absence du 2023-02-16 en double pour M10006", `Absence du ${MASK} en double pour M10006`],
    ["Fin d'absence 2024-01-03 antérieure au début 2024-01-10", `Fin d'absence ${MASK} antérieure au début ${MASK}`],
    [
      "Absence du 2024-01-03 au 2024-01-05 hors de la période d'emploi (2019-05-01 - en poste)",
      `Absence du ${MASK} au ${MASK} hors de la période d'emploi (${MASK} - en poste)`,
    ],
    ["Valeur invalide pour category : « CONGE_LONG » ; valeur invalide pour days : « -2 »", `Valeur invalide pour category : « ${MASK} » ; valeur invalide pour days : « ${MASK} »`],
    ["Date invalide pour start_date : « 2024-02-30 »", `Date invalide pour start_date : « ${MASK} »`],
    ["Catégorie MALADIE incohérente pour M10007", `Catégorie ${MASK} incohérente pour M10007`],
    ["Valeur invalide pour matricule : « M-12 »", "Valeur invalide pour matricule : « M-12 »"],
    ["Matricule M123 absent des salariés importés", "Matricule M123 absent des salariés importés"],
  ])("%s", (input, expected) => {
    expect(maskRejectionMessage(input, "absences.csv")).toBe(expected);
    expect(maskRejectionMessage(input, "exports/2026-08/absences.csv")).toBe(expected);
  });

  it("les autres fichiers gardent dates et codes", () => {
    expect(maskRejectionMessage("Pointage du 2024-01-03 hors de la période d'emploi (2019-05-01 - en poste)", "attendance.csv")).toBe(
      "Pointage du 2024-01-03 hors de la période d'emploi (2019-05-01 - en poste)",
    );
  });
});

describe("getImportDetail : échantillons masqués pour l'ADMIN, intacts pour la RH", () => {
  let db: ReturnType<typeof openDalDb>;
  let w: ReturnType<typeof buildWorld>;
  let batch: number;
  beforeAll(() => {
    db = openDalDb("privacy-mask");
    w = buildWorld(db.sqlite);
    batch = Number(db.sqlite.prepare("INSERT INTO import_batch (source, status) VALUES ('test', 'OK')").run().lastInsertRowid);
    const ins = db.sqlite.prepare("INSERT INTO import_rejection (batch_id, file, line, rule, message, raw, severity) VALUES (?, 'payroll.csv', ?, ?, ?, ?, 'REJET')");
    ins.run(batch, 2, "SALAIRE_SOUS_SMIG", "Salaire de base 350 TND inférieur au SMIG (528.320 TND) en 2025-03", "M123;2025-03;350;420;0;2025-04-05");
    ins.run(batch, 3, "VALEUR_INVALIDE", "Valeur invalide pour gross_salary : « 4x20 »", "M124;2025-03;400;4x20;0;2025-04-05");
  });
  afterAll(() => db.close());

  it("ADMIN : montants et valeurs masqués, ligne et règle conservées, jamais de ligne brute", () => {
    const d = getImportDetail(w.ctx.admin, batch);
    expect(d.samples.map((s) => s.message)).toEqual([
      `Salaire de base ${MASK} TND inférieur au SMIG (528.320 TND) en 2025-03`,
      `Valeur invalide pour gross_salary : « ${MASK} »`,
    ]);
    expect(d.samples.map((s) => [s.line, s.rule])).toEqual([[2, "SALAIRE_SOUS_SMIG"], [3, "VALEUR_INVALIDE"]]);
    expect(JSON.stringify(d)).not.toMatch(/350|4x20|M123;/);
  });

  it("RH : message d'origine", () => {
    expect(getImportDetail(w.ctx.rh, batch).samples[0].message).toContain("350 TND");
  });

  it("absences : l'ADMIN ne voit que le matricule, la RH garde dates et catégorie", () => {
    db.sqlite
      .prepare("INSERT INTO import_rejection (batch_id, file, line, rule, message, raw, severity) VALUES (?, 'absences.csv', 9, 'DOUBLON', ?, ?, 'REJET')")
      .run(batch, "Absence du 2023-02-16 en double pour M10006", "M10006;2023-02-16;2023-02-17;2;MALADIE;2023-02-20");
    const admin = getImportDetail(w.ctx.admin, batch).samples.find((s) => s.file === "absences.csv")!;
    expect(admin.message).toBe(`Absence du ${MASK} en double pour M10006`);
    expect(JSON.stringify(getImportDetail(w.ctx.admin, batch))).not.toMatch(/2023-02-1[67]|MALADIE/);
    expect(getImportDetail(w.ctx.rh, batch).samples.find((s) => s.file === "absences.csv")!.message).toBe("Absence du 2023-02-16 en double pour M10006");
  });

  it("le matricule reste visible pour l'ADMIN", () => {
    db.sqlite.prepare("INSERT INTO import_rejection (batch_id, file, line, rule, message, severity) VALUES (?, 'payroll.csv', 4, 'MATRICULE_INCONNU', 'Matricule M999 absent des salariés importés', 'REJET')").run(batch);
    expect(getImportDetail(w.ctx.admin, batch).samples.map((s) => s.message)).toContain("Matricule M999 absent des salariés importés");
  });
});
