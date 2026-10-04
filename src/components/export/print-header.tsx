import type { Role } from "@/db/schema";
import { formatDate } from "@/components/pilotage/labels";
import "./print.css";

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Administrateur", RH: "Responsable RH", MANAGER: "Manager" };

export function editedAt(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Tunis", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} à ${get("hour")}:${get("minute")}`;
}

// En-tête visible uniquement à l'impression (PDF) : application, titre, date des données, compte, date d'édition, confidentialité
export function PrintHeader({ title, dataDate, login, role, scope }: { title: string; dataDate: string; login: string; role: Role; scope?: string }) {
  return (
    <div className="mb-5 hidden border-b-2 border-heading pb-3 text-fg print:block">
      <div className="flex items-baseline justify-between gap-4 text-xs">
        <p className="font-semibold uppercase tracking-wider text-heading">People Analytics · AJIR</p>
        <p className="font-semibold">Document interne — confidentiel</p>
      </div>
      <p className="mt-2 text-xl font-semibold text-heading">{title}</p>
      <p className="mt-1 text-xs text-fg-muted">
        {scope ? `${scope} · ` : ""}Données au {formatDate(dataDate)} · Édité le {editedAt()} par {login} ({ROLE_LABEL[role]})
      </p>
    </div>
  );
}
