// Traduction des entrées du journal d'audit en phrases (« rh.demo a ouvert la fiche du collaborateur n° 24 »).
// Aucune donnée nominative : un collaborateur est désigné par son numéro interne, un compte par son identifiant.

import { formatSetting, settingUiLabel } from "./settings-labels";

export type AuditEntry = {
  action: string;
  outcome: "OK" | "REFUSE" | "ECHEC";
  login: string | null;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
};

type Verb = { p3: string; p2: string; inf: string };
const er = (stem: string): Verb => ({ p3: `a ${stem}é`, p2: `avez ${stem}é`, inf: `${stem}er` });
const V = {
  consulter: er("consult"),
  ouvrir: { p3: "a ouvert", p2: "avez ouvert", inf: "ouvrir" },
  creer: { p3: "a créé", p2: "avez créé", inf: "créer" },
  modifier: er("modifi"),
  generer: { p3: "a généré", p2: "avez généré", inf: "générer" },
  deverrouiller: er("déverrouill"),
  desactiver: er("désactiv"),
  reactiver: er("réactiv"),
  deposer: { p3: "a déposé", p2: "avez déposé", inf: "déposer" },
  lancer: er("lanc"),
  exporter: er("export"),
  enregistrer: er("enregistr"),
  lever: { p3: "a levé", p2: "avez levé", inf: "lever" },
  cloturer: { p3: "a clôturé", p2: "avez clôturé", inf: "clôturer" },
  decider: { p3: "a décidé", p2: "avez décidé", inf: "décider" },
  changer: er("chang"),
  donner: er("donn"),
  rechercher: er("recherch"),
  publier: { p3: "a publié", p2: "avez publié", inf: "publier" },
  annuler: er("annul"),
  remplacer: { p3: "a remplacé", p2: "avez remplacé", inf: "remplacer" },
  activer: er("activ"),
  mettreEnService: { p3: "a mis en service", p2: "avez mis en service", inf: "mettre en service" },
  revenir: { p3: "est revenu à", p2: "êtes revenu à", inf: "revenir à" },
} satisfies Record<string, Verb>;

const de = (inf: string) => (/^[aeéèêiîoôuh]/i.test(inf) ? `d'${inf}` : `de ${inf}`);

const PAGE_LABEL: Record<string, string> = {
  "/dashboard": "Tableau de bord",
  "/synthese": "Synthèse du mois",
  "/employees": "Collaborateurs",
  "/equipes": "Équipes",
  "/organigramme": "Organigramme",
  "/retention": "Rétention",
  "/absenteeism": "Absentéisme",
  "/formations": "Formations",
  "/charge": "Charge de travail",
  "/previsions": "Prévisions effectifs",
  "/recommendations": "Recommandations",
  "/interventions": "Interventions",
  "/data-health": "Santé des données",
  "/transparency": "Transparence du modèle",
  "/derive": "Dérive des données",
  "/backtesting": "Vérification a posteriori",
  "/alerts": "Alertes",
  "/confidentialite": "Droit d'accès",
  "/admin": "Console d'administration",
  "/admin/users": "Utilisateurs et accès",
  "/admin/settings": "Paramètres",
  "/admin/audit": "Journal d'audit",
  "/compte": "Mon compte",
};
const ROLE_NAME: Record<string, string> = { ADMIN: "administrateur", RH: "responsable RH", MANAGER: "manager" };
const ALERT_STATUS: Record<string, string> = { NOUVELLE: "Nouvelle", EN_COURS: "En cours", TRAITEE: "Traitée", REJETEE: "Rejetée" };
const EXPORT_LIST: Record<string, string> = { employees: "la liste des collaborateurs", alerts: "la liste des alertes", recommendations: "la liste des recommandations" };

