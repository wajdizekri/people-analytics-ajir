// Fêtes religieuses tunisiennes par année de l'Hégire (dates grégoriennes du 1er jour).
// Base : calendrier Umm al-Qura, corrigée quand la date retenue en Tunisie est connue
// (annonce du Mufti de la République, observation locale) : 1444 Aïd el-Fitr = 22/04/2023.
// Dates estimées : à relire chaque année et ajuster ici, puis relancer buildCalendar.
// ramadan = 1er Ramadan ; le Ramadan se termine la veille de l'Aïd el-Fitr.
// Aïd el-Fitr et Aïd el-Idha : 2 jours fériés à partir de la date indiquée.
export type HijriYearDates = {
  rasElAm: string; // 1er Moharram
  mouled: string; // 12 Rabia el Awal
  ramadan: string; // 1er Ramadan
  fitr: string; // 1er Chawal
  idha: string; // 10 Dhou el Hijja
};

export const TN_HIJRI_DATES: Record<number, HijriYearDates> = {
  1440: { rasElAm: "2018-09-11", mouled: "2018-11-20", ramadan: "2019-05-06", fitr: "2019-06-04", idha: "2019-08-11" },
  1441: { rasElAm: "2019-08-31", mouled: "2019-11-09", ramadan: "2020-04-24", fitr: "2020-05-24", idha: "2020-07-31" },
  1442: { rasElAm: "2020-08-20", mouled: "2020-10-29", ramadan: "2021-04-13", fitr: "2021-05-13", idha: "2021-07-20" },
  1443: { rasElAm: "2021-08-09", mouled: "2021-10-18", ramadan: "2022-04-02", fitr: "2022-05-02", idha: "2022-07-09" },
  1444: { rasElAm: "2022-07-30", mouled: "2022-10-08", ramadan: "2023-03-23", fitr: "2023-04-22", idha: "2023-06-28" },
  1445: { rasElAm: "2023-07-19", mouled: "2023-09-27", ramadan: "2024-03-11", fitr: "2024-04-10", idha: "2024-06-16" },
  1446: { rasElAm: "2024-07-07", mouled: "2024-09-15", ramadan: "2025-03-01", fitr: "2025-03-30", idha: "2025-06-06" },
  1447: { rasElAm: "2025-06-26", mouled: "2025-09-04", ramadan: "2026-02-18", fitr: "2026-03-20", idha: "2026-05-27" },
  1448: { rasElAm: "2026-06-16", mouled: "2026-08-25", ramadan: "2027-02-08", fitr: "2027-03-09", idha: "2027-05-16" },
  1449: { rasElAm: "2027-06-06", mouled: "2027-08-14", ramadan: "2028-01-28", fitr: "2028-02-26", idha: "2028-05-05" },
  1450: { rasElAm: "2028-05-25", mouled: "2028-08-03", ramadan: "2029-01-16", fitr: "2029-02-14", idha: "2029-04-24" },
  1451: { rasElAm: "2029-05-14", mouled: "2029-07-24", ramadan: "2030-01-05", fitr: "2030-02-04", idha: "2030-04-13" },
  1452: { rasElAm: "2030-05-04", mouled: "2030-07-13", ramadan: "2030-12-26", fitr: "2031-01-24", idha: "2031-04-02" },
};

// Années grégoriennes entièrement couvertes par la table ; hors plage, repli sur Umm al-Qura (Intl).
export const TN_TABLE_FIRST_YEAR = 2019;
export const TN_TABLE_LAST_YEAR = 2030;

// Fête de la Révolution : 14 janvier jusqu'en 2021 inclus, puis 17 décembre à partir de 2021
// (décret présidentiel n° 2021-223 du 7 décembre 2021, JORT ; le 17/12/2021 a été le premier chômé).
export const REVOLUTION_JAN14_LAST_YEAR = 2021;
export const REVOLUTION_DEC17_FIRST_YEAR = 2021;

export const FIXED_HOLIDAYS: { md: string; name: string; from?: number; to?: number }[] = [
  { md: "01-01", name: "Nouvel An" },
  { md: "01-14", name: "Fête de la Révolution et de la Jeunesse", to: REVOLUTION_JAN14_LAST_YEAR },
  { md: "03-20", name: "Fête de l'Indépendance" },
  { md: "04-09", name: "Journée des Martyrs" },
  { md: "05-01", name: "Fête du Travail" },
  { md: "07-25", name: "Fête de la République" },
  { md: "08-13", name: "Fête de la Femme" },
  { md: "10-15", name: "Fête de l'Évacuation" },
  { md: "12-17", name: "Fête de la Révolution", from: REVOLUTION_DEC17_FIRST_YEAR },
];

// Séance unique d'été (secteur public) : 1er juillet - 31 août
export const SUMMER_SEANCE_UNIQUE = { from: "07-01", to: "08-31" };
