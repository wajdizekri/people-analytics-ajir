"use client";

import { useState } from "react";
import { EChart } from "@/components/charts/echart";
import { ChartData, type ChartSpec } from "@/components/charts/pbi";
import { fieldCls } from "@/components/ui";

type Item = { key: string; label: string; spec: ChartSpec; message: string; detail: string };

// Visuel « prévision » : le titre (message) suit le périmètre choisi (RH : entreprise ou département) ; graphiques construits côté serveur.
export function ForecastPicker({ items, subtitle, footnote }: { items: Item[]; subtitle: string; footnote: string }) {
  const [key, setKey] = useState(items[0]?.key);
  const current = items.find((i) => i.key === key) ?? items[0];
  if (!current) return null;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="text-base font-semibold leading-snug text-fg">{current.message}</h2>
          <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">{subtitle}</p>
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
      <p className="mb-2 rounded-control bg-surface-2 px-3 py-2 text-sm text-fg-muted" aria-live="polite">
        {current.detail}
      </p>
      <EChart
        option={current.spec.option}
        format={current.spec.format}
        height={current.spec.height}
        ariaLabel={`${current.message}. ${current.spec.ariaLabel}`}
      />
      <ChartData table={current.spec.table} caption={current.message} />
      <p className="mt-2 text-xs leading-relaxed text-fg-muted">{footnote}</p>
    </div>
  );
}
