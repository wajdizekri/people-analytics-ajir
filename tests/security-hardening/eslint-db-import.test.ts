import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";

// Point 6 : l'accès direct à @/db/client est réservé à src/lib, src/db, src/worker, scripts et aux tests.
const ROOT = path.resolve(__dirname, "../..");
const CODE = 'import { getDb } from "@/db/client";\nexport const x = getDb;\n';

async function restricted(filePath: string, code = CODE): Promise<boolean> {
  const [r] = await new ESLint({ cwd: ROOT }).lintText(code, { filePath: path.join(ROOT, filePath) });
  return r.messages.some((m) => m.ruleId === "no-restricted-imports");
}

describe("règle ESLint no-restricted-imports sur @/db/client", () => {
  it("interdit dans les pages, composants, Route Handlers et le proxy (alias ou chemin relatif)", async () => {
    expect(await restricted("src/app/(app)/dashboard/page.tsx")).toBe(true);
    expect(await restricted("src/app/api/dashboard/route.ts")).toBe(true);
    expect(await restricted("src/components/charts/echart.tsx")).toBe(true);
    expect(await restricted("src/proxy.ts")).toBe(true);
    expect(await restricted("src/components/x.tsx", 'import { getDb } from "../db/client";\nexport const x = getDb;\n')).toBe(true);
  }, 120_000);

  it("autorisé dans la DAL, les moteurs, le worker, les scripts et les tests", async () => {
    for (const f of ["src/lib/dal/alerts.ts", "src/lib/engine/alerts.ts", "src/worker/index.ts", "scripts/migrate.ts", "tests/unit/x.test.ts"]) {
      expect(await restricted(f), f).toBe(false);
    }
  }, 120_000);

  it("aucune page ni aucun composant n'importe la base aujourd'hui", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /from\s+["'][^"']*db\/client["']/.test(fs.readFileSync(p, "utf8"))) offenders.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, "src/app"));
    walk(path.join(ROOT, "src/components"));
    expect(offenders).toEqual([]);
  });
});
