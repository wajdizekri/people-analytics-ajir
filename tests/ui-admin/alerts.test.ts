import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import { countAlerts, getAlert, listAlerts, updateAlert } from "@/lib/dal/alerts";
import { HttpError } from "@/lib/dal/errors";
import { auditRows, setupDb, teardownDb } from "./helpers";

let fx: ReturnType<typeof setupDb>;
const ids: Record<string, number> = {};

function alert(key: string, a: { type: string; audience: string; managerId?: number | null; employeeId?: number | null; status?: string }) {
  ids[key] = Number(
    getDb()
      .sqlite.prepare(
        `INSERT INTO alert (type, severity, status, audience, manager_id, employee_id, title, message, dedup_key)
         VALUES (?, 'ATTENTION', ?, ?, ?, ?, ?, 'message', ?)`,
      )
      .run(a.type, a.status ?? "NOUVELLE", a.audience, a.managerId ?? null, a.employeeId ?? null, key, key).lastInsertRowid,
  );
}

beforeAll(() => {
  fx = setupDb("alerts");
  const e = fx.emp;
  alert("turnoverMgrE2", { type: "TURNOVER", audience: "MANAGER", managerId: e.SUB, employeeId: e.E2 });
  alert("absCollectiveRoot", { type: "ABSENTEISME", audience: "MANAGER", managerId: e.MGR });
  alert("absCollectiveSub", { type: "ABSENTEISME", audience: "MANAGER", managerId: e.SUB });
  alert("absIndividualRh", { type: "ABSENTEISME", audience: "RH", managerId: e.SUB, employeeId: e.E3 });
  alert("absIndividualMisrouted", { type: "ABSENTEISME", audience: "MANAGER", managerId: e.SUB, employeeId: e.E3 });
  alert("turnoverRhE1", { type: "TURNOVER", audience: "RH", managerId: e.MGR, employeeId: e.E1 });
  alert("systemAdmin", { type: "SYSTEME", audience: "ADMIN" });
  alert("dataRh", { type: "DONNEES", audience: "RH" });
  alert("turnoverOtherTeam", { type: "TURNOVER", audience: "MANAGER", managerId: fx.emp.MGR2, employeeId: e.E4 });
  alert("staleManagerOtherEmployee", { type: "TURNOVER", audience: "MANAGER", managerId: e.MGR, employeeId: e.E4 });
  alert("collectiveOtherTeam", { type: "ABSENTEISME", audience: "MANAGER", managerId: e.MGR2 });
});

afterAll(() => teardownDb(fx.file));

const titles = (list: { title: string }[]) => list.map((a) => a.title).sort();

describe("visibilité des alertes", () => {
  it("un manager ne voit que l'audience MANAGER de sa hiérarchie, jamais RH/ADMIN ni l'absentéisme individuel", () => {
    expect(titles(listAlerts(fx.ctx.mgr))).toEqual(["absCollectiveRoot", "absCollectiveSub", "turnoverMgrE2"]);
    expect(titles(listAlerts(fx.ctx.mgr2))).toEqual(["collectiveOtherTeam", "staleManagerOtherEmployee", "turnoverOtherTeam"]);
  });

  it("filtre par type pour un manager sans élargir le périmètre", () => {
    expect(titles(listAlerts(fx.ctx.mgr, { type: "ABSENTEISME" }))).toEqual(["absCollectiveRoot", "absCollectiveSub"]);
  });

  it("RH voit tout sauf l'audience ADMIN ; ADMIN seulement le système et les données, jamais une alerte nominative", () => {
    const rh = titles(listAlerts(fx.ctx.rh));
    expect(rh).not.toContain("systemAdmin");
    expect(rh).toContain("absIndividualRh");
    expect(rh).toHaveLength(Object.keys(ids).length - 1);
    expect(titles(listAlerts(fx.ctx.admin))).toEqual(["dataRh", "systemAdmin"]);
    expect(() => getAlert(fx.ctx.admin, ids.turnoverRhE1)).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it("détail hors périmètre : 403 et refus journalisé ; inexistant : 404", () => {
    expect(() => getAlert(fx.ctx.mgr, ids.absIndividualRh)).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => getAlert(fx.ctx.rh, ids.systemAdmin)).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() => getAlert(fx.ctx.mgr, 999_999)).toThrowError(expect.objectContaining({ status: 404 }));
    expect(auditRows("alert.view").filter((r) => r.outcome === "REFUSE" && r.user_id === fx.users.mgr)).toHaveLength(1);
    expect(getAlert(fx.ctx.mgr, ids.turnoverMgrE2).title).toBe("turnoverMgrE2");
  });
});

