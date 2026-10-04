import { withApi } from "@/lib/api";
import { clientIp, createSession, destroySession } from "@/lib/auth/session";
import { verifyLaunch } from "@/lib/dal/ajir";
import { errorPage, redirectTo } from "@/app/go/responses";

// Ouverture du module depuis AJIR sans ressaisie du mot de passe : GET /api/ajir/launch?login=&ts=&sig=[&cible=]
// (format et calcul de la signature : docs/INTEGRATION_AJIR.md). Désactivé (404) sans AJIR_LAUNCH_SECRET.
export const GET = withApi(async (req) => {
  const q = req.nextUrl.searchParams;
  const res = verifyLaunch({ login: q.get("login"), ts: q.get("ts"), sig: q.get("sig"), cible: q.get("cible") }, Date.now(), clientIp(req.headers));
  if (!res.ok) {
    const login = { href: "/login", label: "Se connecter" };
    return res.status === 404
      ? errorPage(404, "Ouverture depuis AJIR désactivée", "Connectez-vous avec votre identifiant et votre mot de passe.", login)
      : errorPage(401, "Lien AJIR invalide ou expiré", "Relancez le module depuis le menu AJIR, ou connectez-vous avec votre mot de passe.", login);
  }
  await destroySession();
  await createSession(res.userId);
  return redirectTo(res.target);
});
