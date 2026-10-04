import "server-only";
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "@/lib/dal/errors";
import { logger } from "@/lib/logger";

type Handler<C> = (req: NextRequest, ctx: C) => Promise<Response>;

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}

// Enveloppe commune des Route Handlers :
// - contrôle d'origine sur les méthodes qui modifient (CSRF)
// - erreurs au format { error: { code, message, correlationId } } sans détail interne
export function withApi<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const correlationId = crypto.randomUUID();
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const origin = req.headers.get("origin");
        const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
        // Origin illisible (« null » d'une iframe sandbox ou d'une redirection) : refus 403, jamais une 500.
        if (origin && host && originHost(origin) !== host) {
          throw new HttpError(403, "ORIGINE_INVALIDE", "Requête refusée : elle ne provient pas de cette application. Rechargez la page puis réessayez.");
        }
      }
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: { code: err.code, message: err.message, correlationId } }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: { code: "VALIDATION", message: "Saisie invalide. Corrigez les champs signalés puis réessayez.", issues: err.issues.map((i) => ({ path: i.path, message: i.message })), correlationId } },
          { status: 400 },
        );
      }
      logger.error({ err, correlationId, url: req.url }, "Erreur API");
      return NextResponse.json({ error: { code: "ERREUR_INTERNE", message: "Erreur inattendue du serveur. Réessayez dans un instant ; si le problème persiste, signalez-le à l'administrateur de l'outil.", correlationId } }, { status: 500 });
    }
  };
}
