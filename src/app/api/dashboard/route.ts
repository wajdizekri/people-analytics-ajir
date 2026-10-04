import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { requireContext } from "@/lib/dal/context";
import { dashboardQuerySchema, getDashboard } from "@/lib/dal/dashboard";
import { parseQuery } from "@/lib/dal/employees";

export const GET = withApi(async (req) => {
  const ctx = await requireContext();
  const { data } = parseQuery(dashboardQuerySchema, req.nextUrl.searchParams, "strict");
  return NextResponse.json(getDashboard(ctx, data), { headers: { "Cache-Control": "no-store" } });
});
