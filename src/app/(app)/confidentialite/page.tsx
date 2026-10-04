import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { pageContext } from "@/lib/dal/context";
import { parseQuery } from "@/lib/dal/employees";
import { HttpError } from "@/lib/dal/errors";
import {
  PRIVACY_STATUSES,
  PRIVACY_TYPES,
  getPrivacySubject,
  listPrivacyRequests,
  searchPrivacySubjects,
  type PrivacyRequestDto,
  type PrivacyStatus,
  type PrivacySubjectDto,
  type PrivacyType,
} from "@/lib/dal/privacy";
import { Badge, Button, ButtonLink, Card, DataTable, EmptyState, KpiTile, Notice, PageHeader, StatusBadge, Steps, cardCls, fieldCls, fmt, type DataTableRow, type StepStatus } from "@/components/ui";
import { InfoTip } from "@/components/help";
import { CloseRequestForm, ExportLinks, LiftOppositionForm, RequestForm } from "@/components/privacy/privacy-forms";
import { closeRequestAction, createRequestAction, liftOppositionAction } from "./actions";

export const metadata = { title: "Droit d'accès — People Analytics AJIR" };

const pageSchema = z.object({
  q: z.string().trim().max(100).optional(),
  salarie: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  statut: z.enum(PRIVACY_STATUSES).optional(),
  type: z.enum(PRIVACY_TYPES).optional(),
});
type PageQuery = z.output<typeof pageSchema>;

const TYPE_LABEL: Record<PrivacyType, string> = { ACCES: "Accès", OPPOSITION: "Opposition", RECTIFICATION: "Rectification" };
const STATUS_LABEL: Record<PrivacyStatus, string> = { OUVERTE: "Ouverte", TRAITEE: "Traitée", REFUSEE: "Refusée" };
const STATUS_TONE: Record<PrivacyStatus, "amber" | "emerald" | "slate"> = { OUVERTE: "amber", TRAITEE: "emerald", REFUSEE: "slate" };

const selectCls = `${fieldCls} mt-1 focus:outline-none focus:ring-2 focus:ring-primary/25`;
const STATUS_ORDER: Record<PrivacyStatus, number> = { OUVERTE: 1, TRAITEE: 2, REFUSEE: 3 };

function href(q: PageQuery, patch: Partial<PageQuery>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...q, ...patch })) if (v != null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `/confidentialite?${s}` : "/confidentialite";
}

function RequestStatus({ r }: { r: PrivacyRequestDto }) {
  if (r.overdue) return <Badge tone="red">Hors délai</Badge>;
  return <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>;
}

// Parcours en trois étapes (composant commun Steps : numéro, état écrit, étape en cours annoncée)
const STEPS = [{ title: "Retrouver le collaborateur" }, { title: "Enregistrer la demande" }, { title: "Répondre et clôturer" }];

function RequestSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className={`${cardCls} mb-6 p-4`}>
      <Steps
        label="Étapes du traitement d'une demande"
        steps={STEPS.map((s, i) => ({ ...s, status: (i + 1 < current ? "done" : i + 1 === current ? "current" : "todo") as StepStatus }))}
      />
    </div>
  );
}

