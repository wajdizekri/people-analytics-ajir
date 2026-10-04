import { Badge } from "@/components/ui";
import type { Role } from "@/db/schema";
import type { AlertDTO, AlertSeverity, AlertStatus, AlertType } from "@/lib/dal/alerts";

export const TYPE_LABEL: Record<AlertType, string> = {
  TURNOVER: "Risque de départ",
  ABSENTEISME: "Absentéisme",
  DONNEES: "Qualité des données",
  SYSTEME: "Système",
};

// Types que chaque rôle peut recevoir (visibilité de la DAL) : le filtre ne propose pas un type toujours vide
export const TYPES_BY_ROLE: Record<Role, AlertType[]> = {
  RH: ["TURNOVER", "ABSENTEISME", "DONNEES", "SYSTEME"],
  MANAGER: ["TURNOVER", "ABSENTEISME"],
  ADMIN: ["DONNEES", "SYSTEME"],
};

// Lien vers la fiche avec retour vers la liste d'alertes ou le détail d'une alerte (fil d'Ariane « Alertes » / « Alerte » sur la fiche)
export function withReturn(link: string, retour: string): string {
  return /^\/employees\/\d+$/.test(link) && retour.startsWith("/alerts") ? `${link}?retour=${encodeURIComponent(retour)}` : link;
}

export const STATUS_LABEL: Record<AlertStatus, string> = {
  NOUVELLE: "Nouvelle",
  EN_COURS: "En cours",
  TRAITEE: "Traitée",
  REJETEE: "Rejetée",
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  CRITIQUE: "Critique",
  ATTENTION: "Attention",
  INFO: "Information",
};

// Ce que la gravité veut dire pour l'utilisateur
export const SEVERITY_HINT: Record<AlertSeverity, string> = {
  CRITIQUE: "à traiter en priorité",
  ATTENTION: "à examiner",
  INFO: "pour information",
};

const SEVERITY_STYLE = {
  CRITIQUE: "bg-danger-soft text-danger ring-danger/30",
  ATTENTION: "bg-warning-soft text-warning ring-warning/30",
  INFO: "bg-info-soft text-info ring-info/30",
} as const;
export const SEVERITY_DOT = { CRITIQUE: "bg-danger", ATTENTION: "bg-warning", INFO: "bg-info" } as const;
export const SEVERITY_BORDER = { CRITIQUE: "border-l-danger", ATTENTION: "border-l-warning", INFO: "border-l-info" } as const;
const STATUS_TONE = { NOUVELLE: "sky", EN_COURS: "amber", TRAITEE: "emerald", REJETEE: "slate" } as const;

const STATUS_ICON: Record<AlertStatus, string> = {
  NOUVELLE: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  EN_COURS: "M8 4.5V8l2.2 1.4 M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0",
  TRAITEE: "m3.5 8.5 3 3 6-7",
  REJETEE: "m4.5 4.5 7 7 m0-7-7 7",
};

const TYPE_ICON: Record<AlertType, string> = {
  TURNOVER: "M10 17l5-5-5-5 M15 12H3 M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5",
  ABSENTEISME: "M8 2v4 M16 2v4 M3 9h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M10 13l4 4 M14 13l-4 4",
  DONNEES: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  SYSTEME: "M4 4h16v6H4z M4 14h16v6H4z M8 7h.01 M8 17h.01",
};

// Pastille de couleur toujours doublée du libellé
export function SeverityBadge({ severity, withHint = false }: { severity: AlertSeverity; withHint?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${SEVERITY_STYLE[severity]}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[severity]}`} />
      {SEVERITY_LABEL[severity]}
      {withHint && <span className="font-normal">· {SEVERITY_HINT[severity]}</span>}
    </span>
  );
}

export function StatusBadge({ status }: { status: AlertStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mr-1 h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d={STATUS_ICON[status]} />
      </svg>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function TypeIcon({ type, className = "h-3.5 w-3.5" }: { type: AlertType; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={TYPE_ICON[type]} />
    </svg>
  );
}

// Libellé du lien vers l'élément concerné, selon sa destination
export function linkLabel(link: string, employeeName?: string | null): string {
  if (link.startsWith("/employees/")) return employeeName ? `Voir la fiche de ${employeeName}` : "Voir la fiche du collaborateur";
  if (link.startsWith("/absenteeism")) return "Voir l'absentéisme";
  if (link.startsWith("/data-health")) return "Voir la santé des données";
  if (link.startsWith("/transparency")) return "Voir la transparence du modèle";
  if (link.startsWith("/admin")) return "Voir la console";
  return "Ouvrir l'élément concerné";
}

// Action proposée : une phrase qui dit quoi faire, selon le type d'alerte et le rôle
export function proposedAction(a: Pick<AlertDTO, "type" | "status" | "employeeName" | "departmentName">, role: Role): string {
  if (a.status === "TRAITEE" || a.status === "REJETEE") return "Aucune : l'alerte est clôturée.";
  switch (a.type) {
    case "TURNOVER":
      return "Prévoir un échange avec le collaborateur pour comprendre sa situation.";
    case "ABSENTEISME":
      if (a.employeeName) return "Vérifier les absences avec le collaborateur, sans présumer de leur cause.";
      return role === "MANAGER" ? "Analyser l'absentéisme de votre équipe et en parler avec la RH." : "Analyser l'absentéisme de l'équipe avec son manager.";
    case "DONNEES":
      return role === "ADMIN" ? "Vérifier les lignes rejetées de l'import, puis faire corriger l'export AJIR si besoin." : "Vérifier la qualité de l'import avec l'administrateur.";
    case "SYSTEME":
      return "Vérifier que le service de calcul fonctionne, puis relancer le traitement en attente.";
  }
}

// Qui ou quoi est concerné, en mots
export function concernedLabel(a: Pick<AlertDTO, "type" | "employeeName" | "departmentName">): string {
  if (a.employeeName) return a.employeeName;
  if (a.departmentName) return a.departmentName;
  if (a.type === "DONNEES" || a.type === "SYSTEME") return "L'outil (alerte technique)";
  return a.type === "ABSENTEISME" ? "Une équipe (voir la description)" : "Plusieurs collaborateurs";
}

const TZ = "Africa/Tunis";

export function alertDate(s: string): { day: string; time: string } | null {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return {
    day: d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }),
    time: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ }),
  };
}
