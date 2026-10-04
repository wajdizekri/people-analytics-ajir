import Link from "next/link";
import type { Role } from "@/db/schema";
import { FAQ, GLOSSARY, KPIS, SCREENS, forRole, type SectionId } from "@/lib/help/content";
import { Button, ButtonLink, EmptyState, cardCls, fieldCls } from "@/components/ui";

// Recherche dans l'aide (?q=) : questions fréquentes, glossaire, indicateurs et écrans du rôle, réponses affichées
// directement. Côté serveur, sur les mêmes contenus filtrés par rôle que la page : rien de plus n'est montré.

export type HelpHit = { title: string; text: string; href: string };
export type HelpResults = { faq: HelpHit[]; glossaire: HelpHit[]; indicateurs: HelpHit[]; ecrans: HelpHit[] };

const GROUPS: { key: keyof HelpResults; title: string; link: string }[] = [
  { key: "faq", title: "Questions fréquentes", link: "Voir toutes les questions" },
  { key: "glossaire", title: "Glossaire", link: "Voir le glossaire" },
  { key: "indicateurs", title: "Indicateurs", link: "Voir les indicateurs" },
  { key: "ecrans", title: "Écrans", link: "Ouvrir l'écran" },
];

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Mots d'au moins 2 lettres, tous présents (accents et majuscules ignorés) ; null si la recherche est vide. */
export function searchHelp(role: Role, query: string, sections: SectionId[]): HelpResults | null {
  const words = norm(query).split(/[\s'’,;.?!]+/).filter((w) => w.length >= 2);
  if (!words.length) return null;
  const match = (...parts: string[]) => {
    const hay = norm(parts.join(" "));
    return words.every((w) => hay.includes(w));
  };
  const has = (id: SectionId) => sections.includes(id);
  return {
    faq: has("faq") ? forRole(FAQ, role).filter((f) => match(f.q, f.a)).map((f) => ({ title: f.q, text: f.a, href: "#faq" })) : [],
    glossaire: has("glossaire") ? forRole(GLOSSARY, role).filter((g) => match(g.term, g.definition)).map((g) => ({ title: g.term, text: g.definition, href: "#glossaire" })) : [],
    indicateurs: has("tableau-de-bord")
      ? forRole(KPIS, role).filter((k) => match(k.label, k.definition)).map((k) => ({ title: k.label, text: k.definition, href: "#tableau-de-bord" }))
      : [],
    ecrans: forRole(SCREENS, role)
      .map((s) => ({ title: s.labels?.[role] ?? s.label, text: s.purpose, href: s.href }))
      .filter((s) => match(s.title, s.text)),
  };
}

export function HelpSearch({ query, results }: { query: string; results: HelpResults | null }) {
  const total = results ? GROUPS.reduce((n, g) => n + results[g.key].length, 0) : 0;
  return (
    <div className={`${cardCls} mb-6 p-4`}>
      <form method="get" action="/aide" role="search" aria-label="Rechercher dans l'aide" className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 grow basis-56">
          <label htmlFor="aide-q" className="block text-sm font-medium text-fg">
            Rechercher dans l&apos;aide
          </label>
          <input
            id="aide-q"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={100}
            placeholder="Un mot ou une question : départ, absence, alerte…"
            aria-describedby="aide-q-aide"
            className={`${fieldCls} mt-1`}
          />
        </div>
        <Button type="submit" variant="primary" icon="search">
          Rechercher
        </Button>
        {query && (
          <ButtonLink href="/aide" variant="tertiary">
            Effacer la recherche
          </ButtonLink>
        )}
      </form>
      <p id="aide-q-aide" className="mt-1.5 text-xs text-fg-muted">
        Questions fréquentes, glossaire, indicateurs et écrans de votre rôle. Le sommaire ci-dessous reste disponible.
      </p>

      {query && (
        <div className="mt-4 border-t border-line pt-4">
          {!results || total === 0 ? (
            <EmptyState
              compact
              title={`Aucun résultat pour « ${query} »`}
              actions={
                <ButtonLink href="/aide" variant="secondary">
                  Effacer la recherche
                </ButtonLink>
              }
            >
              {results ? "Essayez un mot plus court ou un synonyme, ou parcourez le sommaire." : "Saisissez au moins 2 lettres, ou parcourez le sommaire."}
            </EmptyState>
          ) : (
            <>
              <h2 id="aide-resultats" className="text-base font-semibold text-heading">
                {total} résultat{total > 1 ? "s" : ""} pour « {query} »
              </h2>
              {GROUPS.filter((g) => results[g.key].length > 0).map((g) => (
                <div key={g.key} className="mt-3">
                  <h3 className="text-sm font-semibold text-heading">
                    {g.title} ({results[g.key].length})
                  </h3>
                  <ul className="mt-1.5 divide-y divide-line rounded-control border border-line">
                    {results[g.key].map((hit) => (
                      <li key={`${hit.href}-${hit.title}`} className="px-3 py-2 text-sm">
                        <p className="font-medium text-fg">{hit.title}</p>
                        <p className="mt-0.5 text-fg-muted">{hit.text}</p>
                        <Link href={hit.href} className="mt-1 inline-flex min-h-8 items-center text-link underline underline-offset-2 hover:decoration-2">
                          {g.link}
                          {g.key === "ecrans" && <span className="sr-only"> {hit.title}</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
