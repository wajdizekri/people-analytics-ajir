"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useFormStatus } from "react-dom";
import { Button, buttonClass, menuItemClass, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button";
import { Icon, Spinner, type IconName } from "./icons";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Boîte de dialogue modale accessible (élément <dialog> natif) : rôle dialog, titre et texte de conséquence reliés,
// focus piégé, Échap ou clic sur le fond pour annuler, focus rendu à l'élément d'origine à la fermeture.
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Annuler",
  tone = "danger",
  onConfirm,
  onCancel,
  returnFocus,
  extra,
}: {
  open: boolean;
  title: string;
  /** Texte de conséquence (description de la boîte). */
  children: ReactNode;
  /** Contenu complémentaire hors description (champ motif). */
  extra?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
      // Champ à remplir d'abord (motif) ; sinon, pour une action destructive, « Annuler » (l'action sans conséquence)
      const input = d.querySelector<HTMLElement>("textarea, input:not([type=hidden])");
      (input ?? (tone === "danger" ? cancelRef : confirmRef).current)?.focus();
    } else if (!open && d.open) {
      d.close();
      returnFocus?.current?.focus();
    }
  }, [open, tone, returnFocus]);

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    e.stopPropagation();
    if (e.key !== "Tab") return;
    const list = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descId}
      aria-modal="true"
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      style={{ width: "min(32rem, calc(100vw - 2rem))", maxWidth: "none" }}
      className="confirm-dialog m-auto animate-dialog-in rounded-card border border-line bg-surface p-0 text-left text-fg shadow-pop"
    >
      <div className="flex gap-3 p-5">
        <span
          aria-hidden="true"
          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tone === "danger" ? "bg-danger-soft text-danger" : "bg-primary-soft text-link"}`}
        >
          <Icon name={tone === "danger" ? "warning" : "info"} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold text-heading">
            {title}
          </h2>
          <div id={descId} className="mt-1.5 space-y-2 text-sm leading-relaxed text-fg-muted">
            {children}
          </div>
          {extra}
        </div>
      </div>
      <div className="flex flex-col-reverse gap-2 rounded-b-card border-t border-line bg-surface-2 px-5 py-3 sm:flex-row sm:justify-end">
        <button ref={cancelRef} type="button" onClick={onCancel} className={buttonClass("secondary")}>
          {cancelLabel}
        </button>
        <button ref={confirmRef} type="button" onClick={onConfirm} className={buttonClass(tone === "danger" ? "danger" : "primary")}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

export type ConfirmReason = {
  /** Nom du champ envoyé avec le formulaire (« comment », « motif »). */
  name: string;
  label: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  placeholder?: string;
  hint?: string;
};

/**
 * Bouton avec confirmation (remplace window.confirm). Deux usages :
 * - dans un formulaire (Server Action) : à la confirmation, le formulaire est soumis avec name/value/formAction du bouton ;
 * - avec onConfirm (composant client) : la fonction est appelée à la confirmation.
 * Le texte `consequence` dit ce qui va se passer (« La recommandation sera close. La décision est tracée. »).
 * `reason` ajoute un champ motif (facultatif ou obligatoire) dans la boîte, envoyé avec le formulaire sous `reason.name`.
 * La boîte est rendue dans le formulaire (jamais dans un portail) : les champs de `fields` et `reason` sont envoyés avec lui.
 * Tests E2E : page.getByRole("dialog").getByRole("button", { name: confirmLabel }).click().
 */
export function ConfirmButton({
  children,
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Annuler",
  variant = "danger",
  size = "md",
  icon,
  disabled,
  className = "",
  onConfirm,
  name,
  value,
  formAction,
  form,
  pendingLabel,
  menuItem = false,
  reason,
  pending: pendingProp = false,
  fields,
}: {
  children: ReactNode;
  /** Question posée : « Rejeter cette recommandation ? » */
  title: string;
  consequence: ReactNode;
  /** Libellé du bouton de confirmation ; par défaut le texte du bouton. */
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  disabled?: boolean;
  className?: string;
  onConfirm?: (reason?: string) => void;
  name?: string;
  value?: string;
  formAction?: ButtonProps["formAction"];
  form?: string;
  pendingLabel?: string;
  /** Rendu comme élément du menu « Plus d'actions ». */
  menuItem?: boolean;
  reason?: ConfirmReason;
  /** En cours imposé (envoi par useActionState + startTransition, que useFormStatus ne voit pas). */
  pending?: boolean;
  /** Champs de formulaire supplémentaires dans la boîte (date, avis…), envoyés avec le formulaire, hors du texte de conséquence. */
  fields?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const submitter = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const { pending } = useFormStatus();
  const busy = pendingProp || (pending && !onConfirm);
  const label = confirmLabel ?? (typeof children === "string" ? children : "Confirmer");

  const confirm = () => {
    const text = field.current?.value.trim() ?? "";
    if (reason) {
      const min = reason.minLength ?? (reason.required ? 1 : 0);
      if (text.length < min) {
        setError(
          reason.required && text.length === 0
            ? `${reason.label} : champ obligatoire. Saisissez un motif puis confirmez.`
            : `${reason.label} : ${min} caractères au moins (${text.length} saisis).`,
        );
        field.current?.focus();
        return;
      }
    }
    setError(null);
    setOpen(false);
    if (onConfirm) return onConfirm(reason ? text : undefined);
    const f = trigger.current?.form ?? (form ? (document.getElementById(form) as HTMLFormElement | null) : null);
    if (!f) return;
    if (typeof f.requestSubmit === "function") f.requestSubmit(submitter.current ?? undefined);
    else submitter.current?.click();
  };

  const tone = variant === "danger" ? "danger" : "primary";
  const reasonField = reason && (
    <div className="mt-3">
      <label htmlFor={fieldId} className="block text-sm font-medium text-fg">
        {reason.label}
        <span className="font-normal text-fg-muted">{reason.required ? " (obligatoire)" : " (facultatif)"}</span>
      </label>
      {reason.hint && (
        <p id={`${fieldId}-aide`} className="mt-0.5 text-xs text-fg-muted">
          {reason.hint}
        </p>
      )}
      <textarea
        ref={field}
        id={fieldId}
        name={reason.name}
        form={form}
        rows={3}
        maxLength={reason.maxLength ?? 1000}
        placeholder={reason.placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={[reason.hint ? `${fieldId}-aide` : "", error ? `${fieldId}-erreur` : ""].filter(Boolean).join(" ") || undefined}
        onInput={() => error && setError(null)}
        className={`mt-1 block w-full rounded-control border bg-surface px-2.5 py-2 text-sm text-fg transition-colors duration-150 focus:border-primary ${error ? "border-danger" : "border-line-strong"}`}
      />
      {error && (
        <p id={`${fieldId}-erreur`} role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
  return (
    <>
      <button
        ref={trigger}
        type="button"
        form={form}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        aria-haspopup="dialog"
        role={menuItem ? "menuitem" : undefined}
        onClick={() => setOpen(true)}
        className={menuItem ? menuItemClass(variant === "danger", className) : buttonClass(variant, size, className)}
      >
        {busy ? <Spinner /> : icon ? <Icon name={icon} className={menuItem && variant === "danger" ? "h-4 w-4 text-danger" : "h-4 w-4"} /> : null}
        {busy && pendingLabel ? pendingLabel : children}
      </button>
      {!onConfirm && <button ref={submitter} type="submit" hidden tabIndex={-1} aria-hidden="true" name={name} value={value} formAction={formAction} form={form} />}
      <ConfirmDialog
        open={open}
        title={title}
        confirmLabel={label}
        cancelLabel={cancelLabel}
        tone={tone}
        onConfirm={confirm}
        onCancel={() => {
          setError(null);
          setOpen(false);
        }}
        returnFocus={trigger}
        extra={
          (fields || reasonField) && (
            <>
              {fields && <div className="mt-3 space-y-3">{fields}</div>}
              {reasonField}
            </>
          )
        }
      >
        {typeof consequence === "string" ? <p>{consequence}</p> : consequence}
      </ConfirmDialog>
    </>
  );
}

// Bouton de soumission qui passe seul à l'état « en cours » (texte pendingLabel, désactivé) pendant l'envoi du formulaire
export function SubmitButton({ pendingLabel, variant = "primary", ...props }: Omit<ButtonProps, "type"> & { pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <Button {...props} variant={variant} type="submit" pending={pending || props.pending} pendingLabel={pendingLabel} />;
}
