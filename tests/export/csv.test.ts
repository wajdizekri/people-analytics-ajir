import { describe, expect, it } from "vitest";
import { buildTable, csvCell, frDate, frDateTime, frNumber, neutralizeFormula, toCsv } from "@/lib/export/csv";
import { exportHref, pickExportParams, searchParamsRecord } from "@/lib/export/kinds";
import { parseCsv } from "./parse";

describe("sérialisation CSV (Excel français)", () => {
  it("BOM UTF-8, séparateur « ; », fins de ligne CRLF, en-têtes en français", () => {
    const csv = toCsv({ columns: [{ header: "Matricule" }, { header: "Département" }], rows: [["M1", "Ressources humaines"]] });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe("﻿Matricule;Département\r\nM1;Ressources humaines\r\n");
    expect(Buffer.from(csv, "utf8").subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it("guillemets RFC 4180 : séparateur, guillemet ou saut de ligne dans la cellule", () => {
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('dit "bonjour"')).toBe('"dit ""bonjour"""');
    expect(csvCell("ligne 1\nligne 2")).toBe('"ligne 1\nligne 2"');
    expect(csvCell("ligne 1\r\nligne 2")).toBe('"ligne 1\r\nligne 2"');
    expect(csvCell("simple, avec virgule")).toBe("simple, avec virgule");
    const csv = toCsv({ columns: [{ header: "Titre" }, { header: "Message" }], rows: [['A;"B"', "x\r\ny"]] });
    expect(parseCsv(csv)).toEqual([
      ["Titre", "Message"],
      ['A;"B"', "x\r\ny"],
    ]);
  });

  it("décimales à virgule, sans séparateur de milliers ni « -0 »", () => {
    expect(frNumber(12.345, 1)).toBe("12,3");
    expect(frNumber(0.05 * 100, 1)).toBe("5,0");
    expect(frNumber(1234567.891, 2)).toBe("1234567,89");
    expect(frNumber(42)).toBe("42");
    expect(frNumber(2.5)).toBe("2,5");
    expect(frNumber(-3.25, 1)).toBe("-3,3");
    expect(frNumber(-0.01, 1)).toBe("0,0");
    expect(frNumber(Number.NaN)).toBe("");
    expect(csvCell(-1.5, { header: "", type: "number", decimals: 1 })).toBe("-1,5");
  });

  it("dates JJ/MM/AAAA, horodatages à l'heure de Tunis", () => {
    expect(frDate("2026-08-31")).toBe("31/08/2026");
    expect(csvCell("2026-08-31T10:00:00.000Z", { header: "", type: "date" })).toBe("31/08/2026");
    expect(frDateTime("2026-08-31T23:30:00.000Z")).toBe("01/09/2026 00:30");
    expect(frDateTime("2026-01-15 08:05:00")).toBe("15/01/2026 09:05");
    expect(frDateTime("2026-01-15")).toBe("15/01/2026");
    expect(frDateTime("pas une date")).toBe("pas une date");
  });

  it("neutralise l'injection de formule (=, +, -, @, tabulation, retour chariot)", () => {
    for (const s of ["=1+1", "+33 6", "-2", "@SUM(A1)", "\tcmd", "\rcmd"]) expect(neutralizeFormula(s)).toBe(`'${s}`);
    expect(neutralizeFormula("Normal = texte")).toBe("Normal = texte");
    expect(csvCell('=HYPERLINK("http://x";"clic")')).toBe(`"'=HYPERLINK(""http://x"";""clic"")"`);
    expect(csvCell("\r=1")).toBe(`"'\r=1"`);
    const csv = toCsv({ columns: [{ header: "=Titre" }], rows: [["@cmd"]] });
    expect(csv).toBe("﻿'=Titre\r\n'@cmd\r\n");
  });

  it("valeurs absentes vides, booléens en mots, colonnes typées par buildTable", () => {
    const t = buildTable(
      [
        { header: "Nom", value: (r: { n: string; p: number | null; ok: boolean }) => r.n },
        { header: "Probabilité (%)", type: "number", decimals: 1, value: (r) => r.p },
        { header: "Actif", value: (r) => r.ok },
      ],
      [
        { n: "A", p: 12.34, ok: true },
        { n: "B", p: null, ok: false },
      ],
    );
    expect(t.columns.map((c) => c.header)).toEqual(["Nom", "Probabilité (%)", "Actif"]);
    expect(toCsv(t)).toBe("﻿Nom;Probabilité (%);Actif\r\nA;12,3;Oui\r\nB;;Non\r\n");
  });
});

describe("paramètres d'export", () => {
  it("reprend seulement les filtres de la page (ni page ni retour), valeurs répétées comprises", () => {
    expect(exportHref("employees", { q: "ben ali", niveau: "ELEVE", page: "3", retour: "/dashboard", tri: "nom" })).toBe("/api/export/employees?q=ben+ali&niveau=ELEVE&tri=nom");
    expect(exportHref("alerts", { status: ["NOUVELLE", "EN_COURS"], page: "2" })).toBe("/api/export/alerts?status=NOUVELLE&status=EN_COURS");
    expect(exportHref("recommendations", {})).toBe("/api/export/recommendations");
    expect(pickExportParams("recommendations", { statut: "PROPOSEE", niveau: "ELEVE" })).toEqual({ statut: "PROPOSEE" });
    expect(searchParamsRecord(new URLSearchParams("a=1&b=2&a=3"))).toEqual({ a: ["1", "3"], b: "2" });
  });
});
