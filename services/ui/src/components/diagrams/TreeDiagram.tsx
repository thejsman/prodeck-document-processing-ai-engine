'use client';

import type { TreeDiagramData, TreeNode } from '../../lib/customDiagramRenderer';
import type { PluginTokens } from '../../types/presentation';

interface Props {
  data: TreeDiagramData;
  tokens: PluginTokens;
}

const NODE_W = 170;
const NODE_H = 58;
const LEVEL_H = 110;

interface PositionedNode {
  node: TreeNode;
  x: number;
  y: number;
  width: number;
  children: PositionedNode[];
}

function measureTree(node: TreeNode, depth: number): number {
  if (!node.children?.length) return NODE_W + 28;
  return node.children.reduce((sum, c) => sum + measureTree(c, depth + 1), 0);
}

function positionTree(node: TreeNode, depth: number, left: number): PositionedNode {
  const w = measureTree(node, depth);
  const children: PositionedNode[] = [];
  let childLeft = left;
  for (const child of node.children ?? []) {
    const cw = measureTree(child, depth + 1);
    children.push(positionTree(child, depth + 1, childLeft));
    childLeft += cw;
  }
  return { node, x: left + w / 2, y: depth * LEVEL_H + 30, width: w, children };
}

function flattenTree(root: PositionedNode): PositionedNode[] {
  const result: PositionedNode[] = [root];
  for (const child of root.children) result.push(...flattenTree(child));
  return result;
}

function renderConnectors(node: PositionedNode): React.ReactNode[] {
  const lines: React.ReactNode[] = [];
  for (const child of node.children) {
    const parentBottomY = node.y + NODE_H;
    const childTopY = child.y;
    lines.push(
      <path key={`${node.x}-${child.x}`}
        d={`M ${node.x},${parentBottomY} C ${node.x},${(parentBottomY + childTopY) / 2} ${child.x},${(parentBottomY + childTopY) / 2} ${child.x},${childTopY}`}
        stroke="#888" strokeOpacity={0.4} strokeWidth={1.5} fill="none" />
    );
    lines.push(...renderConnectors(child));
  }
  return lines;
}

export function TreeDiagram({ data, tokens }: Props) {
  if (!data?.root) return null;

  const positioned = positionTree(data.root, 0, 0);
  const allNodes = flattenTree(positioned);
  const maxX = Math.max(...allNodes.map(n => n.x + NODE_W / 2));
  const maxY = Math.max(...allNodes.map(n => n.y + NODE_H));
  const VW = Math.max(maxX + 30, 500);
  const VH = maxY + 40;
  const offsetX = (VW - positioned.width) / 2;

  function shiftX(n: PositionedNode): PositionedNode {
    return { ...n, x: n.x + offsetX, children: n.children.map(shiftX) };
  }
  const centeredRoot = shiftX(positioned);
  const centeredNodes = flattenTree(centeredRoot);

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" xmlns="http://www.w3.org/2000/svg" aria-label={`Tree: ${data.root.title}`}>
      {renderConnectors(centeredRoot)}
      {centeredNodes.map((pn, i) => {
        const isRoot = i === 0;
        const nx = pn.x - NODE_W / 2;
        const ny = pn.y;
        return (
          <g key={i}>
            <rect x={nx} y={ny} width={NODE_W} height={NODE_H} rx={8}
              fill={isRoot ? tokens.accent : (tokens.surfaceCard ?? tokens.surface)}
              stroke={tokens.accent} strokeOpacity={isRoot ? 0 : 0.4} strokeWidth={1} />
            <text x={pn.x} y={ny + NODE_H / 2 + 6} textAnchor="middle"
              fontSize={isRoot ? 16 : 14} fontWeight={isRoot ? 700 : 600}
              fill={isRoot ? 'white' : tokens.text} fontFamily={`'${tokens.bodyFont}', sans-serif`}>
              {pn.node.title.length > 20 ? pn.node.title.slice(0, 19) + '…' : pn.node.title}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
