import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { clientIp } from "@/lib/auth/session";
import { askAssistant } from "@/lib/dal/assistant";
import { requireContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";

const MAX_BODY = 2048;
const tooLarge = () => new HttpError(413, "TROP_VOLUMINEUX", "Question trop longue : raccourcissez-la puis réessayez.");
const unreadable = () => new HttpError(400, "CORPS_INVALIDE", "Requête illisible : données JSON attendues. Rechargez la page puis réessayez.");

// Corps lu par morceaux et abandonné dès le plafond franchi (Content-Length absent ou mensonger)
async function boundedJson(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw tooLarge();
  const reader = req.body?.getReader();
  if (!reader) throw unreadable();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw unreadable();
  }
}

// POST { question } : réponse de l'assistant d'aide. Le rôle vient de la session, jamais du corps.
export const POST = withApi(async (req) => {
  const ctx = await requireContext(["ADMIN", "RH", "MANAGER"]);
  const body = await boundedJson(req);
  const answer = await askAssistant(ctx, body, { source: "api", ip: clientIp(req.headers) });
  return NextResponse.json(answer, { headers: { "Cache-Control": "no-store" } });
});
