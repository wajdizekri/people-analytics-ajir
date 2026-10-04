import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionUser } from "@/lib/auth/session";
import type { AssistantAnswer } from "@/lib/rag/types";

const state = vi.hoisted(() => ({ session: null as SessionUser | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  readSession: async () => state.session,
}));

// Modules rag simulés : seule la route est vérifiée ici.
const rag = vi.hoisted(() => ({ search: vi.fn(), answer: vi.fn() }));
vi.mock("@/lib/rag", () => ({ searchCorpus: rag.search, sanitizeQuery: vi.fn() }));
vi.mock("@/lib/rag/answer", () => ({ answerQuestion: rag.answer, assistantAiConfig: () => null, extractiveAnswer: vi.fn() }));

import { getDb } from "@/db/client";
import { RATE_RULES, resetRateLimits } from "@/lib/auth/rate-limit";
import * as route from "@/app/api/assistant/route";
import { auditRows, setupDb, teardownDb } from "../ui-admin/helpers";

const QUESTION = "Que signifie le facteur Zorglub associé ?";
const extrait: AssistantAnswer = { mode: "EXTRAIT", answer: "Extrait de l'aide.", sources: [{ title: "Facteurs associés", href: "/aide#glossaire" }] };

let fx: ReturnType<typeof setupDb>;
beforeAll(() => {
  fx = setupDb("rag-api");
});
afterAll(() => teardownDb(fx.file));

beforeEach(() => {
  resetRateLimits();
  rag.search.mockReset().mockReturnValue([]);
  rag.answer.mockReset().mockResolvedValue(extrait);
});

const as = (who: "admin" | "rh" | "mgr" | null) => {
  state.session = who ? { ...fx.ctx[who] } : null;
};
const noParams = { params: Promise.resolve({}) };
const post = (body: BodyInit | null, headers?: Record<string, string>) =>
  route.POST(new NextRequest("http://localhost/api/assistant", { method: "POST", body, headers }), noParams);
const ask = (payload: unknown) => post(JSON.stringify(payload), { "content-type": "application/json" });

describe("POST /api/assistant", () => {
  it("401 sans session, 403 depuis une origine étrangère ; rien n'est cherché", async () => {
    as(null);
    const anon = await ask({ question: QUESTION });
    expect(anon.status).toBe(401);
    expect((await anon.json()).error.code).toBe("NON_AUTHENTIFIE");
    as("rh");
    const cross = await post(JSON.stringify({ question: QUESTION }), { origin: "https://evil.example", host: "localhost" });
    expect(cross.status).toBe(403);
    expect((await cross.json()).error.code).toBe("ORIGINE_INVALIDE");
    expect(rag.search).not.toHaveBeenCalled();
  });

  it("200 pour les trois rôles, réponse AssistantAnswer non mise en cache", async () => {
    for (const [who, role] of [["admin", "ADMIN"], ["rh", "RH"], ["mgr", "MANAGER"]] as const) {
      as(who);
      const res = await ask({ question: QUESTION });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual(extrait);
      expect(rag.search).toHaveBeenLastCalledWith(QUESTION, role);
    }
  });

  it("un MANAGER qui envoie { role: \"RH\" } reste MANAGER", async () => {
    as("mgr");
    const res = await ask({ question: QUESTION, role: "RH", userId: fx.users.rh });
    expect(res.status).toBe(200);
    expect(rag.search).toHaveBeenCalledWith(QUESTION, "MANAGER");
    expect(rag.search).not.toHaveBeenCalledWith(expect.anything(), "RH");
    expect(auditRows("assistant.ask").at(-1)!.user_id).toBe(fx.users.mgr);
  });

  it("400 sur un corps illisible ou une question hors bornes, 413 au-delà de 2 Ko", async () => {
    as("rh");
    for (const body of ["pas du json", "", "{\"question\":"]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("CORPS_INVALIDE");
    }
    for (const question of ["ab", "x".repeat(301)]) {
      const res = await ask({ question });
      expect(res.status).toBe(400);
      const err = (await res.json()).error;
      expect(err.code).toBe("QUESTION_INVALIDE");
      expect(err.message).toMatch(/^Question trop (courte|longue)/);
    }
    const big = await ask({ question: QUESTION, padding: "x".repeat(3000) });
    expect(big.status).toBe(413);
    expect((await big.json()).error.code).toBe("TROP_VOLUMINEUX");
    expect((await post(JSON.stringify({ question: QUESTION }), { "content-length": "999999" })).status).toBe(413);
    expect(rag.search).not.toHaveBeenCalled();
  });

  it("429 en français à la 31e question en 15 minutes", async () => {
    as("rh");
    for (let i = 0; i < RATE_RULES.assistant.limit; i++) expect((await ask({ question: `${QUESTION} ${i}` })).status).toBe(200);
    const res = await ask({ question: QUESTION });
    expect(res.status).toBe(429);
    const err = (await res.json()).error;
    expect(err.code).toBe("TROP_DE_QUESTIONS");
    expect(err.message).toMatch(/Réessayez dans 15 minutes\./);
  });

  it("aucune ligne d'audit ne contient le texte de la question", async () => {
    as("mgr");
    await ask({ question: QUESTION });
    const rows = auditRows("assistant.ask");
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.parse(rows.at(-1)!.detail_json!)).toEqual({ source: "api", length: QUESTION.length, hits: 0, mode: "EXTRAIT" });
    const all = JSON.stringify(getDb().sqlite.prepare("SELECT * FROM audit_log").all());
    expect(all).not.toContain("Zorglub");
    expect(all).not.toContain("facteur");
  });
});
