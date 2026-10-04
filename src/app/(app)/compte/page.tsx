import type { ReactNode } from "react";
import { pageContext } from "@/lib/dal/context";
import { getAccount } from "@/lib/dal/account";
import type { Role } from "@/db/schema";
import { EmptyState, Initials, Notice, PageHeader, ThemeToggle, cardCls, fmt, tableCls } from "@/components/ui";
import { Icon, OutcomeBadge, ROLE_LABEL, RoleBadge } from "@/components/admin/admin-ui";
import { describeAudit } from "@/components/admin/audit-labels";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Mon compte — People Analytics AJIR" };

const RIGHTS: Record<Role, { can: string[]; cannot: string[]; why: string }> = {
  ADMIN: {
    can: [
      "Créer, débloquer et désactiver les comptes",
      "Régler les paramètres de calcul et de contrôle",
      "Consulter le journal d'audit et les refus d'accès",
      "Importer les exports AJIR et suivre les calculs",
      "Suivre le modèle et sa fiabilité (mise en service par une procédure tracée, hors de l'interface)",
    ],
    cannot: ["Fiches collaborateurs, salaires et estimations individuelles", "Tableaux de bord RH, absentéisme et recommandations"],
    why: "L'administrateur gère l'outil sans voir les données des collaborateurs : c'est la séparation des tâches.",
  },
  RH: {
    can: [
      "Tableau de bord de toute l'entreprise, masse salariale comprise",
      "Fiches complètes : rémunération, estimation chiffrée, facteurs détaillés",
      "Recommandations, simulation « et si ? » et vérification a posteriori",
      "Santé des données, transparence du modèle et droit d'accès des personnes",
    ],
    cannot: ["Gestion des comptes, paramètres et journal d'audit (rôle administrateur)"],
    why: "Chaque consultation de fiche est tracée, pour protéger les collaborateurs et vous-même.",
  },
  MANAGER: {
    can: ["Tableau de bord et liste de votre équipe", "Niveau de risque et grandes catégories de facteurs", "Alertes de votre équipe"],
    cannot: [
      "Salaires, masse salariale et probabilités chiffrées",
      "Signaux individuels d'absentéisme",
      "Indicateurs sur un groupe de moins de 5 personnes",
      "Collaborateurs hors de votre hiérarchie",
    ],
    why: "Ces limites protègent la vie privée de vos collaborateurs ; la RH dispose du détail si besoin.",
  },
};

function Panel({ id, title, icon, children, className = "" }: { id: string; title: string; icon: "id" | "check" | "lock" | "clock" | "sliders"; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`${cardCls} min-w-0 p-5 ${className}`}>
      <h2 id={id} className="mb-4 flex scroll-mt-4 items-center gap-2 text-base font-semibold text-heading">
        <span aria-hidden="true" className="inline-flex h-8 w-8 items-center justify-center rounded-control bg-primary-soft text-link ring-1 ring-inset ring-primary/25">
          <Icon name={icon} />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-medium text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-fg">{children}</dd>
    </div>
  );
}

