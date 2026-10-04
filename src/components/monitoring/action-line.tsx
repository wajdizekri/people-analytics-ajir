import type { ReactNode } from "react";

// Action d'un verdict du monitoring, au format libellé + valeur : « Action : Vérifier la saisie dans AJIR »
export function ActionLine({ children, className = "mt-2" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-sm text-fg ${className}`}>
      <span className="font-semibold">Action : </span>
      {children}
    </p>
  );
}
