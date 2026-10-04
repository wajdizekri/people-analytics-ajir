"""Tables Markdown tirées des résultats (ml/train/results/*.json) : python ml/train/report.py [jeu principal] > tables.md"""
import json
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from train.study import propose_threshold, summarize_by_events  # noqa: E402

RESULTS = Path(__file__).resolve().parent / "results"
LABELS = {"B0": "B0 (règles)", "LOGREG": "LOGREG (protocole)", "LOGREG_PROD": "LOGREG recette de production",
          "LOGREG_NW": "LOGREG sans pondération", "LOGREG_PLATT_IN": "LOGREG, Platt intra-échantillon", "LGBM": "LightGBM",
          "ORACLE": "Oracle du simulateur"}
SPLITS = {"aleatoire_ligne": "aléatoire par ligne", "aleatoire_ligne_naif": "aléatoire par ligne + variables naïves",
          "par_salarie": "par salarié", "temporel": "temporel (origines glissantes)"}
NAIVE = {"B0_nom": "B0, variables as-of", "B0": "B0, variables naïves", "LOGREG_nom": "LOGREG as-of → as-of",
         "LOGREG": "LOGREG naïf → naïf (annoncé)", "LOGREG_alt": "LOGREG naïf → as-of (production)",
         "LGBM_nom": "LightGBM as-of → as-of", "LGBM": "LightGBM naïf → naïf (annoncé)", "LGBM_alt": "LightGBM naïf → as-of (production)"}


def f(x, d=3):
    return "—" if x is None else f"{x:.{d}f}".replace(".", ",").replace("-", "−")


def pct(x, d=1):
    return "—" if x is None else f"{100 * x:.{d}f} %".replace(".", ",")


def ci(v, d=3):
    return "" if not v else f" [{f(v[0], d)} ; {f(v[1], d)}]"


def table(head, rows):
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def load(name):
    return json.loads((RESULTS / f"{name}.json").read_text(encoding="utf-8"))


def datasets_table(all_res):
    return table(["Jeu", "Snapshots suivis", "Positifs (taux)", "Salariés", "Démissions distinctes", "Période des snapshots"],
                 [[r["dataset"], r["n_rows"], f"{r['n_pos']} ({pct(r['base_rate'], 2)})", r["n_employees"], r["events"], r["panel"]]
                  for r in all_res])


def origins_table(r):
    rows = []
    for o in r["origins"]:
        rows.append([o["origin"], o["train"], f"{o['n_train']} / {o['events_train']}", o["cal"], o["test"],
                     f"{o['n_test']} / {o['pos_test']}", f"{o['logreg']['C']:g}", f(o["logreg"]["platt_a"], 2),
                     f"{o['lgbm']['num_leaves']} f., {o['lgbm']['min_child_samples']} min, {o['lgbm']['n_rounds']} arbres"])
    return table(["Origine", "Apprentissage", "Lignes / démissions", "Calibration", "Test", "Lignes / positifs", "C", "Platt a",
                  "LightGBM"], rows)


def main_table(r, models=("B0", "LOGREG", "LOGREG_PROD", "LGBM", "LOGREG_NW", "LOGREG_PLATT_IN")):
    ev = r["evaluation"]
    rows = []
    for m in models:
        x = ev["models"][m]
        c = x["ci"]
        prob = "brier" in x
        rows.append([LABELS[m], f(x["auc"]) + ci(c.get("auc")), f(x["pr_auc"]) + ci(c.get("pr_auc")),
                     f(x.get("brier"), 4) if prob else "n/a", (f(x["oe_ratio"], 2) + ci(c.get("oe_ratio"), 2)) if prob else "n/a",
                     (f(x["slope"], 2) + ci(c.get("slope"), 2)) if prob else "n/a",
                     pct(x["precision_at_k"]), f(x["lift_at_k"], 2) + ci(c.get("lift_at_k"), 2), pct(x["recall_at_k"])])
    head = ["Modèle", "AUC 6 mois [IC 95 %]", "PR-AUC", "Brier", "Observé / prévu", "Pente de calibration",
            f"Précision à {pct(ev['capacity_rate'], 0)}", "Lift", "Rappel"]
    return table(head, rows) + f"\n\nTest empilé : {ev['n']} snapshots, {ev['n_pos']} positifs (prévalence {pct(ev['base_rate'], 2)}), " \
                               f"{ev['n_employees']} salariés ; bootstrap groupé par salarié, {ev['n_boot']} tirages."