export default async function AccountPage() {
  const ctx = await pageContext();
  const a = getAccount(ctx);
  const rights = RIGHTS[a.role];
  const activity = a.activity.map((r) => ({
    ...r,
    text: describeAudit({ action: r.action, outcome: r.outcome, login: a.login, targetType: null, targetId: null, detail: null }, undefined, true),
  }));
  const scope =
    a.role === "ADMIN"
      ? "Administration de l'outil, sans accès aux données RH nominatives"
      : a.role === "RH"
        ? "Toute l'entreprise"
        : `Votre équipe : ${fmt.int(a.teamSize)} collaborateur${(a.teamSize ?? 0) > 1 ? "s" : ""}`;

  return (
    <>
      <PageHeader eyebrow="Aide et compte" title="Mon compte" subtitle="Vos informations, ce que votre rôle permet de voir et la sécurité de votre accès." />

      <div className="mb-4">
        <Notice tone="info" title="Votre accès est protégé.">
          Une session se ferme après 2 heures sans activité. Vos actions sensibles sont tracées dans un journal que personne ne peut modifier.
          {a.lastLoginAt && (
            <>
              {" "}
              Connexion précédente : le {fmt.dateTime(a.lastLoginAt)} ; si ce n&apos;était pas vous,{" "}
              <a href="#cp-mdp" className="font-medium text-link underline underline-offset-2 hover:decoration-2">
                changez votre mot de passe
              </a>
              .
            </>
          )}
        </Notice>
      </div>

      {/* Deux colonnes indépendantes (hauteurs libres) ; sur mobile : profil, affichage, mot de passe, droits, activité */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <Panel id="cp-profil" title="Profil" icon="id">
            <div className="flex items-center gap-4 rounded-lg bg-linear-to-r from-primary-soft to-surface p-3 ring-1 ring-inset ring-primary/20">
              <Initials name={a.employee?.name || a.login} className="size-14! bg-primary! text-lg! text-primary-fg! ring-4 ring-accent/40" />
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-heading">{a.employee?.name || a.login}</p>
                <div className="mt-1">
                  <RoleBadge role={a.role} />
                </div>
              </div>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="Identifiant de connexion">
                <span className="font-mono font-medium">{a.login}</span>
              </Field>
              <Field label="Rôle">{ROLE_LABEL[a.role]}</Field>
              <Field label="Ce que vous voyez" wide>
                {scope}
              </Field>
              <Field label="E-mail">{a.email ? <span className="break-all">{a.email}</span> : <span className="text-fg-muted">non renseigné</span>}</Field>
              <Field label="Collaborateur lié">
                {a.employee ? (
                  <>
                    {a.employee.name} <span className="font-mono text-xs text-fg-muted">({a.employee.matricule})</span>
                  </>
                ) : (
                  <span className="text-fg-muted">aucun</span>
                )}
              </Field>
              <Field label="Compte créé le">{fmt.date(a.createdAt)}</Field>
              <Field label="Sessions ouvertes">
                <span className="tabular-nums">{fmt.int(a.openSessions)}</span>
                <span className="text-fg-muted"> (dont celle-ci)</span>
              </Field>
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-xs text-fg-muted">
              Une information est inexacte ? L&apos;administrateur de l&apos;outil peut la corriger ; votre fiche collaborateur se corrige dans AJIR.
            </p>
          </Panel>

          <Panel id="cp-affichage" title="Affichage" icon="sliders">
            <ThemeToggle variant="segmented" />
            <p className="mt-2 text-xs text-fg-muted">
              « Système » suit le réglage clair ou sombre de votre ordinateur. Le choix s&apos;applique tout de suite et reste mémorisé sur cet appareil.
            </p>
          </Panel>

          <Panel id="cp-mdp" title="Changer mon mot de passe" icon="lock">
            <PasswordForm login={a.login} otherSessions={Math.max(0, a.openSessions - 1)} />
          </Panel>

        </div>
        <div className="min-w-0 space-y-4">
          <Panel id="cp-droits" title="Ce que votre rôle permet" icon="check">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-success-soft/60 p-3 ring-1 ring-inset ring-success/20">
                <h3 className="text-sm font-semibold text-success">Vous pouvez</h3>
                <ul className="mt-2 space-y-2 text-sm text-fg">
                  {rights.can.map((r) => (
                    <li key={r} className="flex gap-2">
                      <span aria-hidden="true" className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success text-surface">
                        <Icon name="check" className="h-3 w-3" />
                      </span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg bg-surface-2 p-3 ring-1 ring-inset ring-line">
                <h3 className="text-sm font-semibold text-fg">Réservé à d&apos;autres rôles</h3>
                <ul className="mt-2 space-y-2 text-sm text-fg-muted">
                  {rights.cannot.map((r) => (
                    <li key={r} className="flex gap-2">
                      <Icon name="lock" className="mt-0.5 h-4 w-4 text-fg-subtle" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-3 text-sm text-fg-muted">{rights.why}</p>
          </Panel>

          <Panel id="cp-activite" title="Mon activité récente" icon="clock">
            <p className="-mt-2 mb-3 text-sm text-fg-muted">Vos 10 dernières actions enregistrées. Une action que vous ne reconnaissez pas ? Changez votre mot de passe et prévenez l&apos;administrateur.</p>
            {a.activity.length === 0 ? (
              <EmptyState compact title="Aucune activité enregistrée pour l'instant">
                Vos connexions et vos actions sensibles (consultations, modifications) apparaîtront ici.
              </EmptyState>
            ) : (
              // Panneau étroit (mobile, deux colonnes à 1024 px) : une ligne par action ; tableau dès 448 px de large
              <div className="@container">
                <ul aria-label="Vos 10 dernières actions enregistrées" className="divide-y divide-line @md:hidden">
                  {activity.map((r) => (
                    <li key={r.id} className="py-2.5">
                      <p className="text-sm text-fg">{r.text}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-xs tabular-nums text-fg-muted">{fmt.dateTime(r.at)}</span>
                        <OutcomeBadge outcome={r.outcome} />
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto @md:block">
                  <table className={tableCls.table}>
                    <caption className="sr-only">Vos 10 dernières actions enregistrées</caption>
                    <thead className={tableCls.thead}>
                      <tr>
                        <th scope="col" className={tableCls.th}>Date et heure</th>
                        <th scope="col" className={tableCls.th}>Action</th>
                        <th scope="col" className={tableCls.th}>Résultat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activity.map((r) => (
                        <tr key={r.id} className={tableCls.tr}>
                          <td className={`${tableCls.td} whitespace-nowrap tabular-nums text-fg-muted`}>{fmt.dateTime(r.at)}</td>
                          <td className={tableCls.td}>{r.text}</td>
                          <td className={tableCls.td}><OutcomeBadge outcome={r.outcome} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
