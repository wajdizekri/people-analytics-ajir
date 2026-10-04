import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api";
import { clientIp } from "@/lib/auth/session";
import { requireContext } from "@/lib/dal/context";
import { getEmployeeDetail } from "@/lib/dal/employees";
import { notFound } from "@/lib/dal/errors";

const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const GET = withApi<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const ctx = await requireContext();
  const id = idSchema.safeParse((await params).id);
  if (!id.success) throw notFound("Collaborateur");
  const dto = getEmployeeDetail(ctx, id.data, { source: "api", ip: clientIp(req.headers) });
  return NextResponse.json(dto, { headers: { "Cache-Control": "no-store" } });
});
