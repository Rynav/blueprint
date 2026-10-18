/**
 * Circuit mapping: a wired diagram -> MNA elements -> node voltages and LED brightness.
 *
 * The bridge between the canvas and the analog solver. Nets come from `buildNets`; each
 * placed part is translated pin-by-pin into the solver's `SpiceElement` set. Nothing here
 * throws: a diagram that cannot be solved (no ground, singular, non-convergent) comes back
 * as `converged: false` with a human-readable `reason`.
 */

import { buildNets } from '@/lib/netlist'
import { diodeFromForwardVoltage, solve } from '@/lib/spice/solve'
import type { SpiceElement } from '@/lib/spice/types'
import type { Diagram, PartDef } from '@/lib/types'

export interface CircuitState {
  converged: boolean
  /** Net id -> volts relative to ground. */
  volts: Record<string, number>
  /** Part id -> LED brightness 0..1. Absent for non-LEDs. */
  brightness: Record<string, number>
  /** Part id -> current in amps, for the parts we model. */
  current: Record<string, number>
  /** Set when the circuit could not be solved (no ground, singular, not converged). */
  reason?: string
}

/** LED rated point used to derive the junction: 2.0 V @ 20 mA, the usual LED series R. */
const LED_AT_AMPS = 0.02
const LED_N = 1.8
const LED_RS = 15
/** 20 mA through an LED reads as full brightness. */
const FULL_BRIGHTNESS_AMPS = 0.02
/** Thevenin output resistance of an MCU pin, ohms. */
const PIN_OHMS = 30
/** Thevenin source voltage of a pin driven to logic 1. */
const PIN_HIGH_VOLTS = 5
/** Default GMIN resistance: 1 GΩ. */
const GMIN_OHMS = 1e9
/** Rails/battery are single- or two-pin; these are their pin ids where they matter. */
const BATTERY_PINS = { plus: '+', minus: '-' } as const

const finite = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

type NetOf = (partId: string, pinId: string) => string | undefined

/** The first pin of a part whose net resolves; a rail has exactly one. */
function firstPinNet(partId: string, def: PartDef, netOf: NetOf): string | undefined {
  for (const pin of def.pins) {
    const net = netOf(partId, pin.id)
    if (net !== undefined) return net
  }
  return undefined
}

/**
 * Ground node. Primary: a `rail-gnd` part's pin (the rail has exactly one pin, labelled
 * GND). Fallback: any ground-kind pin of a part carrying an `mcu` spec (the Uno's GND pins).
 * Returns undefined when neither exists.
 */
function findGround(diagram: Diagram, defs: Map<string, PartDef>, netOf: NetOf): string | undefined {
  for (const part of diagram.parts) {
    if (part.def !== 'rail-gnd') continue
    const def = defs.get(part.def)
    if (!def) continue
    const net = firstPinNet(part.id, def, netOf)
    if (net !== undefined) return net
  }

  for (const part of diagram.parts) {
    const def = defs.get(part.def)
    if (!def?.mcu) continue
    for (const pin of def.pins) {
      if (pin.kind !== 'ground') continue
      const net = netOf(part.id, pin.id)
      if (net !== undefined) return net
    }
  }
  return undefined
}

