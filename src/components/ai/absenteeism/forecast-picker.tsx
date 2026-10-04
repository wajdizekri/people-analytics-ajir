"use client";

import { useState } from "react";
import { EChart } from "@/components/charts/echart";
import { ChartData, type ChartSpec } from "@/components/charts/pbi";
import { InfoTip } from "@/components/help/info-tip";
import { StatusBadge, fieldCls, type StatusTone } from "@/components/ui";
import type { CoverageCell } from "@/lib/ai/conformal";
import { CoverageNote } from "@/components/ai/conformal/coverage-note";
import type { ForecastTrend } from "./forecast-section";

type Item = { key: string; label: string; spec: ChartSpec; trend: ForecastTrend | null; coverage?: CoverageCell | null };

const TREND: Record<ForecastTrend, { label: string; tone: StatusTone }> = {
  hausse: { label: "Hausse prévue", tone: "warning" },
  baisse: { label: "Baisse prévue", tone: "success" },
  stable: { label: "Stable", tone: "neutral" },
};

// Visuel « prévision » : titre fixe, périmètre choisi (RH : entreprise ou département) et tendance en badge ; graphiques construits côté serveur.
export function ForecastPicker({ title, items, help }: { title: string; items: Item[]; help: string }) {
  const [key, setKey] = useState(items[0]?.key);
  const current = items.find((i) => i.key === key) ?? items[0];
  if (!current) return null;
  const trend = current.trend ? TREND[current.trend] : null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold leading-snug text-fg">
            {title}
            <InfoTip label={title} prefix="Détails" align="start">
              {help}
            </InfoTip>
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-fg-muted" aria-live="polite">
            {items.length === 1 && <span>{current.label}</span>}
            {trend && <StatusBadge tone={trend.tone}>{trend.label}</StatusBadge>}
          </p>
        </div>
        {items.length > 1 && (
          <div className="w-full sm:w-64">
            <label htmlFor="abs-forecast-unit" className="block text-xs font-medium text-fg-muted">
              Périmètre affiché
            </label>
            <select id="abs-forecast-unit" value={current.key} onChange={(e) => setKey(e.target.value)} className={`${fieldCls} mt-1 cursor-pointer`}>
              {items.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <EChart
        option={current.spec.option}
        format={current.spec.format}
        height={current.spec.height}
        ariaLabel={`${title}, ${current.label}${trend ? ` : ${trend.label.toLowerCase()}` : ""}. ${current.spec.ariaLabel}`}
      />
      <ChartData table={current.spec.table} caption={`${title}, ${current.label}`} />
      <CoverageNote cell={current.coverage} />
    </div>
  );
}
