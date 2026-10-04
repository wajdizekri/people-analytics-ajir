"""État de la projection à une fin de mois : même calcul que src/lib/ai/workforce/state.ts (requêtes partagées)."""
import math

from .engine import month_index, month_label
from .queries import rows

RESIGN = ("DEMISSION", "ABANDON")
OTHER = ("LICENCIEMENT", "DECES", "MUTATION", "AUTRE")


def month_start(ym: str) -> str:
    return f"{ym}-01"


def month_end(ym: str) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    days = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return f"{ym}-{days:02d}"


def shift(ym: str, n: int) -> str:
    return month_label(month_index(ym) + n)


def _k(date: str | None, m0: int) -> int | None:
    return None if not date else month_index(date[:7]) - m0


def build_state(con, as_of: str, bundle_e: dict, bundle_m: dict | None, prob6: dict | None = None) -> dict:
    H = int(bundle_e["horizon"])
    w = bundle_e["windows"]
    ret = bundle_e["retirement"]
    m0s = as_of[:7]
    m0 = month_index(m0s)
    ret_age = f"+{int(ret['age'])} years"
    ret_lag = f"+{int(ret['lag_days'])} days"

    depts = rows(con, "departments")
    index = {d["id"]: i for i, d in enumerate(depts)}
    agg = rows(con, "aggregates", {"from": shift(m0s, -int(w["rates_months"])), "to": m0s})
    agg_months = sorted({a["month"] for a in agg})
    hc_by = {(a["month"], a["department_id"]): a["headcount"] for a in agg}

    first_rate = shift(m0s, -int(w["rates_months"]) + 1)
    if agg_months and shift(agg_months[0], 1) > first_rate:
        first_rate = shift(agg_months[0], 1)
    rate_months = [month_label(i) for i in range(month_index(first_rate), m0 + 1)] if first_rate <= m0s else []
    denom = [0.0] * len(depts)
    for m in rate_months:
        prev = shift(m, -1)
        for d in depts:
            denom[index[d["id"]]] += hc_by.get((prev, d["id"]), 0)
    resign = [0.0] * len(depts)
    other = [0.0] * len(depts)
    if rate_months:
        for x in rows(con, "exits", {"fromDate": month_start(rate_months[0]), "toDate": as_of}):
            i = index.get(x["department_id"])
            if i is None:
                continue
            if x["reason"] in RESIGN:
                resign[i] += x["n"]
            elif x["reason"] in OTHER:
                other[i] += x["n"]
    den_all = sum(denom)
    resign_all = sum(resign) / den_all if den_all > 0 else 0.0
    other_all = sum(other) / den_all if den_all > 0 else 0.0

    hire_from = shift(m0s, -int(w["hires_months"]) + 1)
    hire_months = [m for m in agg_months if hire_from <= m <= m0s]
    entries = [0.0] * len(depts)
    for a in agg:
        if hire_from <= a["month"] <= m0s and a["department_id"] in index:
            entries[index[a["department_id"]]] += a["entries"]
    mass0 = {a["department_id"]: a["payroll_mass"] for a in agg if a["month"] == m0s}

    members = rows(con, "members", {"asOf": as_of, "m0": m0s, "retAge": ret_age, "retLag": ret_lag})
    members = [mb for mb in members if mb["department_id"] in index]
    sal_from = month_start(shift(m0s, -int(w["hire_salary_months"]) + 1))
    dept_base = [[0.0, 0] for _ in depts]
    hire_base = [[0.0, 0] for _ in depts]
    for mb in members:
        if mb["base"] is None:
            continue
        i = index[mb["department_id"]]
        dept_base[i][0] += mb["base"]
        dept_base[i][1] += 1
        if mb["work_start"] >= sal_from:
            hire_base[i][0] += mb["base"]
            hire_base[i][1] += 1
    hire_all_n = sum(h[1] for h in hire_base)
    hire_all = sum(h[0] for h in hire_base) / hire_all_n if hire_all_n else None
    base_all_n = sum(b[1] for b in dept_base)
    base_all = sum(b[0] for b in dept_base) / base_all_n if base_all_n else 0.0

    min_hires = int(w["min_hires_salary"])
    departments = []
    for i, d in enumerate(depts):
        avg_base = dept_base[i][0] / dept_base[i][1] if dept_base[i][1] else base_all
        if hire_base[i][1] >= min_hires:
            hire_sal = hire_base[i][0] / hire_base[i][1]
        elif hire_all is not None:
            hire_sal = hire_all
        else:
            hire_sal = avg_base
        departments.append({
            "id": d["id"], "code": d["code"], "name": d["name"], "hc0": 0, "mass0": mass0.get(d["id"]),
            "resignRate": resign[i] / denom[i] if denom[i] > 0 else resign_all,
            "otherRate": other[i] / denom[i] if denom[i] > 0 else other_all,
            "hiresPerMonth": entries[i] / len(hire_months) if hire_months else 0.0,
            "hireSalary": hire_sal, "avgBase": avg_base, "level": None,
        })

    source = "LOGREG" if prob6 is not None else "TAUX"
    out_members = []
    for mb in members:
        i = index[mb["department_id"]]
        departments[i]["hc0"] += 1
        known = _k(mb["known_exit"], m0)
        cdd = _k(mb["contract_end"], m0) if mb["contract_type"] == "CDD" and mb["contract_end"] and mb["contract_end"] > as_of else None
        rk = _k(mb["retire_date"], m0)
        out_members.append({
            "d": i,
            "base": mb["base"] if mb["base"] is not None else departments[i]["avgBase"],
            "p6": prob6.get(mb["id"]) if prob6 is not None else None,
            "cdd": cdd if cdd is not None and 1 <= cdd <= H else None,
            "ret": rk if rk is not None and 1 <= rk <= H else None,
            "known": known,
            "grade": mb["grade"],
        })

    cdd_rows = rows(con, "cdd", {"fromDate": month_start(shift(m0s, -int(w["cdd_months"]))), "toDate": month_end(shift(m0s, -1))})[0]
    q_cdd = cdd_rows["exits"] / cdd_rows["ends"] if cdd_rows["ends"] >= int(bundle_e["cdd"]["min_cases"]) else float(bundle_e["cdd"]["q_prior"])
    data_start = month_start(agg_months[0]) if agg_months else as_of
    ret_rows = rows(con, "retirement", {"fromDate": data_start, "toDate": month_end(shift(m0s, -1)), "retAge": ret_age})[0]
    q_ret = ret_rows["retired"] / ret_rows["reached"] if ret_rows["reached"] >= int(ret["min_cases"]) else float(ret["q_prior"])

    raise_ = None
    growth = []
    for g in rows(con, "salaryGrowth", {"from": shift(m0s, -11), "to": m0s}):
        if not g["prev"]:
            continue
        rate = g["cur"] / g["prev"] - 1.0
        if g["month"].endswith("-01"):
            raise_ = rate
        else:
            growth.append(rate)
    fallback = float(bundle_m["raise_fallback"]) if bundle_m else 0.0
    state = {
        "asOf": as_of, "month0": m0s, "resignSource": source, "qCdd": q_cdd, "qRet": q_ret,
        "raise": raise_ if raise_ is not None else fallback,
        "drift": sum(growth) / len(growth) if growth else 0.0,
        "levelTotal": None, "departments": departments, "members": out_members,
    }
    if bundle_m is not None:
        _levels(con, state, bundle_m, index, m0s)
    return state


