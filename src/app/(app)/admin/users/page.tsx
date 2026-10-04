import Link from "next/link";
import { z } from "zod";
import { ROLES, type Role } from "@/db/schema";
import { pageContext } from "@/lib/dal/context";
import { ACTIVATION_DAYS, listUsers, type UserDTO } from "@/lib/dal/admin";
import { Button, ButtonLink, EmptyState, Initials, PageHeader, cardCls, fmt, tableCls } from "@/components/ui";
import { ActiveFilters, Pagination, buildHref } from "@/components/pilotage/filters";
import { UserCreateForm } from "@/components/admin/user-create-form";
import { UserActions } from "@/components/admin/user-actions";
import { Icon, ROLE_LABEL, RoleBadge, SortHeader, StatusPill, fieldCls, labelCls, type SortDir, type Tone } from "@/components/admin/admin-ui";

export const metadata = { title: "Utilisateurs et accès — People Analytics AJIR" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const PAGE_SIZE = 25;

const STATES = {
  verrouille: { label: "Verrouillé", plural: "Verrouillés", tone: "red", hint: "à débloquer" },
  actif: { label: "Actif", plural: "Actifs", tone: "emerald", hint: "peuvent se connecter" },
  attente: { label: "En attente d'activation", plural: "En attente d'activation", tone: "amber", hint: "mot de passe non défini" },
  desactive: { label: "Désactivé", plural: "Désactivés", tone: "slate", hint: "accès coupé" },
} as const satisfies Record<string, { label: string; plural: string; tone: Tone; hint: string }>;
type State = keyof typeof STATES;
const STATE_KEYS = Object.keys(STATES) as State[];
const DOT: Record<Tone, string> = { emerald: "bg-success", amber: "bg-warning", red: "bg-danger", slate: "bg-fg-subtle", sky: "bg-primary" };

// Tri par colonne (sens par défaut au premier clic) ; sans tri choisi : comptes à traiter d'abord, puis les plus récents
const SORTS = {
  compte: { label: "identifiant", dir: "asc" },
  role: { label: "rôle", dir: "asc" },
  etat: { label: "état", dir: "asc" },
  connexion: { label: "dernière connexion", dir: "desc" },
} as const satisfies Record<string, { label: string; dir: SortDir }>;
type SortKey = keyof typeof SORTS;
const SORT_KEYS = Object.keys(SORTS) as SortKey[];

const filtersSchema = z.object({
  q: z.string().trim().max(100).catch(""),
  role: z.enum(ROLES).optional().catch(undefined),
  etat: z.enum(STATE_KEYS as [State, ...State[]]).optional().catch(undefined),
  tri: z.enum(SORT_KEYS as [SortKey, ...SortKey[]]).optional().catch(undefined),
  ordre: z.enum(["asc", "desc"]).optional().catch(undefined),
});
type Filters = z.infer<typeof filtersSchema>;

function stateOf(u: UserDTO): State {
  if (!u.active) return "desactive";
  if (u.lockedUntil) return "verrouille";
  if (!u.hasPassword) return "attente";
  return "actif";
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const href = (f: Partial<Filters>) => buildHref("/admin/users", { q: f.q || undefined, role: f.role, etat: f.etat, tri: f.tri, ordre: f.tri ? f.ordre : undefined });
const STATE_ORDER: Record<State, number> = { verrouille: 0, attente: 1, actif: 2, desactive: 3 };

type Row = UserDTO & { state: State };
function compare(key: SortKey | undefined, dir: SortDir): (a: Row, b: Row) => number {
  const priority = (a: Row, b: Row) => Number(a.state !== "verrouille") - Number(b.state !== "verrouille") || b.createdAt.localeCompare(a.createdAt) || a.login.localeCompare(b.login);
  if (!key) return priority;
  const s = dir === "asc" ? 1 : -1;
  return (a, b) => {
    if (key === "connexion") {
      // Jamais connecté : toujours en fin de liste, quel que soit le sens
      if (!a.lastLoginAt || !b.lastLoginAt) return Number(!a.lastLoginAt) - Number(!b.lastLoginAt) || a.login.localeCompare(b.login);
      return s * a.lastLoginAt.localeCompare(b.lastLoginAt);
    }
    const d =
      key === "compte"
        ? a.login.localeCompare(b.login, "fr")
        : key === "role"
          ? ROLE_LABEL[a.role].localeCompare(ROLE_LABEL[b.role], "fr")
          : STATE_ORDER[a.state] - STATE_ORDER[b.state];
    return s * d || a.login.localeCompare(b.login, "fr");
  };
}

function CounterTile({ label, hint, value, dot, to, current, urgent, className = "" }: { label: string; hint: string; value: number; dot: string; to: string; current: boolean; urgent?: boolean; className?: string }) {
  return (
    <Link
      href={to}
      aria-current={current ? "true" : undefined}
      className={`${cardCls} ${className} group block min-h-10 px-3 py-2.5 transition hover:-translate-y-px hover:border-primary/50 hover:shadow-pop active:translate-y-0 ${current ? "border-primary ring-2 ring-primary/25" : ""} ${urgent ? "border-danger/40 bg-danger-soft" : ""}`}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
        <span className="text-2xl font-semibold tabular-nums text-heading">{fmt.int(value)}</span>
      </span>
      <span className="mt-0.5 block text-xs font-semibold text-fg">{label}</span>
      <span className="block text-xs text-fg-muted">{hint}</span>
    </Link>
  );
}

function StateDetail({ u, state }: { u: UserDTO; state: State }) {
  const lines: string[] = [];
  if (state === "verrouille" && u.lockedUntil) lines.push(`Après plusieurs échecs de connexion, jusqu'au ${fmt.dateTime(u.lockedUntil)}`);
  if (u.active && u.activationExpiresAt) lines.push(`Lien en attente, valable jusqu'au ${fmt.date(u.activationExpiresAt)}`);
  else if (state === "attente") lines.push("Aucun lien valide : générez-en un");
  if (state !== "verrouille" && u.active && u.failedAttempts > 0) lines.push(`${u.failedAttempts} échec${u.failedAttempts > 1 ? "s" : ""} de connexion récent${u.failedAttempts > 1 ? "s" : ""}`);
  return (
    <>
      {lines.map((l) => (
        <span key={l} className="mt-1 block text-xs text-fg-muted">{l}</span>
      ))}
    </>
  );
}

// Tableau à partir de lg ; en dessous, une fiche par compte (2 colonnes dès sm), libellés visibles
const td = "block px-3 py-1 lg:table-cell lg:py-2.5 lg:align-top";
function MobileLabel({ children }: { children: string }) {
  return <span className="mr-1 text-xs font-medium text-fg-muted lg:hidden">{children} :</span>;
}

export default async function UsersPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext(["ADMIN"]);
  const sp = await searchParams;
  const filters = filtersSchema.parse({ q: one(sp.q), role: one(sp.role), etat: one(sp.etat), tri: one(sp.tri), ordre: one(sp.ordre) });
  const dir: SortDir = filters.ordre ?? (filters.tri ? SORTS[filters.tri].dir : "asc");
  const users = listUsers(ctx)
    .map((u) => ({ ...u, state: stateOf(u) }))
    .sort(compare(filters.tri, dir));

  const byState = Object.fromEntries(STATE_KEYS.map((s) => [s, users.filter((u) => u.state === s).length])) as Record<State, number>;
  const byRole = Object.fromEntries(ROLES.map((r) => [r, users.filter((u) => u.role === r).length])) as Record<Role, number>;
  const needle = norm(filters.q);
  const shown = users.filter(
    (u) =>
      (!filters.role || u.role === filters.role) &&
      (!filters.etat || u.state === filters.etat) &&
      (!needle || norm([u.login, u.email ?? "", u.employee?.name ?? "", u.employee?.matricule ?? ""].join(" ")).includes(needle)),
  );
  const filtered = !!(filters.q || filters.role || filters.etat);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const requested = Number(one(sp.page));
  const page = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, pageCount) : 1;
  const rows = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const first = shown.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(shown.length, page * PAGE_SIZE);
  const sortHref = (key: SortKey) =>
    href({ ...filters, tri: key, ordre: filters.tri === key ? (dir === "asc" ? "desc" : "asc") : SORTS[key].dir });
  const sortedBy = filters.tri ? `triés par ${SORTS[filters.tri].label} (${dir === "asc" ? "croissant" : "décroissant"})` : "comptes verrouillés d'abord, puis les plus récents";
  const active = [
    ...(filters.q ? [{ label: "Recherche", value: filters.q, removeHref: href({ ...filters, q: "" }) }] : []),
    ...(filters.role ? [{ label: "Rôle", value: ROLE_LABEL[filters.role], removeHref: href({ ...filters, role: undefined }) }] : []),
    ...(filters.etat ? [{ label: "État", value: STATES[filters.etat].label, removeHref: href({ ...filters, etat: undefined }) }] : []),
  ];
  const sortTh = (key: SortKey, label: string) => (
    <SortHeader label={label} href={sortHref(key)} active={filters.tri === key} dir={dir} className={tableCls.th} />
  );

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Utilisateurs et accès"
        subtitle={`${fmt.int(users.length)} comptes : ${fmt.int(byRole.ADMIN)} administrateur${byRole.ADMIN > 1 ? "s" : ""}, ${fmt.int(byRole.RH)} responsable${byRole.RH > 1 ? "s" : ""} RH, ${fmt.int(byRole.MANAGER)} manager${byRole.MANAGER > 1 ? "s" : ""}. Un nouveau compte reçoit un lien d'activation valable ${ACTIVATION_DAYS} jours.`}
        actions={
          <ButtonLink href="#nouveau-compte" variant="primary" icon="plus">
            Créer un compte
          </ButtonLink>
        }
      />

      <nav aria-label="Filtrer par état du compte" className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <CounterTile label="Tous les comptes" hint="tous rôles et états" value={users.length} dot="bg-accent" to={href({ ...filters, etat: undefined })} current={!filters.etat} className="col-span-2 sm:col-span-1" />
        {STATE_KEYS.map((s) => (
          <CounterTile
            key={s}
            label={STATES[s].plural}
            hint={STATES[s].hint}
            value={byState[s]}
            dot={DOT[STATES[s].tone]}
            to={href({ ...filters, etat: filters.etat === s ? undefined : s })}
            current={filters.etat === s}
            urgent={s === "verrouille" && byState[s] > 0}
          />
        ))}
      </nav>

      <section id="nouveau-compte" aria-labelledby="nu-title" className={`${cardCls} mb-6 scroll-mt-4 overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line bg-surface-2 px-4 py-3">
          <h2 id="nu-title" className="flex items-center gap-2 text-base font-semibold text-heading">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary-soft text-link">
              <Icon name="user-plus" />
            </span>
            Créer un compte
          </h2>
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
            {["Saisir l'identifiant et le rôle", "Lier un collaborateur (obligatoire pour un manager)", "Transmettre le lien d'activation"].map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-accent-fg">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
        <div className="p-4">
          <UserCreateForm />
        </div>
      </section>

      <section aria-labelledby="ul-title" className={`${cardCls} min-w-0 overflow-hidden p-4`}>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="ul-title" className="text-base font-semibold text-heading">
            Comptes
          </h2>
          <p className="text-xs text-fg-muted" aria-live="polite">
            {shown.length === 0
              ? "Aucun compte affiché"
              : `${fmt.int(first)}–${fmt.int(last)} sur ${fmt.int(shown.length)}${filtered ? ` (filtrés parmi ${fmt.int(users.length)})` : ""} · ${sortedBy}`}
          </p>
        </div>

        <form method="get" role="search" aria-label="Rechercher un compte" className="mb-3 grid gap-3 rounded-control border border-line bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
          {filters.tri && <input type="hidden" name="tri" value={filters.tri} />}
          {filters.tri && <input type="hidden" name="ordre" value={dir} />}
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="uf-q" className={labelCls}>Rechercher un compte</label>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-2.5 mt-1 flex items-center text-fg-subtle">
                <Icon name="search" />
              </span>
              <input id="uf-q" name="q" type="search" defaultValue={filters.q} maxLength={100} placeholder="Identifiant, e-mail, nom ou matricule" className={fieldCls(false, "pl-8 pr-3")} />
            </div>
          </div>
          <div>
            <label htmlFor="uf-role" className={labelCls}>Rôle</label>
            <select id="uf-role" name="role" defaultValue={filters.role ?? ""} className={fieldCls()}>
              <option value="">Tous les rôles</option>
              {ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="uf-etat" className={labelCls}>État</label>
            <select id="uf-etat" name="etat" defaultValue={filters.etat ?? ""} className={fieldCls()}>
              <option value="">Tous les états</option>
              {STATE_KEYS.map((s) => (
                <option key={s} value={s}>{STATES[s].label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2 sm:justify-end lg:col-span-1">
            {filtered && (
              <ButtonLink href={href({ tri: filters.tri, ordre: filters.ordre })} variant="tertiary">
                Réinitialiser les filtres
              </ButtonLink>
            )}
            <Button type="submit" variant="primary" icon="filter">
              Appliquer les filtres
            </Button>
          </div>
        </form>
        {active.length > 0 && <ActiveFilters filters={active} />}

        {users.length === 0 ? (
          <EmptyState title="Aucun compte">Créez le premier compte avec le formulaire ci-dessus.</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState
            title="Aucun compte ne correspond à cette recherche"
            action={
              <ButtonLink href={href({ tri: filters.tri, ordre: filters.ordre })} variant="secondary">
                Afficher tous les comptes
              </ButtonLink>
            }
          >
            Vérifiez l&apos;orthographe, ou retirez un filtre.
          </EmptyState>
        ) : (
          <>
            <div className="lg:overflow-x-auto">
              <table className={`${tableCls.table} block lg:table`}>
                <caption className="sr-only">
                  Comptes utilisateurs, {first} à {last} sur {shown.length}, {sortedBy}
                </caption>
                <thead className={`${tableCls.thead} hidden lg:table-header-group`}>
                  <tr>
                    {sortTh("compte", "Compte")}
                    {sortTh("role", "Rôle")}
                    <th scope="col" className={tableCls.th}>Collaborateur lié</th>
                    {sortTh("etat", "État")}
                    {sortTh("connexion", "Dernière connexion")}
                    <th scope="col" className={`${tableCls.th} lg:w-px`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="block space-y-2 lg:table-row-group lg:space-y-0">
                  {rows.map((u) => (
                    <tr
                      key={u.id}
                      role="row"
                      className={`grid gap-x-4 rounded-control border border-line py-2 transition-colors duration-150 sm:grid-cols-2 lg:table-row lg:rounded-none lg:border-0 lg:border-b lg:py-0 lg:last:border-b-0 lg:hover:bg-surface-3 ${u.active ? "" : "text-fg-muted"} ${u.state === "verrouille" ? "border-danger/40 bg-danger-soft lg:bg-danger-soft/60" : ""}`}
                    >
                      <th scope="row" role="rowheader" className={`${td} text-left font-normal sm:col-span-2`}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Initials name={u.employee?.name || u.login} className={u.active ? "" : "opacity-50"} />
                          <div className="min-w-0">
                            <span className="break-all font-medium text-fg">{u.login}</span>
                            {u.id === ctx.userId && (
                              <span className="ml-1.5 rounded bg-accent/20 px-1 py-px text-[11px] font-medium text-fg">vous</span>
                            )}
                            {u.email && <span className="block max-w-56 truncate text-xs text-fg-muted" title={u.email}>{u.email}</span>}
                          </div>
                        </div>
                      </th>
                      <td role="cell" className={td}>
                        <MobileLabel>Rôle</MobileLabel>
                        <RoleBadge role={u.role} />
                      </td>
                      <td role="cell" className={td}>
                        <MobileLabel>Collaborateur lié</MobileLabel>
                        {u.employee ? (
                          <>
                            <span className="text-fg">{u.employee.name}</span>
                            <span className="ml-1 font-mono text-xs text-fg-muted lg:ml-0 lg:block">{u.employee.matricule}</span>
                          </>
                        ) : (
                          <span className="text-fg-subtle">aucun</span>
                        )}
                      </td>
                      <td role="cell" className={td}>
                        <MobileLabel>État</MobileLabel>
                        <StatusPill tone={STATES[u.state].tone}>{STATES[u.state].label}</StatusPill>
                        <StateDetail u={u} state={u.state} />
                      </td>
                      <td role="cell" className={`${td} tabular-nums lg:whitespace-nowrap`}>
                        <MobileLabel>Dernière connexion</MobileLabel>
                        {u.lastLoginAt ? fmt.dateTime(u.lastLoginAt) : <span className="text-fg-subtle">jamais</span>}
                      </td>
                      <td role="cell" className={`${td} pt-2 sm:col-span-2 lg:pt-2.5`}>
                        <UserActions
                          id={u.id}
                          login={u.login}
                          active={u.active}
                          hasPassword={u.hasPassword}
                          locked={!!u.lockedUntil}
                          failedAttempts={u.failedAttempts}
                          isSelf={u.id === ctx.userId}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <div className="mt-3 border-t border-line pt-3">
                <Pagination
                  path="/admin/users"
                  params={{ q: filters.q || undefined, role: filters.role, etat: filters.etat, tri: filters.tri, ordre: filters.tri ? dir : undefined }}
                  page={page}
                  pageCount={pageCount}
                  total={shown.length}
                  pageSize={PAGE_SIZE}
                  embedded
                />
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
