import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EXPORT_LABEL, EXPORT_MAX_ROWS, exportHref, type ExportKind, type RawSearchParams } from "@/lib/export/kinds";

const int = (n: number) => n.toLocaleString("fr-FR");

// Téléchargement du CSV de la liste affichée : reprend les filtres et le tri de l'URL courante ; périmètre et colonnes fixés par le serveur
export function ExportButton({
  kind,
  searchParams = {},
  total,
  variant = "secondary",
  size = "md",
  className = "",
}: {
  kind: ExportKind;
  searchParams?: RawSearchParams;
  /** Nombre de lignes de la liste filtrée : au-delà du plafond, le bouton le signale. */
  total?: number;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const capped = total != null && total > EXPORT_MAX_ROWS;
  return (
    <span className={`inline-flex flex-col items-end gap-1 print:hidden ${className}`}>
      <a href={exportHref(kind, searchParams)} download className={buttonClass(variant, size)}>
        <Icon name="download" />
        Exporter (CSV)
        <span className="sr-only"> : {EXPORT_LABEL[kind]} avec les filtres affichés</span>
      </a>
      {capped && (
        <span className="text-xs text-fg-muted">
          Fichier limité aux {int(EXPORT_MAX_ROWS)} premières lignes sur {int(total)}.
        </span>
      )}
    </span>
  );
}
