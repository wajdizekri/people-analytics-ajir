import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantAnswer, RagChunk, RagHit } from "@/lib/rag/types";

// Modules rag simulés : ce fichier vérifie le service (validation, rôle, limite d'usage, audit), pas la recherche.
const rag = vi.hoisted(() => ({
  search: vi.fn(),
  answer: vi.fn(),
  config: vi.fn(),
}));
vi.mock("@/lib/rag", () => ({ searchCorpus: rag.search, sanitizeQuery: vi.fn() }));
vi.mock("@/lib/rag/answer", () => ({ answerQuestion: rag.answer, assistantAiConfig: rag.config, extractiveAnswer: vi.fn() }));

import { getDb } from "@/db/client";
import { describeAudit, actionLabel } from "@/components/admin/audit-labels";
import { RATE_RULES, consume, resetRateLimits } from "@/lib/auth/rate-limit";
import { askAssistant } from "@/lib/dal/assistant";
import { HttpError } from "@/lib/dal/errors";
import { auditRows, setupDb, teardownDb } from "../ui-admin/helpers";

const QUESTION = "Comment lire le niveau de risque Zorglub ?";
const chunk = (id: string, roles: RagChunk["roles"]): RagChunk => ({ id, title: `Titre ${id}`, text: `Texte ${id}`, roles, href: "/aide#glossaire", source: "help:faq" });
const hit = (id: string, roles: RagChunk["roles"], score = 1): RagHit => ({ chunk: chunk(id, roles), score });
const extrait: AssistantAnswer = { mode: "EXTRAIT", answer: "Extrait de l'aide.", sources: [{ title: "Niveau de risque", href: "/aide#glossaire" }] };
const meta = { source: "api" as const, ip: "10.0.0.1" };

let fx: ReturnType<typeof setupDb>;
beforeAll(() => {
  fx = setupDb("rag-dal");
});
afterAll(() => teardownDb(fx.file));

beforeEach(() => {
  resetRateLimits();
  rag.search.mockReset().mockImplementation((_q: string, role: string) => [hit("a", [role as RagChunk["roles"][number]]), hit("b", ["ADMIN", "RH", "MANAGER"], 0.5)]);
  rag.answer.mockReset().mockResolvedValue(extrait);
  rag.config.mockReset().mockReturnValue(null);
});

async function httpError(p: Promise<unknown>): Promise<HttpError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  return err as HttpError;
}

