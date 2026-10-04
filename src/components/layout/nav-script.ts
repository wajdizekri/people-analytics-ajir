// Script en ligne du menu réduit, inséré dans <head> au rendu serveur (NavRailScript, nav-rail.tsx) : même principe que le
// thème (src/components/ui/theme-script.ts). Choix enregistré : localStorage « pa-nav » = rail ; clé absente = menu déployé.
// Pose data-nav="rail" sur <html> avant le premier affichage : le rail est mis en forme par CSS (variantes
// in-data-[nav=rail]), sans lecture au rendu serveur ni décalage d'hydratation.
export const NAV_STORAGE_KEY = "pa-nav";
export const NAV_ATTRIBUTE = "data-nav";
export const NAV_RAIL = "rail";

export const navScript = `(function(){try{if(localStorage.getItem("${NAV_STORAGE_KEY}")==="${NAV_RAIL}")document.documentElement.setAttribute("${NAV_ATTRIBUTE}","${NAV_RAIL}")}catch(e){}})()`;
