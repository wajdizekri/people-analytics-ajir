"""Écriture de l'export AJIR (11 CSV, contrat de docs/CONVENTIONS.md) et du dossier ground_truth/."""
import json
import unicodedata
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C
from . import daily as D
from . import defects as DF
from . import latent as L
from . import names as N
from . import org as O
from . import trainings as TR
from .calendar_tn import day_str

HEADERS = {
    "departments.csv": ["code", "name"],
    "employees.csv": ["matricule", "last_name", "first_name", "sex", "birth_date", "hire_date", "department_code",
                      "job_family", "job_title", "grade", "manager_matricule", "governorate", "marital_status"],
    "contracts.csv": ["matricule", "contract_type", "start_date", "end_date"],
    "exits.csv": ["matricule", "exit_date", "exit_reason", "resignation_date", "recorded_at"],
    "career_events.csv": ["matricule", "date", "event_type", "old_value", "new_value", "recorded_at"],
    "attendance.csv": ["matricule", "date", "check_in", "check_out", "worked_minutes", "overtime_minutes", "late_minutes"],
    "absences.csv": ["matricule", "start_date", "end_date", "days", "category", "recorded_at"],
    "payroll.csv": ["matricule", "month", "base_salary", "gross_salary", "overtime_hours", "recorded_at"],
    "trainings.csv": ["matricule", "training_code", "title", "mandatory", "start_date", "end_date", "due_date", "hours", "status"],
    "evaluations.csv": ["matricule", "eval_date", "score", "recorded_at"],
    "users.csv": ["login", "matricule", "role", "email", "active"],
}
HHMM = np.array([f"{h:02d}:{m:02d}" for h in range(24) for m in range(60)], dtype=object)


def write_csv(df: pd.DataFrame, path: Path, mode="w", header=True):
    df.to_csv(path, sep=";", index=False, encoding="utf-8", lineterminator="\n", mode=mode, header=header)


def opt_days(days) -> np.ndarray:
    days = np.asarray(days, dtype=np.int64)
    return np.where(days >= 0, day_str(np.maximum(days, 0)), "")


def _ascii(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if c.isalnum() and ord(c) < 128).lower()


