import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api";
import { clientIp } from "@/lib/auth/session";
import { requireContext } from "@/lib/dal/context";
import { HttpError, notFound } from "@/lib/dal/errors";
import { runWhatIf } from "@/lib/dal/whatif";

const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const POST = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireContext();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) throw notFound("Collaborateur");
  const text = await req.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, "CORPS_INVALIDE", "Requête illisible : données JSON attendues. Rechargez la page puis réessayez.");
    }
  }
  const dto = runWhatIf(ctx, id.data, body, { source: "api", ip: clientIp(req.headers) });
  return NextResponse.json(dto, { headers: { "Cache-Control": "no-store" } });
});
