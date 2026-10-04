import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSISTANT_API_URL,
  EXTRACT_MAX_CHARS,
  FALLBACK_NOTICE,
  NO_ANSWER,
  PERSONAL_ID_NOTICE,
  aiNotice,
  answerQuestion,
  assistantAiConfig,
  clearAssistantCache,
  extractiveAnswer,
} from "@/lib/rag/answer";
import type { RagHit } from "@/lib/rag/types";

// Réponse de l'assistant d'aide avec fetch simulé : aucun appel réel à l'API. Repli sur l'extrait à chaque échec.

const hit = (id: string, title: string, text: string, href = `/aide#${id}`): RagHit => ({
  chunk: { id, title, text, roles: ["RH", "MANAGER"], href, source: "help:faq" },
  score: 1,
});

const HITS: RagHit[] = [
  hit("petit-groupe", "Seuil de petit groupe", "Les indicateurs d'un groupe de moins de 5 personnes sont masqués. Ce seuil protège l'anonymat des collaborateurs."),
  hit("risque", "Niveau de risque", "Le niveau de risque est une estimation fondée sur des facteurs associés. Il est recalculé chaque mois."),
  hit("alertes", "Alertes", "Une alerte critique doit être traitée sous 7 jours."),
];
const CONFIG = { apiKey: "cle-de-test", model: "claude-opus-5-5" };
const QUESTION = "Pourquoi certains indicateurs sont-ils masqués ?";
const GOOD = "Les indicateurs d'un groupe de moins de 5 personnes sont masqués [1]. Le niveau de risque reste une estimation [2].";

