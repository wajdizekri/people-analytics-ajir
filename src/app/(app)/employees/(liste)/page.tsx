import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, ButtonLink, EmptyState, Icon, Initials, Notice, PageHeader, RiskBadge, cardCls, fmt, tableCls } from "@/components/ui";
import { TermTip } from "@/components/help";
import { ActiveFilters, FilterForm, Pagination, buildHref, type ActiveFilter } from "@/components/pilotage/filters";
import { Breadcrumb, safeReturn } from "@/components/ux/breadcrumb";
import { ExportButton } from "@/components/export/export-button";
import { CONTRACT_LABELS, LEVEL_LABELS, formatDate, formatLiftShort, formatPoints, formatProb, formatTenure } from "@/components/pilotage/labels";
import { PILOTAGE_ROLES, getContext, pageContext } from "@/lib/dal/context";
import {
  AGE_BANDS,
  CONTRACT_TYPES,
  LEVEL_FILTERS,
  TENURE_BANDS,
  departmentOptions,
  employeeListSchema,
  listEmployees,
  managerOptions,
  parseQuery,
  type EmployeeListQuery,
  type EmployeeRowManager,
  type EmployeeRowRh,
} from "@/lib/dal/employees";
import { PendingHint } from "./pending-hint";

// Titre identique au libellé du menu : « Mon équipe » pour le manager
export async function generateMetadata() {
  const ctx = await getContext();
  return { title: `${ctx?.role === "MANAGER" ? "Mon équipe" : "Collaborateurs"} — People Analytics AJIR` };
}

type SortKey = EmployeeListQuery["tri"];

// Tri annoncé en toutes lettres au-dessus du tableau (« Trié par niveau de risque, du plus élevé au plus faible »)
const SORT_TEXT: Record<SortKey, { label: string; asc: string; desc: string }> = {
  risque: { label: "niveau de risque", desc: "du plus élevé au plus faible", asc: "du plus faible au plus élevé" },
  probabilite: { label: "probabilité à 6 mois", desc: "de la plus forte à la plus faible", asc: "de la plus faible à la plus forte" },
  nom: { label: "nom", asc: "de A à Z", desc: "de Z à A" },
  matricule: { label: "matricule", asc: "par ordre croissant", desc: "par ordre décroissant" },
  departement: { label: "département", asc: "de A à Z", desc: "de Z à A" },
  anciennete: { label: "ancienneté", asc: "de la plus courte à la plus longue", desc: "de la plus longue à la plus courte" },
};
const defaultDir = (k: SortKey) => (k === "risque" || k === "probabilite" ? "desc" : "asc");

// En-tête collant : l'ombre intérieure remplace la bordure basse (une bordure de <thead> défile avec le tableau)
const th = `${tableCls.th} sticky top-0 z-10 whitespace-nowrap bg-surface-2 shadow-[inset_0_-2px_0_var(--color-line)]`;
const td = "px-3 py-2.5";
// Ligne cliquable : le lien du nom couvre toute la ligne (after:inset-0), seul lien de la ligne ; ligne en cours d'ouverture teintée
const rowCls = `${tableCls.tr} group/row relative cursor-pointer has-[a:focus-visible]:bg-surface-3 has-[[data-pending]]:bg-primary-soft`;
const stretched = "after:absolute after:inset-0 after:content-['']";

// Mêmes pictogrammes que DataTable (tri serveur ici : 1 000+ lignes paginées, tri et page dans l'URL)
function SortIcon({ dir }: { dir?: "asc" | "desc" }) {
  return <Icon name={dir === "asc" ? "arrow-up" : dir === "desc" ? "arrow-down" : "arrow-up-down"} className={`h-3.5 w-3.5 ${dir ? "text-link" : "text-fg-subtle"}`} />;
}

const Missing = () => (
  <>
    <span aria-hidden="true">—</span>
    <span className="sr-only">non disponible</span>
  </>
);

