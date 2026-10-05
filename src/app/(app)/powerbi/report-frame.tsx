"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, ButtonLink, Icon, Spinner, cardCls } from "@/components/ui";

const AREA = "h-[calc(100dvh-13rem)] min-h-[520px]";

export function ReportFrame({ src, title }: { src: string; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);

  return (
    <section aria-label={title} className={`${cardCls} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-1.5">
        <p className="inline-flex items-center gap-2 text-sm font-medium text-fg">
          <Icon name="chart" className="h-4 w-4 text-fg-muted" />
          {title}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="tertiary"
            size="sm"
            icon="refresh"
            onClick={() => {
              setLoaded(false);
              setVersion((v) => v + 1);
            }}
          >
            Recharger
          </Button>
          <Button variant="tertiary" size="sm" icon="monitor" onClick={() => void box.current?.requestFullscreen?.()}>
            Plein écran
          </Button>
          <ButtonLink href={src} variant="tertiary" size="sm" external>
            Ouvrir dans Power BI
          </ButtonLink>
        </div>
      </div>
      <div ref={box} className={`relative bg-surface ${AREA}`}>
        {!loaded && (
          <div role="status" className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-fg-muted">
            <Spinner />
            Chargement du rapport…
          </div>
        )}
        <iframe key={version} src={src} title={title} allowFullScreen onLoad={() => setLoaded(true)} className="relative h-full w-full border-0" />
      </div>
    </section>
  );
}

export function ReportPlaceholder({ action }: { action?: ReactNode }) {
  return (
    <section
      aria-label="Espace du rapport Power BI"
      className={`flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-line-strong bg-surface-2 px-6 text-center ${AREA}`}
    >
      <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon name="chart" className="h-7 w-7" />
      </span>
      <p className="text-base font-semibold text-heading">Espace du rapport Power BI</p>
      <p className="text-sm text-fg-muted">Aucun rapport configuré</p>
      {action}
    </section>
  );
}
