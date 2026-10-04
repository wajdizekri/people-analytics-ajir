"use client";

import { useEffect, useRef, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import "./print.css";

// Thème sombre suspendu le temps de l'impression (les graphiques se redessinent en clair), rétabli ensuite
function suspendDarkTheme(): (() => void) | null {
  const d = document.documentElement;
  if (d.getAttribute("data-theme") !== "dark") return null;
  d.classList.add("pa-theme-switching");
  d.setAttribute("data-theme", "light");
  return () => {
    if (d.getAttribute("data-theme") === "light") d.setAttribute("data-theme", "dark");
    d.classList.remove("pa-theme-switching");
  };
}

export function PrintButton({
  label = "Imprimer / PDF",
  variant = "secondary",
  size = "md",
  className = "",
}: {
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const restore = useRef<(() => void) | null>(null);

  useEffect(() => {
    const before = () => {
      restore.current ??= suspendDarkTheme();
    };
    const after = () => {
      restore.current?.();
      restore.current = null;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      after();
    };
  }, []);

  const print = () => {
    const undo = suspendDarkTheme();
    if (!undo) return window.print();
    restore.current = undo;
    setPending(true);
    // Deux images et un court délai : graphiques redessinés en clair avant l'aperçu
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        setTimeout(() => {
          setPending(false);
          window.print();
        }, 150),
      ),
    );
  };

  return (
    <Button variant={variant} size={size} icon="printer" onClick={print} pending={pending} pendingLabel="Préparation…" className={`print:hidden ${className}`}>
      {label}
    </Button>
  );
}
