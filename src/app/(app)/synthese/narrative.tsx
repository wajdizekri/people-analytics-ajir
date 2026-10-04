import { SectionHeader, cardCls } from "@/components/ui";
import { InfoTip } from "@/components/help";
import type { Narrative } from "@/lib/ai/narrative";
import type { AccessContext } from "@/lib/dal/context";
import type { AuditMeta } from "@/lib/dal/employees";
import { getSynthesisNarrative, type SynthesisDto } from "@/lib/dal/synthesis";

function sourceLine(n: Narrative, pending: boolean): string {
  if (pending) return "Reformulation par IA générative en cours : version par phrases types affichée en attendant.";
  if (n.source === "IA") return `Reformulé par IA générative (modèle ${n.model}) à partir des seuls agrégats ; chaque chiffre a été vérifié.`;
  return n.fallback ? "Rédaction par phrases types : la reformulation par IA générative n'a pas abouti." : "Rédaction par phrases types, sans IA générative.";
}

// Encadré « Synthèse du mois en quelques phrases » : une phrase par ligne, méthode de rédaction toujours indiquée
export function NarrativeBox({ narrative, pending = false }: { narrative: Narrative; pending?: boolean }) {
  return (
    <section aria-labelledby="synthese-redigee-titre" aria-busy={pending || undefined} className={`${cardCls} p-4 sm:p-5`}>
      <SectionHeader
        id="synthese-redigee-titre"
        title="Synthèse du mois en quelques phrases"
        tip={
          <InfoTip label="Comment ce texte est rédigé">
            Phrases construites à partir des chiffres clés de cette page, pour votre périmètre, sans aucune donnée nominative. Si l&apos;option est activée sur
            le serveur, une IA générative les reformule à partir des seuls agrégats. Un chiffre non fourni entraîne le retour aux phrases types.
          </InfoTip>
        }
      />
      <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg marker:text-fg-subtle">
        {narrative.sentences.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
        Texte rédigé automatiquement à partir des indicateurs ci-dessous. {sourceLine(narrative, pending)}
      </p>
    </section>
  );
}

// Version reformulée, rendue dans un <Suspense> dont le repli est la version par phrases types (la page n'attend pas l'API)
export async function AiNarrative({ ctx, synthesis, meta }: { ctx: AccessContext; synthesis: SynthesisDto; meta: AuditMeta }) {
  return <NarrativeBox narrative={await getSynthesisNarrative(ctx, synthesis, meta)} />;
}
