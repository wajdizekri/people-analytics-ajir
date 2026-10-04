import { projectedConstellation, VIEW_HEIGHT } from "./constellation-data";

// Couleurs de la constellation (scène 3D et repli SVG), selon le thème : à poser sur le conteneur (fond marine).
// La scène 3D relit ces variables au changement de thème.
export const CONSTELLATION_VARS =
  "[--cst-node:#8fb4e0] [--cst-node-2:#3572bd] [--cst-accent:#f09219] [--cst-line:#5b8fcf] [--cst-line-o:0.45] " +
  "dark:[--cst-node:#5b8fcf] dark:[--cst-node-2:#1e56a3] dark:[--cst-accent:#e08a1e] dark:[--cst-line:#3572bd] dark:[--cst-line-o:0.38]";

const f = (n: number) => Number(n.toFixed(3));
const FILL = ["var(--cst-node)", "var(--cst-node-2)"] as const;

/** Vue fixe de la constellation (SVG rendu côté serveur) : repli de la scène 3D et visuel des petits écrans. */
export function ConstellationStatic({ className = "" }: { className?: string }) {
  const { nodes, edges } = projectedConstellation();
  const h = f(VIEW_HEIGHT);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`${f(-VIEW_HEIGHT / 2)} ${f(-VIEW_HEIGHT / 2)} ${h} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      overflow="visible"
      className={`pointer-events-none h-full w-full select-none ${className}`}
    >
      <g stroke="var(--cst-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none">
        {edges.map((e, i) => (
          <line
            key={i}
            x1={f(e.a.x)}
            y1={f(e.a.y)}
            x2={f(e.b.x)}
            y2={f(e.b.y)}
            vectorEffect="non-scaling-stroke"
            style={{ strokeOpacity: `calc(var(--cst-line-o) * ${f(0.55 + 0.45 * e.depth)})` }}
          />
        ))}
      </g>
      <g>
        {nodes.map((n, i) => (
          <circle
            key={i}
            cx={f(n.x)}
            cy={f(n.y)}
            r={f(n.r)}
            fill={n.hub ? "var(--cst-accent)" : FILL[n.tone]}
            fillOpacity={f(0.6 + 0.4 * n.depth)}
          />
        ))}
      </g>
    </svg>
  );
}
