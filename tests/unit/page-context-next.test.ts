import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/session";

const state = vi.hoisted(() => ({ session: null as SessionUser | null, headers: null as Headers | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  readSession: async () => state.session,
}));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!state.headers) throw new Error("hors requête");
    return state.headers;
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

import { ROUTE_HEADER, pageContext } from "@/lib/dal/context";

const at = (path: string | null) => (state.headers = path == null ? null : new Headers({ [ROUTE_HEADER]: path }));
const target = async () => {
  try {
    await pageContext(["RH"]);
  } catch (e) {
    return (e as Error).message.replace(/^REDIRECT /, "");
  }
  return null;
};

describe("pageContext sans session valide (cookie encore présent) : retour à la page demandée après connexion", () => {
  beforeEach(() => {
    state.session = null;
  });

  it("chemin interne transmis par le proxy → /login?next=<chemin>", async () => {
    at("/employees/79");
    expect(await target()).toBe("/login?next=%2Femployees%2F79");
    at("/previsions");
    expect(await target()).toBe("/login?next=%2Fprevisions");
  });

  it("sans en-tête, accueil, connexion, API ou chemin non interne → /login sans next", async () => {
    for (const p of [null, "/", "/login", "/api/employees", "//evil.example", "/\\evil.example", "/interdit"]) {
      at(p);
      expect(await target(), String(p)).toBe("/login");
    }
  });
});
