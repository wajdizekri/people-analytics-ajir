import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExportButton } from "@/components/export/export-button";
import { PrintButton } from "@/components/export/print-button";
import { PrintHeader, editedAt } from "@/components/export/print-header";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));

describe("composants d'export et d'impression", () => {
  it("ExportButton : lien de téléchargement avec les filtres courants, masqué à l'impression, plafond signalé", () => {
    const html = renderToStaticMarkup(createElement(ExportButton, { kind: "employees", searchParams: { niveau: "ELEVE", page: "2", retour: "/dashboard" }, total: 120 }));
    expect(html).toContain('href="/api/export/employees?niveau=ELEVE"');
    expect(html).toContain("download");
    expect(html).toContain("Exporter (CSV)");
    expect(html).toContain("print:hidden");
    expect(html).not.toContain("premières lignes");
    const capped = renderToStaticMarkup(createElement(ExportButton, { kind: "alerts", total: 12_345 }));
    expect(capped).toContain('href="/api/export/alerts"');
    expect(capped).toMatch(/limité aux 10\s000 premières lignes sur 12\s345/);
  });

  it("PrintHeader : visible seulement à l'impression, avec date des données, compte, rôle et confidentialité", () => {
    const html = renderToStaticMarkup(createElement(PrintHeader, { title: "Synthèse du mois", dataDate: "2026-08-31", login: "rh.demo", role: "RH" }));
    expect(html).toMatch(/class="[^"]*\bhidden\b[^"]*print:block/);
    for (const s of ["People Analytics · AJIR", "Synthèse du mois", "Données au 31/08/2026", "rh.demo (Responsable RH)", "Document interne — confidentiel", "Édité le"]) expect(html).toContain(s);
    expect(editedAt(new Date("2026-10-02T13:05:00Z"))).toBe("02/10/2026 à 14:05");
  });

  it("PrintButton : bouton « Imprimer / PDF » masqué à l'impression", () => {
    const html = renderToStaticMarkup(createElement(PrintButton));
    expect(html).toContain("Imprimer / PDF");
    expect(html).toContain('type="button"');
    expect(html).toContain("print:hidden");
  });
});
