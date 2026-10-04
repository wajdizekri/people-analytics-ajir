"""Évaluation complète : anomalies d'absentéisme et contrôle qualité de l'import.

Prérequis (exports TypeScript, voir docs/RESULTATS_ANOMALIES_QUALITE.md) puis :
    python -m ml.eval.run [--s2]
Écrit ml/eval/results/anomalies.json, quality.json et tables.md.
"""
from __future__ import annotations

import argparse
import json

import numpy as np

from . import anomalies as A
from . import common as C
from . import quality as Q
from .metrics import event_metrics

S2 = {"sim_dir": C.ROOT / "data" / "sim" / "mixte_medium_s2", "export": C.ROOT / "data" / "eval-out-s2", "db": C.ROOT / "data" / "eval-s2.db"}
TYPES = ["PIC_EQUIPE", "ROTATION_EQUIPE", "LUNDI_VENDREDI", "PONTS", "DERIVE"]
LABEL = {"PIC_EQUIPE": "Pic d'équipe", "ROTATION_EQUIPE": "Rotation d'équipe (réservé)", "LUNDI_VENDREDI": "Lundi/vendredi", "PONTS": "Ponts", "DERIVE": "Dérive"}


def fmt(x, pct: bool = False, nd: int = 1) -> str:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return "–"
    if pct:
        return f"{100 * x:.{nd}f} %".replace(".", ",")
    if isinstance(x, (int, np.integer)):
        return f"{x:,}".replace(",", " ")
    return f"{x:.{nd}f}".replace(".", ",")


def md_table(header: list[str], rows: list[list[str]]) -> str:
    out = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    out += ["| " + " | ".join(r) + " |" for r in rows]
    return "\n".join(out)


def collective(ctx: A.Context) -> dict:
    ex = ctx.export
    tab = A.table_detections(ctx, ex / "anomaly_table.csv")
    res: dict = {"events": len(ctx.events), "excluded_events": ctx.excluded_events, "months": ctx.months}
    res["replication"] = {
        "batch_table_vs_python": A.same_detections(tab, A.python_detections(ctx, "cal", "batch", 3.5, 2)),
    }
    for f, tag, mode in (("replay_monthly_nominal.csv", "cal", "monthly"), ("replay_monthly_nocal.csv", "nocal", "monthly"), ("replay_batch_nocal.csv", "nocal", "batch")):
        if (ex / f).exists():
            res["replication"][f] = A.same_detections(A.table_detections(ctx, ex / f), A.python_detections(ctx, tag, mode, 3.5, 2))
    res["table"] = event_metrics(tab, ctx.events, ctx.months)
    res["table_false_explained"] = A.explain_false_detections(ctx, tab)
    if (ex / "replay_monthly_nominal.csv").exists():
        mon = A.table_detections(ctx, ex / "replay_monthly_nominal.csv")
        res["monthly"] = event_metrics(mon, ctx.events, ctx.months)
        res["monthly_operational_delay"] = A.operational_delay(ctx, mon)
    res["coverage"] = A.coverage(ctx)
    res["sensitivity_batch"] = A.sensitivity(ctx, "batch", with_chance=True)
    res["sensitivity_monthly_k2"] = A.sensitivity(ctx, "monthly", ks=(2,))
    res["week_level_ap"] = A.week_level_ap(ctx)
    res["event_pr_curve_batch_k2"] = A.pr_curve_events(ctx, "batch", 2)
    rules = {"nominal k=2 z>3,5": [(3.5, 2)], "k=3 z>2,5": [(2.5, 3)], "k=2 z>4 ou k=3 z>2,5": [(4.0, 2), (2.5, 3)]}
    res["rules"] = {name: A._flat(event_metrics(A.union_rules(ctx, "cal", "batch", r), ctx.events, ctx.months)) for name, r in rules.items()}
    return res


