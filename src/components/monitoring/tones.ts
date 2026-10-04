import { SEMANTIC, cssChartColor, type Tone } from "@/components/charts/theme";

// Couleur sémantique d'un élément HTML coloré en style en ligne (jauge de poids) : même teinte que les graphiques,
// équivalent sombre via cssChartColor (variable --pa-chart-<hex> de globals.css)
export const toneCss = (tone: Tone) => cssChartColor(SEMANTIC[tone]);
