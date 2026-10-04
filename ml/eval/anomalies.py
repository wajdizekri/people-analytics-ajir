"""Évaluation de la détection d'anomalies d'absentéisme (src/lib/anomalies) contre les anomalies injectées."""
from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

from . import common as C
from .metrics import Detection, Event, average_precision, binom_sf, days_between, event_metrics, match, rule_fires

TEAM_TYPES = ("PIC_EQUIPE", "ROTATION_EQUIPE")
INDIV_TYPES = ("LUNDI_VENDREDI", "PONTS", "DERIVE")
MIN_GROUP_SIZE = 5


class Context:
    """Données partagées : salariés, groupes, événements injectés, scores exportés."""

    def __init__(self, sim_dir: Path = C.SIM_DIR, export: Path = C.EXPORT_DIR, db: Path = C.EVAL_DB):
        self.export = export
        self.db = db
        self.meta = C.load_meta(export)
        self.emps = C.load_employees(export)
        self.members = C.group_members(self.emps)
        self.events_df = C.load_events(sim_dir, self.emps)
        self.eval_from, self.eval_to = self.meta["fromWeek"], self.meta["toWeek"]
        all_events = [
            Event(int(r.anomaly_id), r.type, r.start, r.end, r.members, int(r.held_out), None if pd.isna(r.department_id) else int(r.department_id))
            for r in self.events_df.itertuples()
        ]
        # événements commencés pendant la période de référence initiale (avant la première semaine évaluée) : exclus
        self.events = [e for e in all_events if e.start >= self.eval_from]
        self.excluded_events = len(all_events) - len(self.events)
        self.months = len(C.month_range(self.meta["from"], self.meta["to"]))
        self._scores: dict[str, tuple] = {}
        self._active: np.ndarray | None = None

    def scores(self, tag: str):
        if tag not in self._scores:
            s = C.load_scores(tag, self.export)
            keys, weeks, z, den = C.z_matrix(s)
            monitored_end = s.groupby("key")["monitored_end"].first().reindex(keys).to_numpy().astype(bool)
            self._scores[tag] = (keys, weeks, z, den, monitored_end)
        return self._scores[tag]

    def active_counts(self, keys: list[str], days: list[str]) -> np.ndarray:
        """Effectif en poste (sortie >= jour) de chaque groupe à chaque date, comme activeAtEnd."""
        hire = self.emps["hire_date"].to_numpy()
        ex = np.where(self.emps["exit_date"] == "", "9999-12-31", self.emps["exit_date"]).astype(str)
        idx = {int(i): n for n, i in enumerate(self.emps["id"])}
        d = np.array(days)
        out = np.zeros((len(keys), len(days)), dtype=int)
        for gi, k in enumerate(keys):
            m = np.array([idx[i] for i in self.members.get(k, ())], dtype=int)
            if len(m):
                out[gi] = ((hire[m][:, None] <= d[None, :]) & (ex[m][:, None] >= d[None, :])).sum(0)
        return out


def python_detections(ctx: Context, tag: str, mode: str, threshold: float, k: int) -> list[Detection]:
    """Réplique detectAnomalies (partie collective) sur les z exportés : mode batch (un appel sur toute la période,
    comme le pipeline --backtest) ou monthly (un appel par mois, comme le worker)."""
    keys, weeks, z, _, monitored_end = ctx.scores(tag)
    wi = {w: i for i, w in enumerate(weeks)}
    found: dict[tuple[str, int], int] = {}
    if mode == "batch":
        lo, hi = wi[ctx.eval_from], wi[ctx.eval_to]
        for g, key in enumerate(keys):
            if monitored_end[g]:
                for w in rule_fires(z[g], threshold, k, lo, hi):
                    found.setdefault((key, w - k + 1), w)
    elif mode == "monthly":
        months = C.month_range(ctx.meta["from"], ctx.meta["to"])
        spans = [C.weeks_of_month(m) for m in months]
        ends = [C.add_days(tw, 6) for _, tw in spans]
        act = ctx.active_counts(keys, ends)
        for mi, (fw, tw) in enumerate(spans):
            lo, hi = wi[fw], wi[tw]
            for g, key in enumerate(keys):
                if act[g, mi] >= MIN_GROUP_SIZE:
                    for w in rule_fires(z[g], threshold, k, lo, hi):
                        found.setdefault((key, w - k + 1), w)
    else:
        raise ValueError(mode)
    dets = []
    for (key, w0), w in sorted(found.items(), key=lambda x: (x[0][1], x[0][0])):
        dets.append(Detection(key, weeks[w0], C.add_days(weeks[w], 6), ctx.members.get(key, frozenset()), float(np.nanmin(z[keys.index(key), w0 : w + 1]))))
    return dets


