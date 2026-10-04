import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { requireContext } from "@/lib/dal/context";
import { alertFiltersSchema, listAlerts } from "@/lib/dal/alerts";

export const GET = withApi(async (req) => {
  const ctx = await requireContext();
  const q = req.nextUrl.searchParams;
  const filters = alertFiltersSchema.parse({
    type: q.get("type") || undefined,
    status: q.get("status") || undefined,
    severity: q.get("severity") || undefined,
    limit: q.get("limit") || undefined,
  });
  return NextResponse.json({ alerts: listAlerts(ctx, filters) });
});
