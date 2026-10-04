// Constellation « collaborateurs connectés » : nœuds et liens déterministes (graine fixe), partagés par la scène 3D et
// son repli SVG pour que les deux affichent exactement la même figure, cadrée par la même caméra.

export type ConstellationNode = { x: number; y: number; z: number; r: number; hub: boolean; tone: 0 | 1 };

export const CAMERA = { z: 7.6, fov: 40 } as const;
/** Inclinaison et rotation de départ du groupe (radians) : la vue initiale de la 3D = le repli SVG. */
export const BASE_TILT = 0.32;
export const BASE_SPIN = 0.55;

const COUNT = 46;
const RADIUS = { x: 3.15, y: 1.85, z: 3.15 };
const HUBS = new Set([3, 14, 27, 38]);

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildNodes(): ConstellationNode[] {
  const rand = mulberry32(20260930);
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: COUNT }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / COUNT;
    const ring = Math.sqrt(1 - y * y);
    const theta = golden * i;
    const depth = 0.68 + rand() * 0.38;
    const hub = HUBS.has(i);
    return {
      x: Math.cos(theta) * ring * depth * RADIUS.x,
      y: y * depth * RADIUS.y,
      z: Math.sin(theta) * ring * depth * RADIUS.z,
      r: hub ? 0.11 : 0.045 + rand() * 0.035,
      hub,
      tone: rand() < 0.62 ? 0 : 1,
    };
  });
}

function buildEdges(nodes: ConstellationNode[]): [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  nodes.forEach((a, i) => {
    const nearest = nodes
      .map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) }))
      .filter((n) => n.j !== i && n.d < 2.6)
      .sort((p, q) => p.d - q.d)
      .slice(0, a.hub ? 5 : 2);
    for (const { j } of nearest) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(i < j ? [i, j] : [j, i]);
    }
  });
  return edges;
}

export const NODES = buildNodes();
export const EDGES = buildEdges(NODES);

/** Position après la rotation de départ (X puis Y, ordre des Euler de three.js « XYZ »). */
function rotate({ x, y, z }: { x: number; y: number; z: number }) {
  const cy = Math.cos(BASE_SPIN);
  const sy = Math.sin(BASE_SPIN);
  const x1 = x * cy + z * sy;
  const z1 = -x * sy + z * cy;
  const cx = Math.cos(BASE_TILT);
  const sx = Math.sin(BASE_TILT);
  return { x: x1, y: y * cx - z1 * sx, z: y * sx + z1 * cx };
}

/** Hauteur visible dans le plan z = 0 (unités du monde), base du viewBox SVG. */
export const VIEW_HEIGHT = 2 * CAMERA.z * Math.tan((CAMERA.fov * Math.PI) / 360);

/** Projection perspective de la vue de départ, pour le repli SVG (même cadrage vertical que la caméra 3D). */
export function projectedConstellation() {
  const pts = NODES.map((n) => {
    const p = rotate(n);
    const k = CAMERA.z / (CAMERA.z - p.z);
    return { x: p.x * k, y: -p.y * k, z: p.z, r: n.r * k, hub: n.hub, tone: n.tone };
  });
  const zs = pts.map((p) => p.z);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const near = (z: number) => (z - zMin) / (zMax - zMin || 1);
  return {
    nodes: pts.map((p) => ({ ...p, depth: near(p.z) })).sort((a, b) => a.z - b.z),
    edges: EDGES.map(([a, b]) => ({ a: pts[a], b: pts[b], depth: (near(pts[a].z) + near(pts[b].z)) / 2 })),
  };
}
