import type { Diagram, PartDef, PartInstance, Vec } from '@/lib/types'

/** Canvas grid pitch, in world units. */
export const GRID = 10

export function snap(value: number): number {
  return Math.round(value / GRID) * GRID
}

export function snapVec(v: Vec): Vec {
  return { x: snap(v.x), y: snap(v.y) }
}

/** Rotate a point clockwise about the origin by `degrees` (0/90/180/270), matching SVG's rotate(). */
function rotateAboutOrigin(p: Vec, degrees: number): Vec {
  switch ((((Math.round(degrees / 90) % 4) + 4) % 4)) {
    case 1:
      return { x: -p.y, y: p.x }
    case 2:
      return { x: -p.x, y: -p.y }
    case 3:
      return { x: p.y, y: -p.x }
    default:
      return p
  }
}

/** Local point -> world point, rotating about the part's local centre. */
export function localToWorld(part: PartInstance, def: PartDef, local: Vec): Vec {
  const c = { x: def.width / 2, y: def.height / 2 }
  const r = rotateAboutOrigin({ x: local.x - c.x, y: local.y - c.y }, part.rotation)
  return { x: r.x + c.x + part.at.x, y: r.y + c.y + part.at.y }
}

/** World point -> local point (inverse of localToWorld). */
export function worldToLocal(part: PartInstance, def: PartDef, world: Vec): Vec {
  const c = { x: def.width / 2, y: def.height / 2 }
  const r = rotateAboutOrigin(
    { x: world.x - part.at.x - c.x, y: world.y - part.at.y - c.y },
    -part.rotation,
  )
  return { x: r.x + c.x, y: r.y + c.y }
}

export function pinWorld(part: PartInstance, def: PartDef, pinId: string): Vec | undefined {
  const pin = def.pins.find((p) => p.id === pinId)
  return pin ? localToWorld(part, def, pin) : undefined
}

/**
 * Outward unit vector at a pin, rotated with the part: the edge of the part's box
 * the pin sits on. Lets wires leave and enter along the pin instead of running
 * back through the component.
 */
export function pinDir(part: PartInstance, def: PartDef, pinId: string): Vec | undefined {
  const pin = def.pins.find((p) => p.id === pinId)
  if (!pin) return undefined
  const left = pin.x
  const right = def.width - pin.x
  const top = pin.y
  const bottom = def.height - pin.y
  const min = Math.min(left, right, top, bottom)
  const dir =
    min === left
      ? { x: -1, y: 0 }
      : min === right
        ? { x: 1, y: 0 }
        : min === top
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 }
  return rotateAboutOrigin(dir, part.rotation)
}

/** World axis-aligned bounding box of a placed part. */
export function partBounds(part: PartInstance, def: PartDef) {
  const corners: Vec[] = [
    { x: 0, y: 0 },
    { x: def.width, y: 0 },
    { x: def.width, y: def.height },
    { x: 0, y: def.height },
  ].map((c) => localToWorld(part, def, c))
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export function boundsContain(b: { x: number; y: number; w: number; h: number }, p: Vec) {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
}

export function rectsIntersect(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

export interface Viewport {
  /** World point rendered at the canvas origin. */
  x: number
  y: number
  zoom: number
}

export function screenToWorld(vp: Viewport, screen: Vec): Vec {
  return { x: screen.x / vp.zoom + vp.x, y: screen.y / vp.zoom + vp.y }
}

export function worldToScreen(vp: Viewport, world: Vec): Vec {
  return { x: (world.x - vp.x) * vp.zoom, y: (world.y - vp.y) * vp.zoom }
}

/** Topmost part under a world point, or undefined. Later parts win. */
export function hitTestPart(
  diagram: Diagram,
  defs: Map<string, PartDef>,
  world: Vec,
): PartInstance | undefined {
  for (let i = diagram.parts.length - 1; i >= 0; i--) {
    const part = diagram.parts[i]
    const def = defs.get(part.def)
    if (!def) continue
    const local = worldToLocal(part, def, world)
    if (local.x >= 0 && local.x <= def.width && local.y >= 0 && local.y <= def.height) {
      return part
    }
  }
  return undefined
}
