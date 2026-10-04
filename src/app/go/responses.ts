// Réponses des points d'entrée AJIR (/go/*, /api/ajir/launch) : redirection relative (indépendante de l'hôte vu derrière
// le reverse proxy) ou page d'erreur minimale en français, sans aucune donnée de la requête.
const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export function redirectTo(path: string): Response {
  return new Response(null, { status: 303, headers: { ...NO_STORE, Location: path } });
}

export function errorPage(status: 401 | 403 | 404, title: string, message: string, link: { href: string; label: string }): Response {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — People Analytics</title></head>
<body style="font-family:system-ui,sans-serif;background:#f6f8fb;color:#0f172a;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:420px;text-align:center">
<p style="margin:0;font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#9d174d">Erreur ${status}</p>
<h1 style="font-size:20px;margin:8px 0">${title}</h1>
<p style="color:#475569;font-size:14px">${message}</p>
<a href="${link.href}" style="display:inline-block;margin-top:16px;background:#002c52;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none">${link.label}</a>
</main></body></html>`;
  return new Response(html, { status, headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8" } });
}
