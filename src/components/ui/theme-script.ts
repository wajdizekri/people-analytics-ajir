// Script en ligne du thème (posé dans <head> par src/app/layout.tsx) : s'exécute pendant l'analyse du HTML, avant le premier
// affichage, donc sans flash. Choix enregistré : localStorage « pa-theme » = light | dark | system (défaut system).
// Pose data-theme (résolu : light | dark) et data-theme-pref (choix) sur <html> ; suit le thème du système et les autres onglets.
export const THEME_STORAGE_KEY = "pa-theme";

export const themeScript = `(function(){try{var d=document.documentElement,k="${THEME_STORAGE_KEY}",m=window.matchMedia("(prefers-color-scheme: dark)");function a(){var p=null;try{p=localStorage.getItem(k)}catch(e){}if(p!=="light"&&p!=="dark")p="system";d.setAttribute("data-theme",p==="system"?(m.matches?"dark":"light"):p);d.setAttribute("data-theme-pref",p)}a();m.addEventListener("change",a);window.addEventListener("storage",function(e){if(e.key===k)a()})}catch(e){}})()`;
