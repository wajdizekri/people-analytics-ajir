import Link from "next/link";
import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Icon, Spinner, type IconName } from "./icons";
import { MoreActions } from "./more-actions";

// Boutons de la charte (docs/qa/CHARTE_UI.md § 2) : un seul primaire par zone, secondaire (contour) pour les alternatives,
// tertiaire (lien) pour Annuler / Voir le détail, destructif (rouge) avec confirmation (ConfirmButton). Hauteur ≥ 40 px.

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-200 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-fg shadow-sm hover:bg-primary-hover disabled:hover:bg-primary",
  secondary: "border border-line-strong bg-surface text-link shadow-sm hover:border-primary hover:bg-primary-soft disabled:hover:border-line-strong disabled:hover:bg-surface",
  tertiary: "text-link underline-offset-4 hover:bg-primary-soft hover:underline disabled:hover:bg-transparent disabled:hover:no-underline",
  danger: "bg-danger-solid text-white shadow-sm hover:bg-danger-solid-hover disabled:hover:bg-danger-solid",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-10 px-3 text-[13px]",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
};
const TERTIARY_SIZE: Record<ButtonSize, string> = { sm: "min-h-10 px-2 text-[13px]", md: "min-h-10 px-2.5 text-sm", lg: "min-h-12 px-3 text-base" };

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra = "") {
  return `${BASE} ${VARIANT[variant]} ${variant === "tertiary" ? TERTIARY_SIZE[size] : SIZE[size]}${extra ? ` ${extra}` : ""}`;
}

// Compatibilité : chaînes de classes utilisées directement par les écrans (className={buttonCls.primary})
export const buttonCls = {
  primary: buttonClass("primary"),
  secondary: buttonClass("secondary"),
  tertiary: buttonClass("tertiary"),
  danger: buttonClass("danger"),
  primarySm: buttonClass("primary", "sm"),
  secondarySm: buttonClass("secondary", "sm"),
};

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icône à gauche du texte (nom du jeu d'icônes ou élément). */
  icon?: IconName | ReactNode;
  iconEnd?: IconName;
  fullWidth?: boolean;
};

function Content({ icon, iconEnd, children, pending }: { icon?: IconName | ReactNode; iconEnd?: IconName; children: ReactNode; pending?: boolean }) {
  return (
    <>
      {pending ? <Spinner /> : typeof icon === "string" ? <Icon name={icon as IconName} /> : icon}
      {children}
      {iconEnd && !pending && <Icon name={iconEnd} />}
    </>
  );
}

export type ButtonProps = ComponentPropsWithoutRef<"button"> &
  Common & {
    /** En cours : bouton désactivé, indicateur animé et `pendingLabel` (« Enregistrement… »). */
    pending?: boolean;
    pendingLabel?: string;
    /** Raison affichée sous le bouton quand il est désactivé (« Sélectionnez au moins un fichier »). */
    disabledReason?: string;
  };

// Bouton (type="button" par défaut ; type="submit" dans un formulaire, ou SubmitButton pour l'état « en cours » automatique)
export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconEnd,
  fullWidth,
  pending = false,
  pendingLabel,
  disabledReason,
  disabled,
  className = "",
  type = "button",
  children,
  "aria-describedby": describedBy,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  const off = disabled || pending;
  const showReason = !!disabled && !pending && !!disabledReason;
  const button = (
    <button
      type={type}
      disabled={off}
      aria-busy={pending || undefined}
      aria-describedby={[describedBy, showReason ? reasonId : ""].filter(Boolean).join(" ") || undefined}
      className={buttonClass(variant, size, `${fullWidth ? "w-full" : ""} ${className}`.trim())}
      {...rest}
    >
      <Content icon={icon} iconEnd={iconEnd} pending={pending}>
        {pending && pendingLabel ? pendingLabel : children}
      </Content>
    </button>
  );
  if (!showReason) return button;
  return (
    <span className={`inline-flex flex-col gap-1 ${fullWidth ? "w-full" : ""}`}>
      {button}
      <span id={reasonId} className="text-xs text-fg-muted">
        {disabledReason}
      </span>
    </span>
  );
}