describe("askAssistant", () => {
  it("cherche avec la question nettoyée et le rôle de la session, puis renvoie la réponse", async () => {
    const res = await askAssistant(fx.ctx.rh, { question: `  ${QUESTION}  ` }, meta);
    expect(res).toEqual(extrait);
    expect(rag.search).toHaveBeenCalledWith(QUESTION, "RH");
    expect(rag.answer).toHaveBeenCalledWith(QUESTION, expect.any(Array), { config: null });
    expect(rag.answer.mock.calls[0][1]).toHaveLength(2);
  });

  it("le rôle vient uniquement du contexte : un champ « role » du corps est ignoré", async () => {
    await askAssistant(fx.ctx.mgr, { question: QUESTION, role: "RH" }, meta);
    expect(rag.search).toHaveBeenCalledWith(QUESTION, "MANAGER");
    await askAssistant(fx.ctx.admin, { question: QUESTION, role: "RH" }, meta);
    expect(rag.search).toHaveBeenLastCalledWith(QUESTION, "ADMIN");
  });

  it("écarte tout passage réservé à un autre rôle, même renvoyé par la recherche", async () => {
    rag.search.mockReturnValue([hit("rh-seul", ["RH"]), hit("commun", ["RH", "MANAGER"])]);
    await askAssistant(fx.ctx.mgr, { question: QUESTION }, meta);
    const passed = rag.answer.mock.calls[0][1] as RagHit[];
    expect(passed.map((h) => h.chunk.id)).toEqual(["commun"]);
  });

  it("transmet la configuration IA générative si elle existe", async () => {
    const config = { apiKey: "cle-test", model: "modele-test" };
    rag.config.mockReturnValue(config);
    await askAssistant(fx.ctx.rh, { question: QUESTION }, meta);
    expect(rag.answer).toHaveBeenCalledWith(QUESTION, expect.any(Array), { config });
  });

  it("400 propre sur une question absente, trop courte ou trop longue, sans recherche ni audit", async () => {
    const before = auditRows("assistant.ask").length;
    const cases: [unknown, RegExp][] = [
      [{ question: "ab" }, /trop courte/],
      [{ question: "   a    " }, /trop courte/],
      [{ question: "x".repeat(301) }, /trop longue/],
      [{ question: 42 }, /absente/],
      [{}, /absente/],
      [null, /absente/],
      ["Comment ?", /absente/],
    ];
    for (const [input, message] of cases) {
      const err = await httpError(askAssistant(fx.ctx.rh, input, meta));
      expect(err.status).toBe(400);
      expect(err.code).toBe("QUESTION_INVALIDE");
      expect(err.message).toMatch(message);
    }
    expect(rag.search).not.toHaveBeenCalled();
    expect(auditRows("assistant.ask")).toHaveLength(before);
    await expect(askAssistant(fx.ctx.rh, { question: "x".repeat(300) }, meta)).resolves.toEqual(extrait);
    await expect(askAssistant(fx.ctx.rh, { question: "abc" }, meta)).resolves.toEqual(extrait);
  });

  it("429 en français après 30 questions en 15 minutes, par utilisateur, chaque question comptée", async () => {
    for (let i = 0; i < RATE_RULES.assistant.limit; i++) await askAssistant(fx.ctx.mgr, { question: `${QUESTION} ${i}` }, meta);
    const err = await httpError(askAssistant(fx.ctx.mgr, { question: QUESTION }, meta));
    expect(err.status).toBe(429);
    expect(err.code).toBe("TROP_DE_QUESTIONS");
    expect(err.message).toMatch(/^Vous avez posé beaucoup de questions en peu de temps\. Réessayez dans 15 minutes\.$/);
    expect(rag.search).toHaveBeenCalledTimes(RATE_RULES.assistant.limit);
    const refused = auditRows("assistant.ask").at(-1)!;
    expect(refused.outcome).toBe("REFUSE");
    expect(JSON.parse(refused.detail_json!)).toEqual({ source: "api", length: QUESTION.length, reason: "limite_usage" });
    await expect(askAssistant(fx.ctx.mgr2, { question: QUESTION }, meta)).resolves.toEqual(extrait);
  });

  it("consume compte chaque appel et libère la clé à la fin de la fenêtre", () => {
    const rule = { limit: 2, windowMs: 1000 };
    expect(consume("k", rule, 0)).toBe(0);
    expect(consume("k", rule, 10)).toBe(0);
    expect(consume("k", rule, 20)).toBe(980);
    expect(consume("k", rule, 1000)).toBe(0);
  });

  it("échec de la recherche : erreur propagée, audit ECHEC", async () => {
    rag.search.mockImplementation(() => {
      throw new Error("corpus absent");
    });
    await expect(askAssistant(fx.ctx.rh, { question: QUESTION }, meta)).rejects.toThrow("corpus absent");
    const row = auditRows("assistant.ask").at(-1)!;
    expect(row.outcome).toBe("ECHEC");
    expect(JSON.parse(row.detail_json!)).toEqual({ source: "api", length: QUESTION.length, hits: 0, reason: "erreur_interne" });
  });

  it("audit assistant.ask : longueur, passages et mode, jamais le texte de la question", async () => {
    rag.answer.mockResolvedValueOnce({ mode: "AUCUN", answer: "L'aide ne couvre pas cette question.", sources: [] });
    await askAssistant(fx.ctx.rh, { question: QUESTION }, meta);
    const rows = getDb().sqlite.prepare("SELECT * FROM audit_log WHERE action = 'assistant.ask' ORDER BY id").all() as Record<string, unknown>[];
    const last = rows.at(-1)!;
    expect(last).toMatchObject({ user_id: fx.users.rh, outcome: "OK", target_type: "assistant", ip: "10.0.0.1" });
    expect(JSON.parse(last.detail_json as string)).toEqual({ source: "api", length: QUESTION.length, hits: 2, mode: "AUCUN" });
    const all = JSON.stringify(getDb().sqlite.prepare("SELECT * FROM audit_log").all());
    expect(all).not.toContain("Zorglub");
    expect(all).not.toContain("niveau de risque");

    const entry = { action: "assistant.ask", outcome: "OK" as const, login: "rh", targetType: "assistant", targetId: null, detail: last.detail_json as string };
    expect(describeAudit(entry)).toBe(`rh a posé une question à l'assistant d'aide (${QUESTION.length} caractères, 2 passages, aucune réponse dans l'aide).`);
    expect(describeAudit({ ...entry, detail: JSON.stringify({ length: 12, hits: 1, mode: "EXTRAIT" }) }, new Map(), true)).toBe(
      "Vous avez posé une question à l'assistant d'aide (12 caractères, 1 passage, extrait de l'aide).",
    );
    expect(describeAudit({ ...entry, outcome: "REFUSE", detail: JSON.stringify({ length: 12, reason: "limite_usage" }) })).toBe(
      "rh a tenté de poser une question à l'assistant d'aide (12 caractères, limite d'usage atteinte) : accès refusé.",
    );
    expect(actionLabel("assistant.ask")).toBe("Poser une question à l'assistant d'aide");
  });
});
