import type { Diagram, Endpoint, Note, PartInstance, Vec, Wire } from '@/lib/types'

/** localStorage key for the single autosaved diagram. */
export const AUTOSAVE_KEY = 'blueprint.diagram.v1'

/** Pretty JSON so exported/autosaved files stay diffable by hand. */
export function serialize(d: Diagram): string {
  return JSON.stringify(d, null, 2)
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/** Missing/invalid coords salvage to the origin rather than dropping the entry. */
function asVec(v: unknown): Vec {
  const r = asRecord(v)
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)
  return { x: num(r?.x), y: num(r?.y) }
}

function parsePart(v: unknown): PartInstance | null {
  const r = asRecord(v)
  if (!r) return null
  const id = asString(r.id)
  const def = asString(r.def)
  if (!id || !def) return null
  const rot = r.rotation
  return {
    id,
    def,
    at: asVec(r.at),
    rotation: rot === 90 || rot === 180 || rot === 270 ? rot : 0,
    label: asString(r.label),
  }
}

function parseEndpoint(v: unknown): Endpoint | null {
  const r = asRecord(v)
  if (!r) return null
  const part = asString(r.part)
  const pin = asString(r.pin)
  return part && pin ? { part, pin } : null
}

function parseWire(v: unknown): Wire | null {
  const r = asRecord(v)
  if (!r) return null
  const id = asString(r.id)
  const from = parseEndpoint(r.from)
  const to = parseEndpoint(r.to)
  if (!id || !from || !to) return null
  return { id, from, to, color: asString(r.color), label: asString(r.label) }
}

function parseNote(v: unknown): Note | null {
  const r = asRecord(v)
  if (!r) return null
  const id = asString(r.id)
  if (!id) return null
  return { id, at: asVec(r.at), text: asString(r.text) ?? '', color: asString(r.color) }
}

/**
 * Validate + normalise raw JSON text. Salvages partially valid files by dropping
 * malformed entries; throws only when the input isn't a JSON object or the version
 * is unsupported.
 */
export function parse(text: string): Diagram {
  const root = asRecord(JSON.parse(text))
  if (!root) throw new Error('Not a blueprint diagram: expected a JSON object.')
  if (root.version !== 1) {
    throw new Error(`Unsupported blueprint version: ${String(root.version ?? 'missing')}.`)
  }
  return {
    version: 1,
    parts: asArray(root.parts).map(parsePart).filter((p): p is PartInstance => p !== null),
    wires: asArray(root.wires).map(parseWire).filter((w): w is Wire => w !== null),
    notes: asArray(root.notes).map(parseNote).filter((n): n is Note => n !== null),
  }
}

export function saveLocal(d: Diagram): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, serialize(d))
  } catch {
    // private mode / quota / no storage — autosave is best-effort, never fatal
  }
}

export function loadLocal(): Diagram | null {
  try {
    const text = localStorage.getItem(AUTOSAVE_KEY)
    return text ? parse(text) : null
  } catch {
    return null
  }
}

export function downloadDiagram(d: Diagram, filename = 'blueprint.diagram.json'): void {
  const blob = new Blob([serialize(d)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function readDiagramFile(file: File): Promise<Diagram> {
  return parse(await file.text())
}

/** The sketch is a plain string, so it gets its own tiny key rather than a diagram envelope. */
export const SKETCH_KEY = 'blueprint.sketch.v1'

export function saveSketch(text: string): void {
  try {
    localStorage.setItem(SKETCH_KEY, text)
  } catch {
    // best effort; a full or blocked storage must not break editing
  }
}

export function loadSketch(): string | null {
  try {
    return localStorage.getItem(SKETCH_KEY)
  } catch {
    return null
  }
}
