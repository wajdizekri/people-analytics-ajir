import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { requireContext } from "@/lib/dal/context";
import { createUser, createUserSchema, listUsers } from "@/lib/dal/admin";
import { HttpError } from "@/lib/dal/errors";

export const GET = withApi(async () => {
  const ctx = await requireContext(["ADMIN"]);
  return NextResponse.json({ users: listUsers(ctx) });
});

export const POST = withApi(async (req) => {
  const ctx = await requireContext(["ADMIN"]);
  const body = await req.json().catch(() => {
    throw new HttpError(400, "CORPS_INVALIDE", "Requête illisible : données JSON attendues. Rechargez la page puis réessayez.");
  });
  const user = createUser(ctx, createUserSchema.parse(body));
  return NextResponse.json({ user }, { status: 201 });
});
