"""Moteur de projection (stock-flux + régression de masse). Même suite d'opérations que src/lib/ai/workforce/engine.ts :
toute modification doit être reportée des deux côtés (parité vérifiée par golden.json)."""
import math

CAUSES = ("resign", "other", "cdd", "retire", "known")


def month_index(ym: str) -> int:
    return int(ym[:4]) * 12 + int(ym[5:7]) - 1


def month_label(idx: int) -> str:
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def _series(n: int) -> list[float]:
    return [0.0] * n


def _interval(q: dict, source: str) -> dict:
    return q.get(source) or q["TAUX"]


def project(bundle_e: dict, bundle_m: dict | None, state: dict, scenario: dict) -> dict:
    H = int(bundle_e["horizon"])
    m0 = month_index(state["month0"])
    months = [month_label(m0 + k) for k in range(1, H + 1)]
    p6_months = float(bundle_e["prob6_months"])
    hiring = float(scenario.get("hiringPct", 100.0)) / 100.0
    raise_ = scenario.get("raise")
    raise_ = float(state["raise"]) if raise_ is None else float(raise_)
    drift = float(state["drift"])
    q_cdd = float(state["qCdd"])
    q_ret = float(state["qRet"])
    source = state["resignSource"]
    qe = _interval(bundle_e["interval"], source)
    qm = _interval(bundle_m["interval"], source) if bundle_m else None

    factor = []
    jan = 0
    for k in range(1, H + 1):
        if (m0 + k) % 12 == 0:
            jan += 1
        factor.append(math.pow(1.0 + raise_, jan) * math.pow(1.0 + drift, k))

    depts = []
    grades: dict[str, dict] = {}
    for d in state["departments"]:
        depts.append({
            "id": d["id"], "code": d["code"], "name": d["name"], "hc0": float(d["hc0"]), "mass0": d["mass0"],
            "members": _series(H), "var": _series(H), "base": _series(H), "hiresHc": _series(H),
            "exits": {c: _series(H) for c in CAUSES}, "hires": _series(H),
        })

    for mb in state["members"]:
        acc = depts[mb["d"]]
        dep = state["departments"][mb["d"]]
        p6 = mb["p6"]
        h = 1.0 - math.pow(1.0 - p6, 1.0 / p6_months) if p6 is not None else float(dep["resignRate"])
        o = float(dep["otherRate"])
        base = float(mb["base"])
        g = mb["grade"] or "?"
        gr = grades.setdefault(g, {"grade": g, "hc0": 0.0, "base0": 0.0, "hc12": 0.0})
        gr["hc0"] += 1.0
        gr["base0"] += base
        s = 1.0
        for k in range(1, H + 1):
            i = k - 1
            if mb["known"] is not None:
                if k == mb["known"]:
                    acc["exits"]["known"][i] += s
                    s = 0.0
            else:
                r = s * h
                acc["exits"]["resign"][i] += r
                s1 = s - r
                x = s1 * o
                acc["exits"]["other"][i] += x
                s1 = s1 - x
                if mb["cdd"] == k:
                    c = s1 * q_cdd
                    acc["exits"]["cdd"][i] += c
                    s1 = s1 - c
                if mb["ret"] == k:
                    t = s1 * q_ret
                    acc["exits"]["retire"][i] += t
                    s1 = s1 - t
                s = s1
            acc["members"][i] += s
            acc["var"][i] += s * (1.0 - s)
            acc["base"][i] += s * base
        gr["hc12"] += s

    level_total = state.get("levelTotal")
    out_depts = []
    for acc, dep in zip(depts, state["departments"]):
        r = float(dep["resignRate"])
        o = float(dep["otherRate"])
        hires_m = float(dep["hiresPerMonth"]) * hiring
        prev = 0.0
        hc, sd, lo, up = _series(H), _series(H), _series(H), _series(H)
        for k in range(1, H + 1):
            i = k - 1
            er = prev * r
            eo = (prev - er) * o
            acc["exits"]["resign"][i] += er
            acc["exits"]["other"][i] += eo
            cur = prev - er - eo + hires_m
            acc["hiresHc"][i] = cur
            acc["hires"][i] = hires_m
            prev = cur
            hc[i] = acc["members"][i] + cur
            v = acc["var"][i] + cur
            acc["var"][i] = v
            sd[i] = math.sqrt(v)
            hw = float(qe["dept"][i]) * sd[i]
            lo[i] = max(0.0, hc[i] - hw)
            up[i] = hc[i] + hw
        mass = mlo = mup = None
        level = dep.get("level")
        if level is None:
            level = level_total
        if bundle_m is not None and level is not None:
            mass, mlo, mup = _series(H), _series(H), _series(H)
            hire_sal = float(dep["hireSalary"])
            for k in range(1, H + 1):
                i = k - 1
                b = factor[i] * (acc["base"][i] + acc["hiresHc"][i] * hire_sal)
                acc["base"][i] = b
                mass[i] = b * math.exp(float(level) + float(bundle_m["season"][(m0 + k) % 12]))
                hw = float(qm["dept"][i]) * mass[i]
                mlo[i] = max(0.0, mass[i] - hw)
                mup[i] = mass[i] + hw
        out_depts.append({
            "id": dep["id"], "code": dep["code"], "name": dep["name"], "hc0": acc["hc0"], "mass0": acc["mass0"],
            "hc": hc, "hcSd": sd, "hcLower": lo, "hcUpper": up,
            "exits": acc["exits"], "hires": acc["hires"],
            "mass": mass, "massLower": mlo, "massUpper": mup,
        })

    tot_hc, tot_sd, tot_lo, tot_up = _series(H), _series(H), _series(H), _series(H)
    tot_exits = {c: _series(H) for c in CAUSES}
    tot_hires = _series(H)
    with_mass = bundle_m is not None and len(out_depts) > 0 and all(d["mass"] is not None for d in out_depts)
    tot_mass = _series(H) if with_mass else None
    tot_mlo = _series(H) if with_mass else None
    tot_mup = _series(H) if with_mass else None
    for i in range(H):
        v = 0.0
        for d, acc in zip(out_depts, depts):
            tot_hc[i] += d["hc"][i]
            v += acc["var"][i]
            tot_hires[i] += d["hires"][i]
            for c in CAUSES:
                tot_exits[c][i] += d["exits"][c][i]
            if with_mass:
                tot_mass[i] += d["mass"][i]
        tot_sd[i] = math.sqrt(v)
        hw = float(qe["total"][i]) * tot_sd[i]
        tot_lo[i] = max(0.0, tot_hc[i] - hw)
        tot_up[i] = tot_hc[i] + hw
        if with_mass:
            hwm = float(qm["total"][i]) * tot_mass[i]
            tot_mlo[i] = max(0.0, tot_mass[i] - hwm)
            tot_mup[i] = tot_mass[i] + hwm
    mass0 = [d["mass0"] for d in out_depts]
    total = {
        "hc0": sum(d["hc0"] for d in out_depts),
        "mass0": sum(mass0) if mass0 and all(m is not None for m in mass0) else None,
        "hc": tot_hc, "hcSd": tot_sd, "hcLower": tot_lo, "hcUpper": tot_up,
        "exits": tot_exits, "hires": tot_hires,
        "mass": tot_mass, "massLower": tot_mlo, "massUpper": tot_mup,
    }
    by_grade = []
    for g in sorted(grades):
        gr = grades[g]
        by_grade.append({"grade": g, "hc0": gr["hc0"], "avgBase0": gr["base0"] / gr["hc0"], "hc12": gr["hc12"]})
    return {"months": months, "raise": raise_, "hiringPct": hiring * 100.0, "departments": out_depts, "total": total, "byGrade": by_grade}
