"use client";

import { useId, useState, type ChangeEvent, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { fieldCls } from "@/components/ui/classes";
import { Icon } from "@/components/ui/icons";

// Champ mot de passe : bouton icône afficher / masquer (bascule aria-pressed, libellé accessible constant) et
// avertissement Verr. Maj. relié au champ. Le libellé du bouton est un texte masqué, pas un aria-label : il ne
// se confond pas avec le libellé du champ (getByLabel("Mot de passe") reste univoque).

/** Champ des pages d'authentification (44 px) ; en erreur, bordure rouge à la place de la bordure de champ. */
export function authFieldCls(invalid = false) {
  const cls = fieldCls.replace("min-h-10", "min-h-11");
  return invalid ? cls.replace("border-line-strong", "border-danger").replace("hover:border-fg-muted", "hover:border-danger") : cls;
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return <Icon name={crossed ? "eye-off" : "eye"} className="h-5 w-5" />;
}

type Props = {
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  /** Libellé accessible du bouton (« Afficher le mot de passe »). */
  toggleLabel?: string;
  /** Élément à droite du libellé (lien d'aide). */
  labelAside?: ReactNode;
  /** Identifiants d'aide et d'erreur, ajoutés à aria-describedby. */
  describedBy?: string;
  invalid?: boolean;
  /** Erreur propre au champ, affichée juste sous lui (id `${id}-erreur`) ; met le champ en erreur. */
  error?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  value?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  ref?: Ref<HTMLInputElement>;
  /** Contenu sous le champ (règles de saisie). */
  children?: ReactNode;
};

export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  toggleLabel = "Afficher le mot de passe",
  labelAside,
  describedBy,
  invalid: invalidProp = false,
  error,
  required = true,
  minLength,
  maxLength,
  value,
  onChange,
  ref,
  children,
}: Props) {
  const [show, setShow] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const capsId = useId();
  const watchCaps = (e: KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState("CapsLock"));
  const errorId = `${id}-erreur`;
  const invalid = invalidProp || !!error;
  const described = [describedBy, error ? errorId : null, capsLock ? capsId : null].filter(Boolean).join(" ") || undefined;

  // Le lien d'aide (labelAside) est affiché à droite du libellé mais placé après le champ dans le DOM : au clavier,
  // Tab passe de l'identifiant au mot de passe sans s'arrêter sur « Mot de passe oublié ? ».
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
        <label htmlFor={id} className="col-start-1 row-start-1 block text-sm font-medium text-fg">
          {label}
        </label>
        <div className="relative col-span-2 row-start-2 mt-1">
          <input
            ref={ref}
            id={id}
            name={name}
            type={show ? "text" : "password"}
            autoComplete={autoComplete}
            autoCapitalize="none"
            spellCheck={false}
            required={required}
            minLength={minLength}
            maxLength={maxLength}
            value={value}
            onChange={onChange}
            onKeyDown={watchCaps}
            onKeyUp={watchCaps}
            onBlur={() => setCapsLock(false)}
            aria-invalid={invalid || undefined}
            aria-describedby={described}
            className={`${authFieldCls(invalid)} pr-12`}
          />
          <button
            type="button"
            aria-pressed={show}
            aria-controls={id}
            onClick={() => setShow((s) => !s)}
            className="absolute bottom-px right-px top-px inline-flex w-11 items-center justify-center rounded-r-control text-fg-muted transition-colors duration-150 hover:bg-surface-3 hover:text-fg active:translate-y-px aria-pressed:text-link"
          >
            <EyeIcon crossed={show} />
            <span className="sr-only">{toggleLabel}</span>
          </button>
        </div>
        {labelAside && <div className="col-start-2 row-start-1">{labelAside}</div>}
      </div>
      {error && (
        <p id={errorId} className="mt-1.5 flex items-start gap-1.5 text-sm font-medium text-danger">
          <Icon name="error" className="mt-0.5 h-4 w-4" />
          {error}
        </p>
      )}
      {children}
      <p id={capsId} aria-live="polite" className="text-xs font-medium text-warning">
        {capsLock && (
          <span className="mt-1.5 inline-flex items-center gap-1.5">
            <Icon name="warning" className="h-3.5 w-3.5" />
            Majuscules verrouillées (touche Verr. Maj).
          </span>
        )}
      </p>
    </div>
  );
}
