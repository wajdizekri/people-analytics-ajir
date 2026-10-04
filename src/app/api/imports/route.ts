import { NextResponse } from "next/server";
import { withApi } from "@/lib/api";
import { requireContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { UPLOAD_MAX_TOTAL_BYTES, importListSchema, listImports, saveUploadedExport } from "@/lib/dal/imports";

export const GET = withApi(async (req) => {
  const ctx = await requireContext(["ADMIN", "RH"]);
  const opts = importListSchema.parse({ limit: req.nextUrl.searchParams.get("limit") || undefined });
  return NextResponse.json({ imports: listImports(ctx, opts) });
});

const MAX_BODY = UPLOAD_MAX_TOTAL_BYTES + 64 * 1024;
const tooLarge = () => new HttpError(413, "TROP_VOLUMINEUX", `Export trop volumineux : ${UPLOAD_MAX_TOTAL_BYTES / 1048576} Mo au plus. Retirez les fichiers qui ne font pas partie de l'export AJIR, puis réessayez.`);

// Corps lu par morceaux et abandonné dès le plafond franchi, Content-Length absent (envoi par blocs) ou mensonger
async function boundedBody(req: Request): Promise<Buffer<ArrayBuffer> | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// Téléversement multipart (champ « files », plusieurs CSV) : stockage sous data/inbox/<horodatage>/ puis job IMPORT en file.
export const POST = withApi(async (req) => {
  const ctx = await requireContext(["ADMIN"]);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw tooLarge();
  const body = await boundedBody(req);
  const form = await new Request(req.url, { method: "POST", headers: req.headers, body }).formData().catch(() => {
    throw new HttpError(400, "CORPS_INVALIDE", "Requête illisible : envoyez les fichiers de l'export depuis le formulaire d'import de Santé des données.");
  });
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  const res = await saveUploadedExport(ctx, files);
  return NextResponse.json(res, { status: 202 });
});
