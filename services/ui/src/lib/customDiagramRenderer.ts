export type CustomDiagramType = 'orbital' | 'puzzle'

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

export type CustomDiagramData = OrbitalDiagramData | PuzzleDiagramData

export const CUSTOM_SVG_PREFIX = '__CUSTOM_SVG__'

export function isCustomDiagram(diagram: string): boolean {
  return diagram.startsWith(CUSTOM_SVG_PREFIX)
}

export function parseCustomDiagramData(raw: string): CustomDiagramData | null {
  try {
    const jsonStr = raw.startsWith(CUSTOM_SVG_PREFIX)
      ? raw.slice(CUSTOM_SVG_PREFIX.length)
      : raw
    const parsed = JSON.parse(jsonStr)
    if (parsed.type === 'orbital' || parsed.type === 'puzzle') {
      return parsed as CustomDiagramData
    }
    return null
  } catch {
    return null
  }
}
