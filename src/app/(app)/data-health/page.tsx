import Link from "next/link";
import type { ReactNode } from "react";
import { pageContext } from "@/lib/dal/context";
import { EXPORT_FILES, UPLOAD_MAX_TOTAL_BYTES, getDataHealth, getImportDetail, listImports, type DataHealthDTO, type ImportDetailDTO, type WorkerState } from "@/lib/dal/imports";
import { FRESHNESS_DAYS, getDataMonitoring, type DataMonitoringDTO } from "@/lib/dal/data-monitoring";
import { HttpError } from "@/lib/dal/errors";
import { ButtonLink, Card, DataTable, EmptyState, Notice, PageHeader, Section, StatusBadge, StatusSummary, fmt, type StatusTone } from "@/components/ui";
import { KpiCard, type Status } from "@/components/charts/pbi";
import { IMPORT_STATUS, JOB_TYPE_LABEL, nf, qualityStatus } from "@/components/monitoring/data-options";
import { OnThisPage } from "@/components/ux/on-this-page";
import { AutoRefresh } from "@/components/ux/auto-refresh";
import { PageIntro, TermTip } from "@/components/help";
import { RecomputeForm, UploadForm } from "./admin-controls";
import { ImportControls, ImportLead } from "./import-controls";
import { Trends } from "./trends";

export const metadata = { title: "Santé des données — People Analytics AJIR" };

// Ordre de lecture : verdict, indicateurs, contrôles de l'import (Pareto puis tableau), import et relance (administrateur),
// historique, tendances.

type Light = "bon" | "attention" | "critique";
type SP = Promise<Record<string, string | string[] | undefined>>;

const JOB_STATUS: Record<DataHealthDTO["jobs"][number]["status"], { label: string; tone: StatusTone }> = {
  EN_FILE: { label: "En attente", tone: "info" },
  EN_COURS: { label: "En cours", tone: "warning" },
  TERMINE: { label: "Terminé", tone: "success" },
  ECHEC: { label: "Échec", tone: "danger" },
};

const WORKER: Record<WorkerState, { label: string; tone: Status }> = {
  ACTIF: { label: "En marche", tone: "bon" },
  EN_RETARD: { label: "En retard", tone: "attention" },
  PERIME: { label: "Arrêté", tone: "critique" },
  ABSENT: { label: "Arrêté", tone: "critique" },
};

const TONE_LABEL: Record<Status, string> = { bon: "Normal", attention: "À surveiller", critique: "Critique", neutre: "—" };

function age(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 90) return `il y a ${seconds} s`;
  if (seconds < 5400) return `il y a ${Math.round(seconds / 60)} min`;
  if (seconds < 172800) return `il y a ${Math.round(seconds / 3600)} h`;
  return `il y a ${Math.round(seconds / 86400)} jours`;
}