describe("workflow des alertes", () => {
  it("un manager ne peut pas modifier une alerte hors périmètre", () => {
    expect(() => updateAlert(fx.ctx.mgr, ids.turnoverOtherTeam, { status: "EN_COURS" })).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it("NOUVELLE -> EN_COURS -> REJETEE avec commentaire obligatoire, transitions invalides refusées", () => {
    const id = ids.turnoverMgrE2;
    expect(() => updateAlert(fx.ctx.mgr, id, { status: "TRAITEE" })).toThrowError(HttpError);
    expect(updateAlert(fx.ctx.mgr, id, { status: "EN_COURS" }).status).toBe("EN_COURS");
    expect(() => updateAlert(fx.ctx.mgr, id, { status: "REJETEE" })).toThrowError(ZodError);
    expect(() => updateAlert(fx.ctx.mgr, id, { status: "REJETEE", comment: "  " })).toThrowError(ZodError);
    const done = updateAlert(fx.ctx.mgr, id, { status: "REJETEE", comment: "Départ déjà anticipé, poste en cours de remplacement." });
    expect(done.status).toBe("REJETEE");
    expect(done.comment).toContain("remplacement");
    expect(done.updatedByLogin).toBe("mgr");
    expect(() => updateAlert(fx.ctx.rh, id, { status: "EN_COURS" })).toThrowError(expect.objectContaining({ status: 409 }));
    const log = auditRows("alert.update").filter((r) => r.outcome === "OK");
    expect(log.map((r) => JSON.parse(r.detail_json ?? "{}").to)).toEqual(["EN_COURS", "REJETEE"]);
  });

  it("RH traite une alerte RH", () => {
    const id = ids.dataRh;
    updateAlert(fx.ctx.rh, id, { status: "EN_COURS" });
    expect(updateAlert(fx.ctx.rh, id, { status: "TRAITEE" }).status).toBe("TRAITEE");
  });
});

describe("comptage exact et pagination des alertes", () => {
  it("countAlerts suit la visibilité et les filtres de listAlerts, sans plafond ; offset pour la pagination", () => {
    for (const ctx of [fx.ctx.rh, fx.ctx.mgr, fx.ctx.admin]) {
      expect(countAlerts(ctx)).toBe(listAlerts(ctx, { limit: 500 }).length);
      expect(countAlerts(ctx, { type: "ABSENTEISME" })).toBe(listAlerts(ctx, { type: "ABSENTEISME", limit: 500 }).length);
      expect(countAlerts(ctx, { status: "NOUVELLE", severity: "ATTENTION" })).toBe(listAlerts(ctx, { status: "NOUVELLE", severity: "ATTENTION", limit: 500 }).length);
    }
    const all = listAlerts(fx.ctx.rh, { limit: 500 }).map((a) => a.id);
    const pages = [...listAlerts(fx.ctx.rh, { limit: 2, offset: 0 }), ...listAlerts(fx.ctx.rh, { limit: 2, offset: 2 }), ...listAlerts(fx.ctx.rh, { limit: 500, offset: 4 })].map((a) => a.id);
    expect(pages).toEqual(all);
    expect(countAlerts(fx.ctx.rh, { severity: "CRITIQUE" })).toBe(0);
  });
});
