import fs from "node:fs";
import path from "node:path";

export const MODELS = path.resolve(process.cwd(), "models");
export const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;

// Dernière version calibrée (champ `conformal`) d'un sujet, ou null tant que la calibration n'a pas été lancée
export function conformalDir(topic: "absenteeism" | "workload" | "workforce", prefix: string): string | null {
  const root = path.join(MODELS, topic);
  const dirs = fs
    .readdirSync(root)
    .filter((d) => d.startsWith(prefix) && fs.existsSync(path.join(root, d, "model.json")))
    .filter((d) => readJson<{ conformal?: unknown }>(path.join(root, d, "model.json")).conformal != null)
    .sort();
  return dirs.length ? path.join(root, dirs[dirs.length - 1]) : null;
}

// Générateur pseudo-aléatoire reproductible (mulberry32) et lois usuelles
export function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    u,
    normal: () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()),
    expo: () => -Math.log(1 - u()),
  };
}

export type ParityCase = { h: number; level: number; scores: number[]; interval: [number, number]; scope?: string; target?: string; variant?: string };
