import type { ReactNode } from "react";
import { toastResult, type ActionResult, type ActionToastOptions } from "@/components/ui/toast";

/**
 * Toast du résultat d'une Server Action, émis au retour de l'appel (dans la fonction passée à useActionState) :
 * il part même si le formulaire disparaît au rafraîchissement. Délègue à toastResult (@/components/ui/toast).
 */
export function announce<T extends ActionResult>(res: T, o: ActionToastOptions & { error: ReactNode }): T {
  toastResult(res, o);
  return res;
}