function SubjectPanel({ s }: { s: PrivacySubjectDto }) {
  const e = s.employee;
  const open = s.requests.filter((r) => r.status === "OUVERTE");
  return (
    <div className="space-y-4">
      <Card title={`${e.lastName} ${e.firstName} — matricule ${e.matricule}`}>
        <p className="text-sm text-fg-muted">
          {[e.jobTitle, e.department].filter(Boolean).join(" · ") || "Poste non renseigné"} · embauché le {fmt.date(e.hireDate)}
          {e.status === "SORTI" && (
            <>
              {" "}
              · <Badge>Sorti le {fmt.date(e.exitDate)}</Badge>
            </>
          )}
        </p>
        {s.opposition ? (
          <div className="mt-3">
            <Notice tone="warning" title={s.opposition.label}>
              Depuis le {fmt.dateTime(s.opposition.since)}
              {s.opposition.recordedBy ? ` · par ${s.opposition.recordedBy}` : ""} · exclu du calcul du risque
            </Notice>
            <LiftOppositionForm employeeId={e.id} action={liftOppositionAction} />
          </div>
        ) : (
          <p className="mt-3">
            <StatusBadge tone="neutral">Aucune opposition</StatusBadge>
          </p>
        )}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Étape 2 · Nouvelle demande" headingLevel={3}>
          <RequestForm employeeId={e.id} opposed={!!s.opposition} action={createRequestAction} />
        </Card>
        <Card
          title="Données détenues"
          headingLevel={3}
          actions={
            <InfoTip label="Copie d'accès" prefix="Détails" align="end">
              Toutes ces rubriques, plus l&apos;identité, les facteurs des estimations, les interventions et les demandes déjà faites.
            </InfoTip>
          }
        >
          <dl className="grid grid-cols-[1fr_max-content] gap-x-4 gap-y-1.5 text-sm">
            {s.inventory.map((i) => (
              <div key={i.label} className="contents">
                <dt className="text-fg-muted">{i.label}</dt>
                <dd className="text-right tabular-nums text-fg">{fmt.int(i.count)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card title={`Étape 3 · Répondre et clôturer${open.length ? ` (${open.length} demande${open.length > 1 ? "s" : ""} ouverte${open.length > 1 ? "s" : ""})` : ""}`} headingLevel={3}>
        {s.requests.length === 0 ? (
          <EmptyState compact title="Aucune demande enregistrée" />
        ) : (
          <ol className="space-y-3">
            {s.requests.map((r) => (
              <li key={r.id} className={`rounded-control border p-3 ${r.overdue ? "border-danger/40 bg-danger-soft/40" : "border-line"}`}>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-fg">Demande n° {r.id}</span>
                  <Badge tone="sky">{TYPE_LABEL[r.type]}</Badge>
                  <RequestStatus r={r} />
                </div>
                <p className="mt-1 text-sm text-fg-muted">
                  Reçue le {fmt.dateTime(r.createdAt)}
                  {r.createdBy ? ` par ${r.createdBy}` : ""}
                  {r.status === "OUVERTE" && (
                    <>
                      {" "}
                      · <span className={r.overdue ? "font-semibold text-danger" : "font-medium text-fg"}>échéance {fmt.date(r.dueDate)}</span>
                    </>
                  )}
                  {r.closedAt ? ` · clôturée le ${fmt.dateTime(r.closedAt)}${r.closedBy ? ` par ${r.closedBy}` : ""}` : ""}
                </p>
                {r.note && <p className="mt-2 whitespace-pre-line text-sm text-fg">{r.note}</p>}
                {r.type === "ACCES" && r.status !== "REFUSEE" && (
                  <div className="mt-2">
                    <ExportLinks requestId={r.id} />
                  </div>
                )}
                {r.type === "RECTIFICATION" && r.status === "OUVERTE" && (
                  <p className="mt-2">
                    <StatusBadge tone="info">Correction à faire dans AJIR</StatusBadge>
                  </p>
                )}
                {r.status === "OUVERTE" && <CloseRequestForm requestId={r.id} type={r.type} action={closeRequestAction} />}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function Section({ id, title, children, className = "" }: { id: string; title: string; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`${cardCls} min-w-0 p-4 sm:p-5 ${className}`}>
      <h2 id={id} className="mb-3 text-base font-semibold text-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function PrivacyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await pageContext(["RH"]);
  const { data: q, ignored } = parseQuery(pageSchema, await searchParams, "lenient");
  const register = listPrivacyRequests(ctx, { statut: q.statut, type: q.type });
  const results = q.q && q.q.length >= 2 ? searchPrivacySubjects(ctx, q.q) : null;
  let subject: PrivacySubjectDto | null = null;
  let subjectMissing = false;
  if (q.salarie) {
    try {
      subject = getPrivacySubject(ctx, q.salarie);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) subjectMissing = true;
      else throw e;
    }
  }
  const c = register.counts;
  const step: 1 | 2 | 3 = !subject ? 1 : subject.requests.some((r) => r.status === "OUVERTE") ? 3 : 2;

  return (
    <div>
      <PageHeader
        eyebrow="Données et modèle"
        title="Droit d'accès"
        subtitle="Demandes d'accès, d'opposition et de rectification des collaborateurs."
        scope="Réservé à la RH"
        badge={<StatusBadge tone="info">Actions tracées</StatusBadge>}
      />

      <RequestSteps current={step} />

      {ignored.length > 0 && (
        <div className="mb-4">
          <Notice tone="warning">Paramètre ignoré : {ignored.join(", ")}</Notice>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Demandes ouvertes"
          value={fmt.int(c.open)}
          href={href({}, { statut: "OUVERTE" })}
          tip={<InfoTip label="Demandes ouvertes" align="end">Réponse due sous un mois.</InfoTip>}
        />
        <KpiTile label="Hors délai" value={fmt.int(c.overdue)} />
        <KpiTile
          label="Oppositions en vigueur"
          value={fmt.int(c.oppositions)}
          tip={<InfoTip label="Oppositions en vigueur" align="end">Collaborateurs exclus du calcul du risque.</InfoTip>}
        />
        <KpiTile label="Demandes enregistrées" value={fmt.int(c.total)} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Section id="etape-1" title="Étape 1 · Retrouver le collaborateur" className="lg:col-span-1">
          <form method="get" action="/confidentialite" role="search" className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 grow basis-40">
              <label htmlFor="privacy-q" className="block text-sm font-medium text-fg">Matricule ou nom</label>
              <input
                id="privacy-q"
                name="q"
                type="search"
                defaultValue={q.q ?? ""}
                minLength={2}
                maxLength={100}
                placeholder="Présents et sortis"
                className={selectCls}
                autoComplete="off"
              />
            </div>
            {q.statut && <input type="hidden" name="statut" value={q.statut} />}
            {q.type && <input type="hidden" name="type" value={q.type} />}
            <Button type="submit" variant="primary" icon="search">
              Rechercher
            </Button>
          </form>
          <div className="mt-3">
            {results === null ? null : results.length === 0 ? (
              <EmptyState compact title="Aucun collaborateur trouvé" />
            ) : (
              <ul className="divide-y divide-line" aria-label="Résultats de la recherche">
                {results.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={href(q, { salarie: r.id })}
                      aria-current={q.salarie === r.id ? "true" : undefined}
                      className="flex min-h-10 items-center justify-between gap-2 rounded px-2 py-2 text-sm hover:bg-primary-soft aria-[current]:bg-primary-soft"
                    >
                      <span>
                        <span className="font-medium text-fg">
                          {r.lastName} {r.firstName}
                        </span>
                        <span className="block text-xs text-fg-muted">
                          {r.matricule}
                          {r.department ? ` · ${r.department}` : ""}
                        </span>
                      </span>
                      <span className="flex flex-wrap justify-end gap-1">
                        {r.status === "SORTI" && <Badge>Sorti</Badge>}
                        {r.opposed && <Badge tone="amber">Opposition</Badge>}
                        {r.openRequests > 0 && <Badge tone="sky">{r.openRequests} ouverte{r.openRequests > 1 ? "s" : ""}</Badge>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <div className="min-w-0 lg:col-span-2">
          {subject ? (
            <SubjectPanel s={subject} />
          ) : subjectMissing ? (
            <EmptyState title="Collaborateur introuvable" />
          ) : (
            <EmptyState title="Aucun collaborateur sélectionné" icon="search" />
          )}
        </div>
      </div>

      <Section id="registre" title="Registre des demandes">
        <form method="get" action="/confidentialite" aria-label="Filtrer le registre" className="mb-4 flex flex-wrap items-end gap-3 rounded-control border border-line bg-surface-2 p-3">
          {q.q && <input type="hidden" name="q" value={q.q} />}
          {q.salarie && <input type="hidden" name="salarie" value={q.salarie} />}
          <div className="w-full sm:w-48">
            <label htmlFor="reg-statut" className="block text-sm font-medium text-fg">Statut</label>
            <select id="reg-statut" name="statut" defaultValue={q.statut ?? ""} className={selectCls}>
              <option value="">Tous les statuts</option>
              {PRIVACY_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
          <div className="w-full sm:w-48">
            <label htmlFor="reg-type" className="block text-sm font-medium text-fg">Type</label>
            <select id="reg-type" name="type" defaultValue={q.type ?? ""} className={selectCls}>
              <option value="">Tous les types</option>
              {PRIVACY_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            {(q.statut || q.type) && (
              <ButtonLink href={href(q, { statut: undefined, type: undefined })} variant="tertiary">
                Réinitialiser les filtres
              </ButtonLink>
            )}
            <Button type="submit" variant="primary" icon="filter">
              Appliquer les filtres
            </Button>
          </div>
        </form>
        {register.rows.length > 0 && (
          <p className="mb-2 text-xs text-fg-muted">
            {fmt.int(register.rows.length)} demande{register.rows.length > 1 ? "s" : ""}
            {q.statut || q.type ? ` filtrée${register.rows.length > 1 ? "s" : ""}` : ""}
          </p>
        )}
        <DataTable
          caption="Registre des demandes d'exercice des droits"
          pageSize={25}
          maxHeight={false}
          columns={[
            { key: "collaborateur", label: "Collaborateur" },
            { key: "id", label: "N°", numeric: true },
            { key: "recue", label: "Reçue le" },
            { key: "type", label: "Type" },
            { key: "statut", label: "Statut" },
            { key: "echeance", label: "Réponse attendue avant le" },
            { key: "cloture", label: "Clôture" },
          ]}
          rows={register.rows.map(
            (r): DataTableRow => ({
              id: r.id,
              href: href(q, { salarie: r.employee.id }),
              cells: {
                collaborateur: (
                  <>
                    {r.employee.name}
                    <span className="block text-xs font-normal text-fg-muted">{r.employee.matricule}</span>
                  </>
                ),
                id: r.id,
                recue: <span className="whitespace-nowrap tabular-nums">{fmt.dateTime(r.createdAt)}</span>,
                type: TYPE_LABEL[r.type],
                statut: <RequestStatus r={r} />,
                echeance: <span className="whitespace-nowrap tabular-nums">{r.status === "OUVERTE" ? fmt.date(r.dueDate) : "—"}</span>,
                cloture: <span className="whitespace-nowrap">{r.closedAt ? `${fmt.date(r.closedAt)}${r.closedBy ? ` · ${r.closedBy}` : ""}` : "—"}</span>,
              },
              sort: {
                collaborateur: r.employee.name,
                id: r.id,
                recue: r.createdAt,
                type: TYPE_LABEL[r.type],
                statut: r.overdue ? 0 : STATUS_ORDER[r.status],
                echeance: r.status === "OUVERTE" ? r.dueDate : null,
                cloture: r.closedAt,
              },
            }),
          )}
          empty={
            <EmptyState
              compact
              title={q.statut || q.type ? "Aucune demande pour ces filtres" : "Aucune demande enregistrée"}
              action={
                q.statut || q.type ? (
                  <ButtonLink href={href(q, { statut: undefined, type: undefined })} variant="secondary">
                    Réinitialiser les filtres
                  </ButtonLink>
                ) : undefined
              }
            />
          }
        />
        {register.rows.length === 200 && <p className="mt-2 text-xs text-fg-muted">Limité aux 200 demandes les plus récentes</p>}
      </Section>

      <div className="mt-6">
        <Notice tone="neutral" title="Règles">
          <ul className="list-disc space-y-0.5 pl-5">
            <li>Rectification : dans AJIR, source de vérité</li>
            <li>Copie d&apos;accès : au seul collaborateur concerné</li>
            <li>Journal d&apos;audit : jamais supprimé</li>
            <li>Cadre légal : loi organique n° 2004-63, articles 32 à 42</li>
          </ul>
        </Notice>
      </div>
    </div>
  );
}
