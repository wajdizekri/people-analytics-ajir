import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { InterventionEffects, Journey, WhatsNew } from "@/components/insights";
import { EmployeeHeader, EmployeeSummary, EstimationZone, FactsZone, SuggestionsZone } from "@/components/pilotage/employee-detail";
import { todayTunis } from "@/components/pilotage/labels";
import { WhatIfZone } from "@/components/pilotage/what-if";
import { Breadcrumb, safeReturn } from "@/components/ux/breadcrumb";
import { clientIp } from "@/lib/auth/session";
import { PILOTAGE_ROLES, pageContext } from "@/lib/dal/context";
import { getEmployeeDetail, type EmployeeDetailDto } from "@/lib/dal/employees";
import { HttpError } from "@/lib/dal/errors";
import { getEmployeeInterventionEffects, type EmployeeEffectsDto } from "@/lib/dal/interventions";
import { getOppositionFlag } from "@/lib/dal/privacy";
import { getEmployeeJourney, getEmployeeNews, type EmployeeJourneyDto, type EmployeeNewsDto } from "@/lib/dal/synthesis";
import { decideRecommendationAction, feedbackRecommendationAction } from "./actions";

export const metadata = { title: "Fiche collaborateur — People Analytics AJIR" };

const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// Pages d'origine d'où l'on revient à la liste filtrée (paramètre ?retour=, chemin interne validé) ; libellés = titre de la page d'origine
const ORIGINS: Record<string, string> = {
  "/employees": "Collaborateurs",
  "/backtesting": "Vérification a posteriori",
  "/absenteeism": "Absentéisme",
  "/recommendations": "Recommandations",
  "/alerts": "Alertes",
  "/organigramme": "Organigramme",
  "/charge": "Charge de travail",
  "/formations": "Formations obligatoires",
  "/synthese": "Synthèse du mois",
  "/interventions": "Interventions",
};
// Détail d'une alerte (/alerts/123) : retour vers l'alerte elle-même, pour la clôturer sans la rechercher
const ALERT_DETAIL = /^\/alerts\/\d{1,12}$/;

export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await pageContext(PILOTAGE_ROLES);
  const id = idSchema.safeParse((await params).id);
  if (!id.success) notFound();
  let d: EmployeeDetailDto;
  let news: EmployeeNewsDto;
  let journey: EmployeeJourneyDto;
  let effects: EmployeeEffectsDto;
  try {
    const meta = { source: "page" as const, ip: clientIp(await headers()) };
    d = getEmployeeDetail(ctx, id.data, meta);
    news = getEmployeeNews(ctx, id.data, meta);
    journey = getEmployeeJourney(ctx, id.data, meta);
    effects = getEmployeeInterventionEffects(ctx, id.data, meta);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    if (e instanceof HttpError && e.status === 403) redirect("/interdit");
    throw e;
  }
  const opposition = getOppositionFlag(ctx, d.employee.id);
  const rawRetour = (await searchParams)?.retour;
  const firstRetour = Array.isArray(rawRetour) ? rawRetour[0] : rawRetour;
  const alertBack = firstRetour && ALERT_DETAIL.test(firstRetour) ? firstRetour : undefined;
  const retour = alertBack ?? safeReturn(rawRetour, Object.keys(ORIGINS));
  const origin = retour ? retour.split(/[?#]/)[0] : "/employees";
  const originLabel = alertBack ? "Alerte" : origin === "/employees" && ctx.role === "MANAGER" ? "Mon équipe" : ORIGINS[origin];

  const simulation = d.view === "RH" && d.estimation.status === "OK" && !opposition;

  // Ordre de lecture : qui → en bref → nouveautés → Faits → Estimation → Parcours → Suggestions → suivi des actions → simulation.
  // Sous lg les zones s'empilent dans cet ordre (le parcours ne repousse plus l'estimation) ; à partir de lg, Faits puis Parcours
  // à gauche, Estimation à droite sur deux rangées (la 2e rangée, flexible, absorbe la hauteur en trop de l'estimation).
  return (
    <>
      <Breadcrumb items={[{ label: originLabel, href: retour ?? "/employees" }, { label: `${d.employee.lastName} ${d.employee.firstName}` }]} />
      <EmployeeHeader d={d} />
      <EmployeeSummary d={d} opposition={opposition} simulation={simulation} />
      <WhatsNew data={news} className="mt-6" />
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-12 lg:grid-rows-[auto_1fr]">
        <FactsZone d={d} className="lg:col-span-7" />
        <EstimationZone d={d} opposition={opposition} className="lg:col-span-5 lg:row-span-2" />
        <Journey data={journey} className="lg:col-span-7" />
      </div>
      <SuggestionsZone d={d} decideAction={decideRecommendationAction} feedbackAction={feedbackRecommendationAction} today={todayTunis()} className="mt-6" />
      {effects.items.length > 0 && <InterventionEffects data={effects} className="mt-6" />}
      {simulation && d.view === "RH" && (
        <WhatIfZone employeeId={d.employee.id} baseSalary={d.compensation.current?.baseSalary ?? null} grade={d.employee.grade} />
      )}
    </>
  );
}
