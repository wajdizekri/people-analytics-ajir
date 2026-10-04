import Link from "next/link";
import type { ReactNode } from "react";

// Encart « À quoi sert cette page » : une phrase, trois repères au plus, un lien vers la rubrique d'aide.
export function PageIntro({ children, points, helpHref }: { children: ReactNode; points?: ReactNode[]; helpHref?: string }) {
  return (
    <section aria-labelledby="page-intro-titre" className="mb-4 flex gap-3 rounded-card border border-info/25 bg-surface px-4 py-3 text-sm text-fg-muted shadow-card">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-info" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01" />
      </svg>
      <div className="min-w-0">
        <h2 id="page-intro-titre" className="text-sm font-semibold text-heading">
          À quoi sert cette page
        </h2>
        <p className="mt-0.5">{children}</p>
        {points && points.length > 0 && (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-fg-muted">
            {points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        )}
        {helpHref && (
          <p className="mt-1.5">
            <Link href={helpHref} className="text-link underline underline-offset-2 transition-colors duration-150 hover:decoration-2">
              En savoir plus dans l&apos;aide
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
