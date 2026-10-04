import Link from "next/link";
import { Icon, fmt } from "@/components/ui";

// none : texte affiché quand il n'y a rien (« Aucune nouvelle alerte ») ; à défaut « 0 <singular> »
export type Shortcut = { href: string; count: number; singular: string; plural: string; detail?: string; urgent?: boolean; none?: string };

// Bandeau « À traiter » : accès direct aux éléments qui attendent une action (alertes nouvelles, décisions en attente).
// Un élément à zéro est un simple texte coché, pas un lien vers une liste vide.
export function ShortcutBar({ items, note }: { items: Shortcut[]; note?: string }) {
  if (!items.length) return null;
  return (
    <nav aria-label="À traiter" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="inline-flex items-center gap-1.5 font-semibold text-heading">
        <Icon name="inbox" className="h-4 w-4 text-fg-subtle" />
        À traiter
      </span>
      <ul className="flex flex-wrap gap-2">
        {items.map((s) => (
          <li key={s.href}>
            {s.count > 0 ? (
              <Link
                href={s.href}
                className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 shadow-sm transition-colors duration-150 active:translate-y-px ${
                  s.urgent ? "border-danger/40 bg-danger-soft text-danger hover:border-danger" : "border-info/40 bg-info-soft text-info hover:border-info"
                }`}
              >
                {s.urgent && <Icon name="warning" />}
                <span className="font-semibold tabular-nums">{fmt.int(s.count)}</span>
                <span>
                  {s.count > 1 ? s.plural : s.singular}
                  {s.detail && <span className="font-semibold">, {s.detail}</span>}
                </span>
                <Icon name="chevron-right" />
              </Link>
            ) : (
              <span className="inline-flex min-h-10 items-center gap-1.5 px-1 text-fg-muted">
                <Icon name="check" className="h-4 w-4 text-success" />
                {s.none ?? `${fmt.int(0)} ${s.singular}`}
              </span>
            )}
          </li>
        ))}
      </ul>
      {note && <span className="text-xs text-fg-muted">{note}</span>}
    </nav>
  );
}
