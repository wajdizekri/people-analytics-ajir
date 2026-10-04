import Link from "next/link";
import type { ReactNode } from "react";
import { ROLES } from "@/db/schema";
import { pageContext } from "@/lib/dal/context";
import { getAdminOverview, listUsers } from "@/lib/dal/admin";
import { getDataHealth, type ImportDTO, type WorkerStatus } from "@/lib/dal/imports";
import { countOpenAlerts } from "@/lib/dal/alerts";
import { getAdminMonitoring, type WeekComparison } from "@/lib/dal/monitoring";
import { Chart, KpiCard, VisualCard, type ChartSpec, type Delta, type Status } from "@/components/charts/pbi";
import { DataDetails } from "@/components/pilotage/data-details";
import { ButtonLink, EmptyState, Notice, PageHeader, SectionHeader, cardCls, fmt, tableCls } from "@/components/ui";
import { Icon } from "@/components/admin/admin-ui";
import { describeAudit } from "@/components/admin/audit-labels";
import { auditRefusalsHref, authDailyChart, jobsChart, plural, refusalsChart, roleCounts } from "@/components/monitoring/admin-options";

export const metadata = { title: "Console d'administration — People Analytics AJIR" };

const DAYS = 30;

const WORKER: Record<WorkerStatus["state"], { label: string; tone: Status; verdict: string }> = {
  ACTIF: { label: "Actif", tone: "bon", verdict: "Normal" },
  EN_RETARD: { label: "En retard", tone: "attention", verdict: "À surveiller" },
  PERIME: { label: "Arrêté", tone: "critique", verdict: "Critique" },
  ABSENT: { label: "Arrêté", tone: "critique", verdict: "Critique" },
};

const IMPORT: Record<ImportDTO["status"], { label: string; tone: Status }> = {
  OK: { label: "Conforme", tone: "bon" },
  BLOQUE: { label: "Bloqué", tone: "critique" },
  ECHEC: { label: "Échec", tone: "critique" },
  EN_COURS: { label: "En cours", tone: "neutre" },
};

const HEALTH_HREF = "/data-health";
const HEALTH_LINK = "Voir la santé des données";
const cardLinkCls = "inline-flex min-h-8 items-center text-xs font-medium text-link underline underline-offset-2 hover:decoration-2";
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Le jugement (« favorable », « à surveiller ») est écrit par KpiCard à partir de `good`
function weekDelta(w: WeekComparison, good: Delta["good"]): Delta {
  const diff = w.current - w.previous;
  return { value: diff, good, label: diff === 0 ? "Stable" : `${diff > 0 ? "+" : "−"}${fmt.int(Math.abs(diff))}`, reference: "par rapport aux 7 jours précédents" };
}