// Lien présenté comme un bouton (navigation) : même hiérarchie visuelle que Button
export function ButtonLink({
  href,
  variant = "secondary",
  size = "md",
  icon,
  iconEnd,
  fullWidth,
  external = false,
  className = "",
  children,
  ...rest
}: Omit<ComponentPropsWithoutRef<"a">, "href"> & Common & { href: string; external?: boolean }) {
  const cls = buttonClass(variant, size, `${fullWidth ? "w-full" : ""} ${className}`.trim());
  const content = (
    <Content icon={icon} iconEnd={iconEnd ?? (external ? "external" : undefined)}>
      {children}
      {external && <span className="sr-only"> (nouvel onglet)</span>}
    </Content>
  );
  if (external)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} {...rest}>
        {content}
      </a>
    );
  return (
    <Link href={href} className={cls} {...rest}>
      {content}
    </Link>
  );
}

// Barre d'actions d'un formulaire : en bas, alignée à droite, primaire à droite (mettre Annuler avant Enregistrer).
// Sur mobile, boutons pleine largeur, primaire en haut. `status` : message d'état à gauche (succès, erreur).
export function FormActions({ children, status, className = "", divider = true }: { children: ReactNode; status?: ReactNode; className?: string; divider?: boolean }) {
  return (
    <div className={`mt-5 flex flex-col gap-3 sm:flex-row sm:items-center ${divider ? "border-t border-line pt-4" : ""} ${className}`}>
      {status && <div className="min-w-0 sm:flex-1">{status}</div>}
      <div className="flex flex-col-reverse gap-2 sm:ml-auto sm:flex-row sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto">{children}</div>
    </div>
  );
}

// Actions d'en-tête : au plus 2 boutons visibles (children), le reste dans le menu « Plus d'actions » (more).
// Les éléments du menu : <MenuLink href=…> ou <MenuButton …> (ou un formulaire avec un MenuButton type="submit").
// Sous 640 px : une action par ligne, pleine largeur (aucun débordement à 390 px).
export function ActionBar({ children, more, moreLabel = "Plus d'actions", className = "" }: { children?: ReactNode; more?: ReactNode; moreLabel?: string; className?: string }) {
  return (
    <div
      className={`flex w-full flex-col items-stretch gap-2 [&>*]:w-full [&>form>*]:w-full sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:[&>*]:w-auto sm:[&>form>*]:w-auto ${className}`}
    >
      {children}
      {more && <MoreActions label={moreLabel}>{more}</MoreActions>}
    </div>
  );
}

const MENU_ITEM_BASE =
  "flex min-h-10 w-full items-center gap-2 rounded-[6px] px-3 text-left text-sm transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60";

// Classe d'un élément du menu « Plus d'actions »
export const menuItemCls = `${MENU_ITEM_BASE} text-fg hover:bg-surface-3 focus-visible:bg-surface-3 active:bg-surface-3`;

/** Classe d'un élément de menu, destructif ou non (sans classes concurrentes : text-fg l'emporterait sur text-danger). */
export function menuItemClass(danger = false, extra = "") {
  const tone = danger ? `${MENU_ITEM_BASE} text-danger hover:bg-danger-soft focus-visible:bg-danger-soft active:bg-danger-soft` : menuItemCls;
  return extra ? `${tone} ${extra}` : tone;
}

/** Élément de menu-lien. `download` : lien de téléchargement (export CSV), rendu en <a> simple. */
export function MenuLink({
  href,
  icon,
  children,
  external = false,
  className = "",
  ...rest
}: Omit<ComponentPropsWithoutRef<"a">, "href" | "children" | "role"> & { href: string; icon?: IconName; children: ReactNode; external?: boolean }) {
  const cls = menuItemClass(false, className);
  const iconEl = icon && <Icon name={icon} className="h-4 w-4 text-fg-subtle" />;
  if (external)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" role="menuitem" className={cls} {...rest}>
        {iconEl}
        {children}
        <span className="sr-only"> (nouvel onglet)</span>
      </a>
    );
  if (rest.download != null)
    return (
      <a href={href} role="menuitem" className={cls} {...rest}>
        {iconEl}
        {children}
      </a>
    );
  return (
    <Link href={href} role="menuitem" className={cls} {...rest}>
      {iconEl}
      {children}
    </Link>
  );
}

export function MenuButton({ icon, children, danger = false, className = "", type = "button", ...rest }: ComponentPropsWithoutRef<"button"> & { icon?: IconName; danger?: boolean }) {
  return (
    <button type={type} role="menuitem" className={menuItemClass(danger, className)} {...rest}>
      {icon && <Icon name={icon} className={`h-4 w-4 ${danger ? "text-danger" : "text-fg-subtle"}`} />}
      {children}
    </button>
  );
}
