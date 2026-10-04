import Link from "next/link";

export type Crumb = { label: string; href?: string };

// Fil d'Ariane : le dernier élément est la page courante (aria-current), les précédents sont des liens
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="mb-2 text-sm">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-fg-muted">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${i}-${c.label}`} className="inline-flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden="true" className="text-fg-subtle">
                  ›
                </span>
              )}
              {c.href && !last ? (
                <Link href={c.href} className="text-link underline underline-offset-2 transition-colors duration-150 hover:decoration-2">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "font-medium text-fg" : undefined}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// Retour contextuel transmis dans l'URL (?retour=) : chemin interne d'une page autorisée, jamais d'URL absolue (redirection ouverte)
export function safeReturn(raw: string | string[] | undefined, allowedPaths: string[]): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length > 500) return undefined;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return allowedPaths.includes(value.split(/[?#]/)[0]) ? value : undefined;
}
