import { z } from "zod";
import { withApi } from "@/lib/api";
import { clientIp } from "@/lib/auth/session";
import { requireContext } from "@/lib/dal/context";
import { notFound } from "@/lib/dal/errors";
import { exportList } from "@/lib/dal/export";
import { toCsv } from "@/lib/export/csv";
import { EXPORT_KINDS, EXPORT_ROLES, searchParamsRecord } from "@/lib/export/kinds";

const kindSchema = z.enum(EXPORT_KINDS);

// Export CSV d'une liste (collaborateurs, alertes, recommandations) : mêmes filtres, même périmètre et mêmes colonnes que la page
export const GET = withApi<{ params: Promise<{ kind: string }> }>(async (req, { params }) => {
  const kind = kindSchema.safeParse((await params).kind);
  const ctx = await requireContext(kind.success ? EXPORT_ROLES[kind.data] : undefined);
  if (!kind.success) throw notFound("Export");
  const out = exportList(ctx, kind.data, searchParamsRecord(req.nextUrl.searchParams), { ip: clientIp(req.headers) });
  return new Response(toCsv(out.table), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Rows": String(out.table.rows.length),
      "X-Export-Total": String(out.total),
      "X-Export-Truncated": out.truncated ? "1" : "0",
    },
  });
});