def calendar_block(ctx: A.Context) -> dict:
    ex = ctx.export
    out = {}
    pairs = {
        "simule_batch_z3.5": ("replay_batch_nocal.csv", "anomaly_table.csv"),
        "simule_mensuel_z3.5": ("replay_monthly_nocal.csv", "replay_monthly_nominal.csv"),
        "stress_A_batch_z3.5": ("stress_a_nocal.csv", "stress_a_cal.csv"),
        "stress_B_batch_z3.5": ("stress_b_nocal.csv", "stress_b_cal.csv"),
        "stress_B_batch_z3": ("stress_b_nocal_z3.csv", "stress_b_cal_z3.csv"),
    }
    for name, (nocal, cal) in pairs.items():
        if (ex / nocal).exists() and (ex / cal).exists():
            out[name] = A.calendar_ablation(ctx, A.table_detections(ctx, ex / cal), A.table_detections(ctx, ex / nocal))
    out["simule_batch_z3"] = A.calendar_ablation(ctx, A.python_detections(ctx, "cal", "batch", 3.0, 2), A.python_detections(ctx, "nocal", "batch", 3.0, 2))
    out["factors"] = {"avec": ctx.meta["factor_cal"], "sans": ctx.meta["factor_nocal"]}
    return out


def individual(ctx: A.Context) -> dict:
    return {"bradford": A.bradford_eval(ctx), "bradford_table": A.bradford_table(ctx), "patterns": A.pattern_tests(ctx)}


def validation_s2() -> dict:
    ctx = A.Context(**S2)
    tab = A.table_detections(ctx, ctx.export / "anomaly_table.csv")
    rules = {"nominal k=2 z>3,5": [(3.5, 2)], "k=3 z>2,5": [(2.5, 3)], "k=2 z>4 ou k=3 z>2,5": [(4.0, 2), (2.5, 3)]}
    out = {
        "events": len(ctx.events),
        "replication": A.same_detections(tab, A.python_detections(ctx, "cal", "batch", 3.5, 2)),
        "table": event_metrics(tab, ctx.events, ctx.months),
        "rules": {n: A._flat(event_metrics(A.union_rules(ctx, "cal", "batch", r), ctx.events, ctx.months)) for n, r in rules.items()},
        "bradford_250": A.bradford_eval(ctx, thresholds=(250,))["sweep"][0],
        "patterns": A.pattern_tests(ctx),
    }
    if (ctx.export / "rejections_full.csv").exists():
        d = Q.load_defects(S2["sim_dir"])
        out["quality"] = Q.line_level(d, Q.load_rejections(ctx.export / "rejections_full.csv"))
        rep = json.loads((ctx.export / "rejections_full.json").read_text(encoding="utf-8"))
        out["quality_score"] = Q.score_decomposition(rep["report"], d)
        out["payroll_ratio_check"] = Q.payroll_ratio_check(S2["sim_dir"], d)
        out["payroll_incomplete"] = Q.payroll_incomplete_causes(S2["sim_dir"], d, Q.load_rejections(ctx.export / "rejections_full.csv"), rep["report"]["quality"]["payrollMonth"])
    return out


