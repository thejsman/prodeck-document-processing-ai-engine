export type CustomDiagramType =
  | 'orbital'
  | 'puzzle'
  | 'steps-flow'
  | 'timeline-bar'
  | 'donut-chart'
  | 'bar-chart'
  | 'stat-grid'
  | 'tree-diagram'
  | 'journey-map'
  | 'comparison-table'

export interface OrbitalDiagramData {
  type: 'orbital'
  center: { title: string; subtitle: string }
  satellites: Array<{
    title: string
    description: string
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right'
  }>
}

export interface PuzzleDiagramData {
  type: 'puzzle'
  pieces: Array<{
    title: string
    iconType: 'gateway' | 'monitor' | 'stream' | 'storage' | 'security' | 'cloud' | 'data' | 'api' | 'user' | 'process' | 'integrate' | 'deploy'
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    labelSide: 'left' | 'right'
  }>
  backgroundStyle: 'gradient' | 'solid' | 'mesh'
}

export interface StepsFlowData {
  type: 'steps-flow'
  steps: Array<{
    title: string
    description: string
  }>
}

export interface TimelineBarData {
  type: 'timeline-bar'
  phases: Array<{
    name: string
    durationWeeks: number
    startWeek: number
    description?: string
  }>
}

export interface DonutChartData {
  type: 'donut-chart'
  title?: string
  total?: string
  segments: Array<{
    label: string
    value?: number
    percentage?: number
  }>
}

export interface BarChartData {
  type: 'bar-chart'
  title?: string
  unit?: string
  bars: Array<{
    label: string
    value: number
    sublabel?: string
    highlight?: boolean
  }>
}

export interface StatGridData {
  type: 'stat-grid'
  stats: Array<{
    value: string
    label: string
    sublabel?: string
    icon?: string
    trend?: 'up' | 'down' | 'neutral'
  }>
}

export interface TreeNode {
  title: string
  children?: TreeNode[]
}

export interface TreeDiagramData {
  type: 'tree-diagram'
  root: TreeNode
}

export interface JourneyMapData {
  type: 'journey-map'
  stages: Array<{
    name: string
    activities: string[]
    sentiment?: 'positive' | 'neutral' | 'negative'
  }>
}

export interface ComparisonTableData {
  type: 'comparison-table'
  title?: string
  features: string[]
  options: Array<{
    name: string
    values: Array<boolean | string>
  }>
}

export type CustomDiagramData =
  | OrbitalDiagramData
  | PuzzleDiagramData
  | StepsFlowData
  | TimelineBarData
  | DonutChartData
  | BarChartData
  | StatGridData
  | TreeDiagramData
  | JourneyMapData
  | ComparisonTableData

export const CUSTOM_SVG_PREFIX = '__CUSTOM_SVG__'

export function isCustomDiagram(diagram: string): boolean {
  return diagram.startsWith(CUSTOM_SVG_PREFIX)
}

const VALID_TYPES: Set<string> = new Set([
  'orbital', 'puzzle', 'steps-flow', 'timeline-bar',
  'donut-chart', 'bar-chart', 'stat-grid', 'tree-diagram',
  'journey-map', 'comparison-table',
])

export function parseCustomDiagramData(raw: string): CustomDiagramData | null {
  try {
    const jsonStr = raw.startsWith(CUSTOM_SVG_PREFIX)
      ? raw.slice(CUSTOM_SVG_PREFIX.length)
      : raw
    const parsed = JSON.parse(jsonStr)
    if (VALID_TYPES.has(parsed.type)) {
      return parsed as CustomDiagramData
    }
    return null
  } catch {
    return null
  }
}
