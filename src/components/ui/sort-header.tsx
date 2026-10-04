import Link from "next/link";
import { Icon } from "./icons";

export type SortDir = "asc" | "desc";

// En-tête de colonne triable côté serveur (tri dans l'adresse) : même rendu que les en-têtes de DataTable (flèche, aria-sort, état annoncé)
export function SortHeader({
  label,
  href,
  active,
  dir,
  className = "",
}: {
  label: string;
  href: string;
  active: boolean;
  dir: SortDir;
  className?: string;
}) {
  return (
    <th scope="col" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"} className={className}>
      <Link
        href={href}
        className={`group -mx-1.5 inline-flex min-h-8 items-center gap-1 rounded-control px-1.5 transition-colors duration-150 hover:bg-surface-3 hover:text-fg ${active ? "text-fg" : ""}`}
      >
        {label}
        <Icon
          name={active ? (dir === "asc" ? "arrow-up" : "arrow-down") : "arrow-up-down"}
          className={`h-3.5 w-3.5 transition-opacity ${active ? "text-link" : "opacity-50 group-hover:opacity-100"}`}
        />
        <span className="sr-only">{active ? ` : trié ${dir === "asc" ? "par ordre croissant" : "par ordre décroissant"}, activer pour inverser` : " : activer pour trier"}</span>
      </Link>
    </th>
  );
}
