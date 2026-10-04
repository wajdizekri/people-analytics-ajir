import { ColorLegend, DataTable, EmptyState, Notice, StatusBadge, fmt, tableCls } from "@/components/ui";
import { VisualCard } from "@/components/charts/pbi";
import { EChart } from "@/components/charts/echart";
import { TermTip } from "@/components/help";
import { Disclosure } from "@/components/monitoring/disclosure";
import { IMPORT_STATUS, PARETO_BARS, controlShares, controlsParetoOption, severityStyle, type ControlShare } from "@/components/monitoring/data-options";
import { RULE_HELP, SEVERITY_EFFECT, fileLabel, ruleLabel, shortAction } from "@/components/monitoring/rule-help";
import type { ImportDetailDTO, ImportReportSummary } from "@/lib/dal/imports";

// Contrôles d'un import, du plus synthétique au plus détaillé : Pareto des lignes signalées, tableau compact
// (effet, lignes, part, action en une ligne), puis blocs repliés (explications, exemples de lignes, rapport par fichier).

const SEVERITY_ORDER = ["REJET", "CORRECTION", "AVERTISSEMENT"];
const SEVERITY_DOT: Record<string, string> = { REJET: "bg-danger", CORRECTION: "bg-warning", AVERTISSEMENT: "bg-fg-subtle" };
const SEVERITY_GROUP: Record<string, string> = {
  REJET: "Lignes écartées (non importées)",
  CORRECTION: "Lignes importées après correction automatique",
  AVERTISSEMENT: "Lignes importées, à vérifier",
};

const plural = (n: number, word: string) => `${fmt.int(n)} ${word}${n > 1 ? "s" : ""}`;