function pageName(route: string | null): string {
  if (!route) return "une page réservée";
  const path = route.replace(/^route\s*#?/, "").split("?")[0];
  const exact = PAGE_LABEL[path];
  if (exact) return `la page « ${exact} »`;
  const prefix = Object.keys(PAGE_LABEL)
    .filter((p) => p !== "/admin" && path.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return `une page de « ${PAGE_LABEL[prefix]} »`;
  if (path.startsWith("/admin")) return `une page de « ${PAGE_LABEL["/admin"]} »`;
  if (path.startsWith("/api/")) return `le service ${path}`;
  return `la page ${path}`;
}

const date = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s ?? "");
const n = (id: string | null) => (id ? ` n° ${id}` : "");

function parse(detail: string | null): Record<string, unknown> {
  if (!detail) return {};
  try {
    const v: unknown = JSON.parse(detail);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type Phrase = { verb: Verb; object: string; extra?: string };

// Objet consulté par une action « *.view »
const VIEWS: Record<string, string> = {
  dashboard: "le tableau de bord",
  synthesis: "la synthèse du mois",
  teams: "les équipes",
  org_chart: "l'organigramme",
  absenteeism: "l'absentéisme",
  "absenteeism.forecast": "les prévisions d'absentéisme",
  "absenteeism.recommendations": "les actions proposées sur l'absentéisme",
  training: "les formations",
  workload: "la charge de travail",
  workforce: "les prévisions d'effectifs",
  retention: "la rétention",
  interventions: "les interventions",
  backtest: "la vérification a posteriori",
  model: "la transparence du modèle",
  model_monitoring: "le suivi du modèle",
  drift: "la dérive des données",
  data_health: "la santé des données",
  data_monitoring: "le suivi des données",
  import: "le détail d'un import",
  privacy: "le dossier « droit d'accès » d'un collaborateur",
  settings: "les paramètres",
  audit: "le journal d'audit",
  admin: "la console d'administration",
};

function phrase(e: AuditEntry, users: Map<string, string>): Phrase {
  const d = parse(e.detail);
  const account = () => {
    const login = (e.targetId && users.get(e.targetId)) || (typeof d.login === "string" ? d.login : null);
    return login ? `le compte ${login}` : `le compte${n(e.targetId)}`;
  };
  const employee = `la fiche du collaborateur${n(e.targetId)}`;
  switch (e.action) {
    case "employee.view":
      return { verb: V.ouvrir, object: employee };
    case "employee.news.view":
      return { verb: V.consulter, object: `l'actualité de la fiche du collaborateur${n(e.targetId)}` };
    case "employee.journey.view":
      return { verb: V.consulter, object: `le parcours du collaborateur${n(e.targetId)}` };
    case "employee.effects.view":
      return { verb: V.consulter, object: `l'effet des actions pour le collaborateur${n(e.targetId)}` };
    case "employee.list":
      return { verb: V.consulter, object: "la liste des collaborateurs" };
    case "employee.deeplink":
      return { verb: V.ouvrir, object: "une fiche collaborateur depuis AJIR" };
    case "whatif.run":
      return { verb: V.lancer, object: `une simulation « et si ? » pour le collaborateur${n(e.targetId)}` };
    case "user.create":
      return { verb: V.creer, object: account(), extra: typeof d.role === "string" ? `rôle ${ROLE_NAME[d.role] ?? d.role}` : undefined };
    case "user.activation_link":
      return { verb: V.generer, object: `un lien d'activation pour ${account()}` };
    case "user.unlock":
      return { verb: V.deverrouiller, object: account() };
    case "user.deactivate":
      return { verb: V.desactiver, object: account() };
    case "user.reactivate":
      return { verb: V.reactiver, object: account() };
    case "user.activate":
      return { verb: V.activer, object: e.targetType === "activation" ? "un compte avec un lien d'activation" : account() };
    case "user.password_change":
      return { verb: V.changer, object: "son mot de passe" };
    case "user.password.demo":
      return { verb: V.modifier, object: `le mot de passe de démonstration de ${account()}` };
    case "user.list":
      return { verb: V.consulter, object: "la liste des comptes" };
    case "settings.update": {
      const changes = (d.changes ?? {}) as Record<string, { from: string | null; to: string | null }>;
      const parts = Object.entries(changes).map(([k, c]) => {
        const label = settingUiLabel(k) ?? k;
        const show = (v: string | null) => (v == null ? "aucune valeur" : Number.isFinite(Number(v)) && v !== "" && !k.startsWith("smig_schedule") ? formatSetting(k, Number(v)) : "nouveau barème");
        return k === "smig_schedule" ? `${label} modifié` : `${label} : ${show(c.from)} → ${show(c.to)}`;
      });
      return { verb: V.modifier, object: "les paramètres", extra: parts.join(" ; ") || undefined };
    }
    case "alert.update":
      return {
        verb: V.changer,
        object: `le statut de l'alerte${n(e.targetId)}`,
        extra: typeof d.from === "string" && typeof d.to === "string" ? `${ALERT_STATUS[d.from] ?? d.from} → ${ALERT_STATUS[d.to] ?? d.to}` : undefined,
      };
    case "alert.view":
      return { verb: V.ouvrir, object: `l'alerte${n(e.targetId)}` };
    case "import.upload":
      return { verb: V.deposer, object: "un export AJIR" };
    case "import.run":
      return { verb: V.lancer, object: `l'import AJIR${n(e.targetId)}` };
    case "import.list":
      return { verb: V.consulter, object: "l'historique des imports" };
    case "job.enqueue":
      return { verb: V.lancer, object: `un traitement${typeof d.type === "string" ? ` (${d.type.toLowerCase()})` : ""}` };
    case "scoring.publish":
      return {
        verb: V.publier,
        object: `le calcul des risques${n(e.targetId)}`,
        extra: [d.asOf ? `au ${date(String(d.asOf))}` : "", typeof d.nScored === "number" ? `${d.nScored.toLocaleString("fr-FR")} collaborateurs évalués` : ""].filter(Boolean).join(", ") || undefined,
      };
    case "scoring.supersede":
      return { verb: V.remplacer, object: `les recommandations obsolètes du calcul${n(e.targetId)}` };
    case "scoring.rollback":
      return { verb: V.revenir, object: `un calcul précédent${n(e.targetId)}` };
    case "model.register":
      return { verb: V.enregistrer, object: `le modèle « ${e.targetId ?? "?"} »` };
    case "model.promote":
      return { verb: V.mettreEnService, object: `le modèle « ${e.targetId ?? "?"} »` };
    case "model.rollback":
      return { verb: V.revenir, object: `un modèle précédent` };
    case "recommendation.decide":
      return { verb: V.decider, object: `de la suite de la recommandation${n(e.targetId)}` };
    case "recommendation.feedback":
      return { verb: V.donner, object: `un retour sur la recommandation${n(e.targetId)}` };
    case "recommendation.list":
      return { verb: V.consulter, object: "les recommandations" };
    case "insight.update":
    case "insight.recommendation.update":
    case "training.recommendation.update":
      return { verb: V.modifier, object: `le statut d'une recommandation${n(e.targetId)}` };
    case "privacy.request.create":
      return { verb: V.enregistrer, object: `une demande de droit d'accès${n(e.targetId)}` };
    case "privacy.request.close":
      return { verb: V.cloturer, object: `la demande de droit d'accès${n(e.targetId)}` };
    case "privacy.export":
      return { verb: V.exporter, object: `la copie des données de la demande${n(e.targetId)}` };
    case "privacy.opposition.record":
      return { verb: V.enregistrer, object: "une opposition au calcul du risque" };
    case "privacy.opposition.lift":
      return { verb: V.lever, object: "une opposition au calcul du risque" };
    case "privacy.list":
      return { verb: V.consulter, object: "le registre des demandes de droit d'accès" };
    case "privacy.search":
      return { verb: V.rechercher, object: "un collaborateur dans « Droit d'accès »" };
    case "export.csv": {
      const rows = typeof d.rows === "number" ? `${d.rows.toLocaleString("fr-FR")} ligne${d.rows > 1 ? "s" : ""}${d.truncated ? ", plafond de 10 000 atteint" : ""}` : undefined;
      return { verb: V.exporter, object: `${EXPORT_LIST[e.targetId ?? ""] ?? "une liste"} au format CSV`, extra: rows };
    }
    case "auth.ajir_launch":
      return { verb: V.ouvrir, object: "l'outil depuis AJIR" };
    case "access.page":
    case "access.api": {
      const required = Array.isArray(d.required) ? (d.required as string[]).map((r) => ROLE_NAME[r] ?? r).join(" ou ") : null;
      return { verb: V.ouvrir, object: pageName(e.targetId), extra: required ? `réservée au rôle ${required}` : undefined };
    }
  }
  if (e.action.endsWith(".view")) {
    const key = e.action.slice(0, -".view".length);
    const object = VIEWS[key];
    if (object) return { verb: V.consulter, object };
  }
  if (e.action === "admin.overview" || e.action === "admin.monitoring") return { verb: V.consulter, object: VIEWS.admin };
  return { verb: V.consulter, object: `l'élément « ${e.action} »` };
}

const LOGIN_REASON: Record<string, string> = {
  inconnu_ou_inactif: "identifiant inconnu ou compte désactivé",
  verrouille: "compte verrouillé après plusieurs échecs",
  mot_de_passe: "mot de passe incorrect",
  limite_ip: "trop de tentatives depuis cette adresse",
};

/** Phrase complète ; `self` : formulée pour l'utilisateur lui-même (« Vous avez … »). */
export function describeAudit(e: AuditEntry, users: Map<string, string> = new Map(), self = false): string {
  const anonymous = e.action.startsWith("auth.") || e.action.startsWith("access.") || e.action === "user.activate" ? "Un visiteur non connecté" : "Le système (tâche automatique)";
  const who = self ? "Vous" : (e.login ?? anonymous);
  if (e.action === "auth.login" || e.action === "auth.logout") {
    const d = parse(e.detail);
    if (e.action === "auth.logout") return self ? "Vous vous êtes déconnecté." : `${who} s'est déconnecté.`;
    if (e.outcome === "OK") return self ? "Vous vous êtes connecté." : `${who} s'est connecté.`;
    const reason = typeof d.reason === "string" ? LOGIN_REASON[d.reason] ?? d.reason : null;
    const typed = !e.login && e.targetId && !/^\d+$/.test(e.targetId) ? ` avec l'identifiant « ${e.targetId} »` : "";
    const attempts = typeof d.attempts === "number" ? `, ${d.attempts}e échec` : "";
    const base = self ? "Connexion refusée" : `Connexion refusée pour ${e.login ?? "un visiteur"}${typed}`;
    return `${base}${reason ? ` (${reason}${attempts})` : ""}.`;
  }
  const p = phrase(e, users);
  const extra = p.extra ? ` (${p.extra})` : "";
  if (e.outcome === "REFUSE") {
    const tried = self ? `avez tenté ${de(p.verb.inf)}` : `a tenté ${de(p.verb.inf)}`;
    return `${who} ${tried} ${p.object}${extra} : accès refusé.`;
  }
  if (e.outcome === "ECHEC") return `${who} ${self ? "n'avez" : "n'a"} pas pu ${p.verb.inf} ${p.object}${extra}.`;
  return `${who} ${self ? p.verb.p2 : p.verb.p3} ${p.object}${extra}.`;
}

/** Libellé court d'une action, à l'infinitif (axe d'un graphique) : « Ouvrir la fiche du collaborateur » */
export function actionLabel(action: string): string {
  if (action === "auth.login") return "Se connecter";
  if (action === "auth.logout") return "Se déconnecter";
  const p = phrase({ action, outcome: "OK", login: null, targetType: null, targetId: null, detail: null }, new Map());
  const text = `${p.verb.inf} ${p.object}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Familles d'actions pour le filtre du journal (préfixe de l'action, filtrage côté DAL)
export const AUDIT_CATEGORIES: { prefix: string; label: string }[] = [
  { prefix: "auth.", label: "Connexions et déconnexions" },
  { prefix: "access.", label: "Pages ou services refusés" },
  { prefix: "user.", label: "Comptes utilisateurs" },
  { prefix: "settings.", label: "Paramètres" },
  { prefix: "employee.", label: "Fiches collaborateurs" },
  { prefix: "whatif.", label: "Simulations « et si ? »" },
  { prefix: "alert.", label: "Alertes" },
  { prefix: "recommendation.", label: "Recommandations" },
  { prefix: "privacy.", label: "Droit d'accès des personnes" },
  { prefix: "export.", label: "Exports de listes" },
  { prefix: "import.", label: "Imports AJIR" },
  { prefix: "job.", label: "Traitements lancés" },
  { prefix: "scoring.", label: "Calculs des risques" },
  { prefix: "model.", label: "Modèles" },
  { prefix: "audit.", label: "Consultations du journal" },
];
