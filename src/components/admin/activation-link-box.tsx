"use client";

import { useEffect, useState } from "react";
import { Button, fmt } from "@/components/ui";
import { Icon } from "./admin-ui";

export function ActivationLinkBox({ url, login, expiresAt }: { url: string; login: string; expiresAt: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const id = `activation-${login}`;
  // « Lien copié » revient à « Copier le lien » après quelques secondes (nouvelle copie possible)
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 4000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="mt-2 max-w-xl rounded-control border border-success/30 border-l-4 border-l-success bg-success-soft p-3 text-sm text-fg">
      <label htmlFor={id} className="flex items-center gap-1.5 font-semibold">
        <Icon name="link" className="h-4 w-4 text-success" />
        Lien d&apos;activation pour {login}
      </label>
      <p className="mt-1 text-xs text-fg-muted">Étape suivante : copiez ce lien et transmettez-le à la personne par un canal sûr (messagerie interne, en main propre).</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id={id}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 basis-56 min-h-10 rounded-control border border-line-strong bg-surface px-2 py-2 font-mono text-xs text-fg focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
        />
        <Button
          size="sm"
          variant="primary"
          icon={copied ? "check" : "copy"}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Lien copié" : "Copier le lien"}
        </Button>
      </div>
      {copied === false && <p className="mt-1 text-xs font-medium text-danger">Copie automatique impossible : sélectionnez le lien puis copiez-le (Ctrl+C).</p>}
      <p className="mt-2 flex items-start gap-1.5 text-xs text-fg-muted">
        <Icon name="clock" className="mt-px h-3.5 w-3.5" />
        <span>Valable jusqu&apos;au {fmt.dateTime(expiresAt)}, une seule fois. Il ne sera plus affiché ensuite : en cas de perte, générez-en un nouveau.</span>
      </p>
    </div>
  );
}