def union_rules(ctx: Context, tag: str, mode: str, rules: list[tuple[float, int]]) -> list[Detection]:
    """Prototype : union de plusieurs règles (z, k) ; une détection chevauchant une détection déjà retenue pour le même
    groupe n'est pas comptée deux fois."""
    kept: list[Detection] = []
    for thr, k in rules:
        for d in python_detections(ctx, tag, mode, thr, k):
            if not any(x.key == d.key and x.start <= d.end and d.start <= x.end for x in kept):
                kept.append(d)
    return sorted(kept, key=lambda d: (d.start, d.key))


def operational_delay(ctx: Context, dets: list[Detection]) -> dict:
    """Mode worker : une détection dont la dernière semaine commence au mois M n'est produite que par le lot mensuel
    du 10 du mois M + 1. Délai = cette date - début injecté (médiane par type détecté)."""
    hits = match(dets, ctx.events)
    out = {}
    for t in sorted({e.type for e in ctx.events}):
        ds = []
        for e in ctx.events:
            if e.type == t and hits[e.anomaly_id]:
                run = min(str(np.datetime64(C.add_days(dets[i].end, -6)[:7], "M") + 1) + "-10" for i in hits[e.anomaly_id])
                ds.append(days_between(e.start, run))
        out[t] = {"median": float(np.median(ds)) if ds else None, "min": min(ds) if ds else None, "max": max(ds) if ds else None}
    return out


def table_detections(ctx: Context, path: Path) -> list[Detection]:
    """Détections collectives d'une table anomaly exportée (table de data/app.db ou rejeu TypeScript)."""
    a = C.read_csv(path)
    a = a[a["scope"] != "SALARIE"]
    out = []
    for r in a.itertuples():
        key = f"T{int(r.manager_id)}" if r.scope == "EQUIPE" else f"D{int(r.department_id)}"
        out.append(Detection(key, r.period_start, r.period_end, ctx.members.get(key, frozenset()), float(r.score)))
    return out


def same_detections(a: list[Detection], b: list[Detection]) -> dict:
    sa = {(d.key, d.start) for d in a}
    sb = {(d.key, d.start) for d in b}
    return {"both": len(sa & sb), "only_first": len(sa - sb), "only_second": len(sb - sa)}


def coverage(ctx: Context) -> dict:
    """Part des événements dont au moins un salarié touché est dans une équipe suivie (>= 5 en poste) pendant l'événement."""
    keys = [k for k in ctx.members if k.startswith("T")]
    out = {}
    for mode in ("batch", "monthly"):
        cov = {}
        for t in TEAM_TYPES + INDIV_TYPES:
            evs = [e for e in ctx.events if e.type == t]
            ok = 0
            for e in evs:
                ks = [k for k in keys if ctx.members[k] & e.members]
                if not ks:
                    continue
                if mode == "batch":
                    act = ctx.active_counts(ks, [C.add_days(ctx.eval_to, 6)])[:, 0]
                else:
                    months = C.month_range(e.start[:7], e.end[:7])
                    act = ctx.active_counts(ks, [C.add_days(C.weeks_of_month(m)[1], 6) for m in months]).max(1)
                ok += int((act >= MIN_GROUP_SIZE).any())
            cov[t] = ok / len(evs) if evs else None
        out[mode] = cov
    return out


