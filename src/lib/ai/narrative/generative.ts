import "server-only";
import crypto from "node:crypto";
import { buildPayload, verifyGenerated, type NarrativePayload } from "./payload";
import { draftNarrative, type Narrative, type NarrativeFacts } from "./template";

// Reformulation facultative de la synthèse par IA générative (API Claude, appel serveur par fetch, sans dépendance).
// Désactivée par défaut : active seulement si SYNTHESIS_AI_API_KEY est définie. Seuls les agrégats de la liste blanche
// (payload.ts) et le brouillon issu des gabarits sont transmis. Toute erreur, tout délai dépassé ou tout nombre absent de
// la charge utile entraîne le repli sur les gabarits. Le flux sortant vient du serveur : la CSP du navigateur
// (connect-src 'self') ne le concerne pas.

export const NARRATIVE_API_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_NARRATIVE_MODEL = "claude-opus-4-7";
export const NARRATIVE_TIMEOUT_MS = 10_000;
export const FAILURE_RETRY_MS = 15 * 60_000;
const MAX_TOKENS = 1024;
const CACHE_MAX = 200;

export const SYSTEM_PROMPT = [
  "Vous reformulez la synthèse mensuelle d'un outil de pilotage RH, lue par un responsable RH ou un manager.",
  "Règles impératives :",
  "- Français, vouvoiement, texte simple sans titre, sans liste et sans mise en forme.",
  "- De 4 à 6 phrases, chacune de 20 mots au plus.",
  "- N'utilisez que les nombres présents dans les données fournies, recopiés exactement et écrits en chiffres.",
  "- N'effectuez aucun calcul, aucun arrondi, aucune estimation ni aucune comparaison chiffrée nouvelle.",
  "- Une valeur null signifie que l'indicateur est masqué ou indisponible : dites-le sans deviner de valeur.",
  "- Dites le périmètre et la période.",
  "- Aucune lecture causale : parlez de facteurs associés, jamais de causes, d'effets ou de départs évités.",
  "- Le niveau de risque est une estimation, pas une certitude. Ne proposez aucune décision : la décision reste humaine.",
  "- Ne mentionnez aucune personne, aucun service ni aucune information absente des données fournies.",
  "Répondez uniquement par le texte de la synthèse.",
].join("\n");

export type NarrativeAiConfig = { apiKey: string; model: string };

export function narrativeAiConfig(env: Record<string, string | undefined> = process.env): NarrativeAiConfig | null {
  const apiKey = (env.SYNTHESIS_AI_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const model = (env.SYNTHESIS_AI_MODEL ?? "").trim();
  return { apiKey, model: /^claude-[a-z0-9.-]+$/.test(model) ? model : DEFAULT_NARRATIVE_MODEL };
}

export type NarrativeRequest = { indicateurs: NarrativePayload; brouillon: string };

// Prompt système figé en tête (préfixe stable, marqué pour le cache de l'API ; sous le minimum de jetons du modèle, le
// marqueur reste sans effet) ; les données variables vont dans le message utilisateur.
export function buildRequestBody(request: NarrativeRequest, model: string): string {
  return JSON.stringify({
    model,
    max_tokens: MAX_TOKENS,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Données du mois (agrégats non nominatifs, JSON) :\n${JSON.stringify(request.indicateurs)}\n\nBrouillon à reformuler :\n${request.brouillon}`,
      },
    ],
  });
}

export type NarrativeCall = { outcome: "OK" | "ECHEC"; reason: string; payloadBytes: number; model: string; durationMs: number };

type Rewrite = { ok: true; sentences: string[] } | { ok: false; reason: string };
type ApiMessage = { content?: { type?: string; text?: unknown }[]; stop_reason?: string | null };

const isTimeout = (e: unknown) => {
  const name = (e as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
};

async function callApi(body: string, config: NarrativeAiConfig, fetchImpl: typeof fetch, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  try {
    const res = await fetchImpl(NARRATIVE_API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const msg = (await res.json()) as ApiMessage;
    if (msg.stop_reason !== "end_turn") return { ok: false, reason: `arret_${msg.stop_reason ?? "inconnu"}` };
    const text = (msg.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("")
      .trim();
    return { ok: true, text };
  } catch (e) {
    return { ok: false, reason: isTimeout(e) ? "delai" : e instanceof SyntaxError ? "reponse_invalide" : "reseau" };
  }
}

// Cache en mémoire du processus web : une entrée par périmètre, mois et contenu exact de la requête (donc par version des
// agrégats et du modèle). Réussite conservée ; échec retenté au plus tôt après FAILURE_RETRY_MS. Requêtes simultanées :
// un seul appel (promesse partagée).
type CacheEntry = { expires: number; result: Promise<Rewrite> };
const g = globalThis as unknown as { __paNarrativeCache?: Map<string, CacheEntry> };
const cache = () => (g.__paNarrativeCache ??= new Map());

export function clearNarrativeCache(): void {
  cache().clear();
}

export type NarrativeOptions = {
  config: NarrativeAiConfig | null;
  /** Périmètre : « RH » ou « MANAGER:<id> » (clé de cache, jamais transmis). */
  scopeKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  /** Appelé une fois par appel réel à l'API (pas sur un résultat en cache) : audit sans le contenu. */
  onCall?: (call: NarrativeCall) => void;
};

export async function narrativeFor(facts: NarrativeFacts, opts: NarrativeOptions): Promise<Narrative> {
  const draft = draftNarrative(facts);
  const config = opts.config;
  if (!config) return draft;
  try {
    const payload = buildPayload(facts);
    const body = buildRequestBody({ indicateurs: payload, brouillon: draft.sentences.join(" ") }, config.model);
    const key = `${opts.scopeKey}|${facts.month}|${crypto.createHash("sha256").update(body).digest("hex")}`;
    const now = opts.now ?? Date.now;
    const store = cache();
    let entry = store.get(key);
    if (!entry || entry.expires <= now()) {
      const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
      const started = now();
      const result = (async (): Promise<Rewrite> => {
        const res = await callApi(body, config, fetchImpl, opts.timeoutMs ?? NARRATIVE_TIMEOUT_MS);
        const rewrite: Rewrite = res.ok ? verifyGenerated(res.text, payload) : res;
        opts.onCall?.({
          outcome: rewrite.ok ? "OK" : "ECHEC",
          reason: rewrite.ok ? "ok" : rewrite.reason,
          payloadBytes: Buffer.byteLength(body, "utf8"),
          model: config.model,
          durationMs: Math.max(0, now() - started),
        });
        return rewrite;
      })();
      entry = { expires: Number.POSITIVE_INFINITY, result };
      store.delete(key);
      store.set(key, entry);
      while (store.size > CACHE_MAX) store.delete(store.keys().next().value as string);
      const created = entry;
      void result.then(
        (r) => {
          if (!r.ok) created.expires = now() + FAILURE_RETRY_MS;
        },
        () => {
          created.expires = 0;
        },
      );
    }
    const rewrite = await entry.result;
    return rewrite.ok ? { source: "IA", sentences: rewrite.sentences, model: config.model, fallback: null } : { ...draft, fallback: rewrite.reason };
  } catch {
    return { ...draft, fallback: "erreur_interne" };
  }
}