const signed = (n: number, text: string) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${text}`;

function freshness(days: number | null): { tone: Status; label: string } | undefined {
  if (days == null) return undefined;
  if (days <= FRESHNESS_DAYS.warn) return { tone: "bon", label: "À jour" };
  return days <= FRESHNESS_DAYS.crit ? { tone: "attention", label: "En retard" } : { tone: "critique", label: "Périmées" };
}

// Verdict en une phrase et points d'attention, du plus grave au moins grave
function healthSummary(health: DataHealthDTO, mon: DataMonitoringDTO, admin: boolean): { tone: Light; label: string; title: string; points: ReactNode[] } {
  const rank: Record<Light, number> = { bon: 0, attention: 1, critique: 2 };
  let tone = "bon" as Light;
  const raise = (to: Light) => {
    if (rank[to] > rank[tone]) tone = to;
  };
  const points: ReactNode[] = [];
  const last = health.lastImport;
  const threshold = fmt.pct(mon.qualityThreshold, 0);
  let title: string;
  if (!last) {
    raise("attention");
    title = "Aucun import terminé : les autres écrans n'ont pas encore de données AJIR.";
    points.push(admin ? "Importez le premier export AJIR à l'aide des trois étapes ci-dessous." : "L'administrateur de l'outil doit importer le premier export AJIR.");
  } else {
    const when = `Dernier import du ${fmt.date(last.startedAt)}${health.dataEndDate ? ` (données jusqu'au ${fmt.date(health.dataEndDate)})` : ""}`;
    const quality = last.qualityScore != null ? fmt.pct(last.qualityScore, 1) : "non mesurée";
    if (last.status === "ECHEC") {
      raise("critique");
      title = `${when} en échec : aucun nouveau calcul n'a été publié.`;
    } else if (health.scoring.blocked) {
      raise("critique");
      title = `${when} bloqué : qualité ${quality}, sous le seuil de ${threshold}. Calcul des risques suspendu.`;
    } else {
      title = `${when} : qualité ${quality}, calcul autorisé.`;
    }
    if (last.status !== "OK") {
      const run = health.scoring.currentRun;
      points.push(
        `Les écrans affichent toujours le dernier calcul publié${run ? ` (au ${fmt.date(run.asOf)})` : ""}. ${
          admin ? "Corrigez dans AJIR les rejets expliqués plus bas, puis importez un nouvel export." : "L'administrateur doit importer un export corrigé."
        }`,
      );
    } else if (qualityStatus(last.qualityScore, mon.qualityThreshold, last.status)?.tone === "attention") {
      raise("attention");
      points.push(`Qualité proche du seuil de blocage (${threshold}) : surveillez les rejets expliqués plus bas.`);
    }
  }
  const w = health.worker;
  if (w.state === "PERIME" || w.state === "ABSENT") {
    raise("attention");
    points.push(
      <>
        Le service de calcul ne répond pas{w.heartbeatAt ? ` (dernier signal ${age(w.ageSeconds)})` : ""}. Un nouvel import ou un recalcul resterait en attente.{" "}
        {admin ? "Redémarrez le service « worker » sur le serveur." : "Prévenez l'administrateur de l'outil."}
      </>,
    );
  } else if (w.state === "EN_RETARD") {
    raise("attention");
    points.push(`Le service de calcul répond avec retard (dernier signal ${age(w.ageSeconds)}).`);
  }
  const fresh = freshness(mon.dataLagDays);
  if (fresh && fresh.tone !== "bon") {
    raise("attention");
    points.push(`Les données ont ${fmt.int(mon.dataLagDays)} jours : l'export AJIR du mois suivant est attendu.`);
  }
  if (health.runningImport) points.push(`Import n° ${health.runningImport.id} en cours depuis le ${fmt.dateTime(health.runningImport.startedAt)}.`);
  const label =
    tone === "critique" ? "Action requise" : tone === "attention" ? (last ? "Données utilisables, à surveiller" : "En attente de données") : "Données fiables";
  if (!points.length) points.push("Rien à signaler : les chiffres des autres écrans reposent sur un import conforme.");
  return { tone, label, title, points };
}