def unit_labels(ctx: Context, keys: list[str], weeks: list[str], span: int) -> dict[str, np.ndarray]:
    """Étiquettes (groupe, semaine) par type : fenêtre [lundi(w - span + 1), dimanche(w)] chevauchant un événement
    dont un salarié touché appartient au groupe."""
    starts = np.array([C.add_days(w, -7 * (span - 1)) for w in weeks])
    ends = np.array([C.add_days(w, 6) for w in weeks])
    lab = {t: np.zeros((len(keys), len(weeks)), dtype=bool) for t in TEAM_TYPES + INDIV_TYPES}
    for gi, k in enumerate(keys):
        mem = ctx.members.get(k, frozenset())
        for e in ctx.events:
            if mem & e.members:
                lab[e.type][gi] |= (starts <= e.end) & (ends >= e.start)
    return lab


def week_level_ap(ctx: Context, tag: str = "cal") -> dict:
    """PR-AUC au niveau (équipe, semaine) en faisant varier le seuil du score robuste, un type contre les semaines sans
    aucune anomalie injectée. Unités : équipes >= 5 en poste en fin de semaine, semaines de la période évaluée."""
    keys, weeks, z, _, _ = ctx.scores(tag)
    wi = {w: i for i, w in enumerate(weeks)}
    lo, hi = wi[ctx.eval_from], wi[ctx.eval_to]
    team = np.array([k.startswith("T") for k in keys])
    act = ctx.active_counts(keys, [C.add_days(w, 6) for w in weeks])
    z2 = np.fmin(z, np.roll(z, 1, axis=1))
    z2[:, 0] = np.nan
    z2[np.isnan(np.roll(z, 1, axis=1))] = np.nan
    res = {}
    for name, score, span in (("z_semaine", z, 1), ("z_2_semaines", z2, 2)):
        lab = unit_labels(ctx, keys, weeks, span)
        any_ev = np.zeros_like(lab[TEAM_TYPES[0]])
        for v in lab.values():
            any_ev |= v
        base = np.zeros_like(any_ev)
        base[:, lo : hi + 1] = True
        base &= team[:, None] & (act >= MIN_GROUP_SIZE) & ~np.isnan(score)
        out = {}
        for t, y in lab.items():
            keep = base & (y | ~any_ev)
            yy, ss = y[keep], score[keep]
            out[t] = {"units": int(keep.sum()), "positives": int(yy.sum()), "prevalence": float(yy.mean()), "pr_auc": average_precision(yy, ss)}
        res[name] = out
    return res


def sensitivity(ctx: Context, mode: str, tag: str = "cal", thresholds=(2.5, 3.0, 3.5, 4.0), ks=(1, 2, 3), with_chance: bool = False) -> list[dict]:
    rows = []
    for k in ks:
        for thr in thresholds:
            dets = python_detections(ctx, tag, mode, thr, k)
            m = event_metrics(dets, ctx.events, ctx.months)
            chance = {f"chance_{t}": v for t, v in chance_recall(ctx, dets).items()} if with_chance else {}
            rows.append({"mode": mode, "calendar": tag, "k": k, "z": thr, **_flat(m), **chance})
    return rows