type ApiReply = { text?: string; status?: number; stopReason?: string };
const fakeApi = (reply: ApiReply = {}) =>
  vi.fn<typeof fetch>(async () => {
    const body = { id: "msg_test", type: "message", role: "assistant", content: [{ type: "text", text: reply.text ?? "" }], stop_reason: reply.stopReason ?? "end_turn" };
    return new Response(JSON.stringify(body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  });
const hangingApi = () =>
  vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
const forbiddenFetch = () =>
  vi.fn<typeof fetch>(async () => {
    throw new Error("Appel réseau interdit dans les tests de l'assistant");
  });

const ask = (fetchImpl: typeof fetch, question = QUESTION, hits = HITS, extra: { timeoutMs?: number; model?: string } = {}) =>
  answerQuestion(question, hits, { config: { ...CONFIG, model: extra.model ?? CONFIG.model }, fetchImpl, timeoutMs: extra.timeoutMs });

const fallbackOf = (hits = HITS) => ({ ...extractiveAnswer(hits), notice: FALLBACK_NOTICE });

beforeEach(() => {
  clearAssistantCache();
  vi.stubGlobal("fetch", forbiddenFetch());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("configuration", () => {
  it("clé absente ou vide : désactivée ; ANTHROPIC_API_KEY ne suffit pas ; nom de modèle validé", () => {
    expect(assistantAiConfig({})).toBeNull();
    expect(assistantAiConfig({ ASSISTANT_AI_API_KEY: "   " })).toBeNull();
    expect(assistantAiConfig({ ANTHROPIC_API_KEY: "sk-ant-xxx", SYNTHESIS_AI_API_KEY: "sk-synth" })).toBeNull();
    expect(assistantAiConfig({ ASSISTANT_AI_API_KEY: " sk-test " })).toEqual({ apiKey: "sk-test", model: "claude-opus-5-5" });
    expect(assistantAiConfig({ ASSISTANT_AI_API_KEY: "k", ASSISTANT_AI_MODEL: "claude-sonnet-5-5" })?.model).toBe("claude-sonnet-5-5");
    expect(assistantAiConfig({ ASSISTANT_AI_API_KEY: "k", ASSISTANT_AI_MODEL: "gpt-x; rm -rf" })?.model).toBe("claude-opus-5-5");
    expect(assistantAiConfig({ ASSISTANT_AI_API_KEY: "k", ASSISTANT_AI_MODEL: "Claude-Opus" })?.model).toBe("claude-opus-5-5");
  });
});

describe("extrait sans IA générative", () => {
  it("aucun passage : mode AUCUN, message fixe, aucune source", () => {
    expect(extractiveAnswer([])).toEqual({ mode: "AUCUN", answer: NO_ANSWER, sources: [] });
  });

  it("phrases complètes du meilleur passage, 3 au plus, coupe propre sous la limite", () => {
    const sentence = (i: number) => `Phrase numéro ${i} du passage, assez longue pour peser dans la limite de longueur fixée pour un extrait.`;
    const text = [1, 2, 3, 4, 5].map(sentence).join(" ");
    const a = extractiveAnswer([hit("long", "Long", text)]);
    expect(a.mode).toBe("EXTRAIT");
    expect(a.answer.length).toBeLessThanOrEqual(EXTRACT_MAX_CHARS);
    expect(text.startsWith(a.answer)).toBe(true);
    expect(a.answer).toMatch(/\.$/);
    expect(a.answer.split(/(?<=\.)\s+/).length).toBeGreaterThanOrEqual(1);
    expect(a.answer.split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(3);
    expect(a.notice).toBeUndefined();

    const short = extractiveAnswer([hit("c", "C", "Un. Deux. Trois. Quatre. Cinq.")]);
    expect(short.answer).toBe("Un. Deux. Trois.");
  });

  it("première phrase trop longue : coupée sur un mot entier, terminée par des points de suspension", () => {
    const text = `${"indicateur ".repeat(60).trim()}. Suite.`;
    const a = extractiveAnswer([hit("x", "X", text)]);
    expect(a.answer.length).toBeLessThanOrEqual(EXTRACT_MAX_CHARS);
    expect(a.answer).toMatch(/indicateur…$/);
    expect(text.startsWith(a.answer.slice(0, -1))).toBe(true);
  });

  it("mise en forme retirée ; sources dédoublonnées (titre + lien), 4 au plus, dans l'ordre", () => {
    const hits = [
      hit("a1", "Importer un export AJIR", "## Étapes\n- **Importez** le fichier `export.csv` depuis [l'écran d'import](/import).", "/aide#import"),
      hit("a2", "Importer un export AJIR", "Deuxième passage de la même rubrique.", "/aide#import"),
      hit("b", "Qualité des données", "Texte B."),
      hit("c", "Alertes", "Texte C."),
      hit("d", "Glossaire", "Texte D."),
      hit("e", "Confidentialité", "Texte E."),
    ];
    const a = extractiveAnswer(hits);
    expect(a.answer).toBe("Étapes Importez le fichier export.csv depuis l'écran d'import.");
    expect(a.sources).toEqual([
      { title: "Importer un export AJIR", href: "/aide#import" },
      { title: "Qualité des données", href: "/aide#b" },
      { title: "Alertes", href: "/aide#c" },
      { title: "Glossaire", href: "/aide#d" },
    ]);
  });
});

describe("garde-fous avant tout appel", () => {
  it("sans configuration (null) : extrait, aucun appel", async () => {
    const api = forbiddenFetch();
    expect(await answerQuestion(QUESTION, HITS, { config: null, fetchImpl: api })).toEqual(extractiveAnswer(HITS));
    expect(api).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("configuration absente des options : lue dans l'environnement (clé absente → aucun appel ; clé présente → IA)", async () => {
    vi.stubEnv("ASSISTANT_AI_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-poste-dev");
    expect((await answerQuestion(QUESTION, HITS)).mode).toBe("EXTRAIT");
    expect(globalThis.fetch).not.toHaveBeenCalled();

    vi.stubEnv("ASSISTANT_AI_API_KEY", "cle-env");
    const api = fakeApi({ text: GOOD });
    vi.stubGlobal("fetch", api);
    expect((await answerQuestion(QUESTION, HITS)).mode).toBe("IA");
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][1]?.headers).toMatchObject({ "x-api-key": "cle-env" });
  });

  it("aucun passage : AUCUN sans appel", async () => {
    const api = forbiddenFetch();
    expect(await ask(api, QUESTION, [])).toEqual({ mode: "AUCUN", answer: NO_ANSWER, sources: [] });
    expect(api).not.toHaveBeenCalled();
  });

  it("matricule ou adresse e-mail dans la question : non transmise, extrait et mention explicite", async () => {
    const api = forbiddenFetch();
    for (const q of ["Quel est le risque de M12345 ?", "Pourquoi m00421 est-il en alerte", "jean.dupont@atlas-energies.fr peut-il voir les alertes ?"]) {
      expect(await ask(api, q)).toEqual({ ...extractiveAnswer(HITS), notice: PERSONAL_ID_NOTICE });
    }
    expect(api).not.toHaveBeenCalled();
    const ok = fakeApi({ text: GOOD });
    expect((await ask(ok, "Que signifie la version M12 du modèle ?")).mode).toBe("IA");
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe("appel de l'API et vérification", () => {
  it("réponse valide : mode IA, sources citées seulement, mention du modèle ; requête conforme", async () => {
    const api = fakeApi({ text: GOOD });
    const a = await ask(api);
    expect(a).toEqual({
      mode: "IA",
      answer: GOOD,
      sources: [
        { title: "Seuil de petit groupe", href: "/aide#petit-groupe" },
        { title: "Niveau de risque", href: "/aide#risque" },
      ],
      notice: aiNotice("claude-opus-5-5"),
    });
    expect(a.notice).toBe("Réponse rédigée par IA générative (modèle claude-opus-5-5) à partir de l'aide ; vérifiez les sources.");

    const [url, init] = api.mock.calls[0];
    expect(url).toBe(ASSISTANT_API_URL);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "content-type": "application/json", "x-api-key": "cle-de-test", "anthropic-version": "2023-06-01" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body.system[0].text).toContain("uniquement à partir des passages numérotés");
    expect(body.messages).toHaveLength(1);
    const content: string = body.messages[0].content;
    expect(content).toContain(QUESTION);
    expect(content).toContain("[1] Seuil de petit groupe\nLes indicateurs d'un groupe de moins de 5 personnes sont masqués.");
    expect(content).toContain("[3] Alertes");
  });

  it("au plus 4 passages transmis ; citations renumérotées dans l'ordre des sources, doublons fusionnés", async () => {
    const hits = [
      ...HITS,
      hit("risque-2", "Niveau de risque", "Le calcul utilise 12 mois d'historique.", "/aide#risque"),
      hit("cinquieme", "Cinquième", "Jamais transmis."),
    ];
    const api = fakeApi({ text: "Une alerte critique se traite sous 7 jours [3]. Le calcul utilise 12 mois d'historique [2, 4]." });
    const a = await ask(api, QUESTION, hits);
    expect(a.mode).toBe("IA");
    expect(a.answer).toBe("Une alerte critique se traite sous 7 jours [1]. Le calcul utilise 12 mois d'historique [2].");
    expect(a.sources).toEqual([
      { title: "Alertes", href: "/aide#alertes" },
      { title: "Niveau de risque", href: "/aide#risque" },
    ]);
    const content: string = JSON.parse(String(api.mock.calls[0][1]?.body)).messages[0].content;
    expect(content).toContain("[4] Niveau de risque");
    expect(content).not.toContain("Jamais transmis");
  });

  it("les passages ne répondent pas : AUCUN, sans source", async () => {
    const a = await ask(fakeApi({ text: "L'aide ne couvre pas cette question." }));
    expect(a).toMatchObject({ mode: "AUCUN", answer: NO_ANSWER, sources: [] });
    expect(a.notice).toContain("claude-opus-5-5");
  });

  it.each([
    ["nombre inventé", GOOD.replace("moins de 5", "moins de 6")],
    ["citation inexistante", GOOD.replace("[2]", "[4]")],
    ["citation zéro", GOOD.replace("[2]", "[0]")],
    ["citation mal formée", GOOD.replace("[2]", "[source]")],
    ["aucune citation", "Les indicateurs d'un groupe de moins de 5 personnes sont masqués."],
    ["trop de phrases", "Les groupes de moins de 5 personnes sont masqués [1]. ".repeat(5).trim()],
    ["phrase trop longue", `Les indicateurs ${"très ".repeat(20)}détaillés sont masqués [1].`],
    ["phrase incomplète", "Les indicateurs sont masqués [1"],
    ["réponse vide", "   "],
  ])("%s : repli sur l'extrait", async (_label, text) => {
    expect(await ask(fakeApi({ text }))).toEqual(fallbackOf());
  });

  it("erreur HTTP, réponse tronquée, illisible, réseau coupé : repli ; échec non mis en cache", async () => {
    const http = fakeApi({ status: 529 });
    expect(await ask(http)).toEqual(fallbackOf());
    expect(await ask(http)).toEqual(fallbackOf());
    expect(http).toHaveBeenCalledTimes(2);
    expect(await ask(fakeApi({ status: 401 }))).toEqual(fallbackOf());
    expect(await ask(fakeApi({ text: GOOD, stopReason: "max_tokens" }))).toEqual(fallbackOf());
    expect(await ask(vi.fn<typeof fetch>(async () => new Response("<html>proxy</html>", { status: 200 })))).toEqual(fallbackOf());
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await ask(offline)).toEqual(fallbackOf());
    const ok = fakeApi({ text: GOOD });
    expect((await ask(ok)).mode).toBe("IA");
  });

  it("délai dépassé : appel abandonné, repli sans attendre davantage", async () => {
    const api = hangingApi();
    const started = Date.now();
    expect(await ask(api, QUESTION, HITS, { timeoutMs: 30 })).toEqual(fallbackOf());
    expect(Date.now() - started).toBeLessThan(5000);
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("cache : même question normalisée et mêmes passages → un seul appel ; autres passages ou autre modèle → nouvel appel", async () => {
    const api = fakeApi({ text: GOOD });
    const first = await ask(api);
    const second = await ask(api, "  pourquoi CERTAINS indicateurs   sont-ils masqués");
    expect(second).toEqual(first);
    expect(api).toHaveBeenCalledTimes(1);
    second.sources.pop();
    expect((await ask(api)).sources).toHaveLength(2);
    expect(api).toHaveBeenCalledTimes(1);

    await ask(api, QUESTION, [HITS[0], HITS[1]]);
    expect(api).toHaveBeenCalledTimes(2);
    await ask(api, QUESTION, HITS, { model: "claude-sonnet-5-5" });
    expect(api).toHaveBeenCalledTimes(3);
  });

  it("questions simultanées identiques : une seule requête partagée", async () => {
    const api = fakeApi({ text: GOOD });
    const [a, b] = await Promise.all([ask(api), ask(api)]);
    expect(api).toHaveBeenCalledTimes(1);
    expect(a.mode).toBe("IA");
    expect(b.mode).toBe("IA");
  });
});