function Estimate({ r }: { r: EmployeeRowRh }) {
  if (r.estimate == null) return <span className="text-fg-subtle"><Missing /></span>;
  if (r.estimate.type === "PROBABILITE")
    return (
      <>
        <span className="block font-semibold text-fg">{formatProb(r.estimate.prob6)}</span>
        <span className="block text-xs text-fg-muted">{formatLiftShort(r.estimate.lift)} la moyenne</span>
      </>
    );
  return (
    <>
      <span aria-hidden="true" title={formatPoints(r.estimate.points)}>
        <span className="font-semibold text-fg">{fmt.int(r.estimate.points)}</span> <span className="text-xs text-fg-muted">points</span>
      </span>
      <span className="sr-only">{formatPoints(r.estimate.points)}</span>
    </>
  );
}

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(PILOTAGE_ROLES);
  const raw = await searchParams;
  const { data: q, ignored } = parseQuery(employeeListSchema, raw, "lenient");
  const retour = safeReturn(raw.retour, ["/dashboard", "/synthese", "/organigramme", "/equipes"]);
  const list = listEmployees(ctx, q);
  const rh = list.view === "RH";
  const depts = departmentOptions(ctx);
  const managers = managerOptions(ctx);
  const params = { q: q.q, departement: q.departement, contrat: q.contrat, niveau: q.niveau, manager: q.manager, age: q.age, anciennete: q.anciennete, tri: q.tri, ordre: q.ordre, retour };
  // Retour depuis la fiche vers cette liste, filtres, tri et page conservés
  const here = buildHref("/employees", { ...params, page: list.page > 1 ? list.page : undefined });

  const without = (k: keyof typeof params) => buildHref("/employees", { ...params, [k]: undefined });
  const active: ActiveFilter[] = [];
  if (q.q) active.push({ label: "Recherche", value: `« ${q.q} »`, removeHref: without("q") });
  if (q.departement) active.push({ label: "Département", value: depts.find((d) => d.id === q.departement)?.label ?? `n° ${q.departement}`, removeHref: without("departement") });
  if (q.contrat) active.push({ label: "Contrat", value: CONTRACT_LABELS[q.contrat], removeHref: without("contrat") });
  if (q.niveau) active.push({ label: "Niveau de risque", value: LEVEL_LABELS[q.niveau], removeHref: without("niveau") });
  if (q.manager) active.push({ label: "Manager", value: managers.find((m) => m.id === q.manager)?.label ?? `n° ${q.manager}`, removeHref: without("manager") });
  if (q.age) active.push({ label: "Âge", value: AGE_BANDS[q.age].label, removeHref: without("age") });
  if (q.anciennete) active.push({ label: "Ancienneté", value: TENURE_BANDS[q.anciennete].label, removeHref: without("anciennete") });

  // Le manager n'a pas de tri par probabilité (la DAL retombe sur le niveau de risque)
  const sortKey: SortKey = !rh && q.tri === "probabilite" ? "risque" : q.tri;
  const sortDir = q.ordre ?? defaultDir(sortKey);
  const sortSentence = `Tri : ${SORT_TEXT[sortKey].label}, ${SORT_TEXT[sortKey][sortDir]}`;
  const sortHref = (key: SortKey) => {
    const next = sortKey === key ? (sortDir === "asc" ? "desc" : "asc") : defaultDir(key);
    return { next, href: buildHref("/employees", { ...params, tri: key, ordre: next, page: undefined }) };
  };

  const sortHeader = (key: SortKey, label: ReactNode, opts: { align?: "left" | "right"; tip?: ReactNode } = {}) => {
    const current = sortKey === key;
    const { next, href } = sortHref(key);
    const right = opts.align === "right";
    return (
      <th scope="col" className={`${th} ${right ? "text-right" : ""}`} aria-sort={current ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
        <span className={`inline-flex items-center gap-0.5 ${right ? "flex-row-reverse" : ""}`}>
          <Link
            href={href}
            className={`-mx-1 inline-flex min-h-8 items-center gap-1 rounded-control px-1 transition-colors hover:bg-surface-3 hover:text-link ${current ? "text-fg" : ""} ${right ? "flex-row-reverse" : ""}`}
          >
            <span>
              <span className="sr-only">Trier par </span>
              {label}
              <span className="sr-only">{next === "asc" ? ", ordre croissant" : ", ordre décroissant"}</span>
            </span>
            <SortIcon dir={current ? sortDir : undefined} />
          </Link>
          {opts.tip}
        </span>
      </th>
    );
  };

  const b0 = list.view === "RH" && list.run?.modelKind === "B0";
  const asOf = list.run ? formatDate(list.run.asOf) : null;
  const resetHref = buildHref("/employees", { retour });
  const title = rh ? "Collaborateurs" : "Mon équipe";
  const retourPath = retour?.split(/[?#]/)[0];
  const RETOUR_LABELS: Record<string, string> = { "/dashboard": "Tableau de bord", "/synthese": "Synthèse du mois", "/organigramme": "Organigramme", "/equipes": rh ? "Équipes" : "Mes équipes" };
  const retourLabel = RETOUR_LABELS[retourPath ?? "/dashboard"];
  // Tri en vue cartes (les en-têtes de colonnes n'y sont pas) : puces, même logique que les en-têtes
  const SORT_CHIPS: { key: SortKey; label: string }[] = [
    { key: "risque", label: "Risque" },
    ...(rh ? [{ key: "probabilite" as const, label: b0 ? "Score" : "Probabilité" }] : []),
    { key: "nom", label: "Nom" },
    { key: "anciennete", label: "Ancienneté" },
    { key: "departement", label: "Département" },
  ];

  return (
    <>
      {retour && <Breadcrumb items={[{ label: retourLabel, href: retour }, { label: title }]} />}
      <PageHeader
        title={title}
        scope={rh ? "Toute l'entreprise, collaborateurs actifs" : "Votre périmètre hiérarchique, collaborateurs actifs"}
        period={asOf ? `Niveaux de risque estimés au ${asOf}` : "Aucun calcul de risque publié"}
        actions={list.total > 0 ? <ExportButton kind="employees" searchParams={raw} total={list.total} /> : undefined}
      />
      <FilterForm
        action="/employees"
        values={q}
        search={{ name: "q", label: "Nom ou matricule", placeholder: "Nom, prénom ou matricule (ex. M10024)" }}
        hidden={{ tri: q.tri, ordre: q.ordre, retour }}
        resetHref={resetHref}
        showReset={active.length > 0 || q.tri !== "risque" || !!q.ordre}
        advanced={["contrat", "manager", "age", "anciennete"]}
        fields={[
          { name: "departement", label: "Département", allLabel: "Tous les départements", options: depts.map((o) => ({ value: String(o.id), label: o.label })) },
          { name: "niveau", label: "Niveau de risque", allLabel: "Tous les niveaux", options: LEVEL_FILTERS.map((l) => ({ value: l, label: LEVEL_LABELS[l] })) },
          { name: "contrat", label: "Contrat", allLabel: "Tous les contrats", options: CONTRACT_TYPES.map((c) => ({ value: c, label: CONTRACT_LABELS[c] })) },
          { name: "manager", label: "Manager", allLabel: "Tous les managers", options: managers.map((o) => ({ value: String(o.id), label: o.label })) },
          { name: "age", label: "Tranche d'âge", allLabel: "Toutes les tranches", options: Object.entries(AGE_BANDS).map(([value, b]) => ({ value, label: b.label })) },
          { name: "anciennete", label: "Ancienneté", allLabel: "Toutes les anciennetés", options: Object.entries(TENURE_BANDS).map(([value, b]) => ({ value, label: b.label })) },
        ]}
      />
      <ActiveFilters filters={active} ignored={ignored} />
      {!list.run && (
        <div className="mb-4">
          <Notice tone="warning">Aucun calcul de risque publié</Notice>
        </div>
      )}

      {list.rows.length === 0 ? (
        <EmptyState
          title={active.length > 0 ? "Aucun collaborateur ne correspond aux critères" : "Aucun collaborateur actif"}
          icon={active.length > 0 ? "search" : "users"}
          action={active.length > 0 ? <ButtonLink href={resetHref} variant="secondary" icon="refresh">Réinitialiser les filtres</ButtonLink> : undefined}
        />
      ) : (
        <section className={`${cardCls} @container overflow-hidden`} aria-label={title}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3">
            <p className="text-sm text-fg-muted">
              <span className="text-lg font-semibold tabular-nums text-heading">{fmt.int(list.total)}</span> résultat{list.total > 1 ? "s" : ""}
            </p>
            <p className="text-sm text-fg-muted">{sortSentence}</p>
          </div>

          <nav aria-label="Trier la liste" className="relative flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2.5 @2xl:hidden">
            <span className="shrink-0 text-xs font-semibold text-fg-muted">Trier par</span>
            {SORT_CHIPS.map(({ key, label }) => {
              const current = sortKey === key;
              const { next, href } = sortHref(key);
              return (
                <Link
                  key={key}
                  href={href}
                  aria-current={current ? "true" : undefined}
                  className={`inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-medium ring-1 ring-inset transition-colors active:translate-y-px ${
                    current ? "bg-primary-soft text-link ring-primary" : "bg-surface text-fg-muted ring-line-strong hover:bg-surface-3 hover:text-fg"
                  }`}
                >
                  <span className="sr-only">Trier par </span>
                  {label}
                  <span className="sr-only">{next === "asc" ? ", ordre croissant" : ", ordre décroissant"}</span>
                  {current && <SortIcon dir={sortDir} />}
                </Link>
              );
            })}
          </nav>

          {/* Zone large (≥ 672 px) : tableau ; plus étroite (mobile, tablette avec menu) : cartes empilées, sans défilement horizontal */}
          <div className="relative hidden max-h-[70vh] overflow-auto @2xl:block">
            <table className={tableCls.table}>
              <caption className="sr-only">
                {title} : {sortSentence}
              </caption>
              <thead className="text-xs text-fg-muted">
                <tr>
                  {sortHeader(
                    "nom",
                    <>
                      Nom<span className="font-normal"> et poste</span>
                    </>,
                  )}
                  {sortHeader("departement", "Département")}
                  <th scope="col" className={th}>Contrat</th>
                  {sortHeader("anciennete", "Ancienneté")}
                  {sortHeader("risque", "Niveau de risque", { tip: <TermTip term="niveauRisque" role={ctx.role} /> })}
                  {rh &&
                    sortHeader(
                      "probabilite",
                      b0 ? (
                        <>
                          Score à règles<span className="font-normal"> (points)</span>
                        </>
                      ) : (
                        "Probabilité à 6 mois"
                      ),
                      { align: "right", tip: <TermTip term={b0 ? "scoreRegles" : "probabilite"} role="RH" align="end" /> },
                    )}
                </tr>
              </thead>
              <tbody>
                {list.view === "RH"
                  ? list.rows.map((r) => (
                      <tr key={r.id} className={rowCls}>
                        <Cells r={r} back={here} />
                        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                          <Estimate r={r} />
                        </td>
                      </tr>
                    ))
                  : list.rows.map((r) => (
                      <tr key={r.id} className={rowCls}>
                        <Cells r={r} back={here} />
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line @2xl:hidden" aria-label={`${title} : ${sortSentence}`}>
            {list.view === "RH"
              ? list.rows.map((r) => (
                  <MobileRow key={r.id} r={r} back={here}>
                    <span className="text-right text-sm tabular-nums">
                      <Estimate r={r} />
                    </span>
                  </MobileRow>
                ))
              : list.rows.map((r) => <MobileRow key={r.id} r={r} back={here} />)}
          </ul>
          {list.pageCount > 1 && (
            <div className="border-t border-line bg-surface-2 px-4 py-2.5">
              <Pagination path="/employees" params={params} page={list.page} pageCount={list.pageCount} total={list.total} pageSize={list.pageSize} embedded />
            </div>
          )}
        </section>
      )}
    </>
  );
}

const ficheHref = (r: EmployeeRowManager, back: string) => buildHref(`/employees/${r.id}`, { retour: back });

function Cells({ r, back }: { back: string; r: EmployeeRowManager }) {
  return (
    <>
      <th scope="row" className={`${td} text-left font-normal`}>
        <div className="flex min-w-[13rem] items-center gap-2.5">
          <Initials name={`${r.lastName} ${r.firstName}`} />
          <div className="min-w-0 leading-tight">
            <span className="flex items-center gap-1.5">
              <Link href={ficheHref(r, back)} className={`whitespace-nowrap font-medium text-link underline-offset-2 group-hover/row:underline ${stretched}`}>
                {r.lastName} {r.firstName}
                <PendingHint />
              </Link>
            </span>
            <span className="mt-0.5 block text-xs text-fg-muted">
              {r.jobTitle ?? "Poste non renseigné"} · <span className="tabular-nums">{r.matricule}</span>
            </span>
          </div>
        </div>
      </th>
      <td className={`${td} min-w-[9rem] text-fg-muted`}>{r.department ?? <Missing />}</td>
      <td className={td}>{r.contractType ? <Badge>{CONTRACT_LABELS[r.contractType] ?? r.contractType}</Badge> : <Missing />}</td>
      <td className={`${td} whitespace-nowrap tabular-nums text-fg-muted`}>{formatTenure(r.tenureMonths)}</td>
      <td className={td}>
        <RiskBadge level={r.level} compact />
      </td>
    </>
  );
}

function MobileRow({ r, back, children }: { r: EmployeeRowManager; back: string; children?: ReactNode }) {
  return (
    <li className="group/row relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-3 has-[a:focus-visible]:bg-surface-3 has-[[data-pending]]:bg-primary-soft">
      <Initials name={`${r.lastName} ${r.firstName}`} />
      <div className="min-w-0 flex-1">
        <Link href={ficheHref(r, back)} className={`inline-flex items-center gap-1.5 font-medium text-link underline-offset-2 group-hover/row:underline ${stretched}`}>
          {r.lastName} {r.firstName}
          <PendingHint />
        </Link>
        <p className="text-xs text-fg-muted">
          {r.jobTitle ?? "Poste non renseigné"} · {r.matricule}
        </p>
        <p className="mt-0.5 text-xs text-fg-muted">
          {[r.department, r.contractType ? (CONTRACT_LABELS[r.contractType] ?? r.contractType) : null, formatTenure(r.tenureMonths)].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-1.5">
          <RiskBadge level={r.level} />
        </div>
      </div>
      {children}
      <Icon name="chevron-right" className="h-4 w-4 shrink-0 self-center text-fg-subtle transition-transform group-hover/row:translate-x-0.5" />
    </li>
  );
}
