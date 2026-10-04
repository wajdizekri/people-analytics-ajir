import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftSentences } from "@/lib/ai/narrative";
import {
  DEFAULT_NARRATIVE_MODEL,
  FAILURE_RETRY_MS,
  NARRATIVE_API_URL,
  clearNarrativeCache,
  narrativeAiConfig,
  narrativeFor,
  type NarrativeCall,
} from "@/lib/ai/narrative/generative";
import { facts, fakeApi, forbiddenFetch, hangingApi } from "./helpers";

// Reformulation par IA générative avec fetch simulé : aucun appel réel. Repli sur les phrases types à chaque échec.
const CONFIG = { apiKey: "cle-de-test", model: DEFAULT_NARRATIVE_MODEL };
const F = facts();
const GOOD =
  "Fin août 2026, toute l'entreprise compte 1 234 collaborateurs, soit 12 de plus qu'en juillet 2026. " +
  "On relève 20 entrées et 8 sorties, dont 5 départs volontaires. " +
  "24 collaborateurs sont en risque élevé, dont 6 nouveaux. " +
  "L'absentéisme hors santé passe de 3,1 % à 4,2 %. " +
  "Il reste 5 alertes, dont 2 critiques, et 7 recommandations à décider. " +
  "Ce niveau de risque est une estimation fondée sur des facteurs associés ; la décision vous revient.";

let calls: NarrativeCall[];
const run = (fetchImpl: typeof fetch, extra: Partial<Parameters<typeof narrativeFor>[1]> = {}, f = F) =>
  narrativeFor(f, { config: CONFIG, scopeKey: "RH", fetchImpl, onCall: (c) => calls.push(c), ...extra });

beforeEach(() => {
  clearNarrativeCache();
  calls = [];
  vi.stubGlobal("fetch", forbiddenFetch());
});
afterEach(() => vi.unstubAllGlobals());