function MonitoringKpis({ health, mon, admin }: { health: DataHealthDTO; mon: DataMonitoringDTO; admin: boolean }) {
  const last = mon.imports.at(-1) ?? null;
  const prev = mon.imports.at(-2) ?? null;
  const quality = qualityStatus(last?.qualityScore ?? null, mon.qualityThreshold, last?.status);
  const qDelta = last?.qualityScore != null && prev?.qualityScore != null ? Math.round((last.qualityScore - prev.qualityScore) * 1000) / 10 : null;
  const rDelta = last && prev ? last.rowsRejected - prev.rowsRejected : null;
  const read = last ? last.rowsOk + last.rowsRejected : 0;
  const w = WORKER[health.worker.state];
  const scoringTone: Status = health.scoring.blocked ? "critique" : "bon";
  const run = health.scoring.currentRun;
  const detailHref = last ? `/data-health?batch=${last.id}#detail` : undefined;
  const workerDown = health.worker.state === "PERIME" || health.worker.state === "ABSENT";
  return (
    <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <KpiCard
        tip={<TermTip term="scoreQualite" align="end" />}
        label="Score qualité du dernier import"
        value={last?.qualityScore != null ? fmt.pct(last.qualityScore, 1) : "—"}
        status={quality}
        delta={qDelta != null ? { value: qDelta, label: `${signed(qDelta, `${nf(Math.abs(qDelta))} pt`)} par rapport à l'import précédent`, good: "up" } : null}
        hint={last ? `Seuil de blocage : ${fmt.pct(mon.qualityThreshold, 0)}` : "Aucun import terminé"}
        href={detailHref}
        detailLabel="Voir les contrôles"
      />
      <KpiCard
        tip={<TermTip term="lignesRejetees" align="end" />}
        label="Lignes rejetées au dernier import"
        value={last ? fmt.int(last.rowsRejected) : "—"}
        delta={rDelta != null ? { value: rDelta, label: `${signed(rDelta, fmt.int(Math.abs(rDelta)))} par rapport à l'import précédent`, good: "down" } : null}
        hint={last && read ? `${fmt.pct(last.rowsRejected / read, 1)} des ${fmt.int(read)} lignes lues` : undefined}
        href={detailHref}
        detailLabel="Voir pourquoi"
      />
      <KpiCard
        tip={<TermTip term="fraicheur" align="end" />}
        label="Fraîcheur des données"
        value={mon.dataLagDays != null ? `${fmt.int(mon.dataLagDays)} jour${mon.dataLagDays > 1 ? "s" : ""}` : "—"}
        status={freshness(mon.dataLagDays)}
        hint={mon.dataEndDate ? `Données jusqu'au ${fmt.date(mon.dataEndDate)} · un export attendu chaque mois` : "Aucune donnée importée"}
      />
      <KpiCard
        tip={<TermTip term="worker" align="end" />}
        label="Service de calcul"
        value={w.label}
        status={{ tone: w.tone, label: TONE_LABEL[w.tone] }}
        hint={
          workerDown
            ? `${health.worker.heartbeatAt ? `Dernier signal ${age(health.worker.ageSeconds)}` : "Aucun signal reçu"} · ${admin ? "à redémarrer sur le serveur" : "prévenir l'administrateur"}`
            : `Dernier signal ${age(health.worker.ageSeconds)}`
        }
      />
      <KpiCard
        tip={<TermTip term="calculRisques" align="end" />}
        label="Calcul des risques"
        value={health.scoring.blocked ? "Bloqué" : "Autorisé"}
        status={{ tone: scoringTone, label: TONE_LABEL[scoringTone] }}
        hint={run ? `Dernier calcul publié au ${fmt.date(run.asOf)} · ${fmt.int(run.nScored)} collaborateurs évalués` : "Aucun calcul publié"}
      />
    </div>
  );
}

