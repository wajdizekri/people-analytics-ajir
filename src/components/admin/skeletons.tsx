import type { ReactNode } from "react";
import { Skeleton, SkeletonKpiRow, SkeletonTable, cardCls } from "@/components/ui";

// Squelettes fidèles des écrans Administration, Alertes et Droit d'accès (loading.tsx et repli Suspense) :
// même grille que la page chargée, pour éviter tout saut de mise en page. Seule l'enveloppe est annoncée.

function Busy({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

function HeaderBone({ action = false, meta = false }: { action?: boolean; meta?: boolean }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 border-l-4 border-line pl-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-7 w-64 max-w-full" />
        <Skeleton className="mt-2 h-4 w-full max-w-2xl" />
        {meta && <Skeleton className="mt-2 h-3 w-56 max-w-full" />}
      </div>
      {action && <Skeleton className="h-10 w-40" />}
    </div>
  );
}

function FieldBone({ className = "" }: { className?: string }) {
  return (
    <div className={className}>
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="mt-1.5 h-10 w-full" />
    </div>
  );
}

export function UsersSkeleton() {
  return (
    <Busy label="Chargement des comptes utilisateurs…">
      <HeaderBone action />
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={`${cardCls} px-3 py-2.5`}>
            <Skeleton className="h-7 w-12" />
            <Skeleton className="mt-1.5 h-3 w-3/4" />
            <Skeleton className="mt-1 h-3 w-1/2" />
          </div>
        ))}
      </div>
      <div className={`${cardCls} mb-6 overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="hidden h-4 w-96 md:block" />
        </div>
        <div className="grid gap-x-4 gap-y-3 p-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
          {Array.from({ length: 4 }, (_, i) => (
            <FieldBone key={i} />
          ))}
          <Skeleton className="h-10 w-full self-end lg:w-36" />
        </div>
      </div>
      <SkeletonTable rows={8} columns={5} />
    </Busy>
  );
}

export function AuditSkeleton() {
  return (
    <Busy label="Chargement du journal d'audit…">
      <HeaderBone />
      <div className={`${cardCls} mb-3 p-4`}>
        <Skeleton className="mb-3 h-4 w-52" />
        <Skeleton className="h-10 w-full sm:hidden" />
        <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto] lg:items-end">
          {Array.from({ length: 5 }, (_, i) => (
            <FieldBone key={i} />
          ))}
          <Skeleton className="h-10 w-full lg:w-44" />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>
      <SkeletonTable rows={10} columns={4} />
    </Busy>
  );
}

export function PrivacySkeleton() {
  return (
    <Busy label="Chargement du droit d'accès…">
      <HeaderBone meta />
      <div className={`${cardCls} mb-6 flex flex-col gap-3 p-4 sm:flex-row`}>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-1 gap-2.5">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-2 h-3 w-full" />
            </div>
          </div>
        ))}
      </div>
      <SkeletonKpiRow count={4} className="mb-6 grid-cols-2! lg:grid-cols-4!" />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className={`${cardCls} p-4 sm:p-5`}>
          <Skeleton className="h-4 w-3/4" />
          <div className="mt-3 flex gap-2">
            <Skeleton className="h-10 flex-1" />
            <Skeleton className="h-10 w-28" />
          </div>
          <Skeleton className="mt-2 h-3 w-4/5" />
        </div>
        <Skeleton className="h-48 rounded-card lg:col-span-2" />
      </div>
      <SkeletonTable rows={6} columns={7} />
    </Busy>
  );
}

function PanelBone({ lines = 3 }: { lines?: number }) {
  return (
    <div className={`${cardCls} p-5`}>
      <div className="mb-4 flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-control" />
        <Skeleton className="h-5 w-40" />
      </div>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="mt-2 h-4 w-full first:mt-0" />
      ))}
    </div>
  );
}

export function AccountSkeleton() {
  return (
    <Busy label="Chargement de votre compte…">
      <HeaderBone />
      <Skeleton className="mb-4 h-16 w-full rounded-card" />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <PanelBone lines={5} />
          <PanelBone lines={1} />
          <PanelBone lines={6} />
        </div>
        <div className="space-y-4">
          <PanelBone lines={5} />
          <PanelBone lines={6} />
        </div>
      </div>
    </Busy>
  );
}

export function HelpSkeleton() {
  return (
    <Busy label="Chargement de l'aide…">
      <HeaderBone />
      <div className={`${cardCls} mb-6 flex items-end gap-2 p-4`}>
        <FieldBone className="flex-1" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Skeleton className="h-14 rounded-card lg:h-96" />
        <div className="space-y-6">
          <PanelBone lines={4} />
          <PanelBone lines={6} />
        </div>
      </div>
    </Busy>
  );
}

// Repli de la liste des alertes (dans la page : le titre et le sous-titre sont déjà affichés)
export function AlertsListSkeleton() {
  return (
    <Busy label="Chargement des alertes…">
      <div className={`${cardCls} mb-4 flex flex-wrap items-end gap-3 p-4`}>
        {Array.from({ length: 3 }, (_, i) => (
          <FieldBone key={i} className="w-full sm:w-44" />
        ))}
        <Skeleton className="h-10 w-full sm:ml-auto sm:w-44" />
      </div>
      <div className={`${cardCls} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-48" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="border-b border-l-4 border-line border-l-line-strong/40 px-4 py-3.5 last:border-b-0">
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-5 w-28 rounded-full" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="mt-2 flex flex-col gap-3 md:flex-row md:justify-between">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-2 h-3.5 w-full max-w-2xl" />
                <Skeleton className="mt-2.5 h-3 w-1/2" />
              </div>
              <Skeleton className="h-8 w-36 shrink-0" />
            </div>
          </div>
        ))}
      </div>
    </Busy>
  );
}
