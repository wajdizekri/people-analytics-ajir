"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Color, getConsoleFunction, Matrix4, setConsoleFunction, type Fog, type Group, type InstancedMesh, type LineBasicMaterial } from "three";
import { BASE_SPIN, BASE_TILT, CAMERA, EDGES, NODES } from "./constellation-data";

// Scène 3D de la constellation (chargée à la demande par constellation.tsx : three et React Three Fiber restent hors du
// premier rendu). Rotation lente + parallaxe amortie qui suit la souris ; aucune interaction (pointer-events: none).

// React Three Fiber 9.8 crée encore un THREE.Clock (déprécié depuis three r183) : seul cet avertissement est tu
if (!getConsoleFunction()) {
  setConsoleFunction((type: "log" | "warn" | "error", message: string, ...params: unknown[]) => {
    if (type === "warn" && message.startsWith("THREE.Clock:")) return;
    console[type](message, ...params);
  });
}

const SPIN_SPEED = 0.05; // rad/s : un tour en ~2 min
const PARALLAX = { x: 0.2, y: 0.32 };
const DAMPING = 2.4;

type Palette = { node: Color; node2: Color; accent: Color; line: Color; lineOpacity: number; fog: Color };

function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    node: new Color(get("--cst-node", "#8fb4e0")),
    node2: new Color(get("--cst-node-2", "#3572bd")),
    accent: new Color(get("--cst-accent", "#f09219")),
    line: new Color(get("--cst-line", "#5b8fcf")),
    lineOpacity: Number.parseFloat(get("--cst-line-o", "0.5")) || 0.5,
    fog: new Color(get("--pa-nav", "#002c52")),
  };
}

function Network({ onFirstFrame }: { onFirstFrame: () => void }) {
  const gl = useThree((s) => s.gl);
  const group = useRef<Group>(null);
  const nodes = useRef<InstancedMesh>(null);
  const lineMaterial = useRef<LineBasicMaterial>(null);
  const fog = useRef<Fog>(null);
  const motion = useRef({ px: 0, py: 0, tx: 0, ty: 0, spin: 0, time: 0, first: true });
  const linePositions = useMemo(() => {
    const out = new Float32Array(EDGES.length * 6);
    EDGES.forEach(([a, b], i) => {
      out.set([NODES[a].x, NODES[a].y, NODES[a].z, NODES[b].x, NODES[b].y, NODES[b].z], i * 6);
    });
    return out;
  }, []);
  const hubs = useMemo(() => NODES.flatMap((n, i) => (n.hub ? [i] : [])), []);

  // Matrices des nœuds (position + taille)
  useLayoutEffect(() => {
    const mesh = nodes.current;
    if (!mesh) return;
    const m = new Matrix4();
    NODES.forEach((n, i) => mesh.setMatrixAt(i, m.makeScale(n.r, n.r, n.r).setPosition(n.x, n.y, n.z)));
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  // Couleurs : lues dans les variables CSS du conteneur (avant la première image), relues à chaque changement de thème
  useLayoutEffect(() => {
    const apply = () => {
      const p = readPalette(gl.domElement);
      const mesh = nodes.current;
      if (mesh) {
        NODES.forEach((n, i) => mesh.setColorAt(i, n.hub ? p.accent : n.tone === 0 ? p.node : p.node2));
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      if (lineMaterial.current) {
        lineMaterial.current.color.copy(p.line);
        lineMaterial.current.opacity = p.lineOpacity;
      }
      fog.current?.color.copy(p.fog);
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, [gl]);

  // Parallaxe : position du pointeur dans la fenêtre (la scène elle-même ne reçoit aucun événement)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      motion.current.px = (e.clientX / window.innerWidth) * 2 - 1;
      motion.current.py = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const reset = () => {
      motion.current.px = 0;
      motion.current.py = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", reset);
    };
  }, []);

  const pulse = useMemo(() => new Matrix4(), []);
  useFrame((_, delta) => {
    const g = group.current;
    const mesh = nodes.current;
    if (!g || !mesh) return;
    const s = motion.current;
    const dt = Math.min(delta, 0.1);
    const k = 1 - Math.exp(-dt * DAMPING);
    s.time += dt;
    s.spin += dt * SPIN_SPEED;
    s.tx += (s.py * PARALLAX.x - s.tx) * k;
    s.ty += (s.px * PARALLAX.y - s.ty) * k;
    g.rotation.set(BASE_TILT + s.tx, BASE_SPIN + s.spin + s.ty, 0);
    for (const i of hubs) {
      const n = NODES[i];
      const r = n.r * (1 + 0.1 * Math.sin(s.time * 1.4 + i));
      mesh.setMatrixAt(i, pulse.makeScale(r, r, r).setPosition(n.x, n.y, n.z));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (s.first) {
      s.first = false;
      onFirstFrame();
    }
  });

  return (
    <>
      <fog ref={fog} attach="fog" args={["#002c52", CAMERA.z - 1.5, CAMERA.z + 4.5]} />
      <group ref={group} rotation={[BASE_TILT, BASE_SPIN, 0]}>
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial ref={lineMaterial} transparent depthWrite={false} />
        </lineSegments>
        <instancedMesh ref={nodes} args={[undefined, undefined, NODES.length]}>
          <sphereGeometry args={[1, 18, 14]} />
          <meshLambertMaterial />
        </instancedMesh>
      </group>
      <ambientLight intensity={2} />
      <directionalLight position={[3, 4, 6]} intensity={1.6} />
    </>
  );
}

export default function ConstellationScene({ onReady, onFail }: { onReady: () => void; onFail: (reason: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [running, setRunning] = useState(true);

  // Pause du rendu : onglet caché ou scène hors de l'écran
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let visible = !document.hidden;
    let inView = true;
    const update = () => setRunning(visible && inView);
    const onVisibility = () => {
      visible = !document.hidden;
      update();
    };
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={host} className="absolute inset-0">
      <Canvas
        frameloop={running ? "always" : "never"}
        dpr={[1, 1.5]}
        flat
        camera={{ position: [0, 0, CAMERA.z], fov: CAMERA.fov, near: 0.1, far: 40 }}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power", failIfMajorPerformanceCaveat: true }}
        style={{ pointerEvents: "none" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          // Perte de contexte en cours d'affichage → repli SVG ; celle provoquée par le démontage (canvas déjà retiré) est ignorée
          gl.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            if (gl.domElement.isConnected) onFail("contexte-webgl-perdu");
          });
        }}
      >
        <Network onFirstFrame={onReady} />
      </Canvas>
    </div>
  );
}
