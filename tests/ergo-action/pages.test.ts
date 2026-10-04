import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import type { SeedResult } from "../../scripts/seed-dev-ui";
import { cleanupDb, db, setupSeededDb } from "../pilotage/setup";

// Ergonomie des écrans d'action (alertes, recommandations, export) : rendu serveur sans runtime Next
const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
  useLinkStatus: () => ({ pending: false }),
}));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

let file = "";
let seed: SeedResult;
const ids = { emp: 0, dept: 0, deptName: "", turnover: 0, absNew: 0, absOpen: 0 };

beforeAll(async () => {
  ({ file, seed } = await setupSeededDb("ergo-action"));
  const s = db();
  const e = s.prepare("SELECT e.id, e.department_id AS dept, d.name FROM employee e JOIN department d ON d.id = e.department_id ORDER BY e.id LIMIT 1").get() as { id: number; dept: number; name: string };
  Object.assign(ids, { emp: e.id, dept: e.dept, deptName: e.name });
  const add = s.prepare(
    "INSERT INTO alert (type, severity, status, audience, department_id, employee_id, title, message, link, dedup_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'Message de test.', ?, ?, ?)",
  );
  const run = (...a: unknown[]) => Number(add.run(...a).lastInsertRowid);
  ids.turnover = run("TURNOVER", "ATTENTION", "NOUVELLE", "RH", e.dept, e.id, "Risque de départ élevé", `/employees/${e.id}`, "ea-t", "2026-09-01T08:00:00.000Z");
  ids.absNew = run("ABSENTEISME", "INFO", "NOUVELLE", "RH", e.dept, null, "Absentéisme collectif à examiner", `/absenteeism?departement=${e.dept}`, "ea-a1", "2026-09-02T08:00:00.000Z");
  ids.absOpen = run("ABSENTEISME", "ATTENTION", "EN_COURS", "RH", e.dept, null, "Absentéisme en cours d'examen", `/absenteeism?departement=${e.dept}`, "ea-a2", "2026-09-03T08:00:00.000Z");
  run("DONNEES", "CRITIQUE", "NOUVELLE", "ADMIN", null, null, "Import en échec", "/data-health", "ea-d", "2026-09-04T08:00:00.000Z");
});
afterAll(() => cleanupDb(file));

const as = (role: "RH" | "MANAGER" | "ADMIN") =>
  (session.current =
    role === "MANAGER"
      ? { userId: seed.managerUserId, login: "mgr.demo", role, employeeId: seed.managerEmployeeId }
      : { userId: seed.rhUserId, login: role === "RH" ? "rh.demo" : "admin", role, employeeId: null });
const sp = (o: Record<string, string> = {}) => Promise.resolve(o);
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => m.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

// La liste est rendue dans un <Suspense> par un composant asynchrone : on l'appelle directement
async function alertsList(params: Record<string, string> = {}) {
  const Page = (await import("@/app/(app)/alerts/page")).default;
  const tree = (await Page({ searchParams: sp(params) })) as ReactElement<{ children: ReactElement<{ children: ReactElement }>[] }>;
  const [header, suspense] = tree.props.children;
  const content = suspense.props.children as ReactElement<object, (p: object) => Promise<ReactNode>>;
  expect(isValidElement(content)).toBe(true);
  return { header: html(header), list: html(await content.type(content.props)) };
}
async function alertDetail(id: number, retour?: string) {
  const Page = (await import("@/app/(app)/alerts/[id]/page")).default;
  return html(await Page({ params: Promise.resolve({ id: String(id) }), searchParams: sp(retour ? { retour } : {}) }));
}

describe("alertes : liste", () => {
  it("RH : tri annoncé tel qu'il est, périmètre, export dans l'en-tête de la liste, fiche avec retour vers les alertes", async () => {
    as("RH");
    const { header, list } = await alertsList();
    expect(text(header)).toContain("Toute l'entreprise");
    const t = text(list);
    expect(t).not.toContain("nouvelles et en cours d'abord, les plus graves en tête");
    expect(t).not.toContain("les plus récentes d'abord");
    expect(list.indexOf("Exporter (CSV)")).toBeGreaterThan(list.indexOf('id="alertes-liste"'));
    expect(list).toContain(`href="/employees/${ids.emp}?retour=%2Falerts"`);
    expect(list).toContain(`href="/absenteeism?departement=${ids.dept}"`);
    for (const v of ["TURNOVER", "ABSENTEISME", "DONNEES", "SYSTEME"]) expect(list).toContain(`value="${v}"`);
    // retour filtré conservé jusqu'à la fiche
    const filtered = (await alertsList({ type: "TURNOVER" })).list;
    expect(filtered).toContain(`href="/employees/${ids.emp}?retour=%2Falerts%3Ftype%3DTURNOVER"`);
  });

  it("filtre de type limité aux types que le rôle peut recevoir", async () => {
    as("ADMIN");
    const admin = (await alertsList()).list;
    expect(admin).not.toContain('value="TURNOVER"');
    expect(admin).not.toContain('value="ABSENTEISME"');
    expect(admin).toContain('value="DONNEES"');
    expect(admin).toContain('value="SYSTEME"');
    as("MANAGER");
    const mgr = (await alertsList()).list;
    expect(mgr).toContain('value="TURNOVER"');
    expect(mgr).not.toContain('value="DONNEES"');
    expect(mgr).not.toContain('value="SYSTEME"');
  });

  it("états vides : titre seul, sans point final, action pour élargir", async () => {
    as("MANAGER");
    const none = text((await alertsList({ status: "NOUVELLE" })).list);
    expect(none).toContain("Aucune alerte nouvelle");
    expect(none).not.toContain("Toutes les alertes ont été prises en charge.");
    expect(none).toContain("Afficher toutes les alertes");
    as("RH");
    const filtered = text((await alertsList({ type: "SYSTEME" })).list);
    expect(filtered).toContain("Aucune alerte ne correspond à ces filtres Afficher toutes les alertes");
  });
});

