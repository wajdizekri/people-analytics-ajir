import type { OrgNode } from "@/lib/dal/org-chart";

export type TreeIndex = Map<string, { node: OrgNode; parent: string | null }>;

export function indexTree(root: OrgNode): TreeIndex {
  const index: TreeIndex = new Map();
  const stack: [OrgNode, string | null][] = [[root, null]];
  while (stack.length) {
    const [node, parent] = stack.pop()!;
    index.set(node.key, { node, parent });
    for (const c of node.children) stack.push([c, node.key]);
  }
  return index;
}

// Clés de la racine jusqu'au nœud (inclus)
export function pathTo(index: TreeIndex, key: string): string[] {
  const path: string[] = [];
  for (let k: string | null = key; k != null && path.length <= index.size; k = index.get(k)?.parent ?? null) path.unshift(k);
  return path;
}