function signalAge(seconds: number | null): string {
  if (seconds == null) return "aucun signal reçu";
  if (seconds < 90) return `dernier signal il y a ${seconds} s`;
  if (seconds < 5400) return `dernier signal il y a ${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `dernier signal il y a ${Math.round(seconds / 3600)} h`;
  return `dernier signal il y a ${Math.round(seconds / 86_400)} jours`;
}

function TaskButton({ href, icon, label, hint }: { href: string; icon: Parameters<typeof Icon>[0]["name"]; label: string; hint: string }) {
  return (
    <Link
      href={href}
      className={`${cardCls} group flex min-h-20 items-center gap-3 p-4 transition duration-200 hover:-translate-y-px hover:border-primary/60 hover:bg-primary-soft/60 hover:shadow-pop active:translate-y-0`}
    >
      <span aria-hidden="true" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-fg group-hover:bg-primary-hover">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold text-heading">{label}</span>
        <span className="block text-[13px] leading-snug text-fg-muted">{hint}</span>
      </span>
      <Icon name="arrow" className="ml-auto h-4 w-4 shrink-0 text-link transition group-hover:translate-x-0.5" />
    </Link>
  );
}

// Tuile d'état : valeur, pastille de statut en mots, lien. Un état critique a un cadre et une valeur rouges (ton du kit) ;
// il reste lisible sans la couleur grâce au mot de la pastille (« Critique », « Bloqué »).
function StateTile({
  label,
  value,
  unit,
  tone,
  state,
  hint,
  href,
  detailLabel,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: Status;
  state: string;
  hint: ReactNode;
  href: string;
  detailLabel: string;
}) {
  return (
    <KpiCard
      label={label}
      value={value}
      unit={unit}
      status={{ tone, label: state }}
      tone={tone === "critique" ? "critique" : undefined}
      hint={hint}
      href={href}
      detailLabel={detailLabel}
    />
  );
}

function ChartBlock({ spec, caption, table = spec.table }: { spec: ChartSpec; caption: string; table?: { headers: string[]; rows: ReactNode[][] } }) {
  return (
    <>
      <Chart spec={spec} />
      <DataDetails summary="Voir les données" caption={caption} headers={table.headers} rows={table.rows} numeric />
    </>
  );
}

export default async function AdminConsolePage() {
  const ctx = await pageContext(["ADMIN"]);
  const overview = getAdminOverview(ctx);
  const monitoring = getAdminMonitoring(ctx, DAYS);
  const health = getDataHealth(ctx);
  const openAlerts = countOpenAlerts(ctx);
  const users = new Map(listUsers(ctx).map((u) => [String(u.id), u.login]));

  const { accounts } = overview;
  const totalActive = ROLES.reduce((s, r) => s + accounts.active[r], 0);
  const { daily, week, refusalsByAction, jobs } = monitoring;
  const sum = (k: "logins" | "failedLogins") => daily.reduce((s, d) => s + d[k], 0);
  const logins30 = sum("logins");
  const failed30 = sum("failedLogins");
  const worker = WORKER[health.worker.state];
  const signal = signalAge(health.worker.ageSeconds);
  const lastImport = health.lastImport;
  const importState = lastImport ? IMPORT[lastImport.status] : { label: "Aucun import", tone: "attention" as const };
  const jobsTotal = jobs.reduce((s, j) => s + j.total, 0);
  const jobsFailed = jobs.reduce((s, j) => s + j.counts.ECHEC, 0);
  const period = `${DAYS} derniers jours (${fmt.date(monitoring.from)} – ${fmt.date(monitoring.to)})`;

  // Points d'attention : mêmes états, mêmes mots et mêmes liens que les tuiles ; les points critiques d'abord
  const problems: { text: string; href: string; link: string; critical: boolean }[] = [];
  if (health.worker.state !== "ACTIF")
    problems.push({
      text: `le service de calcul ${health.worker.state === "EN_RETARD" ? "répond avec retard" : "est arrêté"} (${signal})`,
      href: HEALTH_HREF,
      link: HEALTH_LINK,
      critical: worker.tone === "critique",
    });
  if (lastImport && importState.tone === "critique")
    problems.push({
      text: `le dernier import (n° ${lastImport.id}) est ${lastImport.status === "BLOQUE" ? "bloqué" : "en échec"}`,
      href: `/data-health?batch=${lastImport.id}#detail`,
      link: "Voir les contrôles de l'import",
      critical: true,
    });
  if (!lastImport) problems.push({ text: "aucun export AJIR n'a encore été importé", href: "/data-health#import", link: "Importer un export AJIR", critical: false });
  if (health.scoring.blocked && lastImport?.status !== "BLOQUE") problems.push({ text: "le calcul des risques est suspendu", href: HEALTH_HREF, link: HEALTH_LINK, critical: true });
  if (accounts.locked > 0)
    problems.push({ text: plural(accounts.locked, "compte est verrouillé", "comptes sont verrouillés"), href: "/admin/users?etat=verrouille", link: "Débloquer les comptes", critical: false });
  if (openAlerts > 0) problems.push({ text: plural(openAlerts, "alerte est à traiter", "alertes sont à traiter"), href: "/alerts?status=NOUVELLE", link: "Traiter les alertes", critical: false });
  problems.sort((a, b) => Number(b.critical) - Number(a.critical));
  const okParts = [
    lastImport && lastImport.status === "OK" ? `dernier import conforme (${fmt.pct(lastImport.qualityScore, 1)} de qualité, le ${fmt.date(lastImport.startedAt)})` : null,
    health.worker.state === "ACTIF" ? "service de calcul actif" : null,
    plural(totalActive, "compte actif", "comptes actifs"),
  ].filter(Boolean);

  // Titre = le message ; sans donnée, le titre nomme le visuel et l'état vide de la carte porte le message (pas de phrase en double)
  const authTitle =
    logins30 + failed30 === 0 ? `Connexions des ${DAYS} derniers jours` : `${plural(logins30, "connexion réussie", "connexions réussies")} et ${plural(failed30, "échec", "échecs")} en ${DAYS} jours`;
  const jobsTitle =
    jobsTotal === 0
      ? `Traitements des ${DAYS} derniers jours`
      : `${plural(jobsTotal, "traitement", "traitements")} en ${DAYS} jours, ${jobsFailed ? `dont ${fmt.int(jobsFailed)} en échec` : "aucun en échec"}`;
  const refusals = refusalsChart(refusalsByAction);
  const refusalsTitle = refusalsByAction.length === 0 ? `Refus d'accès des ${DAYS} derniers jours` : `Le plus refusé : « ${refusals.table.rows[0][0]} »`;

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Console d'administration"
        subtitle="Surveiller l'état de l'outil, gérer les comptes et contrôler les accès. Aucune donnée RH nominative n'est affichée ici."
        period={period}
      />

      <div className="mb-6">
        {problems.length === 0 ? (
          <Notice tone="success" title="Tout fonctionne normalement.">
            <p>{capitalize(okParts.join(", "))}.</p>
          </Notice>
        ) : (
          <Notice tone={problems.some((p) => p.critical) ? "error" : "warning"} title={`${plural(problems.length, "point demande", "points demandent")} votre attention.`}>
            <ul className="mt-1 space-y-1">
              {problems.map((p) => (
                <li key={p.text} className="flex flex-wrap items-baseline gap-x-2">
                  <span>{capitalize(p.text)}.</span>
                  <Link href={p.href} className="font-medium underline underline-offset-2">
                    {p.link}
                  </Link>
                </li>
              ))}
            </ul>
            {okParts.length > 0 && <p className="mt-1.5 text-[13px] opacity-90">Par ailleurs : {okParts.join(", ")}.</p>}
          </Notice>
        )}
      </div>

      <section aria-labelledby="taches" className="mb-6">
        <SectionHeader id="taches" title="Tâches fréquentes" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <TaskButton
            href="/data-health#import"
            icon="upload"
            label="Importer un export AJIR"
            hint={lastImport ? `Dernier import : n° ${lastImport.id} du ${fmt.date(lastImport.startedAt)}` : "Aucun import pour l'instant"}
          />
          <TaskButton href="/admin/users#nouveau-compte" icon="user-plus" label="Créer un compte" hint="Puis transmettre le lien d'activation" />
          <TaskButton href="/alerts?status=NOUVELLE" icon="bell" label="Traiter les alertes" hint={openAlerts ? plural(openAlerts, "alerte à traiter", "alertes à traiter") : "Aucune alerte à traiter"} />
          <TaskButton href="/admin/audit" icon="list" label="Consulter le journal d'audit" hint="Qui a fait quoi, et quand" />
        </div>
      </section>

      <section aria-labelledby="etat" className="mb-6">
        <SectionHeader id="etat" title="État de l'outil" description="Service de calcul, données, alertes et comptes, à cet instant." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StateTile
            label="Service de calcul"
            value={worker.label}
            tone={worker.tone}
            state={worker.verdict}
            hint={`${capitalize(signal)} : ${health.worker.state === "ACTIF" ? "imports et calculs traités" : "les imports et les calculs restent en attente"}`}
            href={HEALTH_HREF}
            detailLabel={HEALTH_LINK}
          />
          <StateTile
            label="Dernier import AJIR"
            value={lastImport?.qualityScore != null ? fmt.pct(lastImport.qualityScore, 1) : "—"}
            unit={lastImport?.qualityScore != null ? "de qualité" : undefined}
            tone={importState.tone}
            state={importState.label}
            hint={
              lastImport
                ? `N° ${lastImport.id} du ${fmt.date(lastImport.startedAt)} · ${plural(lastImport.rowsRejected, "ligne rejetée", "lignes rejetées")}`
                : "Aucun export AJIR importé pour l'instant"
            }
            href={lastImport ? `/data-health?batch=${lastImport.id}#detail` : "/data-health#import"}
            detailLabel={lastImport ? "Voir les contrôles de l'import" : "Importer un export AJIR"}
          />
          <StateTile
            label="Alertes à traiter"
            value={fmt.int(openAlerts)}
            tone={openAlerts ? "attention" : "bon"}
            state={openAlerts ? "À traiter" : "À jour"}
            hint={openAlerts ? "Alertes système et données, nouvelles ou en cours" : "Aucune alerte système ou données ouverte"}
            href="/alerts"
            detailLabel="Voir les alertes"
          />
          <StateTile
            label="Comptes actifs"
            value={fmt.int(totalActive)}
            tone={accounts.locked ? "attention" : "bon"}
            state={accounts.locked ? plural(accounts.locked, "verrouillé", "verrouillés") : "Aucun verrouillé"}
            hint={
              <>
                <span className="sr-only">Comptes actifs par rôle : </span>
                {roleCounts(accounts.active).join(" · ")}
                <span className="mt-0.5 block">
                  {fmt.int(accounts.pendingActivation)} en attente d&apos;activation · {plural(accounts.openSessions, "session ouverte", "sessions ouvertes")}
                </span>
              </>
            }
            href="/admin/users"
            detailLabel="Voir les comptes"
          />
        </div>
      </section>

      <section aria-labelledby="securite" className="mb-6">
        <SectionHeader id="securite" title="Sécurité des accès" description={`7 derniers jours, comparés aux 7 jours précédents ; la courbe retrace les ${DAYS} derniers jours.`} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            label="Connexions réussies"
            value={fmt.int(week.logins.current)}
            delta={weekDelta(week.logins, "up")}
            hint="Identifiant et mot de passe acceptés"
            spark={daily.map((d) => d.logins)}
            href="/admin/audit?action=auth.login&outcome=OK"
            detailLabel="Voir les connexions dans le journal"
          />
          <KpiCard
            label="Échecs de connexion"
            value={fmt.int(week.failedLogins.current)}
            delta={weekDelta(week.failedLogins, "down")}
            hint="Mot de passe erroné, compte inconnu ou verrouillé"
            spark={daily.map((d) => d.failedLogins)}
            sparkTone="defavorable"
            href="/admin/audit?action=auth.login&outcome=REFUSE"
            detailLabel="Voir les échecs dans le journal"
          />
          <KpiCard
            label="Refus d'accès"
            value={fmt.int(week.refusals.current)}
            delta={weekDelta(week.refusals, "down")}
            hint="Page ou fiche hors du rôle"
            spark={daily.map((d) => d.refusals)}
            sparkTone="defavorable"
            href={auditRefusalsHref()}
            detailLabel="Voir les refus dans le journal"
          />
        </div>
      </section>

      <section aria-labelledby="activite">
        <SectionHeader id="activite" title={`Activité sur ${DAYS} jours`} description="Connexions par jour, traitements du service de calcul et refus d'accès." />
        <div className="grid gap-3 xl:grid-cols-2">
          <VisualCard headingLevel={3} className="xl:col-span-2" title={authTitle} subtitle={`Connexions réussies et échecs, nombre par jour, ${period}`}>
            {logins30 + failed30 === 0 ? (
              <EmptyState compact title={`Aucune tentative de connexion sur ${DAYS} jours`} action={<ButtonLink href="/admin/users" size="sm">Voir les comptes</ButtonLink>}>
                Les connexions apparaissent ici dès qu&apos;un utilisateur ouvre une session.
              </EmptyState>
            ) : (
              <ChartBlock spec={authDailyChart(daily)} caption={authTitle} />
            )}
          </VisualCard>

          <VisualCard
            headingLevel={3}
            title={jobsTitle}
            subtitle={`Traitements du service de calcul par type et statut, nombre sur ${DAYS} jours`}
            actions={
              <Link href="/data-health#historique" className={cardLinkCls}>
                Voir l&apos;historique<span className="sr-only"> des traitements</span>
              </Link>
            }
          >
            {jobsTotal === 0 ? (
              <EmptyState compact title={`Aucun traitement lancé sur ${DAYS} jours`} action={<ButtonLink href="/data-health#import" size="sm">Importer un export AJIR</ButtonLink>}>
                Les traitements apparaissent après un import ou un calcul mensuel.
              </EmptyState>
            ) : (
              <ChartBlock spec={jobsChart(jobs)} caption={jobsTitle} />
            )}
          </VisualCard>

          <VisualCard
            headingLevel={3}
            title={refusalsTitle}
            subtitle={`Refus d'accès par action, nombre sur ${DAYS} jours (8 actions au plus)`}
            actions={
              <Link href={auditRefusalsHref()} className={cardLinkCls}>
                Voir le journal<span className="sr-only"> des refus d&apos;accès</span>
              </Link>
            }
          >
            {refusalsByAction.length === 0 ? (
              <EmptyState compact title={`Aucun refus d'accès sur ${DAYS} jours`} action={<ButtonLink href="/admin/audit" size="sm">Consulter le journal d&apos;audit</ButtonLink>}>
                Personne n&apos;a tenté d&apos;ouvrir une page ou une fiche hors de son rôle.
              </EmptyState>
            ) : (
              <ChartBlock
                spec={refusals}
                caption={refusalsTitle}
                table={{
                  headers: [...refusals.table.headers, "Journal"],
                  rows: refusals.table.rows.map((r, i) => [
                    ...r,
                    <Link key="journal" href={refusals.table.hrefs?.[i] ?? auditRefusalsHref()} className="text-xs font-medium text-link underline underline-offset-2 hover:decoration-2">
                      Voir dans le journal<span className="sr-only"> : {r[0]}</span>
                    </Link>,
                  ]),
                }}
              />
            )}
          </VisualCard>

          <VisualCard
            headingLevel={3}
            className="xl:col-span-2"
            title="Derniers refus d'accès"
            subtitle="Tentatives d'ouvrir une page ou une fiche hors du rôle (hors échecs de connexion)"
            actions={
              <Link href={auditRefusalsHref()} className={cardLinkCls}>
                Tous les refus
              </Link>
            }
          >
            {overview.recentRefusals.length === 0 ? (
              <EmptyState compact title="Aucun refus d'accès enregistré">
                Les tentatives d&apos;ouvrir une page ou une fiche hors du rôle s&apos;affichent ici dès qu&apos;elles se produisent.
              </EmptyState>
            ) : (
              <div className={tableCls.wrap}>
                <table className={tableCls.table}>
                  <caption className="sr-only">Derniers refus d&apos;accès</caption>
                  <thead className={tableCls.thead}>
                    <tr>
                      <th scope="col" className={tableCls.th}>Date et heure</th>
                      <th scope="col" className={tableCls.th}>Ce qui s&apos;est passé</th>
                      <th scope="col" className={`${tableCls.th} hidden sm:table-cell`}>Adresse IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recentRefusals.map((r) => {
                      const [targetType, ...rest] = (r.target ?? "").split(" #");
                      return (
                        <tr key={r.id} className={tableCls.tr}>
                          <td className={`${tableCls.td} whitespace-nowrap tabular-nums`}>{fmt.dateTime(r.at)}</td>
                          <td className={tableCls.td}>
                            {describeAudit({ action: r.action, outcome: "REFUSE", login: r.login, targetType: targetType || null, targetId: rest.join(" #") || null, detail: null }, users)}
                          </td>
                          <td className={`${tableCls.td} hidden font-mono text-xs sm:table-cell`}>{r.ip ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </VisualCard>
        </div>
      </section>
    </>
  );
}