def pr_curve_events(ctx: Context, mode: str = "monthly", k: int = 2, tag: str = "cal") -> dict:
    """Courbe précision / rappel au niveau événement en faisant varier z de 2 à 12 (pas 0,25), k fixé.
    Par type (un contre les détections fausses) : précision = détections attribuées au type / (attribuées + fausses).
    Aire : précision interpolée (max à rappel supérieur ou égal), intégrée depuis un rappel nul."""
    pts = []
    for thr in np.arange(2.0, 12.01, 0.25):
        m = event_metrics(python_detections(ctx, tag, mode, float(thr), k), ctx.events, ctx.months)
        pts.append((float(thr), m))
    out: dict = {"points": [{"z": t, "recall": m["recall_all"], "precision": m["precision"]} for t, m in pts]}
    for t in sorted({e.type for e in ctx.events}) + ["all"]:
        rec, pre = [], []
        for _, m in pts:
            if t == "all":
                r, tp = m["recall_all"], m["true_detections"]
            else:
                r, tp = m["per_type"][t]["recall"], m["per_type"][t]["detections_attributed"]
            rec.append(r)
            pre.append(tp / (tp + m["false_detections"]) if tp + m["false_detections"] else 1.0)
        out[f"pr_auc_{t}"] = interpolated_ap(np.array(rec), np.array(pre))
    return out


def interpolated_ap(recall: np.ndarray, precision: np.ndarray) -> float:
    o = np.argsort(recall, kind="stable")
    r, p = recall[o], precision[o]
    p_int = np.maximum.accumulate(p[::-1])[::-1]
    return float(np.sum(np.diff(np.concatenate([[0.0], r])) * p_int))


def chance_recall(ctx: Context, dets: list[Detection], shifts=(-52, -26, 26, 52)) -> dict:
    """Rappel « par hasard » : mêmes détections décalées de +/- 26 et 52 semaines (groupes inchangés)."""
    out = {}
    for t in sorted({e.type for e in ctx.events}):
        vals = []
        for s in shifts:
            moved = [Detection(d.key, C.add_days(d.start, 7 * s), C.add_days(d.end, 7 * s), d.members) for d in dets]
            vals.append(event_metrics(moved, ctx.events, ctx.months)["per_type"][t]["recall"])
        out[t] = float(np.mean(vals))
    return out


def _flat(m: dict) -> dict:
    d = {k: v for k, v in m.items() if k != "per_type"}
    for t, v in m["per_type"].items():
        d[f"recall_{t}"] = v["recall"]
        d[f"delay_{t}"] = v["delay_median_days"]
    return d


def explain_false_detections(ctx: Context, dets: list[Detection], sim_dir: Path = C.SIM_DIR) -> dict:
    """Détections sans anomalie injectée : chevauchent-elles la phase de départ simulée (signaux faibles) d'un membre ?"""
    phases = _phases(sim_dir, ctx.emps)
    fp = [d for d in dets if not d.matched]
    signal = 0
    for d in fp:
        months = set(C.month_range(d.start[:7], d.end[:7]))
        if any((m, mo) in phases for m in d.members for mo in months):
            signal += 1
    return {"false_detections": len(fp), "with_departure_signal": signal}


def _phases(sim_dir: Path, emps: pd.DataFrame) -> set[tuple[int, str]]:
    lat = C.read_csv(sim_dir / "ground_truth" / "latent_monthly.csv", usecols=["matricule", "month", "phase"])
    lat = lat.dropna(subset=["phase"])
    ids = dict(zip(emps["matricule"], emps["id"].astype(int)))
    return {(ids[m], mo) for m, mo in zip(lat["matricule"], lat["month"]) if m in ids}


