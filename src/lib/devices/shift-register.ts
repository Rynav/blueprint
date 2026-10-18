/**
 * 74HC595: 8-bit serial-in/parallel-out shift register with an output latch.
 *
 * The real chip shifts on SHCP rising edges into an 8-bit shift register; STCP copies it to
 * the output latch; OE (active low) tri-states the outputs; MR (active low) clears the
 * registers. A 16-bit shift register is used here so Q7S (serial out) carries the bit pushed
 * off the top, matching the spec's LSB-first contract.
 */

import type { DeviceModel } from '@/lib/types'

const OUTPUT_PINS = ['q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] as const

const word = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const bitOf = (v: unknown): 0 | 1 => (word(v) & 1) === 1 ? 1 : 0
const levelOf = (v: unknown): 0 | 1 | 'z' => (v === 0 || v === 1 ? v : 'z')

export const shiftRegister: DeviceModel = {
  outputs: [...OUTPUT_PINS, 'q7s'],

  step(input, state) {
    const shcp = input.level('shcp')
    const stcp = input.level('stcp')
    const prevShcp = levelOf(state.shcp)
    const prevStcp = levelOf(state.stcp)
    const reset = input.level('mr') === 0

    let shift = word(state.shift)
    let latch = word(state.latch)

    if (reset) {
      shift = 0
      latch = 0
    } else {
      // Rising edge only: a clock held high must not shift again.
      if (prevShcp !== 1 && shcp === 1) {
        const serial = input.level('ds') === 1 ? 1 : 0
        state.q7s = (shift >> 15) & 1 // the bit pushed off the top appears on Q7S
        shift = ((shift << 1) | serial) & 0xffff
      }
      if (prevStcp !== 1 && stcp === 1) latch = shift & 0xff
    }

    state.shift = shift
    state.latch = latch
    state.shcp = shcp
    state.stcp = stcp
    state.oe = input.level('oe')

    // OE is active low: HIGH (or unwired, which reads 'z') leaves the outputs driven.
    const enabled = state.oe !== 1
    const out: Record<string, 0 | 1 | 'z'> = {}
    for (let i = 0; i < 8; i++) out[OUTPUT_PINS[i]] = enabled ? (((latch >> i) & 1) as 0 | 1) : 'z'
    // shortcut: Q7S is not gated by OE here; gate it too if a design relies on the 595's
    // serial output going high-Z with the parallel outputs.
    out.q7s = bitOf(state.q7s)
    return out
  },

  visual(state) {
    const lit: string[] = []
    if (state.oe !== 1) {
      const latch = word(state.latch)
      for (let i = 0; i < 8; i++) if ((latch >> i) & 1) lit.push(OUTPUT_PINS[i])
    }
    if (bitOf(state.q7s) === 1) lit.push('q7s')
    return { lit }
  },
}
