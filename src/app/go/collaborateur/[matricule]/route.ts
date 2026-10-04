import { withApi } from "@/lib/api";
import { clientIp } from "@/lib/auth/session";
import { resolveEmployeeLink } from "@/lib/dal/ajir";
import { getContext, homePath } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { errorPage, redirectTo } from "../../responses";

// Lien profond du menu AJIR : /go/collaborateur/<matricule> → fiche du salarié si l'utilisateur la voit.
export const GET = withApi<{ params: Promise<{ matricule: string }> }>(async (req, { params }) => {
  const { matricule } = await params;
  const ctx = await getContext();
  // Session expirée : après connexion, retour sur ce même lien profond
  if (!ctx) return redirectTo(`/login?next=${encodeURIComponent(`/go/collaborateur/${encodeURIComponent(matricule)}`)}`);
  const home = { href: homePath(ctx.role), label: "Revenir à l'accueil" };
  try {
    return redirectTo(`/employees/${resolveEmployeeLink(ctx, matricule, clientIp(req.headers))}`);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return errorPage(404, "Collaborateur introuvable", "Aucun collaborateur ne porte ce matricule dans le dernier export AJIR importé. Vérifiez le matricule, ou attendez le prochain import mensuel s'il s'agit d'une arrivée récente.", home);
    if (e instanceof HttpError && e.status === 403)
      return errorPage(403, "Accès refusé", "Ce collaborateur ne fait pas partie de votre périmètre : vous ne voyez que les collaborateurs de votre hiérarchie. Si vous avez besoin de cet accès, demandez-le à l'administrateur de l'outil.", home);
    throw e;
  }
});
