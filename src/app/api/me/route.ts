import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { requireContext } from "@/lib/dal/context";
import { getMe } from "@/lib/dal/employees";

export const GET = withApi(async () => {
  const ctx = await requireContext();
  return NextResponse.json(getMe(ctx), { headers: { "Cache-Control": "no-store" } });
});
