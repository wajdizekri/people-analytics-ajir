"use client";

import { useRef, useSyncExternalStore } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { NAV_ATTRIBUTE, NAV_RAIL, NAV_STORAGE_KEY, navScript } from "./nav-script";

// Menu latéral réduit en rail d'icônes. Source de vérité : attribut data-nav de <html> (posé avant affichage par
// navScript) ; ce module le lit et le modifie. Le style du rail ne dépend que de cet attribut (CSS), l'état React
// ne sert qu'aux attributs ARIA et aux bulles.

function storedRail() {
  try {
    return localStorage.getItem(NAV_STORAGE_KEY) === NAV_RAIL;
  } catch {
    return false;
  }
}

function applyNavRail(rail: boolean) {
  const d = document.documentElement;
  if (rail) d.setAttribute(NAV_ATTRIBUTE, NAV_RAIL);
  else d.removeAttribute(NAV_ATTRIBUTE);
}

/** Enregistre (localStorage « pa-nav ») et applique le mode du menu latéral. */
export function setNavRail(rail: boolean) {
  try {
    if (rail) localStorage.setItem(NAV_STORAGE_KEY, NAV_RAIL);
    else localStorage.removeItem(NAV_STORAGE_KEY);
  } catch {
    // stockage indisponible (navigation privée stricte) : le choix vaut pour la page en cours
  }
  applyNavRail(rail);
}

/** Au montage du menu : réapplique le choix enregistré (arrivée par navigation interne, <html> réinitialisé par React). */
export function syncNavRail() {
  applyNavRail(storedRail());
}

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: [NAV_ATTRIBUTE] });
  return () => obs.disconnect();
}
const snapshot = () => document.documentElement.getAttribute(NAV_ATTRIBUTE) === NAV_RAIL;
const serverSnapshot = () => false;

/** true quand le menu est réduit. Déployé au rendu serveur et à l'hydratation, puis aligné sur <html>. */
export function useNavRail() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** À monter une fois dans le gabarit de l'app : insère navScript dans <head> au rendu serveur (jamais rendu côté navigateur). */
export function NavRailScript() {
  const inserted = useRef(false);
  useServerInsertedHTML(() => {
    if (inserted.current) return null;
    inserted.current = true;
    return <script dangerouslySetInnerHTML={{ __html: navScript }} />;
  });
  return null;
}