def _levels(con, state: dict, bundle_m: dict, index: dict, m0s: str) -> None:
    lo = shift(m0s, -int(bundle_m["windows"]["level_months"]) + 1)
    base = {(b["month"], b["department_id"]): b["base"] for b in rows(con, "baseMass", {"from": lo, "to": m0s})}
    agg = rows(con, "aggregates", {"from": lo, "to": m0s})
    season = bundle_m["season"]
    sums = [[0.0, 0] for _ in state["departments"]]
    tot: dict[str, list[float]] = {}
    for a in agg:
        i = index.get(a["department_id"])
        b = base.get((a["month"], a["department_id"]))
        if i is None or b is None or not b > 0 or not a["payroll_mass"] > 0:
            continue
        s = float(season[month_index(a["month"]) % 12])
        sums[i][0] += math.log(a["payroll_mass"]) - math.log(b) - s
        sums[i][1] += 1
        t = tot.setdefault(a["month"], [0.0, 0.0])
        t[0] += a["payroll_mass"]
        t[1] += b
    for d, (s, n) in zip(state["departments"], sums):
        d["level"] = s / n if n else None
    vals = [math.log(m) - math.log(b) - float(season[month_index(mo) % 12]) for mo, (m, b) in sorted(tot.items()) if m > 0 and b > 0]
    state["levelTotal"] = sum(vals) / len(vals) if vals else None
