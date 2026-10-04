// Choix 3D / repli SVG de la constellation, à partir de ce que le navigateur expose (fonction pure, testée).

export type DeviceHints = {
  /** Panneau visuel affiché (≥ 1024 px). */
  wide: boolean;
  reducedMotion: boolean;
  cores?: number;
  /** navigator.deviceMemory (Go, arrondi par le navigateur). */
  memory?: number;
  saveData?: boolean;
  /** null : WebGL matériel disponible ; sinon la raison (« webgl-indisponible », « webgl-logiciel »). */
  webgl: () => string | null;
};

/** Raison de rester sur le SVG, ou null si la scène 3D peut se charger. WebGL n'est sondé qu'en dernier. */
export function staticReason(h: DeviceHints): string | null {
  if (!h.wide) return "ecran-etroit";
  if (h.reducedMotion) return "mouvement-reduit";
  if ((h.cores !== undefined && h.cores > 0 && h.cores <= 2) || (h.memory !== undefined && h.memory > 0 && h.memory <= 2)) return "appareil-modeste";
  if (h.saveData) return "economie-donnees";
  return h.webgl();
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** Rendu WebGL logiciel (le processeur ferait tout le travail) ? */
export const isSoftwareRenderer = (renderer: string) => SOFTWARE_RENDERER.test(renderer);