def diff_table(ev):
    rows = []
    for k, d in ev["diffs"].items():
        a, b = k.split("-")
        rows.append([f"{LABELS.get(a, NAIVE.get(a, a))} − {LABELS.get(b, NAIVE.get(b, b))}", f(d["auc"]["value"]) + ci(d["auc"]["ci"]),
                     f(d["pr_auc"]["value"]) + ci(d["pr_auc"]["ci"]), f(d["lift_at_k"]["value"], 2) + ci(d["lift_at_k"]["ci"], 2),
                     f(d["auc"]["p_le_0"], 3)])
    return table(["Différence appariée", "ΔAUC [IC 95 %]", "ΔPR-AUC", "Δlift à la capacité", "Part des tirages ΔAUC ≤ 0"], rows)


def oracle_table(r):
    o = r["evaluation"].get("oracle_subset")
    if not o:
        return "_Pas d'oracle._"
    rows = [[LABELS[m], f(v) + ci(o["ci"].get(m))] for m, v in o["auc"].items() if m in ("B0", "LOGREG", "LOGREG_PROD", "LGBM", "ORACLE")]
    return table(["Modèle", "AUC sur les lignes où l'oracle existe [IC 95 %]"], rows) + \
        f"\n\nSous-ensemble : {o['n']} snapshots (un mois sur trois), {o['n_pos']} positifs ({pct(o['base_rate'], 2)})."


def per_origin_table(r, models=("B0", "LOGREG", "LOGREG_PROD", "LGBM")):
    rows = [[o["origin"], f"{o['n']} / {o['n_pos']}"] + [f(o[m]["auc"]) for m in models] + [f(o["LOGREG_PROD"]["lift_at_k"], 2),
            f(o["LOGREG_PROD"]["oe_ratio"], 2)] for o in r["per_origin"]]
    return table(["Origine", "Test (lignes / positifs)"] + [f"AUC {LABELS[m]}" for m in models] + ["Lift recette", "O/E recette"], rows)


def calib_table(r, m="LOGREG_PROD"):
    c = r["curves"][m]
    t1 = table(["Décile", "Estimation moyenne", "Taux observé", "Effectif"],
               [[i + 1, pct(b["p_mean"], 2), pct(b["observed"], 2), b["n"]] for i, b in enumerate(c["bins"])])
    t2 = table(["Part ciblée chaque mois", "Précision", "Lift", "Rappel"],
               [[pct(x["top_pct"], 0), pct(x["precision"]), f(x["lift"], 2), pct(x["recall"])] for x in c["lift_curve"]])
    t3 = table(["Seuil", "Bénéfice net modèle", "Bénéfice net « tous ciblés »"],
               [[pct(x["threshold"], 1), f(x["net_benefit"], 4), f(x["treat_all"], 4)] for x in c["decision_curve"]])
    return t1, t2, t3


def q1a_table(r):
    rows = []
    for s in r["q1a_splits"]["summary"]:
        rows.append([SPLITS.get(s["split"], s["split"]), s["reps"]] + [f"{f(s[m]['mean'])} ± {f(s[m]['sd'])}" for m in ("B0", "LOGREG", "LGBM")]
                    + [f(s["LOGREG"]["inflation"]), f(s["LGBM"]["inflation"])]
                    + [f(s[m]["mean_fenetre"]) for m in ("B0", "LOGREG", "LGBM")]
                    + [f(s["LOGREG"]["inflation_fenetre"]), f(s["LGBM"]["inflation_fenetre"])])
    return table(["Découpage", "Répétitions", "AUC B0", "AUC LOGREG", "AUC LightGBM", "Inflation LOGREG", "Inflation LightGBM",
                  "B0 (fenêtre)", "LOGREG (fenêtre)", "LightGBM (fenêtre)", "Inflation LOGREG (fenêtre)", "Inflation LightGBM (fenêtre)"], rows)