describe("alertes : détail", () => {
  it("alerte suivante dans la même sélection que la liste d'origine (type)", async () => {
    as("RH");
    const sel = await alertDetail(ids.absOpen, "/alerts?type=ABSENTEISME");
    expect(sel).toContain(`href="/alerts/${ids.absNew}?retour=%2Falerts%3Ftype%3DABSENTEISME"`);
    expect(sel).not.toContain(`href="/alerts/${ids.turnover}`);
    expect(text(sel)).toContain("Traiter l'alerte nouvelle suivante");
    // sans sélection : la plus urgente des nouvelles (gravité « Attention » avant « Information »)
    const all = await alertDetail(ids.absOpen);
    expect(all).toContain(`href="/alerts/${ids.turnover}"`);
  });

  it("sélection épuisée : message et lien de retour ; département lié à l'absentéisme", async () => {
    as("RH");
    const done = await alertDetail(ids.absOpen, "/alerts?type=ABSENTEISME&severity=CRITIQUE");
    const t = text(done);
    expect(t).toContain("Aucune autre alerte nouvelle dans cette sélection");
    expect(done).toMatch(/href="\/alerts\?type=ABSENTEISME&amp;severity=CRITIQUE"[^>]*>Revenir à la liste/);
    const name = ids.deptName.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(done).toMatch(new RegExp(`<dd[^>]*><a href="/absenteeism\\?departement=${ids.dept}"[^>]*>${name}</a>`));
  });

  it("fiche du collaborateur ouverte avec retour vers cette alerte ; libellés E2E inchangés", async () => {
    as("RH");
    const d = await alertDetail(ids.turnover, "/alerts?status=NOUVELLE");
    expect(d).toContain(`href="/employees/${ids.emp}?retour=%2Falerts%2F${ids.turnover}"`);
    expect(d).not.toContain(`href="/employees/${ids.emp}"`);
    const t = text(d);
    for (const s of ["Prendre en charge l'alerte", "Rejeter l'alerte", "Toutes les alertes", "Suivi de l'alerte", "Action proposée", "Voir la fiche de"]) expect(t).toContain(s);
    // alerte nouvelle : pas d'enchaînement proposé tant qu'elle n'est pas prise en charge
    expect(t).not.toContain("Aucune autre alerte nouvelle");
  });
});

describe("recommandations", () => {
  it("décision depuis la liste : conséquence du rejet nommant la personne et l'action ; interventions reliées", async () => {
    const { RecoDecision } = await import("@/app/(app)/recommendations/reco-decision");
    const m = html(createElement(RecoDecision, { recommendationId: 7, open: true, today: "2026-10-04", who: "Ben Salah Amine", what: "Entretien de rétention", action: async () => ({}) }));
    expect(m).toContain("<strong>Ben Salah Amine</strong>");
    expect(text(m)).toContain("La recommandation « Entretien de rétention » pour Ben Salah Amine sera classée « Rejetée », sans intervention enregistrée.");
    for (const s of ["Marquer comme réalisée", "Rejeter la recommandation", "Confirmer le rejet", "Motif du rejet"]) expect(m).toContain(s);

    as("RH");
    const Page = (await import("@/app/(app)/recommendations/page")).default;
    const p = html(await Page({ searchParams: sp() }));
    expect(p).toMatch(/href="\/interventions"[^>]*>Voir les interventions/);
    if (p.includes("Page <span")) expect(text(p)).toMatch(/1–25 sur \d/);
  });

  it("formulaire dépliable : plus de window.confirm, rejet confirmé avec conséquence", async () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/components/pilotage/recommendation-forms.tsx"), "utf8");
    expect(src).not.toContain("window.confirm");
    const { DecideForm } = await import("@/components/pilotage/recommendation-forms");
    const m = html(createElement(DecideForm, { recommendationId: 3, today: "2026-10-04", action: async () => ({}) }));
    expect(m).toContain("Enregistrer la réalisation");
  });

  it("état vide : plus rien en attente de décision", async () => {
    as("RH");
    db().prepare("UPDATE recommendation SET status = 'REJETEE' WHERE status = 'PROPOSEE'").run();
    const Page = (await import("@/app/(app)/recommendations/page")).default;
    const t = text(html(await Page({ searchParams: sp({ statut: "PROPOSEE" }) })));
    expect(t).toContain("Aucune recommandation en attente de décision");
    expect(t).not.toContain("Toutes les recommandations ont été décidées.");
    expect(t).toContain("Afficher toutes les recommandations");
  });
});

describe("export et impression", () => {
  it("tout élément présenté en bouton est masqué à l'impression (pagination désactivée, résumés)", () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), "src/components/export/print.css"), "utf8");
    expect(css).toContain('#contenu [class~="active:translate-y-px"]');
  });

  it("bouton d'export compact dans l'en-tête de liste : icône + texte, cible de 40 px", async () => {
    const { ExportButton } = await import("@/components/export/export-button");
    const m = html(createElement(ExportButton, { kind: "alerts", total: 3, size: "sm" }));
    expect(m).toContain("min-h-10");
    expect(m).toContain("Exporter (CSV)");
    expect(m).toContain("<svg");
  });
});
