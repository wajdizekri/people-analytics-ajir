"""Statistiques de calage (turnover, absentéisme, contrats, injections, AUC oracle)."""
import numpy as np
from scipy.stats import rankdata

from . import daily as D
from . import latent as L


def auc(y, s) -> float:
    y = np.asarray(y, bool)
    n1, n0 = int(y.sum()), int((~y).sum())
    if n1 == 0 or n0 == 0:
        return float("nan")
    r = rankdata(s)
    return float((r[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def compute(sim, agg, plan, exporter) -> dict:
    F, P, T, n = sim.F, sim.panel, sim.T, sim.n
    ex = np.where(F["exit_day"][:n] >= 0, F["exit_day"][:n], 10**9)
    hire = F["hire"][:n]
    at_end = (hire[:, None] <= sim.mend[None, :]) & (ex[:, None] > sim.mend[None, :])
    salaried = P["ct"][:n] != L.CT_STAGE
    head = (at_end & salaried).sum(0)
    reason = F["exit_reason"][:n]
    in_period = (ex >= sim.start_day) & (ex <= sim.end_day)
    not_stage = F["ctype"][:n] != L.CT_STAGE
    exits = in_period & not_stage
    vol = exits & np.isin(reason, (L.R_DEM, L.R_ABANDON))
    years = T / 12
    yearly = []
    for y0 in range(0, T - 11, 12):
        lo, hi = sim.mstart[y0], sim.mend[y0 + 11]
        sel = exits & (ex >= lo) & (ex <= hi)
        hc = head[y0:y0 + 12].mean()
        yearly.append(dict(period=f"{sim.month_str[y0]}..{sim.month_str[y0 + 11]}", headcount=round(float(hc), 1),
                           turnover=round(sel.sum() / hc, 4),
                           voluntary=round((sel & np.isin(reason, (L.R_DEM, L.R_ABANDON))).sum() / hc, 4)))
    by_reason = {L.REASONS[r]: int((exits & (reason == r)).sum()) for r in range(1, len(L.REASONS))}
    stage_exits = int((in_period & ~not_stage).sum())

    sal = salaried[: agg["expected"].shape[0]]
    expd = (agg["expected"] * sal).sum()
    days = {D.CATS[c]: int((agg["absdays"][c] * sal).sum()) for c in range(1, 7)}
    non_leave = sum(v for k, v in days.items() if k != "CONGE_ANNUEL")
    non_health = days["CONGE_SANS_SOLDE"] + days["ABSENCE_INJUSTIFIEE"] + days["AUTRE"]
    wd_per_year = sim.cal.n_wd / years
    present = expd - sum(days.values()) - (agg["nobadge"] * sal).sum()

    alive = F["alive"][:n]
    mix = {L.CONTRACTS[c]: round(float((alive & (F["ctype"][:n] == c)).sum() / alive.sum()), 3) for c in range(4)}
    posted = F["post_m"][:n] >= 0
    mech = {L.MECHANISMS[k]: int((posted & (F["mech"][:n] == k)).sum()) for k in (1, 2, 3)}

    out = dict(
        headcount_start=int(head[0]), headcount_end=int(head[-1]), employees_total=int(len(exporter.emp)),
        exits_salaried=int(exits.sum()), exits_by_reason=by_reason, stage_exits=stage_exits,
        turnover_annual=round(float(exits.sum() / head.mean() / years), 4),
        voluntary_annual=round(float(vol.sum() / head.mean() / years), 4),
        voluntary_share=round(float(vol.sum() / max(exits.sum(), 1)), 3), turnover_by_year=yearly,
        absence_days=days, absenteeism_excl_leave=round(float(non_leave / expd), 4),
        absenteeism_non_health=round(float(non_health / expd), 4),
        annual_leave_days_per_fte=round(float(days["CONGE_ANNUEL"] / expd * wd_per_year), 1),
        no_badge_rate=round(float((agg["nobadge"] * sal).sum() / expd), 4),
        late_rate=round(float(agg["late"].sum() / max(present, 1)), 4),
        overtime_h_per_month=round(float(agg["ot"].sum() / 60 / max(((agg["expected"] > 0) & sal).sum(), 1)), 2),
        contract_mix_end=mix, resignation_mechanisms=mech,
        anomalies=dict(employee_month_share=round(plan.employee_months / max(plan.total_employee_months, 1), 4),
                       n=len({r["anomaly_id"] for r in plan.rows}),
                       by_type={t: len({r["anomaly_id"] for r in plan.rows if r["type"] == t})
                                for t in sorted({r["type"] for r in plan.rows})},
                       injected_days=int(sum(r["injected_days"] for r in plan.rows))),
        defects=dict(total=len(exporter.defects),
                     by_type={k: sum(1 for d in exporter.defects if d[2] == k) for k in sorted({d[2] for d in exporter.defects})},
                     share_rows=round(len(exporter.defects) / max(exporter.att_rows + exporter.rows.get("absences.csv", 0)
                                                                   + exporter.rows.get("payroll.csv", 0), 1), 4)),
        rows={**exporter.rows, "attendance.csv": exporter.att_rows},
    )
    tab = getattr(sim, "oracle_table", [])
    if tab:
        sel = [r for r in tab if r["complete"]]
        y = np.concatenate([r["y6"][r["eligible"]] for r in sel]) if sel else np.array([], bool)
        s = np.concatenate([r["prob"][r["eligible"]] for r in sel]) if sel else np.array([])
        out["oracle"] = dict(auc=round(auc(y, s), 4) if len(y) else None, rows=int(len(y)), positives=int(y.sum()),
                             mean_prob=round(float(s.mean()), 4) if len(s) else None,
                             observed_rate=round(float(y.mean()), 4) if len(y) else None, origins=len(sel))
    return out


def summary(st: dict) -> str:
    L_ = []
    L_.append(f"Effectif salarié (hors stagiaires) : {st['headcount_start']} -> {st['headcount_end']} "
              f"({st['employees_total']} salariés au total)")
    L_.append(f"Turnover annuel : {st['turnover_annual']:.1%} dont volontaire {st['voluntary_annual']:.1%} "
              f"(part volontaire {st['voluntary_share']:.0%}) ; sorties : {st['exits_by_reason']} ; fins de stage : {st['stage_exits']}")
    for y in st["turnover_by_year"]:
        L_.append(f"  {y['period']} : effectif {y['headcount']}, turnover {y['turnover']:.1%}, volontaire {y['voluntary']:.1%}")
    L_.append(f"Absentéisme hors congés : {st['absenteeism_excl_leave']:.2%} (hors santé {st['absenteeism_non_health']:.2%}) ; "
              f"congés annuels {st['annual_leave_days_per_fte']} j/an ; jours sans badge {st['no_badge_rate']:.2%}")
    L_.append(f"Retards : {st['late_rate']:.2%} des jours pointés ; heures sup : {st['overtime_h_per_month']} h/mois")
    L_.append(f"Contrats en fin de période : {st['contract_mix_end']}")
    L_.append(f"Mécanismes de démission : {st['resignation_mechanisms']}")
    a = st["anomalies"]
    L_.append(f"Anomalies injectées : {a['n']} ({a['by_type']}), {a['employee_month_share']:.2%} des salarié-mois, "
              f"{a['injected_days']} jours")
    d = st["defects"]
    L_.append(f"Défauts qualité : {d['total']} ({d['share_rows']:.2%} des lignes pointage/absences/paie) {d['by_type']}")
    if "oracle" in st:
        o = st["oracle"]
        L_.append(f"AUC oracle (éligibles, suivi complet, {o['origins']} origines) : {o['auc']} ; "
                  f"{o['positives']}/{o['rows']} positifs, p moyen {o['mean_prob']} vs taux observé {o['observed_rate']}")
    L_.append(f"Lignes : {st['rows']}")
    return "\n".join(L_)