def calendar_ablation(ctx: Context, dets_cal: list[Detection], dets_nocal: list[Detection]) -> dict:
    """Détections avec / sans facteur calendrier, ventilées selon la période : Ramadan, Aïd, pont, séance unique."""
    cal = C.calendar(ctx.db)
    cal["aid"] = cal["holiday_name"].fillna("").str.contains("d el-", regex=False)
    days = cal.set_index("date")

    def classes(d: Detection) -> list[str]:
        sl = days.loc[d.start : d.end]
        out = []
        if sl["is_ramadan"].any():
            out.append("ramadan")
        if sl["aid"].any():
            out.append("aid")
        if sl["is_bridge"].any():
            out.append("pont")
        if sl["is_holiday"].any():
            out.append("ferie")
        if sl["is_seance_unique"].any():
            out.append("seance_unique")
        return out or ["normale"]

    res = {}
    for name, dets in (("avec_calendrier", dets_cal), ("sans_calendrier", dets_nocal)):
        match(dets, ctx.events)
        row = {}
        for cls in ("ramadan", "aid", "pont", "ferie", "seance_unique", "normale"):
            ds = [d for d in dets if cls in classes(d)]
            row[cls] = {"detections": len(ds), "false": sum(1 for d in ds if not d.matched)}
        row["total"] = {"detections": len(dets), "false": sum(1 for d in dets if not d.matched)}
        res[name] = row
    a = {(d.key, d.start): d for d in dets_cal}
    b = {(d.key, d.start): d for d in dets_nocal}
    only_cal = [a[x] for x in a.keys() - b.keys()]
    only_nocal = [b[x] for x in b.keys() - a.keys()]
    res["differences"] = {
        "seulement_avec_calendrier": [{"key": d.key, "start": d.start, "classes": classes(d), "vraie": bool(d.matched)} for d in only_cal],
        "seulement_sans_calendrier": [{"key": d.key, "start": d.start, "classes": classes(d), "vraie": bool(d.matched)} for d in only_nocal],
    }
    return res


# --- signal individuel (Bradford) -------------------------------------------------------------------------------


def _bradford_units(ctx: Context) -> pd.DataFrame:
    runs = C.read_csv(ctx.export / "bradford_runs.csv")
    b = C.read_csv(ctx.export / "bradford_monthly.csv")
    frames = []
    for r in runs.itertuples():
        act = ctx.emps[C.active_at(ctx.emps, r.end, strict_exit=True)][["id"]].rename(columns={"id": "employee_id"})
        act["month"], act["end"] = r.month, r.end
        frames.append(act)
    u = pd.concat(frames, ignore_index=True)
    u = u.merge(b[["month", "employee_id", "spells", "days", "bradford"]], on=["month", "employee_id"], how="left").fillna({"spells": 0, "days": 0.0, "bradford": 0.0})
    u["win_start"] = (pd.to_datetime(u["end"]) - pd.DateOffset(months=12) + pd.Timedelta(days=1)).dt.strftime("%Y-%m-%d")
    return u


def _member_events(ctx: Context) -> pd.DataFrame:
    rows = [(m, e.anomaly_id, e.type, e.start, e.end) for e in ctx.events for m in e.members]
    return pd.DataFrame(rows, columns=["employee_id", "anomaly_id", "type", "start", "end"])


def bradford_eval(ctx: Context, thresholds=(100, 150, 250, 400, 600), sim_dir: Path = C.SIM_DIR) -> dict:
    u = _bradford_units(ctx)
    me = _member_events(ctx)
    x = u[["employee_id", "month", "end", "win_start"]].merge(me.rename(columns={"end": "ev_end"}), on="employee_id")
    x = x[(x["start"] <= x["end"]) & (x["ev_end"] >= x["win_start"])]
    lab = {t: set(zip(x.loc[x["type"] == t, "employee_id"], x.loc[x["type"] == t, "month"])) for t in TEAM_TYPES + INDIV_TYPES}
    any_ev = set(zip(x["employee_id"], x["month"]))
    key = list(zip(u["employee_id"], u["month"]))
    u["any_event"] = [k in any_ev for k in key]
    res: dict = {"runs": int(u["month"].nunique()), "units": len(u)}

    ap = {}
    for t in INDIV_TYPES + TEAM_TYPES:
        y = np.array([k in lab[t] for k in key])
        keep = y | ~u["any_event"].to_numpy()
        ap[t] = {"positives": int(y[keep].sum()), "prevalence": float(y[keep].mean()), "pr_auc": average_precision(y[keep], u["bradford"].to_numpy()[keep])}
    res["pr_auc"] = ap

    phases = _phases(sim_dir, ctx.emps)
    sweep = []
    for thr in thresholds:
        f = u[u["bradford"] >= thr]
        per_run = u.assign(flag=u["bradford"] >= thr).groupby("month")["flag"].mean()
        explained = f["any_event"].sum()
        row = {
            "threshold": thr,
            "flags": len(f),
            "flag_rate_mean": float(per_run.mean()),
            "distinct_employees": int(f["employee_id"].nunique()),
            "distinct_share": float(f["employee_id"].nunique() / u["employee_id"].nunique()),
            "precision_units": float(explained / len(f)) if len(f) else None,
        }
        ff = f[~f["any_event"]]
        sig = sum(1 for e, m, ws in zip(ff["employee_id"], ff["end"], ff["win_start"]) if any((e, mo) in phases for mo in C.month_range(ws[:7], m[:7])))
        row["unexplained_with_departure_signal"] = float(sig / len(ff)) if len(ff) else None
        flagged = f.groupby("employee_id")["end"].apply(list).to_dict()
        for t in INDIV_TYPES + TEAM_TYPES:
            evs = me[me["type"] == t]
            hit, delays = 0, []
            for r in evs.itertuples():
                ends = [e for e in flagged.get(r.employee_id, []) if e >= r.start and _win_start(e) <= r.end]
                if ends:
                    hit += 1
                    delays.append(days_between(r.start, min(ends)))
            row[f"recall_{t}"] = hit / len(evs) if len(evs) else None
            row[f"delay_{t}"] = float(np.median(delays)) if delays else None
        sweep.append(row)
    res["sweep"] = sweep
    return res


