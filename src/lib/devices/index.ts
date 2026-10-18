/**
 * Digital peripheral framework.
 *
 * The MCU is not special: the harness takes the driven pins, derives each net's level, lets
 * every placed part with a `device` spec update its state and drive its own pins, and returns
 * the merged pin map. That map goes straight into `simulate`, whose Thevenin pins then light
 * LEDs from a shift register's outputs exactly as they do from an MCU pin.
 *
 * `stepDevices` is the one-shot entry point (one settle pass). A live caller that records pin
 * edges between frames uses `createDeviceHarness`: build the netlist once, `applyTransition`
 * per edge so a bit-banged clock pulse narrower than a frame is replayed, then `settle` once
 * for the final pin levels.
 */

import { buildNets } from '@/lib/netlist'
import type { Diagram, Endpoint, PartDef, PartInstance } from '@/lib/types'

export type PinValue = 0 | 1 | 'z'

/** Caller-owned device storage: one opaque bag per part id, threaded through every call. */
export type DeviceRuntimeState = Map<string, Record<string, unknown>>

/** Supply rails drive their net to a fixed level, so a control pin tied to a rail reads 0/1. */
// shortcut: only these two named rails drive a net; teach a battery or a generic supply pin
// to drive a net here when a device needs a reference from anything but these rails.
const RAIL_LEVELS: Record<string, 0 | 1> = { 'rail-5v': 1, 'rail-gnd': 0 }

/** A replay entry point over a frozen diagram: feed pin edges, then settle once. */
export interface DeviceHarness {
  /** Pins on a net that any device reads, so a caller can ignore irrelevant churn. */
  readonly watched: Set<string>
  /**
   * Seed every net from a full pin map. **Call this before replaying a frame's
   * transitions**: a pin that did not change during the frame produces no transition,
   * so without a seed the first device to read it sees 'z' instead of its real level.
   * (A pin that did not change has the same value at the start and end of the frame,
   * so end-of-frame values are the correct seed.)
   */
  seed(mcuPinValues: Map<string, PinValue>): void
  /** Apply one pin transition, stepping only the devices that read that pin's net. */
  applyTransition(key: string, value: PinValue, dtMicros?: number): void
  /** Step every device once with the final pin levels and return the merged pin map. */
  settle(mcuPinValues: Map<string, PinValue>, dtMicros?: number): Map<string, PinValue>
}

const splitKey = (key: string): [string, string] | null => {
  const at = key.indexOf(':')
  return at < 0 ? null : [key.slice(0, at), key.slice(at + 1)]
}

/**
 * Freeze a diagram's wiring and per-part device state into a replay harness.
 *
 * `state` is the caller's persistent bag map (shared across frames); it defaults to a fresh
 * map, which suits a one-shot `settle`. Nothing here throws: an unknown part, a missing def,
 * an unwired pin or a throwing device is skipped.
 *
 * shortcut: devices are stepped in diagram order with no fixed-point iteration, so a feedback
 * loop between two devices settles a frame late; and a net has no per-pin resolution beyond
 * 0/1/'z' (no wired-AND, no drive strength).
 */
export function createDeviceHarness(
  diagram: Diagram,
  defs: Map<string, PartDef>,
  state: DeviceRuntimeState = new Map(),
): DeviceHarness {
  let netOf: ((partId: string, pinId: string) => string | undefined) | null = null
  const netPins = new Map<string, Endpoint[]>()
  const railSeeds: Array<[string, PinValue]> = []
  const netDevices = new Map<string, PartInstance[]>()
  const devices: PartInstance[] = []
  const watched = new Set<string>()

  try {
    const nets = buildNets(diagram, defs)
    netOf = nets.netOf
    for (const net of nets.nets) netPins.set(net.id, net.pins)

    // Rails drive their net so a control pin tied to a supply reads a hard 0/1, not 'z'.
    for (const part of diagram.parts) {
      const level = RAIL_LEVELS[part.def]
      if (level === undefined) continue
      for (const pin of defs.get(part.def)?.pins ?? []) {
        const net = netOf(part.id, pin.id)
        if (net !== undefined) railSeeds.push([net, level])
      }
    }

    for (const part of diagram.parts) {
      const def = defs.get(part.def)
      if (!def?.device) continue
      devices.push(part)
      for (const pin of def.pins) {
        const net = netOf(part.id, pin.id)
        if (net === undefined) continue
        const list = netDevices.get(net)
        if (list) list.push(part)
        else netDevices.set(net, [part])
      }
    }

    for (const net of netDevices.keys()) {
      for (const e of netPins.get(net) ?? []) watched.add(`${e.part}:${e.pin}`)
    }
  } catch {
    netOf = null
    devices.length = 0
  }

  // Live net levels while edges are replayed. Reset to rails+MCU on every settle.
  const netLevel = new Map<string, PinValue>()
  const seedNetLevel = (mcuPinValues: Map<string, PinValue>) => {
    netLevel.clear()
    for (const [net, level] of railSeeds) netLevel.set(net, level)
    for (const [key, value] of mcuPinValues) {
      if (value !== 0 && value !== 1) continue
      const kp = splitKey(key)
      const net = kp && netOf ? netOf(kp[0], kp[1]) : undefined
      if (net !== undefined) netLevel.set(net, value)
    }
  }

  const stepDevice = (part: PartInstance, dtMicros: number, merged: Map<string, PinValue>) => {
    const def = defs.get(part.def)
    if (!def?.device) return
    const bag = state.get(part.id) ?? {}
    state.set(part.id, bag)

    let driven: Record<string, 0 | 1 | 'z'>
    try {
      driven = def.device.step(
        {
          level: (pinId) => {
            const net = netOf?.(part.id, pinId)
            return (net !== undefined ? netLevel.get(net) : undefined) ?? 'z'
          },
          dtMicros,
        },
        bag,
      )
    } catch {
      return
    }

    // Written in place so a later device in diagram order sees an earlier device's outputs.
    for (const pinId of Object.keys(driven)) {
      const value = driven[pinId]
      if (value !== 0 && value !== 1 && value !== 'z') continue
      merged.set(`${part.id}:${pinId}`, value)
      const net = netOf?.(part.id, pinId)
      if (net !== undefined) netLevel.set(net, value)
    }
  }

  return {
    watched,

    seed(mcuPinValues) {
      seedNetLevel(mcuPinValues)
    },

    applyTransition(key, value, dtMicros = 0) {
      if (!netOf) return
      const kp = splitKey(key)
      if (!kp) return
      const net = netOf(kp[0], kp[1])
      if (net === undefined) return
      if (value === 0 || value === 1) netLevel.set(net, value)
      for (const part of netDevices.get(net) ?? []) stepDevice(part, dtMicros, new Map())
    },

    settle(mcuPinValues, dtMicros = 0) {
      seedNetLevel(mcuPinValues)
      const merged = new Map(mcuPinValues)
      for (const part of devices) stepDevice(part, dtMicros, merged)
      return merged
    },
  }
}

/**
 * One-shot: advance every digital device once with the given pin levels and return the merged
 * pins. Equivalent to a harness's `settle`, rebuilding the netlist each call.
 */
export function stepDevices(
  diagram: Diagram,
  defs: Map<string, PartDef>,
  mcuPinValues: Map<string, PinValue>,
  state: DeviceRuntimeState,
  dtMicros: number,
): Map<string, PinValue> {
  return createDeviceHarness(diagram, defs, state).settle(mcuPinValues, dtMicros)
}
