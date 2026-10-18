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
      case 'diode': {
        const a = netOf(part.id, 'a') // anode
        const k = netOf(part.id, 'k') // cathode
        if (a === undefined || k === undefined) break
        const vf = params.vf ?? def.defaultParams?.vf ?? 0.7
        // A signal diode is a stiffer junction than an LED: 5 mA knees at 0.7 V.
        add({ kind: 'diode', a, b: k, ...diodeFromForwardVoltage(vf, 0.005, 1.8, 0.5) }, part.id)
        break
      }
      case 'npn-transistor':
      case 'pnp-transistor': {
        const b = netOf(part.id, 'b')
        const c = netOf(part.id, 'c')
        const e = netOf(part.id, 'e')
        if (b === undefined || c === undefined || e === undefined) break
        add(
          {
            kind: 'bjt',
            b,
            c,
            e,
            npn: part.def === 'npn-transistor',
            gain: params.gain ?? def.defaultParams?.gain ?? 100,
          },
          part.id,
        )
        break
      }
      case 'nmos':
      case 'pmos': {
        const g = netOf(part.id, 'g')
        const d = netOf(part.id, 'd')
        const s = netOf(part.id, 's')
        if (g === undefined || d === undefined || s === undefined) break
        add(
          {
            kind: 'mosfet',
            g,
            d,
            s,
            n: part.def === 'nmos',
            vth: params.vth ?? def.defaultParams?.vth ?? 2.1,
          },
          part.id,
        )
        break
      }
      case 'dc-motor': {
        const a = netOf(part.id, '+')
        const b = netOf(part.id, '-')
        if (a === undefined || b === undefined) break
        // shortcut: a motor is modelled as its coil resistance alone — no inductance, so
        // no back-EMF, inrush or speed-under-PWM; add a motor model when PWM averaging lands.
        add({ kind: 'resistor', a, b, ohms: params.ohms ?? def.defaultParams?.ohms ?? 12 }, part.id)
        break
      }
      case 'thermistor': {
        const a = netOf(part.id, '1')
        const b = netOf(part.id, '2')
        if (a === undefined || b === undefined) break
        const r25 = params.ohms ?? def.defaultParams?.ohms ?? 10000
        const beta = params.beta ?? def.defaultParams?.beta ?? 3950
        const tempC = params.temperatureC ?? def.defaultParams?.temperatureC ?? 25
        // NTC beta equation: hotter -> lower resistance.
        const ohms = r25 * Math.exp(beta * (1 / (tempC + 273.15) - 1 / 298.15))
        add({ kind: 'resistor', a, b, ohms }, part.id)
        break
      }
      case 'ldr': {
        const a = netOf(part.id, '1')
        const b = netOf(part.id, '2')
        if (a === undefined || b === undefined) break
        add({ kind: 'resistor', a, b, ohms: params.ohms ?? def.defaultParams?.ohms ?? 10000 }, part.id)
        break
      }
      case 'potentiometer': {
        const p1 = netOf(part.id, '1')
        const p2 = netOf(part.id, '2') // wiper
        const p3 = netOf(part.id, '3')
        if (p1 === undefined || p2 === undefined || p3 === undefined) break
        const ohms = params.ohms ?? def.defaultParams?.ohms ?? 10000
        const pos = Math.min(1, Math.max(0, params.position ?? def.defaultParams?.position ?? 0.5))
        // Two legs from the wiper; clamp off 0 Ω so the solve never goes singular.
        add({ kind: 'resistor', a: p1, b: p2, ohms: Math.max(1e-3, ohms * pos) }, part.id)
        add({ kind: 'resistor', a: p2, b: p3, ohms: Math.max(1e-3, ohms * (1 - pos)) }, part.id)
        break
      }
      case 'rgb-led': {
        const k = netOf(part.id, 'k')
        if (k === undefined) break
        const vf = params.vf ?? def.defaultParams?.vf ?? 2.0
        // Each colour is its own diode to the shared cathode. Owner keys are per-colour so
        // `current[partId:ch]` reads one channel rather than the sum of all three.
        for (const ch of ['r', 'g', 'b'] as const) {
          const a = netOf(part.id, ch)
          if (a === undefined) continue
          add({ kind: 'diode', a, b: k, ...diodeFromForwardVoltage(vf, 0.02, 1.8, 15) }, `${part.id}:${ch}`)
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
// 5 V or 0 V per solve), button state comes from params.pressed not UI interaction.
// Upgrade when those parts are drawn or when PWM duty needs averaging.
// shortcut: no transistor body diode (a BJT/MOSFET blocks one way and conducts the other
// through the channel only) and no temperature-dependent LED/diode Vf. Add both when a
// circuit depends on them (e.g. a flyback across a motor or a thermal sweep of a diode).
