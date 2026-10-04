import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { requireContext } from "@/lib/dal/context";
import { requestScoring, scoringRequestSchema } from "@/lib/dal/imports";
import { HttpError } from "@/lib/dal/errors";

export const POST = withApi(async (req) => {
  const ctx = await requireContext(["ADMIN", "RH"]);
  const text = await req.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, "CORPS_INVALIDE", "Requête illisible : données JSON attendues. Rechargez la page puis réessayez.");
    }
  }
  const res = requestScoring(ctx, scoringRequestSchema.parse(body));
  return NextResponse.json(res, { status: 202 });
});
