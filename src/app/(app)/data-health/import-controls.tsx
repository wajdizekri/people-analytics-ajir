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

// Titre-message du Pareto : la part des lignes signalées qui sont réellement écartées, et le contrôle qui en écarte le plus
export function paretoHeadline(shares: ControlShare[]): string {
  const total = shares.reduce((s, r) => s + r.n, 0);
  const rejects = shares.filter((r) => r.severity === "REJET");
  const rejected = rejects.reduce((s, r) => s + r.n, 0);
  if (!rejected) return total > 1 ? `Aucune ligne écartée : ${fmt.int(total)} lignes signalées, toutes importées` : "Aucune ligne écartée : 1 ligne signalée, importée";
  const share = fmt.pct(rejected / total, 0);
  return rejects.length === 1
    ? `« ${rejects[0].label} » écarte ${share} des lignes signalées`
    : `${share} des lignes signalées sont écartées, d'abord par « ${rejects[0].label} »`;
}

// Phrase d'introduction de la section : statut et volumes de l'import affiché
export function ImportLead({ detail }: { detail: ImportDetailDTO }) {
  const b = detail.batch;
  const read = b.rowsOk + b.rowsRejected;
  const others = detail.bySeverity.filter((s) => s.severity !== "REJET").reduce((t, s) => t + s.n, 0);
  return (
    <>
      <StatusBadge tone={IMPORT_STATUS[b.status].tone}>{IMPORT_STATUS[b.status].label}</StatusBadge> Import du {fmt.date(b.startedAt)} :{" "}
      <strong className="tabular-nums">{fmt.int(b.rowsOk)}</strong> lignes importées, <strong className="tabular-nums">{fmt.int(b.rowsRejected)}</strong> écartées
      {read ? ` (${fmt.pct(b.rowsRejected / read, 1)} des lignes lues)` : ""}, score qualité <strong className="tabular-nums">{fmt.pct(b.qualityScore, 1)}</strong>.
      {others > 0 && ` ${fmt.int(others)} ${others > 1 ? "autres lignes sont importées" : "autre ligne est importée"} avec une correction ou un avertissement.`}
    </>
  );
}

function ControlsPareto({ startedAt, shares }: { startedAt: string; shares: ControlShare[] }) {
  const bars = Math.min(shares.length, PARETO_BARS);
  const legend = [...SEVERITY_ORDER.filter((s) => shares.some((r) => r.severity === s)), ...(shares.some((r) => !SEVERITY_ORDER.includes(r.severity)) ? ["AUTRE"] : [])];
  const top = shares
    .slice(0, 3)
    .map((r) => `${r.label} (${plural(r.n, "ligne")}, ${fmt.pct(r.share, 1)})`)
    .join(" ; ");
  return (
    <VisualCard
      headingLevel={3}
      title={paretoHeadline(shares)}
      subtitle={`Lignes signalées par contrôle à l'import du ${fmt.date(startedAt)} · nombre et part du total signalé${
        shares.length > PARETO_BARS ? ` · ${PARETO_BARS - 1} contrôles les plus signalés, les autres regroupés` : ""
      }`}
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
        { key: "action", label: "Que faire", sortable: false, cardBlock: true },
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
            action: shortAction(r.rule) ?? "Voir les exemples de lignes ci-dessous.",
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
                      <p className="mt-0.5 font-mono text-[11px] text-fg-subtle">Code du contrôle : {r.rule}</p>
                    </div>
                    <div className="min-w-0 text-sm text-fg-muted">
                      {help ? (
                        <>
                          <p>
                            <span className="font-semibold text-fg">Ce que cela veut dire : </span>
                            {help.meaning}
                          </p>
                          <p className="mt-1.5">
                            <span className="font-semibold text-info">Que faire : </span>
                            {help.action}
                          </p>
                        </>
                      ) : (
                        <p>Contrôle sans explication détaillée : voir les exemples de lignes.</p>
                      )}
                    </div>
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
    <Disclosure className="mt-3" summary="Voir des exemples de lignes concernées (100 au plus)">
      <p className="mb-2 text-xs text-fg-muted">
        Rejets d&apos;abord. Le contenu brut n&apos;est pas affiché : retrouvez la ligne dans l&apos;export par son fichier et son numéro.
        {detail.countsSource === "detail" && " Comptages issus du détail conservé (1 000 lignes au plus par fichier et par contrôle)."}
      </p>
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
      s.activeCount ? `${s.payrollMonth ?? "—"} : ${plural(s.activeWithoutPayroll ?? 0, "collaborateur")} en poste sans paie sur ${fmt.int(s.activeCount)}` : "—",
    ],
    ...(s.users
      ? ([
          [
            "Comptes utilisateurs synchronisés",
            `${fmt.int(s.users.created)} créés, ${fmt.int(s.users.reactivated)} réactivés, ${fmt.int(s.users.deactivated)} désactivés, ${fmt.int(s.users.updated)} mis à jour`,
          ],
        ] as [string, string][])
      : []),
    ["Durée du traitement", s.durationMs != null ? `${fmt.num(s.durationMs / 1000, 1)} s` : "—"],
  ];
  return (
    <Disclosure className="mt-3" summary="Voir le rapport complet par fichier (lignes lues, importées, rejetées)">
      {s.error && (
        <div className="mb-3">
          <Notice tone="error">L&apos;import s&apos;est arrêté : {s.error}</Notice>
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
                <td className={`${tableCls.td} text-xs`}>{f.headerError ?? (f.present ? "" : "Absent de l'export")}</td>
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
        <EmptyState title="Aucun contrôle en échec sur cet import">Toutes les lignes lues ont été importées sans correction.</EmptyState>
      ) : (
        <>
          {/* Une seule barre ne fait pas un graphique : le tableau suffit */}
          {shares.length > 1 && <ControlsPareto startedAt={detail.batch.startedAt} shares={shares} />}
          <ControlsTable shares={shares} />
          <Disclosure className="mt-4" summary="Comprendre chaque contrôle : signification, fichiers concernés, action complète">
            <RuleExplanations detail={detail} />
          </Disclosure>
          <Samples detail={detail} />
        </>
      )}
      {detail.summary && <ReportSummary s={detail.summary} />}
    </>
  );
}
