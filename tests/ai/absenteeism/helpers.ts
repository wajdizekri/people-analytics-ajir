import fs from "node:fs";
import path from "node:path";
import type { AbsBundle, Scope } from "@/lib/ai/absenteeism/model";
import type { MonthCal } from "@/lib/ai/absenteeism/series";

export const MODELS_DIR = path.resolve(__dirname, "../../../models/absenteeism");
export const DEV_DB = path.resolve(__dirname, "../../../data/dev-ai-abs.db");

export type GoldenCase = {
  h: number;
  scope: Scope;
  own: [number[], number[]];
  parent: [number[], number[]];
  company: [number[], number[]];
  cal_t: MonthCal;
  cal_t12: MonthCal;
  x: number[];
  value: number;
  lower: number;
  upper: number;
};
export type Golden = {
  cases: GoldenCase[];
  series: {
    as_of: string;
    units: Record<string, { own: [number[], number[]]; parent_unit: string }>;
    company: [number[], number[]];
    forecasts: { unit: string; h: number; x: number[]; value: number }[];
  };
};

export function latestBundleDir(): string | null {
  if (!fs.existsSync(MODELS_DIR)) return null;
  const dirs = fs
    .readdirSync(MODELS_DIR)
    .filter((d) => fs.existsSync(path.join(MODELS_DIR, d, "model.json")))
    .sort();
  return dirs.length ? path.join(MODELS_DIR, dirs[dirs.length - 1]) : null;
}

export const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, "utf8")) as T;
export const loadBundleDir = (dir: string) => ({ bundle: readJson<AbsBundle>(path.join(dir, "model.json")), golden: readJson<Golden>(path.join(dir, "golden.json")) });