def q1b_table(r):
    q = r.get("q1b_naive")
    if not q:
        return "_Pas d'expérience naïve._", ""
    rows = [[NAIVE[m], f(x["auc"]) + ci(x["ci"].get("auc")), f(x["lift_at_k"], 2) + ci(x["ci"].get("lift_at_k"), 2),
             f(x.get("oe_ratio"), 2) if "oe_ratio" in x else "n/a"] for m, x in q["models"].items()]
    changed = ", ".join(f"{k} {pct(v)}" for k, v in sorted(r["naive_changed_rows"].items(), key=lambda kv: -kv[1]))
    return table(["Variante", "AUC [IC 95 %]", "Lift à la capacité", "Observé / prévu"], rows) + "\n\n" + diff_table(q), changed


def events_table(by_events):
    return table(["Démissions observées", "Essais", "ΔAUC moyen (LOGREG − B0)", "10e centile de ΔAUC", "P(AUC LOGREG > B0)",
                  "Δlift moyen", "P(lift LOGREG > B0)", "P(LightGBM > LOGREG)", "O/E dans [0,8 ; 1,25]"],
                 [[f"[{b['events_from']} ; {b['events_to']}[" if b["events_to"] < 10_000 else f"≥ {b['events_from']}", b["runs"],
                   f(b["delta_mean"]), f(b["delta_p10"]), pct(b["p_logreg_gt_b0"], 0), f(b["lift_delta_mean"], 2),
                   pct(b["p_lift_logreg_gt_b0"], 0), pct(b["p_lgbm_gt_logreg"], 0), pct(b["oe_in_range"], 0)]
                  for b in by_events])


def pooled_curve(all_res):
    runs = pd.DataFrame([x | {"dataset": r["dataset"]} for r in all_res if "q1d_curve" in r for x in r["q1d_curve"]["runs"]])
    by_events = summarize_by_events(runs)
    return events_table(by_events), propose_threshold(by_events), runs["dataset"].nunique()


def q1d_tables(r):
    c = r.get("q1d_curve")
    if not c:
        return "_Pas de courbe._", "", {}
    t1 = table(["Salariés tirés", "Éligibles / mois", "Répl. x origines", "Démissions observées (médiane, min-max)", "AUC B0",
                "AUC LOGREG (± é.-t.)", "ΔAUC moyen", "P(LOGREG > B0)", "AUC LightGBM", "P(LightGBM > LOGREG)", "O/E dans [0,8 ; 1,25]",
                "Lift LOGREG", "Lift B0"],
               [[s["size"], f(s["eligible_per_month"], 0), s["runs"], f"{f(s['events_median'], 0)} ({s['events_range'][0]}-{s['events_range'][1]})",
                 f(s["auc_b0"]), f"{f(s['auc_logreg'])} ± {f(s['auc_logreg_sd'])}", f(s["delta_mean"]), pct(s["p_logreg_gt_b0"], 0),
                 f(s["auc_lgbm"]), pct(s["p_lgbm_gt_logreg"], 0), pct(s["oe_in_range"], 0), f(s["lift_logreg"], 2), f(s["lift_b0"], 2)]
                for s in c["by_size"]])
    by_events = summarize_by_events(pd.DataFrame(c["runs"]))
    return t1, events_table(by_events), propose_threshold(by_events)


def fairness_tables(r):
    fr = r["fairness"]
    out = []
    for dim, label in (("sex", "Sexe"), ("age_band", "Tranche d'âge")):
        rows = [[g["group"], g["n"], g["n_pos"], pct(g["base_rate"], 2), pct(g["mean_pred"], 2), f(g["oe_ratio"], 2) + ci(g["ci"]["oe_ratio"], 2),
                 pct(g["selection_rate"], 2) + " [" + pct(g["ci"]["selection_rate"][0], 2) + " ; " + pct(g["ci"]["selection_rate"][1], 2) + "]",
                 pct(g["tpr"]) + " [" + pct(g["ci"]["tpr"][0]) + " ; " + pct(g["ci"]["tpr"][1]) + "]",
                 pct(g["fpr"], 2), f(g["auc"])] for g in fr[dim]]
        out.append(f"**{label}**\n\n" + table(["Groupe", "Snapshots", "Positifs", "Taux observé", "Estimation moyenne", "O/E [IC]",
                                                "Sélection ÉLEVÉ [IC]", "TPR [IC]", "FPR", "AUC"], rows))
    mi = r["proxies"]
    for attr, label in (("sex", "sexe"), ("age_band", "tranche d'âge")):
        rows = [[x["feature"], f(x["mi"], 4), pct(x["share"])] for x in mi[attr]["features"][:6]]
        out.append(f"**Information mutuelle avec le {label}** (entropie {f(mi[attr]['entropy'], 3)} nats, {mi['n_employees']} salariés, "
                   f"un snapshot par salarié)\n\n" + table(["Variable", "IM (nats)", "Part de l'entropie"], rows))
    return out


