import { worldToLocal } from '@/lib/geometry'
import type { ControlChange, Diagram, PartDef, PartInstance, Vec } from '@/lib/types'

/**
 * Helpers shared by the parts that can be operated with the mouse. Their control functions
 * are pure and take a point in the part's own local frame, so they are testable without a
 * canvas - and so a control keeps working when the part is rotated.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Circle {
  x: number
  y: number
  r: number
}

export function inRect(local: Vec, rect: Rect): boolean {
  return (
    local.x >= rect.x &&
    local.x <= rect.x + rect.w &&
    local.y >= rect.y &&
    local.y <= rect.y + rect.h
  )
}

export function inCircle(local: Vec, circle: Circle): boolean {
  return Math.hypot(local.x - circle.x, local.y - circle.y) <= circle.r
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/**
 * Round a parameter before storing it. Without this, a drag writes a new float every mouse
 * move, which churns the diagram, the undo history and the autosave for no visible gain.
 */
export function roundTo(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/** Angle in degrees from a centre to a point, measured clockwise from straight up. */
export function angleFromUp(centre: Vec, point: Vec): number {
  const degrees = (Math.atan2(point.x - centre.x, centre.y - point.y) * 180) / Math.PI
  return (degrees + 360) % 360
}

/**
 * Call a def's control with the pointer already converted into the part's local frame.
 * A control that is missing - or that throws on a stray point - simply has nothing to say,
 * so the canvas can treat the gesture as dragging the part.
 *
 * A control may drive one parameter or several (a joystick moves two axes at once), and the
 * result is normalised to an array so callers never branch on which.
 */
function invoke(
  part: PartInstance,
  def: PartDef,
  world: Vec,
  phase: 'down' | 'move' | 'up',
): ControlChange[] | null {
  if (!def.control) return null
  try {
    const result = def.control({ part, def, local: worldToLocal(part, def, world), phase })
    if (result === null) return null
    const changes = Array.isArray(result) ? result : [result]
    return changes.length > 0 ? changes : null
  } catch {
    return null
  }
}

/**
 * The part whose control the pointer is on, with the changes a `down` makes. Walks front to
 * back like hitTestPart, so the topmost part that answers wins; a part with no control (or
 * one that declines this point) is transparent. Null means the canvas drags the part.
 */
export function controlDown(
  diagram: Diagram,
  defs: Map<string, PartDef>,
  world: Vec,
): { part: PartInstance; changes: ControlChange[] } | null {
  for (let i = diagram.parts.length - 1; i >= 0; i--) {
    const part = diagram.parts[i]
    const def = defs.get(part.def)
    if (!def) continue
    const changes = invoke(part, def, world, 'down')
    if (changes) return { part, changes }
  }
  return null
}

/**
 * A continuing gesture on one known part: `move` while dragging a control, `up` when the
 * pointer lifts (a momentary button releases, a joystick re-centres). Null leaves the
 * stored parameters untouched.
 */
export function controlDrag(
  part: PartInstance,
  def: PartDef,
  world: Vec,
  phase: 'move' | 'up',
): ControlChange[] | null {
  return invoke(part, def, world, phase)
}
