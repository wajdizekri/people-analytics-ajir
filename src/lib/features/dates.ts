const DAY_MS = 86_400_000;

export function toDay(date: string): number {
  return Math.floor(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / DAY_MS);
}

export function fromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isMonthEnd(date: string): boolean {
  return +date.slice(8, 10) === daysInMonth(+date.slice(0, 4), +date.slice(5, 7));
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function monthEnd(month: string): string {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return `${month.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

export function monthStart(month: string): string {
  return `${month.slice(0, 7)}-01`;
}

export function addMonthsToMonth(month: string, n: number): string {
  const idx = +month.slice(0, 4) * 12 + (+month.slice(5, 7) - 1) + n;
  return `${String(Math.floor(idx / 12)).padStart(4, "0")}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

// Une fin de mois reste une fin de mois (31/08 - 2 mois = 30/06) ; sinon le jour est borné.
export function addMonths(date: string, n: number): string {
  const target = addMonthsToMonth(date.slice(0, 7), n);
  const dim = daysInMonth(+target.slice(0, 4), +target.slice(5, 7));
  const day = isMonthEnd(date) ? dim : Math.min(+date.slice(8, 10), dim);
  return `${target}-${String(day).padStart(2, "0")}`;
}

export function monthsBetween(from: string, to: string): number {
  let m = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7));
  if (+to.slice(8, 10) < +from.slice(8, 10) && !isMonthEnd(to)) m -= 1;
  return m;
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonthsToMonth(m, 1)) out.push(m);
  return out;
}

export function normalizeAsOf(asOf: string): string {
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(asOf)) throw new Error(`Date de coupure invalide : ${asOf}`);
  return monthEnd(asOf.slice(0, 7));
}

// 0 = dimanche … 6 = samedi (le 01/01/1970 était un jeudi)
export function dayOfWeek(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function mondayOf(day: number): number {
  return day - ((dayOfWeek(day) + 6) % 7);
}

export function frDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}
