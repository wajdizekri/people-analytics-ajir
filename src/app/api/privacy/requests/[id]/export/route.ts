import { z } from "zod";
import { withApi } from "@/lib/api";
import { clientIp } from "@/lib/auth/session";
import { requireContext } from "@/lib/dal/context";
import { notFound } from "@/lib/dal/errors";
import { EXPORT_FORMATS, exportAccessData } from "@/lib/dal/privacy";

const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const querySchema = z.object({ format: z.enum(EXPORT_FORMATS).default("zip") });

// Copie du droit d'accès : RH seule (403 audité sinon), liée à une demande d'accès, auditée privacy.export
export const GET = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireContext();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) throw notFound("Demande");
  const { format } = querySchema.parse({ format: req.nextUrl.searchParams.get("format") ?? undefined });
  const file = exportAccessData(ctx, id.data, format, { source: "api", ip: clientIp(req.headers) });
  return new Response(new Uint8Array(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Content-Length": String(file.body.length),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
