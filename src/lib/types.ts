import type { ReactNode } from 'react'

/** A point or vector in canvas space. */
export interface Vec {
  x: number
  y: number
}

export type PinKind = 'power' | 'ground' | 'io' | 'analog' | 'pwm' | 'passive'

/** A connection point on a part, in the part's local (unrotated) frame. */
export interface PinDef {
  /** Unique within the part, e.g. "13", "A0", "5v". */
  id: string
  /** Short text shown on the pin, e.g. "5V", "GND", "D13". */
  label?: string
  x: number
  y: number
  kind: PinKind
}

/** A registered component type. Pure data + a stateless visual. */
export interface PartDef {
  /** Registry id, e.g. "arduino-uno". */
  id: string
  name: string
  /** Category id from PART_CATEGORIES. */
  category: string
  /** Local bounding box before rotation. Origin is the local top-left (0,0). */
  width: number
  height: number
  pins: PinDef[]
  /**
   * Groups of pin ids that are permanently shorted inside the part: breadboard
   * column rows, switch poles, multi-terminal connectors. The netlist unions each
   * group. Omitted means every pin is independent.
   */
  internalNets?: string[][]
  /** Default values for `PartInstance.params`, e.g. `{ ohms: 220 }`. */
  defaultParams?: Record<string, number>
  /** Present when the part is a programmable MCU board. */
  mcu?: McuSpec
  /** Draws the part in its local frame. Must not mutate anything. */
  render: (props: { part: PartInstance; def: PartDef; state?: PartRenderState }) => ReactNode
}

/** Live simulation state a part visual may use. Absent means "not being simulated". */
export interface PartRenderState {
  /** LED brightness, 0..1. */
  brightness?: number
}

/** How a board's broken-out pins map onto the emulated chip. */
export interface McuSpec {
  chip: 'atmega328p'
  clockHz: number
  /** Part pin id (e.g. "d13") -> AVR port bit. */
  pins: Record<string, { port: 'B' | 'C' | 'D'; bit: number }>
}

/** A placed component. */
export interface PartInstance {
  id: string
  /** PartDef id. */
  def: string
  /** World position of the part's local origin (0,0). */
  at: Vec
  /** Quarter turns clockwise. */
  rotation: 0 | 90 | 180 | 270
  label?: string
  /** Named values overriding the def's `defaultParams`, e.g. `{ ohms: 220 }`. */
  params?: Record<string, number>
}

/** A pin reference: which pin on which placed part. */
export interface Endpoint {
  part: string
  pin: string
}

export interface Wire {
  id: string
  from: Endpoint
  to: Endpoint
  color?: string
  label?: string
}

/** A free-floating sticky note on the canvas. */
export interface Note {
  id: string
  at: Vec
  text: string
  color?: string
}

export interface Diagram {
  /** Bumped on breaking schema changes. */
  version: 1
  parts: PartInstance[]
  wires: Wire[]
  notes: Note[]
}

export const EMPTY_DIAGRAM: Diagram = { version: 1, parts: [], wires: [], notes: [] }