def summary_table(all_res):
    rows = []
    for r in all_res:
        ev = r["evaluation"]
        m = ev["models"]
        o = ev.get("oracle_subset", {}).get("auc", {})
        rows.append([r["dataset"], f(m["B0"]["auc"]) + ci(m["B0"]["ci"]["auc"]), f(m["LOGREG"]["auc"]) + ci(m["LOGREG"]["ci"]["auc"]),
                     f(m["LOGREG_PROD"]["auc"]) + ci(m["LOGREG_PROD"]["ci"]["auc"]), f(m["LGBM"]["auc"]) + ci(m["LGBM"]["ci"]["auc"]),
                     f(o.get("ORACLE")), f(ev["diffs"]["LOGREG-B0"]["auc"]["value"]) + ci(ev["diffs"]["LOGREG-B0"]["auc"]["ci"]),
                     f(ev["diffs"]["LGBM-LOGREG"]["auc"]["value"]) + ci(ev["diffs"]["LGBM-LOGREG"]["auc"]["ci"]),
                     f(m["LOGREG_PROD"]["oe_ratio"], 2), f(m["LOGREG_PROD"]["slope"], 2), f(m["LOGREG_PROD"]["lift_at_k"], 2),
                     f(m["B0"]["lift_at_k"], 2)])
    return table(["Jeu", "AUC B0", "AUC LOGREG", "AUC recette", "AUC LightGBM", "AUC oracle (1 mois / 3)", "LOGREG − B0",
                  "LightGBM − LOGREG", "O/E recette", "Pente recette", "Lift recette", "Lift B0"], rows)


def main():
    names = sorted(p.stem for p in RESULTS.glob("*.json") if p.stem != "smoke")
    main_name = sys.argv[1] if len(sys.argv) > 1 else names[0]
    all_res = [load(n) for n in [main_name] + [n for n in names if n != main_name]]
    r = all_res[0]
    parts = [("Jeux", datasets_table(all_res)), ("Synthèse par jeu", summary_table(all_res)),
             (f"Origines ({main_name})", origins_table(r))]
    for x in all_res:
        parts += [(f"Résultats {x['dataset']}", main_table(x)), (f"Différences {x['dataset']}", diff_table(x["evaluation"])),
                  (f"Oracle {x['dataset']}", oracle_table(x)), (f"Par origine {x['dataset']}", per_origin_table(x))]
    t1, t2, t3 = calib_table(r)
    parts += [("Calibration par décile (recette)", t1), ("Courbe de lift (recette)", t2), ("Courbe de décision (recette)", t3)]
    for x in all_res:
        if "q1a_splits" in x:
            parts.append((f"Q1a {x['dataset']}", q1a_table(x)))
        b, changed = q1b_table(x)
        parts.append((f"Q1b {x['dataset']}", b + (f"\n\nLignes modifiées par le mode naïf : {changed}" if changed else "")))
        d1, d2, th = q1d_tables(x)
        parts.append((f"Q1d {x['dataset']}", f"{d1}\n\n{d2}\n\nSeuil proposé : {th}"))
    t, th, n = pooled_curve(all_res)
    parts.append((f"Q1d, {n} jeux regroupés", f"{t}\n\nSeuils : {th}"))
    for x in all_res[:1]:
        for i, t in enumerate(fairness_tables(x)):
            parts.append((f"Équité {x['dataset']} ({i + 1})", t))
    fm = r["final_model"]
    coefs = sorted(fm["coef"].items(), key=lambda kv: -abs(kv[1]))
    parts.append(("Modèle final", f"C = {fm['C']:g}, Platt a = {f(fm['platt_a'], 3)}, b = {f(fm['platt_b'], 3)}, "
                  f"lignes de calibration {fm['calibration_rows']}, O/E intra-échantillon {f(fm['in_sample_oe'], 3)}\n\n"
                  + table(["Variable", "Coefficient (z-score)"], [[k, f(v, 3)] for k, v in coefs])))
    print("\n\n".join(f"### {t}\n\n{b}" for t, b in parts))


if __name__ == "__main__":
    main()