describe("activation par variable d'environnement", () => {
  it("clé absente ou vide : désactivée ; la variable générique ANTHROPIC_API_KEY ne suffit pas", () => {
    expect(narrativeAiConfig({})).toBeNull();
    expect(narrativeAiConfig({ SYNTHESIS_AI_API_KEY: "   " })).toBeNull();
    expect(narrativeAiConfig({ ANTHROPIC_API_KEY: "sk-ant-xxx" })).toBeNull();
    expect(narrativeAiConfig({ SYNTHESIS_AI_API_KEY: " sk-test " })).toEqual({ apiKey: "sk-test", model: "claude-opus-5-5" });
    expect(narrativeAiConfig({ SYNTHESIS_AI_API_KEY: "k", SYNTHESIS_AI_MODEL: "claude-sonnet-5-5" })?.model).toBe("claude-sonnet-5-5");
    expect(narrativeAiConfig({ SYNTHESIS_AI_API_KEY: "k", SYNTHESIS_AI_MODEL: "gpt-x; rm -rf" })?.model).toBe("claude-opus-5-5");
  });

  it("sans clé : phrases types, aucun appel réseau, aucun audit", async () => {
    const fetchImpl = forbiddenFetch();
    const n = await narrativeFor(F, { config: null, scopeKey: "RH", fetchImpl, onCall: (c) => calls.push(c) });
    expect(n).toEqual({ source: "GABARIT", sentences: draftSentences(F), model: null, fallback: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("appel de l'API et vérification", () => {
  it("réussite : texte vérifié affiché avec le modèle ; en-têtes, délai et charge conformes ; audit sans contenu", async () => {
    const api = fakeApi({ text: GOOD });
    const n = await run(api);
    expect(n.source).toBe("IA");
    expect(n.model).toBe("claude-opus-5-5");
    expect(n.sentences).toHaveLength(6);
    expect(n.fallback).toBeNull();
    expect(api).toHaveBeenCalledTimes(1);
    const [url, init] = api.mock.calls[0];
    expect(url).toBe(NARRATIVE_API_URL);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "content-type": "application/json", "x-api-key": "cle-de-test", "anthropic-version": "2023-06-01" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = String(init?.body);
    expect(calls).toEqual([{ outcome: "OK", reason: "ok", payloadBytes: Buffer.byteLength(body, "utf8"), model: "claude-opus-5-5", durationMs: expect.any(Number) }]);
    expect(JSON.stringify(calls)).not.toContain("collaborateurs");
  });

  it("cache : même mois, même périmètre, mêmes agrégats → un seul appel ; autre périmètre ou autres agrégats → nouvel appel", async () => {
    const api = fakeApi({ text: GOOD });
    await run(api);
    await run(api);
    expect(api).toHaveBeenCalledTimes(1);
    await run(api, { scopeKey: "MANAGER:12" });
    expect(api).toHaveBeenCalledTimes(2);
    await run(api, {}, facts({ alertsOpen: 6 }));
    expect(api).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(3);
  });

  it("affichages simultanés : une seule requête partagée", async () => {
    const api = fakeApi({ text: GOOD });
    const [a, b] = await Promise.all([run(api), run(api)]);
    expect(api).toHaveBeenCalledTimes(1);
    expect(a.source).toBe("IA");
    expect(b.source).toBe("IA");
  });

  it("chiffre absent de la charge utile : texte écarté, repli sur les phrases types", async () => {
    const n = await run(fakeApi({ text: GOOD.replace("24 collaborateurs", "26 collaborateurs") }));
    expect(n).toEqual({ source: "GABARIT", sentences: draftSentences(F), model: null, fallback: "nombre_non_fourni" });
    expect(calls[0]).toMatchObject({ outcome: "ECHEC", reason: "nombre_non_fourni" });
  });

  it("erreur HTTP, réponse tronquée, réponse illisible, réseau coupé : repli", async () => {
    expect((await run(fakeApi({ status: 401 }))).fallback).toBe("http_401");
    clearNarrativeCache();
    expect((await run(fakeApi({ status: 529 }))).fallback).toBe("http_529");
    clearNarrativeCache();
    expect((await run(fakeApi({ text: GOOD, stopReason: "max_tokens" }))).fallback).toBe("arret_max_tokens");
    clearNarrativeCache();
    const garbage = vi.fn(async () => new Response("<html>proxy</html>", { status: 200 }));
    expect((await run(garbage)).fallback).toBe("reponse_invalide");
    clearNarrativeCache();
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const n = await run(offline);
    expect(n).toMatchObject({ source: "GABARIT", fallback: "reseau" });
    expect(n.sentences).toEqual(draftSentences(F));
    expect(calls.map((c) => c.outcome)).toEqual(["ECHEC", "ECHEC", "ECHEC", "ECHEC", "ECHEC"]);
  });

  it("délai dépassé : appel abandonné, repli sans attendre davantage", async () => {
    const api = hangingApi();
    const started = Date.now();
    const n = await run(api, { timeoutMs: 30 });
    expect(n).toMatchObject({ source: "GABARIT", fallback: "delai" });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(calls[0]).toMatchObject({ outcome: "ECHEC", reason: "delai" });
  });

  it("après un échec, pas de nouvel appel avant le délai de reprise", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const failing = fakeApi({ status: 500 });
    await run(failing, { now });
    await run(failing, { now });
    expect(failing).toHaveBeenCalledTimes(1);
    clock += FAILURE_RETRY_MS + 1;
    const ok = fakeApi({ text: GOOD });
    expect((await run(ok, { now })).source).toBe("IA");
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("le fetch global est utilisé par défaut (simulé ici), jamais un appel réel", async () => {
    const api = fakeApi({ text: GOOD });
    vi.stubGlobal("fetch", api);
    const n = await narrativeFor(F, { config: CONFIG, scopeKey: "RH" });
    expect(n.source).toBe("IA");
    expect(api).toHaveBeenCalledTimes(1);
  });
});