def _win_start(end: str) -> str:
    return (pd.Timestamp(end) - pd.DateOffset(months=12) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")


def bradford_table(ctx: Context, sim_dir: Path = C.SIM_DIR) -> dict:
    """Les signalements SALARIE de la table anomaly (une seule exécution, fin de période)."""
    a = C.read_csv(ctx.export / "anomaly_table.csv")
    a = a[a["scope"] == "SALARIE"]
    me = _member_events(ctx)
    phases = _phases(sim_dir, ctx.emps)
    rows = []
    for r in a.itertuples():
        ev = me[(me["employee_id"] == r.employee_id) & (me["start"] <= r.period_end) & (me["end"] >= r.period_start)]
        sig = any((int(r.employee_id), mo) in phases for mo in C.month_range(r.period_start[:7], r.period_end[:7]))
        rows.append({"employee_id": int(r.employee_id), "bradford": float(r.observed), "types": sorted(set(ev["type"])), "departure_signal": sig})
    active = int(C.active_at(ctx.emps, a["period_end"].iloc[0], strict_exit=True).sum()) if len(a) else 0
    return {"flags": len(rows), "active": active, "rows": rows}


# --- améliorations prototypées (non intégrées au code TypeScript) -----------------------------------------------


def _short_absence_days(db: Path, cal: pd.DataFrame, max_len: int = 3) -> pd.DataFrame:
    """Jours ouvrés d'absence comptée (hors santé et congés) issus d'épisodes courts (<= max_len jours ouvrés)."""
    with sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True) as c:
        ep = pd.read_sql(
            "SELECT employee_id, start_date, end_date FROM absence_episode "
            "WHERE category IN ('ABSENCE_INJUSTIFIEE','CONGE_SANS_SOLDE','AUTRE') AND julianday(end_date) - julianday(start_date) <= 6",
            c,
        )
    work = cal.loc[cal["working"], "date"].to_numpy()
    rows = []
    for e, a, b in ep.itertuples(index=False):
        i, j = np.searchsorted(work, a, "left"), np.searchsorted(work, b, "right")
        if 0 < j - i <= max_len:
            rows.extend((e, d) for d in work[i:j])
    return pd.DataFrame(rows, columns=["employee_id", "date"])


