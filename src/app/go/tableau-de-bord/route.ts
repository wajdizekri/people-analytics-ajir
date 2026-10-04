import { withApi } from "@/lib/api";
import { getContext, homePath } from "@/lib/dal/context";
import { redirectTo } from "../responses";

// Lien du menu AJIR vers le module : tableau de bord (RH, manager) ou console d'administration (ADMIN, sans données RH).
export const GET = withApi(async () => {
  const ctx = await getContext();
  return redirectTo(ctx ? homePath(ctx.role) : "/login");
});
