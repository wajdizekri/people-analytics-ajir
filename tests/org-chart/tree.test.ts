import { describe, expect, it } from "vitest";
import { ORG_MAX_DEPTH, buildOrgChart, orgMasks, resolveHierarchy, type OrgNode, type OrgPerson } from "@/lib/dal/org-chart";

const P = (id: number, managerId: number | null, extra: Partial<OrgPerson> = {}): OrgPerson => ({
  id,
  managerId,
  active: true,
  name: `Nom${id}`,
  jobTitle: null,
  department: null,
  level: null,
  ...extra,
});
const rh = (people: OrgPerson[], absence?: Map<number, { absence: number; workable: number }>) =>
  buildOrgChart(people, { anchor: null, guarded: false, rootLabel: "Entreprise", absence });
const find = (n: OrgNode, key: string): OrgNode | undefined => (n.key === key ? n : n.children.map((c) => find(c, key)).find(Boolean));
const allKeys = (n: OrgNode): string[] => [n.key, ...n.children.flatMap(allKeys)];

describe("construction de l'arbre", () => {
  it("plusieurs racines : racine virtuelle « Entreprise »", () => {
    const { root, stats } = rh([P(1, null), P(2, null), P(3, 1), P(4, 1), P(5, 2, { level: "FAIBLE" }), P(6, 2), P(7, null)]);
    expect(root.key).toBe("root");
    expect(root.employeeId).toBeNull();
    expect(root.name).toBe("Entreprise");
    expect(root.children.map((c) => c.key).sort()).toEqual(["e1", "e2"]);
    expect(root.members.map((m) => m.id)).toEqual([1, 2, 7]);
    expect(root.leaves).toBe(1);
    expect(root.subtree.headcount).toBe(7);
    expect(stats).toMatchObject({ people: 7, managers: 2, depth: 2, reattached: 0, cycles: 0 });
  });

  it("cycle entre actifs : rompu sous la racine, aucun salarié perdu", () => {
    const h = resolveHierarchy([P(10, 11), P(11, 10), P(12, 10)], null);
    expect(h.anomalies.cycles).toBe(1);
    expect(h.order).toHaveLength(4);
    expect(h.children.get(0)).toEqual([10]);
    expect(h.children.get(10)?.sort()).toEqual([11, 12]);
    const { root } = rh([P(10, 11), P(11, 10), P(12, 10), P(20, 20)]);
    expect(root.subtree.headcount).toBe(4);
    expect(root.members.map((m) => m.id)).toEqual([10, 20]);
  });

  it("manager sorti ou absent : rattachement au plus proche ancêtre actif, sinon à la racine", () => {
    const people = [
      P(30, null),
      P(31, 30, { active: false }),
      P(32, 31),
      P(33, null, { active: false }),
      P(34, 33),
      P(35, 999),
      P(36, 37, { active: false }),
      P(37, 36, { active: false }),
      P(38, 36),
    ];
    const { root, stats } = rh(people);
    expect(stats.reattached).toBe(4);
    expect(find(root, "e30")?.members.map((m) => m.id)).toEqual([32]);
    expect(root.members.map((m) => m.id).sort()).toEqual([30, 34, 35, 38]);
    expect(JSON.stringify(root)).not.toMatch(/Nom31|Nom33|Nom36|Nom37/);
    expect(root.subtree.headcount).toBe(5);
  });

  it("collaborateurs sans subordonné agrégés dans leur manager", () => {
    const { root, stats } = rh([P(40, null), P(41, 40), P(42, 40), P(43, 40), P(44, 40), P(45, 44), P(46, 44)]);
    const n40 = find(root, "e40")!;
    expect(allKeys(root).sort()).toEqual(["e40", "e44", "root"]);
    expect(n40.leaves).toBe(3);
    expect(n40.children.map((c) => c.key)).toEqual(["e44"]);
    expect(n40.members.find((m) => m.id === 44)?.leadsTeam).toBe(true);
    expect(n40.team.headcount).toBe(4);
    expect(n40.subtree.headcount).toBe(6);
    expect(find(root, "e44")).toMatchObject({ leaves: 2, team: { headcount: 2 }, subtree: { headcount: 2 } });
    expect(stats.managers).toBe(2);
  });

  it("profondeur bornée : chaîne trop longue aplatie, personne n'est perdu", () => {
    const chain = Array.from({ length: 41 }, (_, i) => P(100 + i, i === 0 ? null : 99 + i));
    const { stats, root } = rh(chain);
    expect(stats.depth).toBe(ORG_MAX_DEPTH);
    expect(stats.flattened).toBeGreaterThan(0);
    expect(root.subtree.headcount).toBe(41);
  });

  it("vue manager : enraciné sur lui, ni sa fiche ni son propre niveau", () => {
    const { root, stats } = buildOrgChart([P(1, 9, { level: "ELEVE" }), P(2, 1, { level: "MOYEN" }), P(3, 2), P(4, 2)], {
      anchor: 1,
      guarded: true,
      rootLabel: "Votre hiérarchie",
    });
    expect(root).toMatchObject({ key: "e1", employeeId: 1, openable: false, level: null, depth: 0 });
    expect(root.children[0]).toMatchObject({ key: "e2", openable: true, level: "MOYEN", depth: 1 });
    expect(stats).toMatchObject({ people: 3, managers: 2, depth: 2 });
  });

  it("indicateurs : part élevé + moyen parmi les évalués, absentéisme du groupe ; vue RH non masquée, petit effectif signalé", () => {
    const absence = new Map([
      [2, { absence: 2, workable: 60 }],
      [3, { absence: 4, workable: 60 }],
      [4, { absence: 0, workable: 60 }],
    ]);
    const { root } = rh([P(1, null), P(2, 1, { level: "ELEVE" }), P(3, 1, { level: "FAIBLE" }), P(4, 1)], absence);
    const n1 = find(root, "e1")!;
    expect(n1.team).toMatchObject({ headcount: 3, small: true, scored: 2, atRisk: 1, riskShare: 0.5, riskMask: null, absenteeismMask: null });
    expect(n1.team.absenteeism).toBeCloseTo(6 / 180, 10);
  });
});

