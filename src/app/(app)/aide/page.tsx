import { pageContext } from "@/lib/dal/context";
import { getHelpSettings } from "@/lib/dal/help";
import { ROLE_LABEL, SECTIONS, forRole } from "@/lib/help/content";
import { Icon, PageHeader, cardCls } from "@/components/ui";
import { SECTION_BODY } from "./sections";
import { HelpSearch, searchHelp } from "./search";

export const metadata = { title: "Aide — People Analytics AJIR" };

type SP = Promise<Record<string, string | string[] | undefined>>;

const CONTACT = {
  RH: "Une question sur un compte ou un accès : l'administrateur de l'outil. Une donnée erronée : à corriger dans AJIR.",
  MANAGER: "Une question sur un collaborateur ou une donnée erronée : la RH. Un problème de compte ou d'accès : l'administrateur de l'outil.",
  ADMIN: "Une question sur un indicateur ou une donnée RH : la RH. Une anomalie technique persistante : l'équipe qui maintient l'outil.",
} as const;

// Centre d'aide commun aux trois rôles : chaque rôle ne voit que les rubriques des écrans auxquels il a accès.
export default async function HelpPage({ searchParams }: { searchParams?: SP } = {}) {
  const ctx = await pageContext();
  const s = getHelpSettings(ctx);
  const sections = forRole(SECTIONS, ctx.role).map((sec) => ({ ...sec, title: sec.titles?.[ctx.role] ?? sec.title }));
  const raw = (await searchParams)?.q;
  const query = (typeof raw === "string" ? raw : "").trim().slice(0, 100);
  const results = query ? searchHelp(ctx.role, query, sections.map((sec) => sec.id)) : null;
  const toc = (
    <ol className="space-y-0.5 text-sm">
      {sections.map((sec) => (
        <li key={sec.id}>
          <a href={`#${sec.id}`} className="block rounded-control px-2 py-1.5 text-link underline-offset-2 transition-colors duration-150 hover:bg-primary-soft hover:underline">
            {sec.title}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <PageHeader title="Aide" subtitle={`Réponses courtes pour utiliser l'outil, adaptées à votre rôle : ${ROLE_LABEL[ctx.role]}.`} />
      <HelpSearch query={query} results={results} />
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <details className={`${cardCls} group p-4 lg:hidden`}>
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 font-medium text-fg [&::-webkit-details-marker]:hidden">
            <Icon name="chevron-right" className="h-4 w-4 text-link transition-transform duration-200 group-open:rotate-90" />
            Sommaire de l&apos;aide
          </summary>
          <nav aria-label="Sommaire de l'aide" className="mt-2">
            {toc}
          </nav>
        </details>
        <nav aria-label="Sommaire de l'aide" className={`${cardCls} hidden self-start p-4 lg:sticky lg:top-4 lg:block`}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Sommaire</p>
          {toc}
        </nav>
        <div className="min-w-0 space-y-6">
          {sections.map((sec) => {
            const Body = SECTION_BODY[sec.id];
            return (
              <section key={sec.id} id={sec.id} aria-labelledby={`${sec.id}-titre`} className={`${cardCls} scroll-mt-4 p-5 text-sm leading-relaxed text-fg-muted`}>
                <h2 id={`${sec.id}-titre`} className="mb-3 text-base font-semibold text-heading">
                  {sec.title}
                </h2>
                <Body role={ctx.role} s={s} />
              </section>
            );
          })}
          <section aria-labelledby="contact-titre" className="rounded-card border border-primary/30 bg-primary-soft p-5 text-sm text-fg">
            <h2 id="contact-titre" className="mb-1 text-base font-semibold text-heading">
              Vous ne trouvez pas la réponse ?
            </h2>
            <p>{CONTACT[ctx.role]}</p>
          </section>
        </div>
      </div>
    </>
  );
}
