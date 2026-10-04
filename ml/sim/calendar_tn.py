"""Calendrier tunisien réel : fériés (dont fêtes religieuses), Ramadan, séance unique, ponts."""
import datetime as dt

import holidays
import numpy as np

NORMAL, RAMADAN, SEANCE_UNIQUE = 0, 1, 2
# (arrivée, départ, pause) en minutes depuis minuit
SCHEDULE = {NORMAL: (480, 1020, 60), RAMADAN: (480, 840, 0), SEANCE_UNIQUE: (450, 810, 0)}

HOLIDAY_FR = {
    "New Year's Day": "Jour de l'an",
    "Revolution and Youth Day": "Fête de la Révolution et de la Jeunesse",
    "Independence Day": "Fête de l'Indépendance",
    "Martyrs' Day": "Journée des Martyrs",
    "Labor Day": "Fête du Travail",
    "Eid al-Fitr": "Aïd el-Fitr",
    "Eid al-Fitr Holiday": "Aïd el-Fitr (congé)",
    "Republic Day": "Fête de la République",
    "Women's Day": "Fête de la Femme",
    "Day of Arafah": "Jour d'Arafa",
    "Eid al-Adha": "Aïd el-Idha",
    "Eid al-Adha Holiday": "Aïd el-Idha (congé)",
    "Islamic New Year": "Nouvel an de l'Hégire",
    "Evacuation Day": "Fête de l'Évacuation",
    "Prophet's Birthday": "Mouled",
}


def _fr(name: str) -> str:
    parts = [p.strip().replace(" (estimated)", "") for p in name.split(";")]
    return " ; ".join(HOLIDAY_FR.get(p, p) for p in parts)


def to_day(d) -> np.ndarray:
    return np.asarray(d, dtype="datetime64[D]").astype(np.int64)


def day_str(days) -> np.ndarray:
    return np.datetime_as_string(np.asarray(days, dtype=np.int64).astype("datetime64[D]"))


def add_months(days, k) -> np.ndarray:
    d = np.asarray(days, dtype=np.int64).astype("datetime64[D]")
    mo = d.astype("datetime64[M]")
    dom = (d - mo.astype("datetime64[D]")).astype(np.int64)
    tgt = mo + np.asarray(k, dtype=np.int64)
    last = ((tgt + 1).astype("datetime64[D]") - tgt.astype("datetime64[D]")).astype(np.int64) - 1
    return (tgt.astype("datetime64[D]") + np.minimum(dom, last)).astype(np.int64)


def add_years(days, k) -> np.ndarray:
    return add_months(days, np.asarray(k, dtype=np.int64) * 12)


class TunisianCalendar:
    def __init__(self, start_month: np.datetime64, end: np.datetime64):
        start = start_month.astype("datetime64[D]")
        self.start_month = start_month
        self.days = np.arange(start, end + 1, dtype="datetime64[D]")
        self.d0 = int(self.days[0].astype(np.int64))
        ints = self.days.astype(np.int64)
        n = len(ints)
        self.weekday = (ints + 3) % 7  # 0 = lundi
        y0, y1 = int(str(self.days[0])[:4]), int(str(self.days[-1])[:4])
        hol = holidays.country_holidays("TN", years=range(y0 - 1, y1 + 2), language="en_US")
        pyd = self.days.astype(dt.date)
        names = [hol.get(d) for d in pyd]
        self.is_holiday = np.array([x is not None for x in names])
        self.holiday_name = np.array([_fr(x) if x else "" for x in names], dtype=object)
        self.is_weekend = self.weekday >= 5
        eids = sorted(
            np.datetime64(d)
            for d, nm in hol.items()
            if any(p.strip().replace(" (estimated)", "") == "Eid al-Fitr" for p in nm.split(";"))
        )
        self.is_ramadan = np.zeros(n, bool)
        for e in eids:  # Ramadan : les 30 jours précédant l'Aïd el-Fitr
            lo, hi = (e - 30 - start).astype(int), (e - 1 - start).astype(int)
            lo, hi = max(lo, 0), min(hi, n - 1)
            if lo <= hi:
                self.is_ramadan[lo : hi + 1] = True
        moy = self.days.astype("datetime64[M]").astype(np.int64) % 12 + 1
        self.moy = moy
        self.is_seance_unique = ((moy == 7) | (moy == 8)) & ~self.is_ramadan
        self.is_working = ~self.is_weekend & ~self.is_holiday
        off = ~self.is_working
        prev_off = np.r_[False, off[:-1]]
        next_off = np.r_[off[1:], False]
        # Pont : jour ouvré isolé entre deux jours chômés dont au moins un férié
        hol_near = np.r_[False, self.is_holiday[:-1]] | np.r_[self.is_holiday[1:], False]
        self.is_bridge = self.is_working & prev_off & next_off & hol_near
        # Jour ouvré collé à un bloc chômé qui contient un férié (avant ou après)
        self.near_holiday = np.zeros(n, bool)
        w = self.is_working
        for i in np.nonzero(w)[0]:
            for step in (-1, 1):
                j, seen_hol = i + step, False
                while 0 <= j < n and not w[j]:
                    seen_hol |= bool(self.is_holiday[j])
                    j += step
                if seen_hol:
                    self.near_holiday[i] = True
        self.day_type = np.where(self.is_ramadan, RAMADAN, np.where(self.is_seance_unique, SEANCE_UNIQUE, NORMAL))
        self.month_idx = (self.days.astype("datetime64[M]") - start_month).astype(np.int64)

        wd = np.nonzero(self.is_working)[0]
        self.wd_days = ints[wd]
        self.wd_month = self.month_idx[wd]
        self.wd_moy = moy[wd]
        self.wd_type = self.day_type[wd]
        self.wd_weekday = self.weekday[wd]
        self.wd_bridge = self.is_bridge[wd]
        self.wd_near_hol = self.near_holiday[wd] | self.wd_bridge
        sched = np.array([SCHEDULE[t] for t in (NORMAL, RAMADAN, SEANCE_UNIQUE)])
        self.wd_start, self.wd_end, self.wd_break = sched[self.wd_type].T
        n_months = int(self.month_idx[-1]) + 1
        self.n_months = n_months
        self.wd_first = np.searchsorted(self.wd_month, np.arange(n_months), "left")
        self.wd_count = np.searchsorted(self.wd_month, np.arange(n_months), "right") - self.wd_first
        self.n_wd = len(wd)

    def random_wd(self, rng, m: int, after: int | None = None) -> int | None:
        lo, k = self.wd_first[m], self.wd_count[m]
        days = self.wd_days[lo : lo + k]
        if after is not None:
            days = days[days > after]
        if len(days) == 0:
            return None
        return int(days[rng.integers(len(days))])

    def wd_index(self, days, side="left") -> np.ndarray:
        return np.searchsorted(self.wd_days, np.asarray(days, dtype=np.int64), side)

    def dim_date_rows(self):
        return {
            "date": np.datetime_as_string(self.days),
            "is_weekend": self.is_weekend.astype(int),
            "is_holiday": self.is_holiday.astype(int),
            "holiday_name": self.holiday_name,
            "is_ramadan": self.is_ramadan.astype(int),
            "is_bridge": self.is_bridge.astype(int),
            "is_seance_unique": self.is_seance_unique.astype(int),
        }