class Exporter:
    def __init__(self, sim, out_dir):
        self.sim = sim
        self.dir = Path(out_dir)
        self.gt = self.dir / "ground_truth"
        self.gt.mkdir(parents=True, exist_ok=True)
        F = sim.F
        self.emp = np.nonzero(F["hire"][: sim.n] <= sim.end_day)[0]
        self.exported = np.zeros(sim.n, bool)
        self.exported[self.emp] = True
        self.known = set(F["mat"][self.emp])
        self.defects = []
        self.rows = {}
        self.att_rows = 0
        self.episodes = []

    # ------------------------------------------------------------------ fichiers volumineux
    def attendance_sink(self, a, episodes):
        mats = self.sim.F["mat"][a["e"]]
        df = pd.DataFrame({
            "matricule": mats, "date": day_str(a["day"]), "check_in": HHMM[a["check_in"]],
            "check_out": HHMM[np.minimum(a["check_out"], 1439)], "worked_minutes": a["worked"],
            "overtime_minutes": a["ot"], "late_minutes": a["late"],
        })
        out, rec = DF.inject(df, "attendance.csv", self.sim.rng_def, self.known, offset=self.att_rows)
        first = self.att_rows == 0
        write_csv(out, self.dir / "attendance.csv", mode="w" if first else "a", header=first)
        self.att_rows += len(out)
        self.defects += rec
        self.episodes += episodes

    def absences(self):
        sim = self.sim
        if self.episodes:
            ep = {k: np.concatenate([x[k] for x in self.episodes]) for k in self.episodes[0]}
        else:
            ep = {k: np.array([], int) for k in ("e", "start", "end", "days", "cat", "recorded")}
        keep = ep["recorded"] <= sim.extraction_day
        ep = {k: v[keep] for k, v in ep.items()}
        self.abs_table = ep
        df = pd.DataFrame({
            "matricule": sim.F["mat"][ep["e"]], "start_date": day_str(ep["start"]), "end_date": day_str(ep["end"]),
            "days": ep["days"], "category": np.array(D.CATS, dtype=object)[ep["cat"]], "recorded_at": day_str(ep["recorded"]),
        }).sort_values(["matricule", "start_date"], kind="stable")
        out, rec = DF.inject(df, "absences.csv", sim.rng_def, self.known)
        write_csv(out, self.dir / "absences.csv")
        self.defects += rec
        self.rows["absences.csv"] = len(out)

    def payroll(self, agg):
        sim, F, P = self.sim, self.sim.F, self.sim.panel
        e = self.emp
        ex = np.where(F["exit_day"][e] >= 0, F["exit_day"][e], 10**9)
        lo = np.maximum(F["hire"][e][:, None], sim.mstart[None, :])
        hi = np.minimum(ex[:, None], sim.mend[None, :])
        days = np.maximum(hi - lo + 1, 0)
        r, m = np.nonzero(days > 0)
        ee = e[r]
        ct = P["ct"][ee, m]
        sal = P["sal"][ee, m]
        sal = np.where(sal > 0, sal, F["salary"][ee])
        stage = ct == L.CT_STAGE
        base = np.where(stage, F["stipend"][ee], sal)
        prorata = days[r, m] / (sim.mend[m] - sim.mstart[m] + 1)
        ot_h = agg["ot"][ee, m] / 60
        gross = base * prorata - base / 26 * agg["unpaid"][ee, m] + np.where(stage, 0, ot_h * base / C.MONTHLY_HOURS * C.OT_PREMIUM)
        df = pd.DataFrame({
            "matricule": F["mat"][ee], "month": sim.month_str[m], "base_salary": base.round(3),
            "gross_salary": np.maximum(gross, 0).round(3), "overtime_hours": np.where(stage, 0, ot_h).round(2),
            "recorded_at": day_str(sim.mend[m] + 5),
        })
        self.employed = (r, m, ee)
        order = np.lexsort((df["month"].values, df["matricule"].values))
        df = df.iloc[order].reset_index(drop=True)
        elig = np.isin(ct[order], (L.CT_CDI, L.CT_CDD))
        out, rec = DF.inject(df, "payroll.csv", sim.rng_def, self.known, eligible_smig=elig)
        write_csv(out, self.dir / "payroll.csv")
        self.defects += rec
        self.rows["payroll.csv"] = len(out)

    # ------------------------------------------------------------------ référentiels et événements
    def referentials(self):
        sim, F, rng = self.sim, self.sim.F, self.sim.rng_misc
        e = self.emp
        write_csv(pd.DataFrame({"code": [d[0] for d in C.DEPARTMENTS], "name": [d[1] for d in C.DEPARTMENTS]}),
                  self.dir / "departments.csv")
        mgr = np.where(F["alive"][e], sim.manager_of(e), F["mgr_exit"][e])
        emp_df = pd.DataFrame({
            "matricule": F["mat"][e], "last_name": F["last"][e], "first_name": F["first"][e],
            "sex": np.where(F["sex"][e] == 0, "F", "M"), "birth_date": day_str(F["birth"][e]),
            "hire_date": day_str(F["hire"][e]), "department_code": np.array(O.DEPT_CODES, dtype=object)[F["dept"][e]],
            "job_family": np.array(C.FAMILIES, dtype=object)[F["fam"][e]], "job_title": F["title"][e],
            "grade": ["G%d" % g for g in F["grade"][e]],
            "manager_matricule": [F["mat"][x] if x >= 0 else "" for x in mgr],
            "governorate": np.array([g for g, _ in N.GOVERNORATES], dtype=object)[F["gov"][e]],
            "marital_status": np.array(N.MARITAL, dtype=object)[F["marital"][e]],
        }).sort_values("matricule")
        write_csv(emp_df, self.dir / "employees.csv")
        self.rows["employees.csv"] = len(emp_df)

        ct = pd.DataFrame(sim.contracts, columns=["e", "type", "start", "end"])
        ct = ct[(ct["start"] <= sim.end_day) & self.exported[ct["e"]]].drop_duplicates(["e", "start"], keep="last")
        con = pd.DataFrame({
            "matricule": F["mat"][ct["e"].values], "contract_type": np.array(L.CONTRACTS, dtype=object)[ct["type"].values],
            "start_date": day_str(ct["start"].values), "end_date": opt_days(ct["end"].values),
        }).sort_values(["matricule", "start_date"])
        write_csv(con, self.dir / "contracts.csv")
        self.rows["contracts.csv"] = len(con)

        n = sim.n
        true_reason = F["exit_reason"][:n]
        reason = np.array(L.REASONS, dtype=object)[true_reason]
        noisy = (true_reason == L.R_DEM) & (rng.random(n) < sim.p.reason_noise)
        reason = np.where(noisy, "AUTRE", reason)
        show_res = (true_reason == L.R_DEM) & F["resign_kept"][:n] & (F["post_day"][:n] >= 0)
        ed = F["exit_day"][:n]
        lag = rng.integers(0, 16, n)
        rec = np.where(show_res, F["post_day"][:n] + rng.integers(0, 11, n),
                       np.where(true_reason == L.R_RETRAITE, ed - rng.integers(0, 31, n), ed + lag))
        has = (ed >= 0) & (ed <= sim.end_day) & (rec <= sim.extraction_day) & self.exported
        idx = np.nonzero(has)[0]
        ex_df = pd.DataFrame({
            "matricule": F["mat"][idx], "exit_date": day_str(ed[idx]), "exit_reason": reason[idx],
            "resignation_date": opt_days(np.where(show_res[idx], F["post_day"][idx], -1)), "recorded_at": day_str(rec[idx]),
        }).sort_values("matricule")
        write_csv(ex_df, self.dir / "exits.csv")
        self.rows["exits.csv"] = len(ex_df)
        self.exit_export = dict(has=has, reason=reason, show_res=show_res, rec=rec)

        cv = pd.DataFrame(sim.career, columns=["e", "day", "kind", "old", "new", "rec"])
        cv = cv[(cv["day"] <= sim.end_day) & (cv["rec"] <= sim.extraction_day) & self.exported[cv["e"]]]
        cv = cv[cv["day"].values >= F["hire"][cv["e"].values]]
        cv = cv[cv["old"] != cv["new"]]
        cv = cv.groupby(["e", "day", "kind"], sort=False, as_index=False).agg(old=("old", "first"), new=("new", "last"), rec=("rec", "max"))
        cv = cv[cv["old"] != cv["new"]]
        car = pd.DataFrame({
            "matricule": F["mat"][cv["e"].values], "date": day_str(cv["day"].values), "event_type": cv["kind"].values,
            "old_value": cv["old"].values, "new_value": cv["new"].values, "recorded_at": day_str(cv["rec"].values),
        }).sort_values(["matricule", "date", "event_type"])
        write_csv(car, self.dir / "career_events.csv")
        self.rows["career_events.csv"] = len(car)

        ev = pd.DataFrame(sim.evals, columns=["e", "day", "score", "rec"])
        ev = ev[(ev["day"] <= sim.end_day) & (ev["rec"] <= sim.extraction_day) & self.exported[ev["e"]]]
        ev = ev[ev["day"].values >= F["hire"][ev["e"].values]].drop_duplicates(["e", "day"])
        evd = pd.DataFrame({"matricule": F["mat"][ev["e"].values], "eval_date": day_str(ev["day"].values),
                            "score": ev["score"].values, "recorded_at": day_str(ev["rec"].values)}).sort_values(["matricule", "eval_date"])
        write_csv(evd, self.dir / "evaluations.csv")
        self.rows["evaluations.csv"] = len(evd)

        tr = pd.DataFrame(TR.generate(sim), columns=["e", "code", "title", "mand", "start", "end", "due", "hours", "status"])
        trd = pd.DataFrame({
            "matricule": F["mat"][tr["e"].values], "training_code": tr["code"].values, "title": tr["title"].values,
            "mandatory": tr["mand"].values, "start_date": opt_days(tr["start"].values), "end_date": opt_days(tr["end"].values),
            "due_date": opt_days(tr["due"].values), "hours": tr["hours"].values, "status": tr["status"].values,
        }).sort_values(["matricule", "training_code", "start_date"])
        write_csv(trd, self.dir / "trainings.csv")
        self.rows["trainings.csv"] = len(trd)
        self.train_table = trd

        users = [("admin", "", "ADMIN", f"admin@{C.EMAIL_DOMAIN}", 1), ("rh.demo", "", "RH", f"rh.demo@{C.EMAIL_DOMAIN}", 1)]
        seen = set()
        for x in e[F["was_mgr"][e]]:
            base = f"{_ascii(F['first'][x])}.{_ascii(F['last'][x])}"
            mail, k = base, 1
            while mail in seen:
                k += 1
                mail = f"{base}{k}"
            seen.add(mail)
            active = int(bool(F["alive"][x]) and F["manages"][x] >= 0)
            users.append((f"mgr.{F['mat'][x]}", F["mat"][x], "MANAGER", f"{mail}@{C.EMAIL_DOMAIN}", active))
        write_csv(pd.DataFrame(users, columns=HEADERS["users.csv"]), self.dir / "users.csv")
        self.rows["users.csv"] = len(users)

    # ------------------------------------------------------------------ vérité terrain
    def ground_truth(self, plan, stats):
        sim, F, P = self.sim, self.sim.F, self.sim.panel
        cfg = dict(size=sim.size, scenario=sim.scenario, seed=sim.seed, n0=sim.n0, months=sim.T, oracle_reps=sim.reps,
                   start_date=str(sim.cal.days[0]), end_date=C.END_DATE,
                   extraction_date=str(np.int64(sim.extraction_day).astype("datetime64[D]")),
                   smig=C.SMIG, salary_floor=C.SALARY_FLOOR, market_growth=C.MARKET_GROWTH,
                   contract_target=C.CONTRACT_TARGET, params=asdict(sim.p),
                   label_definition="y6 = démission ou abandon dont la date de démission (sinon sortie - 1 mois) "
                                    "tombe dans ]t, t+6 mois] ; t = fin de mois")
        (self.gt / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        (self.gt / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")

        r, m, ee = self.employed
        sig = D.signal_matrix(sim)
        trig, post = F["trig_m"][ee], F["post_m"][ee]
        exit_m = np.where(F["exit_day"][ee] >= 0, sim.month_of(np.maximum(F["exit_day"][ee], 0)), 10**6)
        phase = np.where((post >= 0) & (m > post) & (m <= exit_m), "PREAVIS",
                         np.where((trig >= 0) & (m >= trig) & (sig[ee, m] > 0), "DEPART", ""))
        lat = pd.DataFrame({
            "matricule": F["mat"][ee], "month": sim.month_str[m], "engagement": P["E"][ee, m].round(4),
            "manager_quality": P["mq"][ee, m].round(4), "market_pressure": P["mkt"][ee, m].round(4),
            "personal_shock": P["P"][ee, m].round(4), "overtime_target_h": P["O"][ee, m].round(2), "phase": phase,
        })
        write_csv(lat.iloc[np.lexsort((lat["month"].values, lat["matricule"].values))], self.gt / "latent_monthly.csv")

        parts = []
        for row in getattr(sim, "oracle_table", []):
            parts.append(pd.DataFrame({
                "matricule": F["mat"][row["e"]], "as_of": str(np.int64(sim.mend[row["m"]]).astype("datetime64[D]")),
                "prob6": row["prob"].round(5), "eligible": row["eligible"].astype(int), "y6": row["y6"].astype(int),
                "followup_complete": int(row["complete"]),
            }))
        cols = ["matricule", "as_of", "prob6", "eligible", "y6", "followup_complete"]
        write_csv(pd.concat(parts) if parts else pd.DataFrame(columns=cols), self.gt / "oracle_prob6.csv")

        vol = np.nonzero(F["post_m"][: sim.n] >= 0)[0]
        xe = self.exit_export
        mech = pd.DataFrame({
            "matricule": F["mat"][vol], "exit_reason": np.array(L.REASONS, dtype=object)[F["exit_reason"][vol]],
            "mechanism": np.array(L.MECHANISMS, dtype=object)[F["mech"][vol]],
            "trigger_month": sim.month_str[F["trig_m"][vol]], "resignation_date": day_str(F["post_day"][vol]),
            "exit_date": day_str(F["exit_day"][vol]), "engagement_at_trigger": F["E_trig"][vol].round(4),
            "exported": xe["has"][vol].astype(int), "exported_reason": np.where(xe["has"][vol], xe["reason"][vol], ""),
            "resignation_date_exported": (xe["has"][vol] & xe["show_res"][vol]).astype(int),
        }).sort_values("resignation_date")
        write_csv(mech, self.gt / "mechanisms.csv")

        an = pd.DataFrame(plan.rows)
        if len(an):
            an = pd.DataFrame({
                "anomaly_id": an["anomaly_id"], "type": an["type"], "scope": an["scope"],
                "department_code": an["department_code"],
                "manager_matricule": [F["mat"][x] if x >= 0 else "" for x in an["manager"]],
                "matricule": F["mat"][an["e"].values], "start_date": day_str(an["start"].values),
                "end_date": day_str(an["end"].values), "injected_days": an["injected_days"], "held_out": an["held_out"],
            })
        write_csv(an, self.gt / "anomalies.csv")
        dfd = pd.DataFrame(self.defects, columns=["file", "line", "defect_type", "matricule", "detail"])
        write_csv(dfd.sort_values(["file", "line"]), self.gt / "defects.csv")
        cal = pd.DataFrame(sim.cal.dim_date_rows())
        write_csv(cal, self.gt / "calendar.csv")
        (self.gt / "README.txt").write_text(
            "Vérité terrain du simulateur : ne jamais importer dans l'application.\n", encoding="utf-8")