describe("masques côté manager", () => {
  it("équipe directe de 3 et sous-équipe de 7 : les deux équipes masquées, total de la racine affiché", () => {
    const m = orgMasks([
      { team: 3, subtree: 10, children: [1] },
      { team: 7, subtree: 7, children: [] },
    ]);
    expect(m).toEqual([
      { team: "PETIT_GROUPE", subtree: null },
      { team: "PROTECTION", subtree: "PROTECTION" },
    ]);
  });

  it("sous-arbre intermédiaire contenant une équipe masquée : masqué pour ne pas la révéler par différence", () => {
    const m = orgMasks([
      { team: 6, subtree: 26, children: [1] },
      { team: 8, subtree: 20, children: [2, 3] },
      { team: 3, subtree: 3, children: [] },
      { team: 9, subtree: 9, children: [] },
    ]);
    expect(m[2]).toEqual({ team: "PETIT_GROUPE", subtree: "PETIT_GROUPE" });
    expect(m[1]).toEqual({ team: null, subtree: "PROTECTION" });
    expect(m[3]).toEqual({ team: null, subtree: null });
    expect(m[0]).toEqual({ team: "PROTECTION", subtree: null });
  });

  it("aucune petite équipe : rien n'est masqué", () => {
    const m = orgMasks([
      { team: 5, subtree: 17, children: [1] },
      { team: 12, subtree: 12, children: [] },
    ]);
    expect(m.every((x) => x.team == null && x.subtree == null)).toBe(true);
  });

  it("buildOrgChart côté manager : aucun taux sous 5 personnes", () => {
    const people = [P(1, null), P(2, 1, { level: "ELEVE" }), P(3, 1), P(4, 1), P(5, 2, { level: "FAIBLE" }), P(6, 2), P(7, 2), P(8, 2), P(9, 2), P(10, 2), P(11, 2)];
    const absence = new Map(people.map((p) => [p.id, { absence: 1, workable: 60 }]));
    const { root } = buildOrgChart(people, { anchor: 1, guarded: true, rootLabel: "Votre hiérarchie", absence });
    expect(root.team).toMatchObject({ headcount: 3, riskShare: null, scored: null, atRisk: null, riskMask: "PETIT_GROUPE", absenteeism: null, absenteeismMask: "PETIT_GROUPE" });
    const n2 = root.children[0];
    expect(n2.team.headcount).toBe(7);
    expect(n2.team.riskShare).not.toBeNull();
    expect(n2.team).toMatchObject({ absenteeism: null, absenteeismMask: "PROTECTION" });
    expect(root.subtree).toMatchObject({ headcount: 10, absenteeismMask: null });
    expect(root.subtree.absenteeism).toBeCloseTo(10 / 600, 10);
  });
});
