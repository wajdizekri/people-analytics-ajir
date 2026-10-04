import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { requireContext } from "@/lib/dal/context";
import { searchAll } from "@/lib/dal/search";

export const GET = withApi(async (req) => {
  const ctx = await requireContext(["ADMIN", "RH", "MANAGER"]);
  return NextResponse.json(searchAll(ctx, req.nextUrl.searchParams.get("q") ?? ""), { headers: { "Cache-Control": "no-store" } });
});
