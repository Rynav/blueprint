/**
 * Reverse path of the simulation loop: net voltages -> per-pin levels an MCU can read.
 *
 * `simulate()` knows volts per net; `digitalRead`/`analogRead` want a level per board pin.
 * This maps the two, and deliberately omits anything it cannot resolve: an omitted pin is
 * "leave it alone", so an unwired pin keeps whatever the sketch itself configured (notably
 * INPUT_PULLUP) instead of being silently forced low.
 */

import { buildNets } from '@/lib/netlist'
import type { Diagram, PartDef } from '@/lib/types'

export interface PinFeedback {
  /** `${partId}:${pinId}` -> logic level. */
  digital: Map<string, 0 | 1>
  /** `${partId}:${pinId}` -> volts (0..5). */
  analog: Map<string, number>
}

// shortcut: a fixed 2.5 V threshold - a real ATmega input threshold is ~0.6*Vcc rising /
// 0.3*Vcc falling with hysteresis, unmodelled here. Upgrade for slow edges or noisy nodes.
const HIGH_THRESHOLD_VOLTS = 2.5

/**
 * Read every MCU pin's net voltage back into a digital level and an analog value. Unknown
 * parts and dangling pins are skipped, never fatal. A pin is omitted when its net is unknown,
 * its voltage non-finite, or its net touches nothing but the pin itself (unwired) - an
 * unwired net reads 0 V through GMIN, and feeding that 0 back would defeat INPUT_PULLUP.
 */
export function feedbackFromCircuit(
  diagram: Diagram,
  defs: Map<string, PartDef>,
  volts: Record<string, number>,
): PinFeedback {
  const digital = new Map<string, 0 | 1>()
  const analog = new Map<string, number>()
  const nets = buildNets(diagram, defs)
  // A net with a single pin endpoint is a pin wired to nothing.
  const wired = new Set(nets.nets.filter((net) => net.pins.length >= 2).map((net) => net.id))

  for (const part of diagram.parts) {
    const def = defs.get(part.def)
    if (!def?.mcu) continue
    for (const pinId of Object.keys(def.mcu.pins)) {
      const net = nets.netOf(part.id, pinId)
      if (net === undefined || !wired.has(net)) continue
      const v = volts[net]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      digital.set(`${part.id}:${pinId}`, v >= HIGH_THRESHOLD_VOLTS ? 1 : 0)
      analog.set(`${part.id}:${pinId}`, v)
    }
  }
  return { digital, analog }
}
