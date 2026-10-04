import "server-only";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { RATE_RULES, consume } from "@/lib/auth/rate-limit";
import { searchCorpus } from "@/lib/rag";
import { answerQuestion, assistantAiConfig } from "@/lib/rag/answer";
import { QUESTION_MAX, QUESTION_MIN, type AssistantAnswer, type RagHit } from "@/lib/rag/types";
import type { AccessContext } from "./context";
import type { AuditMeta } from "./employees";
import { HttpError } from "./errors";

// Seule la question est lue dans le corps : tout autre champ (rôle compris) est ignoré.
export const assistantQuestionSchema = z.object(
  {
    question: z
      .string({ error: "Question absente : saisissez votre question puis validez." })
      .trim()
      .min(QUESTION_MIN, `Question trop courte : saisissez au moins ${QUESTION_MIN} caractères.`)
      .max(QUESTION_MAX, `Question trop longue : ${QUESTION_MAX} caractères au plus.`),
  },
  { error: "Question absente : saisissez votre question puis validez." },
);

const TARGET = { type: "assistant" };

function parseQuestion(input: unknown): string {
  const r = assistantQuestionSchema.safeParse(input);
  if (!r.success) throw new HttpError(400, "QUESTION_INVALIDE", r.error.issues[0]?.message ?? "Question invalide.");
  return r.data.question;
}

function tooManyQuestions(waitMs: number): string {
  const min = Math.max(1, Math.ceil(waitMs / 60_000));
  return `Vous avez posé beaucoup de questions en peu de temps. Réessayez dans ${min} minute${min > 1 ? "s" : ""}.`;
}

// Réponse tirée de la documentation seule, filtrée par le rôle de la session (jamais par le corps de la requête).
// Rien n'est écrit hormis l'audit, qui ne contient jamais le texte de la question.
export async function askAssistant(ctx: AccessContext, input: unknown, meta: AuditMeta): Promise<AssistantAnswer> {
  const question = parseQuestion(input);
  const length = question.length;
  const wait = consume(`assistant:user:${ctx.userId}`, RATE_RULES.assistant);
  if (wait) {
    audit(ctx.userId, "assistant.ask", TARGET, "REFUSE", { source: meta.source, length, reason: "limite_usage" }, meta.ip);
    throw new HttpError(429, "TROP_DE_QUESTIONS", tooManyQuestions(wait));
  }
  let hits: RagHit[] = [];
  let answer: AssistantAnswer;
  try {
    // Second filtre par rôle : aucun passage d'un autre rôle ne peut atteindre la réponse.
    hits = searchCorpus(question, ctx.role).filter((h) => h.chunk.roles.includes(ctx.role));
    answer = await answerQuestion(question, hits, { config: assistantAiConfig() });
  } catch (err) {
    audit(ctx.userId, "assistant.ask", TARGET, "ECHEC", { source: meta.source, length, hits: hits.length, reason: "erreur_interne" }, meta.ip);
    throw err;
  }
  audit(ctx.userId, "assistant.ask", TARGET, "OK", { source: meta.source, length, hits: hits.length, mode: answer.mode }, meta.ip);
  return answer;
}