// Statut et volumes de l'import affiché, au format libellé : valeur
export function ImportLead({ detail }: { detail: ImportDetailDTO }) {
  const b = detail.batch;
  const read = b.rowsOk + b.rowsRejected;
  const others = detail.bySeverity.filter((s) => s.severity !== "REJET").reduce((t, s) => t + s.n, 0);
  const facts: [string, string][] = [
    ["Date", fmt.date(b.startedAt)],
    ["Importées", fmt.int(b.rowsOk)],
    ["Écartées", `${fmt.int(b.rowsRejected)}${read ? ` (${fmt.pct(b.rowsRejected / read, 1)})` : ""}`],
    ...(others > 0 ? ([["Corrigées ou à vérifier", fmt.int(others)]] as [string, string][]) : []),
    ["Qualité", fmt.pct(b.qualityScore, 1)],
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <StatusBadge tone={IMPORT_STATUS[b.status].tone}>{IMPORT_STATUS[b.status].label}</StatusBadge>
      <dl className="flex flex-wrap gap-x-5 gap-y-1">
        {facts.map(([k, v]) => (
          <div key={k} className="flex gap-1">
            <dt className="text-fg-muted">{k} :</dt>
            <dd className="font-semibold tabular-nums text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ControlsPareto({ shares }: { shares: ControlShare[] }) {
  const bars = Math.min(shares.length, PARETO_BARS);
  const legend = [...SEVERITY_ORDER.filter((s) => shares.some((r) => r.severity === s)), ...(shares.some((r) => !SEVERITY_ORDER.includes(r.severity)) ? ["AUTRE"] : [])];
  const top = shares
    .slice(0, 3)
    .map((r) => `${r.label} (${plural(r.n, "ligne")}, ${fmt.pct(r.share, 1)})`)
    .join(" ; ");
  return (
    <VisualCard
      headingLevel={3}
      title="Lignes signalées par contrôle"
      subtitle={shares.length > PARETO_BARS ? `${PARETO_BARS - 1} premiers contrôles, autres regroupés` : undefined}
      actions={<TermTip term="gravite" align="end" />}
    >
      <ColorLegend items={legend.map(severityStyle)} />
      <EChart
        format={{ digits: 0 }}
        option={controlsParetoOption(shares)}
        height={Math.max(96, 36 * bars + 16)}
        mobileHeight={Math.max(120, 46 * bars + 16)}
        ariaLabel={`Barres horizontales triées : lignes signalées par contrôle. En tête : ${top}.`}
      />
    </VisualCard>
  );
}

function ControlsTable({ shares }: { shares: ControlShare[] }) {
  return (
    <DataTable
      className="mt-4"
      caption="Lignes signalées par contrôle"
      pageSize={0}
      maxHeight={false}
      columns={[
        { key: "controle", label: "Contrôle" },
        { key: "effet", label: "Effet sur la ligne" },
        { key: "lignes", label: "Lignes signalées", numeric: true },
        { key: "part", label: "Part du total", numeric: true },
        { key: "action", label: "Action", sortable: false, cardBlock: true },
      ]}
      rows={shares.map((r) => {
        const eff = SEVERITY_EFFECT[r.severity];
        return {
          id: `${r.rule}-${r.severity}`,
          cells: {
            controle: (
              <>
                <span className="font-medium">{r.label}</span>
                <span className="block font-mono text-[11px] text-fg-subtle">{r.rule}</span>
              </>
            ),
            effet: (
              <>
                <StatusBadge tone={eff?.tone ?? "neutral"}>{eff?.label ?? r.severity}</StatusBadge>
                {eff && <span className="mt-0.5 block text-xs text-fg-muted">{eff.effect}</span>}
              </>
            ),
            lignes: fmt.int(r.n),
            part: fmt.pct(r.share, 1),
            action: shortAction(r.rule) ?? "Voir les exemples de lignes",
          },
          sort: { controle: r.label, effet: SEVERITY_ORDER.indexOf(r.severity), lignes: r.n, part: r.share },
        };
      })}
    />
  );
}

// Chaque contrôle en mots : effet sur la ligne, fichiers concernés, signification et action corrective complète
function RuleExplanations({ detail }: { detail: ImportDetailDTO }) {
  const filesOf = new Map<string, string[]>();
  for (const f of detail.byFile) for (const r of f.rules) filesOf.set(`${r.rule}|${r.severity}`, [...(filesOf.get(`${r.rule}|${r.severity}`) ?? []), f.file]);
  const groups = SEVERITY_ORDER.map((sev) => ({ sev, rules: detail.byRule.filter((r) => r.severity === sev) })).filter((g) => g.rules.length);
  const other = detail.byRule.filter((r) => !SEVERITY_ORDER.includes(r.severity));
  if (other.length) groups.push({ sev: "AUTRE", rules: other });
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const total = g.rules.reduce((s, r) => s + r.n, 0);
        const eff = SEVERITY_EFFECT[g.sev];
        return (
          <div key={g.sev}>
            <h3 className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-heading">
              <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${SEVERITY_DOT[g.sev] ?? "bg-fg-subtle"}`} />
              {SEVERITY_GROUP[g.sev] ?? "Autres contrôles"}
              <span className="font-normal text-fg-muted">
                · {plural(total, "ligne")} signalée{total > 1 ? "s" : ""}
              </span>
            </h3>
            <ul className="divide-y divide-line overflow-hidden rounded-control border border-line">
              {g.rules.map((r) => {
                const help = RULE_HELP[r.rule];
                const files = filesOf.get(`${r.rule}|${r.severity}`) ?? [];
                return (
                  <li key={`${r.rule}-${r.severity}`} className="grid grid-cols-1 gap-x-6 gap-y-2 p-3 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                    <div className="min-w-0">
                      <p className="font-medium text-fg">{ruleLabel(r.rule)}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusBadge tone={eff?.tone ?? "neutral"}>{eff ? `${eff.label} : ${eff.effect}` : r.severity}</StatusBadge>
                        <span className="text-sm font-semibold tabular-nums text-fg">{plural(r.n, "ligne")}</span>
                      </p>
                      {files.length > 0 && (
                        <p className="mt-1 text-xs text-fg-muted">
                          {files.length > 1 ? "Fichiers" : "Fichier"} : {files.map((f) => `${fileLabel(f)} (${f})`).join(", ")}
                        </p>
                      )}
                      <p className="mt-0.5 font-mono text-[11px] text-fg-subtle">Code : {r.rule}</p>
                    </div>
                    <dl className="min-w-0 space-y-1.5 text-sm text-fg-muted">
                      <div>
                        <dt className="inline font-semibold text-fg">Signification : </dt>
                        <dd className="inline">{help?.meaning ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="inline font-semibold text-info">Action : </dt>
                        <dd className="inline">{help?.action ?? "Voir les exemples de lignes"}</dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Samples({ detail }: { detail: ImportDetailDTO }) {
  return (
    <Disclosure className="mt-3" summary="Exemples de lignes (100 max)">
      {detail.countsSource === "detail" && (
        <p className="mb-2">
          <StatusBadge tone="neutral" dot={false}>
            Comptages : détail conservé (1 000 lignes max)
          </StatusBadge>
        </p>
      )}
      <div className="relative max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Exemples de lignes en échec (zone défilante)">
        <table className={tableCls.table}>
          <caption className="sr-only">Exemples de lignes en échec</caption>
          <thead className={tableCls.thead}>
            <tr>
              <th scope="col" className={tableCls.th}>Fichier</th>
              <th scope="col" className={`${tableCls.th} text-right`}>N° de ligne</th>
              <th scope="col" className={tableCls.th}>Contrôle</th>
              <th scope="col" className={tableCls.th}>Message</th>
            </tr>
          </thead>
          <tbody>
            {detail.samples.map((s, i) => (
              <tr key={i} className={tableCls.tr}>
                <td className={`${tableCls.td} font-mono text-xs`}>{s.file}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{s.line ?? "—"}</td>
                <td className={`${tableCls.td} text-xs`}>
                  {ruleLabel(s.rule)}
                  <span className="block text-fg-muted">{SEVERITY_EFFECT[s.severity]?.effect ?? s.severity}</span>
                </td>
                <td className={`${tableCls.td} text-xs`}>{s.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}

function ReportSummary({ s }: { s: ImportReportSummary }) {
  const facts: [string, string][] = [
    ["Dernier jour de données", s.dataEndDate ? fmt.date(s.dataEndDate) : "—"],
    ["Part de lignes valides (moyenne par fichier)", s.rowScore != null ? fmt.pct(s.rowScore, 1) : "—"],
    [
      "Complétude de la paie",
      s.activeCount ? `${s.payrollMonth ?? "—"} · ${fmt.int(s.activeWithoutPayroll ?? 0)} sans paie sur ${plural(s.activeCount, "collaborateur")} en poste` : "—",
    ],
    ...(s.users
      ? ([
          [
            "Comptes utilisateurs synchronisés",
            `${fmt.int(s.users.created)} créés · ${fmt.int(s.users.reactivated)} réactivés · ${fmt.int(s.users.deactivated)} désactivés · ${fmt.int(s.users.updated)} mis à jour`,
          ],
        ] as [string, string][])
      : []),
    ["Durée du traitement", s.durationMs != null ? `${fmt.num(s.durationMs / 1000, 1)} s` : "—"],
  ];
  return (
    <Disclosure className="mt-3" summary="Rapport par fichier">
      {s.error && (
        <div className="mb-3">
          <Notice tone="error">Import arrêté : {s.error}</Notice>
        </div>
      )}
      <dl className="mb-4 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="mb-1 tabular-nums text-fg sm:mb-0">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Lignes lues par fichier">
        <table className={tableCls.table}>
          <caption className="sr-only">Lignes lues par fichier</caption>
          <thead className={tableCls.thead}>
            <tr>
              <th scope="col" className={tableCls.th}>Fichier</th>
              <th scope="col" className={`${tableCls.th} text-right`}>Lignes lues</th>
              <th scope="col" className={`${tableCls.th} text-right`}>Importées</th>
              <th scope="col" className={`${tableCls.th} text-right`}>Rejetées</th>
              <th scope="col" className={tableCls.th}>Remarque</th>
            </tr>
          </thead>
          <tbody>
            {s.files.map((f) => (
              <tr key={f.file} className={`${tableCls.tr} ${f.present ? "" : "text-fg-subtle"}`}>
                <th scope="row" className={`${tableCls.td} font-normal`}>
                  {fileLabel(f.file)}
                  <span className="block font-mono text-xs text-fg-subtle">{f.file}</span>
                </th>
                <td className={`${tableCls.td} ${tableCls.num}`}>{f.present ? fmt.int(f.rows) : "—"}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{f.present ? fmt.int(f.ok) : "—"}</td>
                <td className={`${tableCls.td} ${tableCls.num}`}>{f.present ? fmt.int(f.rejected) : "—"}</td>
                <td className={`${tableCls.td} text-xs`}>{f.headerError ?? (f.present ? "" : "Absent")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}

export function ImportControls({ detail }: { detail: ImportDetailDTO }) {
  const shares = controlShares(detail.byRule.map((r) => ({ ...r, label: ruleLabel(r.rule) })));
  return (
    <>
      {shares.length === 0 ? (
        <EmptyState title="Aucun contrôle en échec" />
      ) : (
        <>
          {/* Une seule barre ne fait pas un graphique : le tableau suffit */}
          {shares.length > 1 && <ControlsPareto shares={shares} />}
          <ControlsTable shares={shares} />
          <Disclosure className="mt-4" summary="Détail des contrôles">
            <RuleExplanations detail={detail} />
          </Disclosure>
          <Samples detail={detail} />
        </>
      )}
      {detail.summary && <ReportSummary s={detail.summary} />}
    </>
  );
}