def tables(res: dict) -> str:
    col, cal, ind, qual = res["collective"], res["calendar"], res["individual"], res["quality"]
    parts = []

    def per_type_rows(m: dict) -> list[list[str]]:
        rows = []
        for t in TYPES:
            v = m["per_type"][t]
            delay = "–" if v["delay_median_days"] is None else f"{fmt(v['delay_median_days'], nd=0)} j ({v['delay_min_days']}–{v['delay_max_days']})"
            rows.append([LABEL[t], fmt(v["events"]), fmt(v["detected"]), fmt(v["recall"], True), delay, fmt(v["detections_attributed"])])
        return rows

    head = ["Type injecté", "Événements", "Détectés", "Rappel", "Délai médian (min–max)", "Détections attribuées"]
    parts.append("### T1. Table anomaly de data/app.db (pipeline --backtest, un appel)\n\n" + md_table(head, per_type_rows(col["table"])))
    t = col["table"]
    parts.append(f"Détections collectives : {t['detections']} ; vraies : {t['true_detections']} ; précision {fmt(t['precision'], True)} ; "
                 f"fausses : {t['false_detections']} soit {fmt(t['fp_per_month'], nd=2)} par mois ; dont {col['table_false_explained']['with_departure_signal']} "
                 f"chevauchant la phase de départ simulée d'un membre.")
    if "monthly" in col:
        m = col["monthly"]
        parts.append("### T2. Rejeu mensuel (mode worker, 66 appels)\n\n" + md_table(head, per_type_rows(m)))
        parts.append(f"Détections : {m['detections']} ; précision {fmt(m['precision'], True)} ; {fmt(m['fp_per_month'], nd=2)} fausses par mois.")

    h = ["k", "z", "Détections", "Précision", "FP/mois", "Pic", "Rotation", "Lundi/ven.", "Ponts", "Dérive", "Délai pic", "Délai rotation"]
    rows = [[str(r["k"]), fmt(r["z"]), fmt(r["detections"]), fmt(r["precision"], True), fmt(r["fp_per_month"], nd=2), fmt(r["recall_PIC_EQUIPE"], True, 0),
             fmt(r["recall_ROTATION_EQUIPE"], True, 0), fmt(r["recall_LUNDI_VENDREDI"], True, 0), fmt(r["recall_PONTS"], True, 0), fmt(r["recall_DERIVE"], True, 0),
             fmt(r["delay_PIC_EQUIPE"], nd=0), fmt(r["delay_ROTATION_EQUIPE"], nd=0)] for r in col["sensitivity_batch"]]
    parts.append("### T3. Sensibilité au seuil z et au nombre k de semaines consécutives (batch, rappel par type)\n\n" + md_table(h, rows))

    rows = [[str(r["k"]), fmt(r["z"])] + [f"{fmt(r[f'recall_{t}'], True, 0)} / {fmt(r[f'chance_{t}'], True, 0)}" for t in ("LUNDI_VENDREDI", "PONTS", "DERIVE")]
            for r in col["sensitivity_batch"]]
    parts.append("### T3b. Types individuels : rappel observé / rappel par hasard (détections décalées de ±26 et ±52 semaines)\n\n"
                 + md_table(["k", "z", "Lundi/ven.", "Ponts", "Dérive"], rows))

    ap = col["week_level_ap"]
    pr = col["event_pr_curve_batch_k2"]
    rows = [[LABEL[t], fmt(ap["z_semaine"][t]["positives"]), fmt(ap["z_semaine"][t]["prevalence"], True, 2), fmt(ap["z_semaine"][t]["pr_auc"], nd=3),
             fmt(ap["z_2_semaines"][t]["pr_auc"], nd=3), fmt(pr[f"pr_auc_{t}"], nd=3)] for t in TYPES]
    parts.append("### T4. PR-AUC en faisant varier le seuil du score robuste\n\n" + md_table(
        ["Type", "Unités positives (semaine)", "Prévalence", "PR-AUC z semaine", "PR-AUC min z sur 2 semaines", "PR-AUC événement (k=2, z de 2 à 12, précision du type)"], rows))

    rows = []
    for name, v in cal.items():
        if name == "factors":
            continue
        a, s = v["avec_calendrier"], v["sans_calendrier"]
        rows.append([name] + [f"{s[c]['false']} → {a[c]['false']}" for c in ("ramadan", "aid", "pont", "ferie", "seance_unique", "normale", "total")]
                    + [f"{s['total']['detections']} → {a['total']['detections']}"])
    parts.append("### T5. Ablation du facteur calendrier : fausses détections sans → avec facteur\n\n" + md_table(
        ["Scénario", "Ramadan", "Aïd", "Pont", "Férié", "Séance unique", "Semaine normale", "Total FP", "Détections"], rows))

    rows = [[n, fmt(r["detections"]), fmt(r["precision"], True), fmt(r["fp_per_month"], nd=2), fmt(r["recall_PIC_EQUIPE"], True, 0), fmt(r["recall_ROTATION_EQUIPE"], True, 0),
             fmt(r["delay_PIC_EQUIPE"], nd=0), fmt(r["delay_ROTATION_EQUIPE"], nd=0)] for n, r in col["rules"].items()]
    if "s2" in res:
        rows += [[f"{n} (graine 2)", fmt(r["detections"]), fmt(r["precision"], True), fmt(r["fp_per_month"], nd=2), fmt(r["recall_PIC_EQUIPE"], True, 0),
                  fmt(r["recall_ROTATION_EQUIPE"], True, 0), fmt(r["delay_PIC_EQUIPE"], nd=0), fmt(r["delay_ROTATION_EQUIPE"], nd=0)] for n, r in res["s2"]["rules"].items()]
    parts.append("### T6. Règles collectives alternatives (batch)\n\n" + md_table(["Règle", "Détections", "Précision", "FP/mois", "Pic", "Rotation", "Délai pic", "Délai rotation"], rows))

    b = ind["bradford"]
    rows = [[fmt(r["threshold"]), fmt(r["flag_rate_mean"], True, 2), f"{r['distinct_employees']} ({fmt(r['distinct_share'], True)})", fmt(r["precision_units"], True),
             fmt(r["recall_LUNDI_VENDREDI"], True, 0), fmt(r["recall_PONTS"], True, 0), fmt(r["recall_DERIVE"], True, 0), fmt(r["recall_PIC_EQUIPE"], True, 0),
             fmt(r["recall_ROTATION_EQUIPE"], True, 0), f"{fmt(r['delay_LUNDI_VENDREDI'], nd=0)} / {fmt(r['delay_PONTS'], nd=0)} / {fmt(r['delay_DERIVE'], nd=0)}"] for r in b["sweep"]]
    parts.append("### T7. Signal individuel Bradford (66 calculs mensuels)\n\n" + md_table(
        ["Seuil", "Signalés / mois", "Salariés signalés au moins une fois", "Précision", "Lundi/ven.", "Ponts", "Dérive", "Membres pic", "Membres rotation", "Délai médian LV / ponts / dérive (j)"], rows))
    rows = [[LABEL[t], fmt(b["pr_auc"][t]["positives"]), fmt(b["pr_auc"][t]["prevalence"], True, 2), fmt(b["pr_auc"][t]["pr_auc"], nd=3)] for t in TYPES]
    parts.append("PR-AUC du facteur de Bradford (unités salarié x mois) :\n\n" + md_table(["Type", "Unités positives", "Prévalence", "PR-AUC"], rows))

    rows = []
    for name, p in ind["patterns"].items():
        rows.append([name, f"{p['window_months']} mois", fmt(p["flag_rate_mean"], True, 2), fmt(p["distinct_employees"]), fmt(p["precision_units"], True),
                     fmt(p["recall_LUNDI_VENDREDI"], True, 0), fmt(p["recall_PONTS"], True, 0), fmt(p["recall_DERIVE"], True, 0),
                     f"{fmt(p['delay_LUNDI_VENDREDI'], nd=0)} / {fmt(p['delay_PONTS'], nd=0)}"])
    if "s2" in res:
        for name, p in res["s2"]["patterns"].items():
            rows.append([f"{name} (graine 2)", f"{p['window_months']} mois", fmt(p["flag_rate_mean"], True, 2), fmt(p["distinct_employees"]), fmt(p["precision_units"], True),
                         fmt(p["recall_LUNDI_VENDREDI"], True, 0), fmt(p["recall_PONTS"], True, 0), fmt(p["recall_DERIVE"], True, 0),
                         f"{fmt(p['delay_LUNDI_VENDREDI'], nd=0)} / {fmt(p['delay_PONTS'], nd=0)}"])
    parts.append("### T8. Prototypes de tests individuels typés (alpha 0,01, au moins 3 jours ciblés)\n\n" + md_table(
        ["Test", "Fenêtre", "Signalés / mois", "Salariés", "Précision", "Lundi/ven.", "Ponts", "Dérive", "Délai LV / ponts (j)"], rows))

    rows = [[r["file"], r["defect_type"], r["expected_rule"], fmt(r["injected"]), fmt(r["flagged_expected_rule"]), fmt(r["detection_rate"], True), ", ".join(r["severity"])]
            for r in qual["full"]["by_type"]]
    parts.append("### T9. Défauts injectés et règles de l'import (rejeu sans plafond de détail)\n\n" + md_table(
        ["Fichier", "Défaut injecté", "Règle attendue", "Injectés", "Signalés par la règle", "Taux", "Sévérité"], rows))
    pc = qual["payroll_ratio_check"]
    parts.append(f"Paie incomplète : {qual['payroll_incomplete']['missing']} salariés en poste sans paie du dernier mois, causes : {qual['payroll_incomplete']['by_cause']}. "
                 f"Import de l'export nettoyé : statut {qual['clean_import']['status']}, score {qual['clean_import']['qualityScore']}, {qual['clean_import']['rowsRejected']} rejet. "
                 f"Règle de cohérence prototypée brut > {fmt(pc['ratio'])} x base : {pc['smig_flagged']}/{pc['smig_defects']} défauts SMIG, "
                 f"{pc['clean_flagged']} ligne saine signalée sur {fmt(pc['clean_rows'])} (ratio sain max {fmt(pc['clean_max_ratio'], nd=3)}).")
    s = qual["score"]
    rows = [[k, fmt(v, nd=3)] for k, v in s["loss_by_rule_points"].items()] + [["complétude paie (PAIE_INCOMPLETE)", fmt(s["loss_completeness_points"], nd=3)]]
    parts.append("### T10. Perte de score qualité par règle (points de pourcentage)\n\n" + md_table(["Règle", "Points perdus"], rows))
    if "s2" in res:
        v = res["s2"]
        t = v["table"]
        rows = [[LABEL[x], fmt(t["per_type"][x]["events"]), fmt(t["per_type"][x]["recall"], True), fmt(v["bradford_250"][f"recall_{x}"], True)] for x in TYPES]
        parts.append(f"### T11. Graine 2 (mixte_medium_s2, hors échantillon)\n\nRéplication Python de la table : {v['replication']}. Collectif : {t['detections']} détections, "
                     f"précision {fmt(t['precision'], True)}, {fmt(t['fp_per_month'], nd=2)} FP/mois. Bradford 250 : {fmt(v['bradford_250']['flag_rate_mean'], True, 2)} signalés par mois, "
                     f"précision {fmt(v['bradford_250']['precision_units'], True)}.\n\n" + md_table(["Type", "Événements", "Rappel collectif (table)", "Rappel Bradford 250"], rows))
        if "quality" in v:
            rows = [[r["file"], r["defect_type"], fmt(r["injected"]), fmt(r["flagged_expected_rule"]), fmt(r["detection_rate"], True, 2)] for r in v["quality"]["by_type"]]
            pc2 = v["payroll_ratio_check"]
            parts.append(f"Qualité graine 2 : score {fmt(v['quality_score']['score'], nd=4)}, lignes signalées sans défaut : {len(v['quality']['false_flags'])} groupe(s), "
                         f"paie incomplète : {v['payroll_incomplete']} ; brut > 2 x base : {pc2['smig_flagged']}/{pc2['smig_defects']} défauts SMIG, "
                         f"{pc2['clean_flagged']} ligne saine signalée.\n\n" + md_table(["Fichier", "Défaut", "Injectés", "Signalés", "Taux"], rows))
    return "\n\n".join(parts) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--s2", action="store_true", help="validation hors échantillon sur mixte_medium_s2 (exports data/eval-out-s2)")
    a = ap.parse_args()
    ctx = A.Context()
    res = {"collective": collective(ctx), "calendar": calendar_block(ctx), "individual": individual(ctx), "quality": Q.evaluate()}
    if a.s2:
        res["s2"] = validation_s2()
    C.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    dump = lambda o, f: (C.RESULTS_DIR / f).write_text(json.dumps(o, indent=1, ensure_ascii=False, default=str), encoding="utf-8")  # noqa: E731
    dump({k: v for k, v in res.items() if k != "quality"}, "anomalies.json")
    dump(res["quality"], "quality.json")
    (C.RESULTS_DIR / "tables.md").write_text(tables(res), encoding="utf-8")
    print(f"Résultats écrits dans {C.RESULTS_DIR}")


if __name__ == "__main__":
    main()
