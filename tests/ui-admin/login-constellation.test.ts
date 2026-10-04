import { describe, expect, it } from "vitest";
import { isSoftwareRenderer, staticReason, type DeviceHints } from "@/components/auth/constellation-support";
import { EDGES, NODES, VIEW_HEIGHT, projectedConstellation } from "@/components/auth/constellation-data";

const capable: DeviceHints = { wide: true, reducedMotion: false, cores: 8, memory: 8, saveData: false, webgl: () => null };

describe("page de connexion : constellation 3D ou repli SVG", () => {
  it("3D seulement sur grand écran, sans mouvement réduit, appareil correct et WebGL matériel", () => {
    expect(staticReason(capable)).toBeNull();
    expect(staticReason({ ...capable, wide: false })).toBe("ecran-etroit");
    expect(staticReason({ ...capable, reducedMotion: true })).toBe("mouvement-reduit");
    expect(staticReason({ ...capable, cores: 2 })).toBe("appareil-modeste");
    expect(staticReason({ ...capable, memory: 2 })).toBe("appareil-modeste");
    expect(staticReason({ ...capable, memory: 0.5 })).toBe("appareil-modeste");
    expect(staticReason({ ...capable, saveData: true })).toBe("economie-donnees");
    expect(staticReason({ ...capable, webgl: () => "webgl-indisponible" })).toBe("webgl-indisponible");
    // Indices absents (Firefox, Safari : pas de deviceMemory) : pas un motif de repli
    expect(staticReason({ ...capable, cores: undefined, memory: undefined, saveData: undefined })).toBeNull();
  });

  it("WebGL n'est sondé qu'en dernier recours (création de contexte évitée sur mobile)", () => {
    let probes = 0;
    const webgl = () => {
      probes++;
      return null;
    };
    staticReason({ ...capable, wide: false, webgl });
    staticReason({ ...capable, reducedMotion: true, webgl });
    staticReason({ ...capable, cores: 1, webgl });
    expect(probes).toBe(0);
    staticReason({ ...capable, webgl });
    expect(probes).toBe(1);
  });

  it("rendus logiciels écartés", () => {
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("Microsoft Basic Render Driver")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isSoftwareRenderer("Apple M2")).toBe(false);
  });

  it("figure déterministe, liens valides, repli SVG cadré comme la caméra", () => {
    expect(NODES).toHaveLength(46);
    expect(NODES.filter((n) => n.hub)).toHaveLength(4);
    expect(EDGES.length).toBeGreaterThan(NODES.length);
    for (const [a, b] of EDGES) {
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(NODES.length);
    }
    expect(new Set(EDGES.map(([a, b]) => `${a}-${b}`)).size).toBe(EDGES.length);
    // Chaque nœud est relié à au moins un autre
    const linked = new Set(EDGES.flat());
    expect(linked.size).toBe(NODES.length);
    const { nodes, edges } = projectedConstellation();
    expect(edges).toHaveLength(EDGES.length);
    for (const n of nodes) {
      expect(Math.abs(n.y)).toBeLessThan(VIEW_HEIGHT / 2);
      expect(n.depth).toBeGreaterThanOrEqual(0);
      expect(n.depth).toBeLessThanOrEqual(1);
    }
    expect(projectedConstellation()).toEqual({ nodes, edges });
  });
});