export function simulate(
  diagram: Diagram,
  defs: Map<string, PartDef>,
  pinValues: Map<string, 0 | 1 | 'z'>,
  options?: { gminOhms?: number },
): CircuitState {
  const gmin = options?.gminOhms ?? GMIN_OHMS
  const nets = buildNets(diagram, defs)
  const netOf: NetOf = (partId, pinId) => nets.netOf(partId, pinId)
  const partById = new Map(diagram.parts.map((p) => [p.id, p]))

  const ground = findGround(diagram, defs, netOf)
  if (ground === undefined) {
    return {
      converged: false,
      volts: {},
      brightness: {},
      current: {},
      reason: 'no ground: add a GND rail or wire an MCU ground pin',
    }
  }

  const els: SpiceElement[] = []
  /** Parallel to `els`: the part id whose `current` this element feeds, or null. */
  const owners: (string | null)[] = []
  const leds = new Set<string>()
  const add = (el: SpiceElement, owner: string | null) => {
    els.push(el)
    owners.push(owner)
  }

  for (const part of diagram.parts) {
    const def = defs.get(part.def)
    if (!def) continue // unknown part ids are skipped, never fatal
    const params = part.params ?? {}
    switch (part.def) {
      case 'resistor': {
        const a = netOf(part.id, '1')
        const b = netOf(part.id, '2')
        if (a === undefined || b === undefined) break
        add({ kind: 'resistor', a, b, ohms: params.ohms ?? def.defaultParams?.ohms ?? 220 }, part.id)
        break
      }
      case 'led': {
        const a = netOf(part.id, 'a') // anode
        const k = netOf(part.id, 'k') // cathode
        if (a === undefined || k === undefined) break
        const vf = params.vf ?? def.defaultParams?.vf ?? 2.0
        add({ kind: 'diode', a, b: k, ...diodeFromForwardVoltage(vf, LED_AT_AMPS, LED_N, LED_RS) }, part.id)
        leds.add(part.id)
        break
      }
      case 'rail-5v': {
        const n = firstPinNet(part.id, def, netOf)
        if (n !== undefined) add({ kind: 'voltage', a: n, b: ground, volts: 5 }, null)
        break
      }
      case 'battery-9v': {
        const a = netOf(part.id, BATTERY_PINS.plus)
        const b = netOf(part.id, BATTERY_PINS.minus)
        if (a !== undefined && b !== undefined) add({ kind: 'voltage', a, b, volts: 9 }, null)
        break
      }
      case 'pushbutton': {
        // Internal ties merge 1a/1b and 2a/2b, so each pole is a switch across the same
        // two nets; modelling both contacts separately is the real device (parallel poles).
        for (const [x, y] of [
          ['1a', '2a'],
          ['1b', '2b'],
        ] as const) {
          const a = netOf(part.id, x)
          const b = netOf(part.id, y)
          if (a === undefined || b === undefined) continue
          add({ kind: 'switch', a, b, closed: (params.pressed ?? 0) === 1 }, part.id)
        }
        break
      }
    }
  }

  // MCU pins: a driven pin is a Thevenin source, an ideal source in series with PIN_OHMS,
  // from the pin's net to ground. 'z' contributes nothing (high impedance, LED stays dark).
  let pinCounter = 0
  for (const [key, value] of pinValues) {
    if (value !== 0 && value !== 1) continue
    const at = key.indexOf(':')
    if (at < 0) continue
    const partId = key.slice(0, at)
    const pinId = key.slice(at + 1)
    const part = partById.get(partId)
    const def = part ? defs.get(part.def) : undefined
    if (!def?.mcu) continue
    if (!def.pins.some((pin) => pin.id === pinId)) continue
    const net = netOf(partId, pinId)
    if (net === undefined) continue
    const mid = `#pin${pinCounter++}` // may not collide with a real net id (n0, n1, ...)
    add({ kind: 'voltage', a: mid, b: ground, volts: value === 1 ? PIN_HIGH_VOLTS : 0 }, null)
    add({ kind: 'resistor', a: mid, b: net, ohms: PIN_OHMS }, partId)
  }

  // GMIN: a 1 GΩ resistor from every net to ground. The standard SPICE trick — it keeps a
  // floating net from making the matrix singular, at the cost of a tiny perturbation of
  // every node.
  for (const net of nets.nets) {
    if (net.id === ground) continue
    add({ kind: 'resistor', a: net.id, b: ground, ohms: gmin }, null)
  }

  const result = solve(els, { ground })

  const volts: Record<string, number> = {}
  for (const net of nets.nets) {
    const v = result.voltages[net.id]
    volts[net.id] = finite(v) ? v : 0
  }

  const current: Record<string, number> = {}
  for (let i = 0; i < els.length; i++) {
    const owner = owners[i]
    if (owner === null) continue
    const amps = result.currents[i]
    current[owner] = (current[owner] ?? 0) + (finite(amps) ? amps : 0)
  }

  const brightness: Record<string, number> = {}
  for (const id of leds) {
    brightness[id] = Math.min(1, Math.max(0, (current[id] ?? 0) / FULL_BRIGHTNESS_AMPS))
  }

  return result.converged
    ? { converged: true, volts, brightness, current }
    : { converged: false, volts, brightness, current, reason: result.reason ?? 'circuit did not converge' }
}

// shortcut: P3 mapping limits — no capacitors/inductors, no PWM averaging (a pin is a hard
// 5 V or 0 V per solve), button state comes from params.pressed not UI interaction, no
// MOSFET/BJT. Upgrade when those parts are drawn or when PWM duty needs averaging.