export default async function DataHealthPage({ searchParams }: { searchParams: SP }) {
  const ctx = await pageContext(["ADMIN", "RH"]);
  const sp = await searchParams;
  const health = getDataHealth(ctx);
  const imports = listImports(ctx, { limit: 50 });
  const requested = typeof sp.batch === "string" ? Number(sp.batch) : null;
  const batchId = requested && Number.isInteger(requested) && requested > 0 ? requested : health.lastImport?.id ?? null;
  let detail: ImportDetailDTO | null = null;
  let detailMissing = false;
  if (batchId) {
    try {
      detail = getImportDetail(ctx, batchId);
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
      detailMissing = true;
    }
  }
  const mon = getDataMonitoring(ctx);
  const admin = ctx.role === "ADMIN";
  // Import ou calcul en file : la page se met à jour seule tant que le worker répond
  const busy = !!health.runningImport || health.jobs.some((j) => j.status === "EN_FILE" || j.status === "EN_COURS");
  const workerUp = health.worker.state === "ACTIF" || health.worker.state === "EN_RETARD";
  const summary = healthSummary(health, mon, admin);

  return (
    <>
      <PageHeader
        eyebrow="Données et modèle"
        title="Santé des données"
        subtitle={`Imports de l'export AJIR, contrôles qualité et calcul mensuel${health.dataEndDate ? ` — données au ${fmt.date(health.dataEndDate)}` : ""}.`}
        actions={
          admin ? (
            <ButtonLink href="#import" variant="primary" icon="upload">
              Importer un export AJIR
            </ButtonLink>
          ) : undefined
        }
      />
      <StatusSummary tone={summary.tone} label={summary.label} title={summary.title} points={summary.points} ariaLabel="État des données en un coup d'œil" />
      <AutoRefresh active={busy && workerUp} label="Traitement en cours (import ou calcul)." />
      <PageIntro
        helpHref="/aide#qualite-donnees"
        points={[
          "Sous le seuil de qualité, l'import est bloqué : les écrans gardent le dernier calcul publié.",
          "Chaque contrôle en échec est expliqué, avec l'action à mener dans AJIR.",
          admin ? "Vous importez ici l'export AJIR du mois et relancez le calcul mensuel." : "L'administrateur importe les exports ; vous vérifiez ici leur fiabilité.",
        ]}
      >
        Vérifier que l&apos;export AJIR a bien été importé avant de se fier aux chiffres des autres écrans.
      </PageIntro>
      <OnThisPage
        items={[
          { id: "detail", label: "Contrôles qualité" },
          ...(admin ? [{ id: "import", label: "Importer" }] : []),
          { id: "historique", label: "Historique" },
          { id: "tendances", label: "Tendances" },
        ]}
      />

      <section aria-label="Indicateurs de qualité des données et des traitements">
        <MonitoringKpis health={health} mon={mon} admin={admin} />
      </section>

      <Section
        id="detail"
        title={detail ? `Contrôles de l'import n° ${detail.batch.id}` : "Contrôles qualité d'un import"}
        intro={detail ? <ImportLead detail={detail} /> : "Les lignes signalées par contrôle, leur effet sur l'import et l'action à mener dans AJIR."}
      >
        {detailMissing && (
          <Notice tone="warning">
            Import n° {batchId} introuvable. Choisissez un import dans l&apos;<a href="#historique" className="font-medium underline underline-offset-2">historique</a>.
          </Notice>
        )}
        {!detail && !detailMissing && (
          <EmptyState title="Aucun import à détailler">Les contrôles qualité du dernier import s&apos;afficheront ici après le premier import.</EmptyState>
        )}
        {detail && <ImportControls detail={detail} />}
      </Section>

      {admin && (
        <div id="import" className="mb-8 grid scroll-mt-4 grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title="Importer un export AJIR" className="lg:col-span-2">
            <UploadForm accepted={EXPORT_FILES} maxBytes={UPLOAD_MAX_TOTAL_BYTES} workerUp={workerUp} />
          </Card>
          <Card title="Relancer le calcul mensuel">
            <p className="mb-3 text-sm text-fg-muted">
              Recalcule les indicateurs, les niveaux de risque, les anomalies et les alertes sur les dernières données importées.
            </p>
            <p className="mb-3 text-xs text-fg-muted">Utile après une modification des paramètres. Inutile après un import : le calcul est lancé automatiquement.</p>
            <RecomputeForm
              disabled={health.scoring.blocked}
              reason={health.scoring.blocked ? "Indisponible tant que le dernier import est bloqué : importez d'abord un export conforme." : undefined}
            />
          </Card>
        </div>
      )}

      <Section id="historique" title="Historique des imports et des traitements">
        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-5">
          <section aria-labelledby="imports-titre" className="min-w-0 2xl:col-span-3">
            <h3 id="imports-titre" className="mb-2 text-base font-semibold text-heading">
              Imports
            </h3>
            <DataTable
              caption="Historique des imports"
              pageSize={10}
              maxHeight={false}
              empty={
                <EmptyState title="Aucun import enregistré">
                  {admin
                    ? "Importez un export AJIR ci-dessus : il apparaîtra ici après son traitement par le service de calcul."
                    : "Le premier export AJIR, importé par l'administrateur, apparaîtra ici après son traitement."}
                </EmptyState>
              }
              columns={[
                { key: "import", label: "Import" },
                { key: "statut", label: "Statut" },
                { key: "ok", label: "Lignes importées", numeric: true },
                { key: "rejet", label: "Lignes rejetées", numeric: true },
                { key: "qualite", label: "Qualité", numeric: true },
                { key: "controles", label: "Contrôles", sortable: false },
              ]}
              rows={imports.map((i) => {
                const shown = detail?.batch.id === i.id;
                return {
                  id: i.id,
                  cells: {
                    import: (
                      <span className="inline-block">
                        <span className="whitespace-nowrap">
                          n° {i.id} · {fmt.dateTime(i.startedAt)}
                        </span>
                        <span className="block text-xs text-fg-muted">
                          {i.source}
                          {i.userLogin ? ` · ${i.userLogin}` : ""}
                        </span>
                        {shown && (
                          <span className="mt-1 block">
                            <StatusBadge tone="info" dot={false}>
                              Contrôles affichés ci-dessus
                            </StatusBadge>
                          </span>
                        )}
                      </span>
                    ),
                    statut: <StatusBadge tone={IMPORT_STATUS[i.status].tone}>{IMPORT_STATUS[i.status].label}</StatusBadge>,
                    ok: fmt.int(i.rowsOk),
                    rejet: fmt.int(i.rowsRejected),
                    qualite: fmt.pct(i.qualityScore, 1),
                    controles: (
                      <Link
                        href={`/data-health?batch=${i.id}#detail`}
                        aria-current={shown ? "true" : undefined}
                        className="inline-flex min-h-8 items-center whitespace-nowrap font-medium text-link underline underline-offset-2 transition-colors hover:text-fg aria-[current]:font-semibold aria-[current]:no-underline"
                      >
                        Voir les contrôles<span className="sr-only"> de l&apos;import n° {i.id}</span>
                      </Link>
                    ),
                  },
                  sort: { import: i.id, statut: IMPORT_STATUS[i.status].label, ok: i.rowsOk, rejet: i.rowsRejected, qualite: i.qualityScore },
                };
              })}
            />
          </section>

          <section aria-labelledby="traitements-titre" className="min-w-0 2xl:col-span-2">
            <h3 id="traitements-titre" className="mb-2 flex items-center gap-1 text-base font-semibold text-heading">
              Traitements récents <TermTip term="traitements" align="end" />
            </h3>
            <DataTable
              caption="Traitements récents"
              pageSize={10}
              maxHeight={false}
              empty={<EmptyState title="Aucun traitement enregistré">Les imports et calculs mensuels lancés apparaîtront ici.</EmptyState>}
              columns={[
                { key: "type", label: "Traitement" },
                { key: "statut", label: "Statut" },
                { key: "lance", label: "Lancé le" },
                { key: "fin", label: "Terminé le" },
              ]}
              rows={health.jobs.map((j) => ({
                id: j.id,
                cells: {
                  type: (
                    <>
                      {JOB_TYPE_LABEL[j.type] ?? j.type} <span className="text-xs text-fg-muted">n° {j.id}</span>
                      {j.target && <span className="block text-xs text-fg-muted">{j.target}</span>}
                    </>
                  ),
                  statut: (
                    <>
                      <StatusBadge tone={JOB_STATUS[j.status].tone}>{JOB_STATUS[j.status].label}</StatusBadge>
                      {j.error && <span className="mt-1 block max-w-xs text-xs text-danger">{j.error}</span>}
                    </>
                  ),
                  lance: (
                    <span className="whitespace-nowrap">
                      {fmt.dateTime(j.createdAt)}
                      {j.createdBy && <span className="block text-xs text-fg-muted">par {j.createdBy}</span>}
                    </span>
                  ),
                  fin: <span className="whitespace-nowrap">{fmt.dateTime(j.finishedAt)}</span>,
                },
                sort: { type: JOB_TYPE_LABEL[j.type] ?? j.type, statut: JOB_STATUS[j.status].label, lance: j.createdAt, fin: j.finishedAt },
              }))}
            />
          </section>
        </div>
      </Section>

      <Section
        id="tendances"
        title="Tendances des imports et des traitements"
        intro="Évolution d'un import à l'autre : utile pour repérer une dégradation progressive de l'export."
        className="mb-0"
      >
        <Trends mon={mon} />
      </Section>
    </>
  );
}
