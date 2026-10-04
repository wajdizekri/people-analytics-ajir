import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { nextAllowedFor, safeNextPath } from "@/app/login/next-path";

describe("destination après connexion (?next=)", () => {
  it("chemins internes seulement, jamais la connexion, l'activation ni une API", () => {
    expect(safeNextPath("/employees?niveau=ELEVE")).toBe("/employees?niveau=ELEVE");
    expect(safeNextPath("/go/collaborateur/M10451")).toBe("/go/collaborateur/M10451");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "javascript:alert(1)", "/login?next=/x", "/api/me", "/activation?token=x", "/", "", undefined, 42])
      expect(safeNextPath(bad), String(bad)).toBeNull();
    expect(safeNextPath(["/alerts", "/x"])).toBe("/alerts");
    expect(safeNextPath(`/employees?q=${"a".repeat(600)}`)).toBeNull();
  });

  it("page accessible au rôle, sinon accueil du rôle", () => {
    expect(nextAllowedFor("ADMIN", "/admin/users")).toBe(true);
    expect(nextAllowedFor("ADMIN", "/transparency")).toBe(true);
    expect(nextAllowedFor("ADMIN", "/dashboard")).toBe(false);
    expect(nextAllowedFor("ADMIN", "/go/collaborateur/M1")).toBe(false);
    expect(nextAllowedFor("RH", "/employees/12?retour=%2Femployees")).toBe(true);
    expect(nextAllowedFor("RH", "/admin/settings")).toBe(false);
    expect(nextAllowedFor("MANAGER", "/go/collaborateur/M1")).toBe(true);
    expect(nextAllowedFor("MANAGER", "/recommendations")).toBe(false);
    expect(nextAllowedFor("MANAGER", "/backtesting")).toBe(false);
  });
});
