import { InfoTip } from "@/components/help/info-tip";
import { Badge, Icon, fmt } from "@/components/ui";
import { boundsLabel, formatSetting, toDisplay, unitOf, type SettingUi } from "./settings-labels";

export type SettingField = {
  key: string;
  value: string;
  defaultValue: string | null;
  min: number;
  max: number;
  step: number;
  int?: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};
export type SettingMeta = { updatedAt: string | null; updatedBy: string | null };

// La date d'installation n'est pas une modification : sans auteur et à la valeur par défaut, rien n'a été changé
export function lastChange(m: SettingMeta, isDefault = false) {
  if (m.updatedBy) return `Modifié le ${fmt.date(m.updatedAt)} par ${m.updatedBy}`;
  if (isDefault || !m.updatedAt) return "Jamais modifié";
  return `Modifié le ${fmt.date(m.updatedAt)}`;
}

const inputCls =
  "block min-h-10 w-full min-w-0 rounded-l-control border bg-surface px-3 py-1.5 text-right text-sm font-medium tabular-nums text-fg transition-colors duration-150 focus:outline-none focus:ring-2";

// Ligne standard d'un paramètre. La grille (libellé à gauche, champ de 12rem à droite) est la même dans toutes les cartes :
// libellés et champs restent alignés sur toute la page. Quand la colonne des cartes fait moins de 32rem, le champ passe sous le libellé.
export function SettingRow({
  field: f,
  ui,
  value,
  raw,
  changed,
  error,
  effect,
  onChange,
}: {
  field: SettingField;
  ui: SettingUi;
  /** Valeur saisie, dans l'unité affichée. */
  value: string;
  /** Valeur saisie en unité de stockage ; NaN si vide ou illisible. */
  raw: number;
  changed: boolean;
  error: string | null;
  effect: string | null;
  onChange: (value: string) => void;
}) {
  const id = `s-${f.key}`;
  const def = f.defaultValue != null && f.defaultValue !== "" ? Number(f.defaultValue) : null;
  return (
    <div className="grid gap-x-6 gap-y-2 py-4 @lg:grid-cols-[minmax(0,1fr)_12rem]">
      {/* Position relative ici, statique sur la bulle : elle s'ouvre sous le libellé, calée à gauche, sans sortir de l'écran */}
      <div className="relative min-w-0">
        {/* En ligne : la bulle « ? » suit le dernier mot du libellé, même quand il passe sur deux lignes */}
        <div className="text-sm leading-6">
          <label htmlFor={id} className="font-semibold text-fg">
            {ui.label}
          </label>{" "}
          <InfoTip label={ui.label} align="start" className="static!">
            {ui.help}
          </InfoTip>
          {changed && (
            <>
              {" "}
              <Badge tone="warning">Modifié</Badge>
            </>
          )}
        </div>
        <p id={`${id}-help`} className="mt-0.5 text-xs text-fg-muted">
          {ui.short}
        </p>
      </div>
      <div className="w-48 max-w-full @lg:justify-self-end">
        <div className={`flex rounded-control transition-shadow duration-200 ${changed && !error ? "ring-2 ring-accent" : ""}`}>
          <input
            id={id}
            name={f.key}
            type="number"
            inputMode="decimal"
            min={toDisplay(f.key, f.min)}
            max={toDisplay(f.key, f.max)}
            step={toDisplay(f.key, f.step)}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required
            aria-invalid={!!error}
            aria-describedby={`${error ? `${id}-err ` : ""}${id}-help ${id}-bornes ${id}-meta ${id}-effect`}
            className={`${inputCls} ${error ? "border-danger focus:ring-danger/25" : "border-line-strong hover:border-fg-muted focus:border-primary focus:ring-primary/25"}`}
          />
          <span aria-hidden="true" className="inline-flex w-20 shrink-0 items-center justify-center rounded-r-control border border-l-0 border-line-strong bg-surface-2 px-1 text-xs font-medium text-fg-muted">
            {unitOf(f.key, toDisplay(f.key, raw))}
          </span>
        </div>
        {error && (
          <p id={`${id}-err`} className="mt-1 text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1 @lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-fg-subtle">
          <div className="flex flex-wrap items-center gap-x-1.5">
            <p id={`${id}-meta`}>
              Valeur par défaut : <span className="font-semibold text-fg-muted">{def != null ? formatSetting(f.key, def) : "aucune"}</span>
              <span aria-hidden="true"> · </span>
              {lastChange(f, def != null && Number(f.value) === def)}
            </p>
            {def != null && raw !== def && (
              <button
                type="button"
                onClick={() => onChange(String(toDisplay(f.key, def)))}
                className="-my-1 inline-flex min-h-8 items-center gap-1 rounded-control px-1.5 font-medium text-link underline-offset-2 transition-colors duration-150 hover:bg-primary-soft hover:underline active:translate-y-px"
              >
                <Icon name="refresh" className="h-3.5 w-3.5" />
                Rétablir la valeur par défaut<span className="sr-only"> : {ui.label}</span>
              </button>
            )}
          </div>
          <p id={`${id}-bornes`} className="tabular-nums">
            <span className="sr-only">Valeurs possibles : </span>
            {boundsLabel(f.key, f.min, f.max)}
          </p>
        </div>
        <p id={`${id}-effect`} className="text-xs text-fg-muted">
          <span className="font-semibold text-fg">Effet : </span>
          {effect ?? "saisissez une valeur valide pour le voir."}
        </p>
      </div>
    </div>
  );
}
