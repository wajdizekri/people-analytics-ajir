import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { SETTINGS_UI, SETTING_GROUPS, boundsLabel, fieldChange, inputError, parseNum, pendingLabel } from "@/components/admin/settings-labels";
import { activeIndex } from "@/components/admin/settings-nav";
import { budgetErrors, budgetInit, budgetKey, budgetSummary, budgetYears, smigErrors, smigInit, smigKey, smigTimeline } from "@/components/admin/settings-tables";

const NBSP = "\u00a0";
// Espaces insécables (dont l'espace fine des milliers) ramenées à des espaces simples
const plain = (s: string) => s.replace(/\s+/g, " ");
const sentences = (s: string) => s.split(/(?<=[.!?])\s+/).filter(Boolean);
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

describe("paramètres : textes courts", () => {
  const ctx = { nScored: 987, asOf: "2026-08-31", lastQuality: 0.981, values: { workload_ot_months: 3, workload_ot_threshold_h: 20 } };

  it("chaque paramètre : libellé, bulle d'aide, effet en quelques mots (12 au plus, sans phrase)", () => {
    for (const [key, ui] of Object.entries(SETTINGS_UI)) {
      expect(ui.label.length, key).toBeGreaterThan(0);
      expect(ui.help.length, key).toBeGreaterThan(0);
      expect("short" in ui, key).toBe(false);
      const effect = ui.effect(Number(DEFAULT_SETTINGS[key]), ctx);
      expect(words(effect), `${key} : ${effect}`).toBeLessThanOrEqual(12);
      expect(sentences(effect), `${key} : ${effect}`).toHaveLength(1);
      expect(effect, key).not.toMatch(/\.$/);
    }
  });

  it("chaque thème : un titre et un libellé court de navigation, sans paragraphe d'introduction", () => {
    const keys = SETTING_GROUPS.flatMap((g) => g.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(Object.keys(SETTINGS_UI).sort());
    expect(new Set(SETTING_GROUPS.map((g) => g.id)).size).toBe(SETTING_GROUPS.length);
    for (const g of SETTING_GROUPS) {
      expect(words(g.nav), g.id).toBeLessThanOrEqual(3);
      expect(g.nav.length, g.id).toBeLessThanOrEqual(g.title.length);
      expect("intro" in g, g.id).toBe(false);
    }
  });

  it("effets concrets conservés (capacité, qualité du dernier import)", () => {
    expect(SETTINGS_UI.capacity_rate.effect(0.02, ctx)).toBe("≈ 20 classés Élevé sur 987 évalués (calcul du 31/08/2026)");
    expect(SETTINGS_UI.quality_threshold.effect(0.95, ctx)).toBe(`Dernier import (98,1${NBSP}%) : accepté`);
    expect(SETTINGS_UI.quality_threshold.effect(0.99, ctx)).toBe(`Dernier import (98,1${NBSP}%) : bloqué`);
    expect(SETTINGS_UI.quality_threshold.effect(0.95, { ...ctx, lastQuality: null })).toBe(`Import bloqué sous 95${NBSP}%`);
  });
});

describe("paramètres : bornes compactes et saisie", () => {
  it("bornes dans l'unité affichée : « 0,5 à 20 % »", () => {
    expect(boundsLabel("capacity_rate", 0.005, 0.2)).toBe(`0,5 à 20${NBSP}%`);
    expect(boundsLabel("abs_reco_ecart_min", 0, 0.05)).toBe(`0 à 5${NBSP}points`);
    expect(boundsLabel("medium_lift", 1, 10)).toBe(`1 à 10${NBSP}fois`);
    expect(plain(boundsLabel("smig_monthly", 100, 5000))).toBe("100 à 5 000 TND");
  });

  it("saisie à la française ou à l'anglaise", () => {
    expect(parseNum(" 1 234,5 ")).toBe(1234.5);
    expect(parseNum("0.2")).toBe(0.2);
    expect(parseNum("abc")).toBeNaN();
  });
});

describe("barème SMIG : contrôles immédiats et lecture en clair", () => {
  it("lecture en clair, triée par date d'effet", () => {
    expect(smigTimeline([{ from: "2026-01-01", value: 554.736 }, { from: null, value: 528.32 }])).toBe("528,32 TND jusqu'au 31/12/2025, puis 554,736 TND à partir du 01/01/2026");
    expect(smigTimeline([{ from: null, value: 528.32 }])).toBe("528,32 TND sans limite de date");
    expect(smigTimeline([{ from: "2025-03-01", value: 500 }, { from: "2026-01-01", value: 554.736 }])).toBe("500 TND du 01/03/2025 au 31/12/2025, puis 554,736 TND à partir du 01/01/2026");
  });

  it("une seule période sans date, pas de date en double, montant dans les bornes", () => {
    expect(smigErrors(smigInit([{ from: null, value: 528.32 }, { from: "2026-01-01", value: 554.736 }])).size).toBe(0);
    const errors = smigErrors([
      { id: 0, from: "", value: "528.32" },
      { id: 1, from: "", value: "50" },
      { id: 2, from: "2026-01-01", value: "" },
      { id: 3, from: "2026-01-01", value: "abc" },
    ]);
    expect(errors.has(0)).toBe(false);
    expect(errors.get(1)).toEqual({ when: "Saisissez la date d'effet.", amount: expect.stringMatching(/^Entre 100 et 5\s000 TND\.$/) });
    expect(errors.get(2)).toEqual({ when: "Date déjà utilisée par une autre période.", amount: "Saisissez un montant." });
    expect(errors.get(3)?.amount).toBe("Saisissez un nombre.");
  });

  it("l'ordre des lignes ne compte pas comme une modification", () => {
    const saved = smigInit([{ from: null, value: 528.32 }, { from: "2026-01-01", value: 554.736 }]);
    expect(smigKey([saved[1], saved[0]])).toBe(smigKey(saved));
    expect(smigKey([saved[0], { ...saved[1], value: "554,736" }])).toBe(smigKey(saved));
    expect(smigKey([saved[0], { ...saved[1], value: "560" }])).not.toBe(smigKey(saved));
  });
});

describe("budgets annuels : contrôles immédiats et résumé", () => {
  it("année entre 2000 et 2100, sans doublon, montant d'au moins 1 000 TND", () => {
    expect(budgetErrors(budgetInit([{ year: 2026, amount: 1717368 }])).size).toBe(0);
    const errors = budgetErrors([
      { id: 0, year: "2026", amount: "500" },
      { id: 1, year: "2026", amount: "" },
      { id: 2, year: "1999", amount: "abc" },
      { id: 3, year: "", amount: "2000000" },
    ]);
    expect(errors.get(0)).toEqual({ when: "Année déjà saisie.", amount: expect.stringMatching(/^Au moins 1\s000 TND\.$/) });
    expect(errors.get(1)).toEqual({ when: "Année déjà saisie.", amount: "Saisissez un montant." });
    expect(errors.get(2)).toEqual({ when: "Entre 2000 et 2100.", amount: "Saisissez un nombre." });
    expect(errors.get(3)).toEqual({ when: "Saisissez une année." });
  });

  it("résumé trié par année ; ordre des lignes sans effet", () => {
    const rows = budgetInit([{ year: 2027, amount: 1500000 }, { year: 2026, amount: 1717368 }]);
    expect(plain(budgetSummary(rows))).toBe("2026 : 1 717 368 TND ; 2027 : 1 500 000 TND");
    expect(budgetSummary([])).toBe("aucun budget");
    expect(budgetYears(rows)).toBe("2026 et 2027");
    expect(budgetYears([...rows, { id: 9, year: "2028", amount: "1" }])).toBe("2026, 2027 et 2028");
    expect(budgetKey([rows[1], rows[0]])).toBe(budgetKey(rows));
  });
});

describe("navigation des thèmes : section en cours au défilement", () => {
  it("dernière section passée sous le quart supérieur de l'écran", () => {
    expect(activeIndex([16, 600, 1200], 800, 2000)).toBe(0);
    expect(activeIndex([-500, 100, 700], 800, 1500)).toBe(1);
    expect(activeIndex([-1200, -600, 190], 800, 900)).toBe(2);
  });

  it("en fin de page, les dernières sections sont atteintes à leur tour", () => {
    const tops = [-900, -300, 300, 650];
    expect(activeIndex(tops, 800, 800)).toBe(1);
    expect(activeIndex(tops, 800, 400)).toBe(2);
    expect(activeIndex(tops, 800, 0)).toBe(3);
  });
});

describe("récapitulatif avant enregistrement : textes vérifiés par les tests E2E", () => {
  const capacity = { key: "capacity_rate", value: "0.02", min: 0.005, max: 0.2 };

  it("« <libellé> : 2 % → 3 % », compteur accordé, rien si la saisie égale la valeur en vigueur", () => {
    const change = fieldChange(capacity, "3");
    expect(plain(change?.text ?? "")).toBe("Capacité mensuelle d'entretiens (part classée « Élevé ») : 2 % → 3 %");
    expect(plain(change?.text ?? "")).toMatch(/Capacité mensuelle .* → 3 %/);
    expect(change?.invalid).toBeUndefined();
    expect(fieldChange(capacity, "2")).toBeNull();
    expect(fieldChange(capacity, " 2,0 ")).toBeNull();
    expect(pendingLabel(1)).toBe("1 modification à enregistrer");
    expect(pendingLabel(2)).toBe("2 modifications à enregistrer");
  });

  it("contrôle immédiat : bornes dans l'unité affichée (« Maximum 20 % », « Minimum 1 »), saisie vide, illisible ou décimale", () => {
    expect(inputError(capacity, "50")).toBe("Maximum 20 %.");
    expect(inputError({ key: "medium_lift", value: "2", min: 1, max: 10 }, "0.2")).toBe("Minimum 1 fois.");
    expect(inputError(capacity, "0,5")).toBeNull();
    expect(inputError(capacity, "20")).toBeNull();
    expect(inputError(capacity, " ")).toBe("Saisissez une valeur.");
    expect(inputError(capacity, "abc")).toBe("Saisissez un nombre.");
    const bradford = { key: "bradford_threshold", value: "250", min: 10, max: 5000, int: true };
    expect(inputError(bradford, "250,5")).toBe("Saisissez un nombre entier, sans décimale.");
    expect(inputError(bradford, "300")).toBeNull();
    expect(fieldChange(capacity, "50")).toEqual({ text: "Capacité mensuelle d'entretiens (part classée « Élevé ») : maximum 20 %", invalid: true });
    expect(fieldChange(capacity, "")).toEqual({ text: "Capacité mensuelle d'entretiens (part classée « Élevé ») : saisissez une valeur", invalid: true });
  });
});