def pattern_tests(ctx: Context, alpha: float = 0.01, min_count: int = 3, windows: dict | None = None) -> dict:
    """Prototype (non intégré au code TypeScript) : tests binomiaux individuels recalculés chaque mois sur les jours
    d'absence courte comptée d'une fenêtre glissante.
    - lundi_vendredi (fenêtre 3 mois) : part des jours tombant un lundi ou un vendredi, contre la part de ces jours
      parmi les jours ouvrés de la fenêtre ;
    - ponts (fenêtre 6 mois) : part des jours collés à un bloc chômé contenant un férié (dim_date).
    Signal si au moins `min_count` jours ciblés et P(X >= k) < alpha."""
    windows = windows or {"lundi_vendredi": 3, "ponts": 6}
    cal = C.calendar(ctx.db).sort_values("date").reset_index(drop=True)
    cal["working"] = (cal["is_weekend"] == 0) & (cal["is_holiday"] == 0) & (cal["is_bridge"] == 0)
    dow = pd.to_datetime(cal["date"]).dt.dayofweek
    off = ~cal["working"].to_numpy()
    hol = cal["is_holiday"].to_numpy().astype(bool)
    near = np.zeros(len(cal), dtype=bool)
    for i in np.nonzero(~off)[0]:
        for step in (-1, 1):
            j, seen = i + step, False
            while 0 <= j < len(cal) and off[j]:
                seen |= hol[j]
                j += step
            near[i] |= seen
    cal["lundi_vendredi"] = cal["working"] & dow.isin([0, 4])
    cal["ponts"] = cal["working"] & near
    wd = cal[cal["working"]]
    days = _short_absence_days(ctx.db, cal).merge(cal[["date", "lundi_vendredi", "ponts"]], on="date")
    runs = C.read_csv(ctx.export / "bradford_runs.csv")
    me = _member_events(ctx)
    n_units = sum(int(C.active_at(ctx.emps, r.end, strict_exit=True).sum()) for r in runs.itertuples())
    out = {}
    for test, months in windows.items():
        flags = []
        for r in runs.itertuples():
            ws = (pd.Timestamp(r.end) - pd.DateOffset(months=months) + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
            p0 = float(wd.loc[(wd["date"] >= ws) & (wd["date"] <= r.end), test].mean())
            w = days[(days["date"] >= ws) & (days["date"] <= r.end)]
            g = w.groupby("employee_id")[test].agg(["sum", "size"])
            g = g[g["sum"] >= min_count]
            act = set(ctx.emps.loc[C.active_at(ctx.emps, r.end, strict_exit=True), "id"].astype(int))
            for e, row in g.iterrows():
                if int(e) in act and binom_sf(int(row["sum"]), int(row["size"]), p0) < alpha:
                    flags.append((int(e), r.month, r.end, ws))
        f = pd.DataFrame(flags, columns=["employee_id", "month", "end", "win_start"])
        x = f.merge(me.rename(columns={"end": "ev_end"}), on="employee_id")
        x = x[(x["start"] <= x["end"]) & (x["ev_end"] >= x["win_start"])]
        explained = set(zip(x["employee_id"], x["month"]))
        row = {
            "window_months": months,
            "flags": len(f),
            "flag_rate_mean": len(f) / n_units if n_units else None,
            "distinct_employees": int(f["employee_id"].nunique()) if len(f) else 0,
            "precision_units": len(explained) / len(f) if len(f) else None,
        }
        fl = f.groupby("employee_id")[["end", "win_start"]].apply(lambda d: list(zip(d["end"], d["win_start"]))).to_dict() if len(f) else {}
        for t in INDIV_TYPES + TEAM_TYPES:
            evs = me[me["type"] == t]
            hit, delays = 0, []
            for r in evs.itertuples():
                ends = [e for e, ws in fl.get(r.employee_id, []) if e >= r.start and ws <= r.end]
                if ends:
                    hit += 1
                    delays.append(days_between(r.start, min(ends)))
            row[f"recall_{t}"] = hit / len(evs) if len(evs) else None
            row[f"delay_{t}"] = float(np.median(delays)) if delays else None
        out[test] = row
    return out
