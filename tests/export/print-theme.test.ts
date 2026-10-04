import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("impression en thème clair", () => {
  it("chaque couleur de graphique du thème sombre (--pa-chart-*) revient à sa valeur claire à l'impression", () => {
    const globals = read("src/app/globals.css");
    const dark = /\[data-theme="dark"\]\s*\{([^}]*--pa-chart-[^}]*)\}/.exec(globals)?.[1] ?? "";
    const vars = [...dark.matchAll(/(--pa-chart-[0-9a-f]{6})\s*:/g)].map((m) => m[1]);
    expect(vars.length).toBeGreaterThan(0);

    const print = read("src/components/export/print.css");
    const media = print.slice(print.indexOf("@media print"));
    const block = /:root\[data-theme\]\s*\{([^}]*)\}/.exec(media)?.[1] ?? "";
    const missing = vars.filter((v) => !new RegExp(`${v}\\s*:\\s*initial\\s*;`).test(block));
    expect(missing).toEqual([]);
  });
});
