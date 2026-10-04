import { NextResponse, type NextRequest } from "next/server";

// Vérification optimiste uniquement (présence du cookie). L'autorisation réelle est faite dans lib/dal.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("pa_session")) {
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "NON_AUTHENTIFIE", message: "Authentification requise." } }, { status: 401 });
    }
    const url = new URL("/login", request.url);
    // Page demandée (lien profond AJIR, nouvel onglet) : revalidée par la page de connexion (chemin interne, rôle)
    const { pathname } = request.nextUrl;
    const params = new URLSearchParams(request.nextUrl.search);
    params.delete("_rsc");
    const target = `${pathname}${params.size ? `?${params}` : ""}`;
    if (pathname !== "/" && target.length <= 500) url.searchParams.set("next", target);
    return NextResponse.redirect(url);
  }
  // Chemin (sans paramètres) transmis au serveur pour l'audit des refus de rôle (ROUTE_HEADER de lib/dal/context.ts).
  // Toujours écrasé ici : une valeur envoyée par le client n'atteint jamais pageContext / requireContext.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pa-pathname", request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!login|activation|api/health|api/ajir/launch|_next/static|_next/image|favicon.ico).*)"],
};
