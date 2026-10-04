import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api";
import { requireContext } from "@/lib/dal/context";
import { alertUpdateSchema, updateAlert } from "@/lib/dal/alerts";
import { HttpError } from "@/lib/dal/errors";

const idSchema = z.coerce.number().int().positive();

export const PATCH = withApi(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireContext();
  const id = idSchema.parse((await params).id);
  const body = await req.json().catch(() => {
    throw new HttpError(400, "CORPS_INVALIDE", "Requête illisible : données JSON attendues. Rechargez la page puis réessayez.");
  });
  const alert = updateAlert(ctx, id, alertUpdateSchema.parse(body));
  return NextResponse.json({ alert });
});
