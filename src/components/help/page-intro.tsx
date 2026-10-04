import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icons";

// Lien discret « Aide » vers la rubrique de la page ; rien sans helpHref. Le texte d'introduction (children, points) n'est plus affiché.
export function PageIntro({ helpHref }: { children?: ReactNode; points?: ReactNode[]; helpHref?: string }) {
  if (!helpHref) return null;
  return (
    <p className="mb-4">
      <Link
        href={helpHref}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-control px-1 text-[13px] font-medium text-link underline-offset-2 transition-colors duration-150 hover:bg-primary-soft hover:underline"
      >
        <Icon name="help" className="h-4 w-4" />
        Aide
        <span className="sr-only"> sur cette page</span>
      </Link>
    </p>
  );
}
