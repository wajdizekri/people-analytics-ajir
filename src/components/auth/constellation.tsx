"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { isSoftwareRenderer, staticReason } from "./constellation-support";

// Constellation décorative : le SVG (children, rendu côté serveur) s'affiche tout de suite ; la scène 3D n'est chargée
// qu'une fois la page au repos, et seulement si l'appareil s'y prête. Sinon le SVG reste : écran < 1024 px (panneau masqué),
// mouvement réduit, WebGL absent ou logiciel, appareil modeste (≤ 2 cœurs ou ≤ 2 Go), économie de données.

// Chunk séparé : la page ne référence qu'un petit chargeur (~1 Ko) ; three et React Three Fiber ne sont demandés qu'au rendu de la scène
const ConstellationScene = dynamic(() => import("./constellation-scene"), { ssr: false });

type Phase = "pending" | "static" | "loading" | "3d";

const WIDE = "(min-width: 1024px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

// WebGL matériel seulement : un rendu logiciel (SwiftShader, llvmpipe…) ferait tourner la scène sur le processeur
let webgl: string | null | undefined;
function webglBlocker(): string | null {
  if (webgl !== undefined) return webgl;
  try {
    const canvas = document.createElement("canvas");
    const opts: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };
    const gl: WebGLRenderingContext | WebGL2RenderingContext | null = canvas.getContext("webgl2", opts) ?? canvas.getContext("webgl", opts);
    if (!gl) webgl = "webgl-indisponible";
    else {
      // Chrome et Safari masquent RENDERER (« WebKit WebGL ») ; Firefox le donne directement
      let renderer = String(gl.getParameter(gl.RENDERER));
      const info = /^webkit webgl$/i.test(renderer) ? gl.getExtension("WEBGL_debug_renderer_info") : null;
      if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
      webgl = isSoftwareRenderer(renderer) ? "webgl-logiciel" : null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    webgl = "webgl-indisponible";
  }
  return webgl;
}

type NavigatorHints = Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };

function currentReason(): string | null {
  const nav = navigator as NavigatorHints;
  return staticReason({
    wide: window.matchMedia(WIDE).matches,
    reducedMotion: window.matchMedia(REDUCED).matches,
    cores: nav.hardwareConcurrency,
    memory: nav.deviceMemory,
    saveData: nav.connection?.saveData,
    webgl: webglBlocker,
  });
}

function whenIdle(cb: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(cb, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(cb, 300);
  return () => window.clearTimeout(id);
}

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function Constellation({ interactive = false, children }: { interactive?: boolean; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(interactive ? "pending" : "static");
  const [reason, setReason] = useState(interactive ? "en-attente" : "statique-demande");
  // Après un échec WebGL, on ne retente pas (redimensionnement, changement de préférence)
  const broken = useRef(false);

  useEffect(() => {
    if (!interactive) return;
    const wide = window.matchMedia(WIDE);
    const reduced = window.matchMedia(REDUCED);
    let cancel = () => {};
    const evaluate = () => {
      cancel();
      cancel = whenIdle(() => {
        const why = broken.current ? "echec-precedent" : currentReason();
        setReason(why ?? "webgl");
        setPhase((p) => (why ? "static" : p === "3d" ? p : "loading"));
      });
    };
    evaluate();
    wide.addEventListener("change", evaluate);
    reduced.addEventListener("change", evaluate);
    return () => {
      cancel();
      wide.removeEventListener("change", evaluate);
      reduced.removeEventListener("change", evaluate);
    };
  }, [interactive]);

  const fail = (why: string) => {
    broken.current = true;
    setReason(why);
    setPhase("static");
  };
  const live = phase === "loading" || phase === "3d";

  return (
    <div aria-hidden="true" data-constellation={phase} data-reason={reason} className="pointer-events-none absolute inset-0 select-none">
      <div className={`absolute inset-0 transition-opacity duration-700 ${phase === "3d" ? "opacity-0" : "opacity-100"}`}>{children}</div>
      {live && (
        <SceneBoundary onError={() => fail("erreur-webgl")}>
          <div className={`absolute inset-0 transition-opacity duration-700 ${phase === "3d" ? "opacity-100" : "opacity-0"}`}>
            <ConstellationScene onReady={() => setPhase((p) => (p === "loading" ? "3d" : p))} onFail={fail} />
          </div>
        </SceneBoundary>
      )}
    </div>
  );
}
