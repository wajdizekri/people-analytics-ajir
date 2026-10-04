import Link from "next/link";
import { pageContext } from "@/lib/dal/context";
import { auditFiltersSchema, listAudit, listUsers } from "@/lib/dal/admin";
import { Button, ButtonLink, EmptyState, Notice, PageHeader, cardCls, fmt, tableCls } from "@/components/ui";
import { ActiveFilters, Pagination, buildHref } from "@/components/pilotage/filters";
import { MobileCollapse } from "@/components/ux/mobile-collapse";
import { Icon, OUTCOME, OutcomeBadge, fieldCls, labelCls } from "@/components/admin/admin-ui";
import { AUDIT_CATEGORIES, actionLabel, describeAudit } from "@/components/admin/audit-labels";

export const metadata = { title: "Journal d'audit — People Analytics AJIR" };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const FILTER_KEYS = ["user", "action", "outcome", "from", "to"] as const;

const TZ = "Africa/Tunis";
const isoDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: TZ });

function TechDetail({ action, raw }: { action: string; raw: string | null }) {
  let full = raw ?? "";
  try {
    if (raw) full = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // détail tronqué à 400 caractères par la DAL : affiché brut
  }
  return (
    <details className="group mt-1">
      <summary className="inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded text-xs text-fg-muted hover:text-link [&::-webkit-details-marker]:hidden">
        <Icon name="chevron" className="h-3 w-3 transition-transform group-open:rotate-90" />
        Données techniques
      </summary>
      <div className="mt-1 max-w-xl rounded-control bg-surface-2 p-2 text-[11px] text-fg-muted ring-1 ring-inset ring-line">
        <p>
          Code de l&apos;action : <code className="font-mono">{action}</code>
        </p>
        {raw && <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono leading-snug">{full}</pre>}
      </div>
    </details>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext(["ADMIN"]);
  const sp = await searchParams;
  const raw = { user: one(sp.user), action: one(sp.action), outcome: one(sp.outcome), from: one(sp.from), to: one(sp.to), page: one(sp.page) };
  const parsed = auditFiltersSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : { page: 1 };
  const data = listAudit(ctx, filters);
  const accounts = listUsers(ctx);
  const users = new Map(accounts.map((u) => [String(u.id), u.login]));
  const logins = accounts.map((u) => u.login).sort((a, b) => a.localeCompare(b));
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const current = parsed.success ? parsed.data : undefined;
  const params = Object.fromEntries(FILTER_KEYS.map((k) => [k, current?.[k] || undefined])) as Record<(typeof FILTER_KEYS)[number], string | undefined>;
  const isCategory = AUDIT_CATEGORIES.some((c) => c.prefix === current?.action);
  const categoryLabel = (a: string) => AUDIT_CATEGORIES.find((c) => c.prefix === a)?.label ?? actionLabel(a);
  const without = (k: (typeof FILTER_KEYS)[number]) => buildHref("/admin/audit", { ...params, [k]: undefined });
  const active = [
    ...(params.user ? [{ label: "Utilisateur", value: params.user, removeHref: without("user") }] : []),
    ...(params.action ? [{ label: "Type d'action", value: categoryLabel(params.action), removeHref: without("action") }] : []),
    ...(params.outcome ? [{ label: "Résultat", value: OUTCOME[params.outcome as keyof typeof OUTCOME].label, removeHref: without("outcome") }] : []),
    ...(params.from ? [{ label: "Depuis le", value: fmt.date(params.from), removeHref: without("from") }] : []),
    ...(params.to ? [{ label: "Jusqu'au", value: fmt.date(params.to), removeHref: without("to") }] : []),
  ];
  const now = new Date();
  const daysAgo = (n: number) => isoDay(new Date(now.getTime() - n * 86_400_000));
  const QUICK = [
    { label: "Aujourd'hui", from: daysAgo(0) },
    { label: "7 derniers jours", from: daysAgo(6) },
    { label: "30 derniers jours", from: daysAgo(29) },
  ];
  const first = (data.page - 1) * data.pageSize + 1;
  const last = Math.min(data.total, data.page * data.pageSize);

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Journal d'audit"
        subtitle="Qui a fait quoi, et quand : connexions, consultations sensibles, modifications et refus d'accès. Les entrées ne peuvent être ni modifiées ni supprimées."
      />

      <section aria-labelledby="af-title" className={`${cardCls} mb-4 p-4`}>
        <h2 id="af-title" className="mb-3 flex items-center gap-2 text-base font-semibold text-heading">
          <Icon name="filter" className="h-4 w-4 text-link" />
          Rechercher dans le journal
        </h2>
        <form method="get" aria-label="Filtrer le journal">
          {/* Sous 640 px, les cinq champs sont repliés ; période rapide et boutons restent visibles */}
          <MobileCollapse label="Filtres" count={active.length}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
              <div>
                <label htmlFor="af-user" className={labelCls}>Utilisateur</label>
                <select id="af-user" name="user" defaultValue={current?.user ?? ""} className={fieldCls()}>
                  <option value="">Tous les utilisateurs</option>
                  {logins.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="af-action" className={labelCls}>Type d&apos;action</label>
                <select id="af-action" name="action" defaultValue={current?.action ?? ""} className={fieldCls()}>
                  <option value="">Toutes les actions</option>
                  {AUDIT_CATEGORIES.map((c) => (
                    <option key={c.prefix} value={c.prefix}>{c.label}</option>
                  ))}
                  {current?.action && !isCategory && <option value={current.action}>Action précise : {actionLabel(current.action)}</option>}
                </select>
              </div>
              <div>
                <label htmlFor="af-outcome" className={labelCls}>Résultat</label>
                <select id="af-outcome" name="outcome" defaultValue={current?.outcome ?? ""} className={fieldCls()}>
                  <option value="">Tous les résultats</option>
                  {(Object.keys(OUTCOME) as (keyof typeof OUTCOME)[]).map((o) => (
                    <option key={o} value={o}>{OUTCOME[o].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="af-from" className={labelCls}>Depuis le</label>
                <input id="af-from" type="date" name="from" defaultValue={current?.from ?? ""} className={fieldCls()} />
              </div>
              <div>
                <label htmlFor="af-to" className={labelCls}>Jusqu&apos;au</label>
                <input id="af-to" type="date" name="to" defaultValue={current?.to ?? ""} className={fieldCls()} />
              </div>
            </div>
          </MobileCollapse>
          <div className="mt-3 flex flex-col-reverse gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Période rapide">
              <span className="mr-1 text-xs font-medium text-fg-muted">Période rapide :</span>
              {QUICK.map((q) => {
                const on = params.from === q.from && !params.to;
                return (
                  <Link
                    key={q.label}
                    href={buildHref("/admin/audit", { ...params, from: q.from, to: undefined })}
                    aria-current={on ? "true" : undefined}
                    className={`inline-flex min-h-8 items-center rounded-full px-3 text-[13px] font-medium ring-1 ring-inset transition-colors duration-150 active:translate-y-px ${
                      on ? "bg-primary text-primary-fg ring-primary" : "bg-surface text-link ring-line-strong hover:bg-primary-soft hover:ring-primary"
                    }`}
                  >
                    {on && <Icon name="check" className="mr-1 h-3.5 w-3.5" />}
                    {q.label}
                  </Link>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {active.length > 0 && (
                <ButtonLink href="/admin/audit" variant="tertiary">
                  Réinitialiser les filtres
                </ButtonLink>
              )}
              <Button type="submit" variant="primary" icon="filter">
                Appliquer les filtres
              </Button>
            </div>
          </div>
        </form>
      </section>

      <ActiveFilters filters={active} />
      {!parsed.success && (
        <div className="mb-4">
          <Notice tone="warning">Filtres invalides ignorés : saisissez les dates au format jj/mm/aaaa avec le calendrier.</Notice>
        </div>
      )}

      {data.rows.length === 0 ? (
        <EmptyState
          title="Aucune entrée ne correspond à ces critères"
          action={
            <ButtonLink href="/admin/audit" variant="secondary">
              Afficher tout le journal
            </ButtonLink>
          }
        >
          Élargissez la période ou retirez un filtre.
        </EmptyState>
      ) : (
        <section aria-labelledby="al-title" className={`${cardCls} min-w-0 overflow-hidden p-4`}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="al-title" className="text-base font-semibold text-heading">
              {fmt.int(data.total)} entrée{data.total > 1 ? "s" : ""}
              {active.length > 0 && <span className="font-normal text-fg-muted"> correspondant aux filtres</span>}
            </h2>
            <p className="text-xs tabular-nums text-fg-muted">
              {fmt.int(first)}–{fmt.int(last)} sur {fmt.int(data.total)} · les plus récentes d&apos;abord
            </p>
          </div>
          <div className="md:overflow-x-auto">
            <table className={`${tableCls.table} block md:table`}>
              <caption className="sr-only">
                Journal d&apos;audit, page {data.page} sur {pages}, les plus récentes d&apos;abord
              </caption>
              <thead className={`${tableCls.thead} hidden md:table-header-group`}>
                <tr>
                  <th scope="col" className={tableCls.th}>Date et heure</th>
                  <th scope="col" className={tableCls.th}>Ce qui s&apos;est passé</th>
                  <th scope="col" className={tableCls.th}>Résultat</th>
                  <th scope="col" className={`${tableCls.th} hidden lg:table-cell`}>Adresse IP</th>
                </tr>
              </thead>
              {/* Sous md : une fiche par entrée (date et résultat en tête, phrase en dessous) */}
              <tbody className="block md:table-row-group">
                {data.rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2.5 md:table-row md:py-0 ${tableCls.tr} ${r.outcome === "REFUSE" ? "bg-danger-soft/50" : ""}`}
                  >
                    <td className="px-1 text-xs tabular-nums text-fg-muted md:whitespace-nowrap md:px-3 md:py-2.5 md:align-top md:text-sm">{fmt.dateTime(r.at)}</td>
                    <td className="col-span-2 row-start-2 px-1 pt-1 md:min-w-[16rem] md:px-3 md:py-2.5 md:align-top">
                      <p className="text-fg">{describeAudit(r, users)}</p>
                      <TechDetail action={r.action} raw={r.detail} />
                    </td>
                    <td className="col-start-2 row-start-1 px-1 md:px-3 md:py-2.5 md:align-top">
                      <OutcomeBadge outcome={r.outcome} />
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 align-top font-mono text-xs text-fg-muted lg:table-cell">{r.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-3 border-t border-line pt-3">
              <Pagination path="/admin/audit" params={params} page={data.page} pageCount={pages} total={data.total} pageSize={data.pageSize} embedded />
            </div>
          )}
        </section>
      )}
    </>
  );
}
