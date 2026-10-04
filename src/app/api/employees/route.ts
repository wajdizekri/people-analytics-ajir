import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { requireContext } from "@/lib/dal/context";
import { employeeListSchema, listEmployees, parseQuery } from "@/lib/dal/employees";

export const GET = withApi(async (req) => {
  const ctx = await requireContext();
  const { data } = parseQuery(employeeListSchema, req.nextUrl.searchParams, "strict");
  return NextResponse.json(listEmployees(ctx, data), { headers: { "Cache-Control": "no-store" } });
});
