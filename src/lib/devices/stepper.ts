/**
 * 28BYJ-48 stepper driven through a ULN2003 board.
 *
 * The board takes four phase inputs; the rotor turns one half-step each time the four levels
 * move to the next (or previous) pattern of the half-step sequence
 * 1000, 1100, 0100, 0110, 0010, 0011, 0001, 1001. Adjacent patterns differ by exactly one
 * bit, so a single `digitalWrite` is a single half-step and the edge replay sees every step.
 *
 * A 28BYJ-48 is geared ~1:64 with 32 steps/rev internally, so one output revolution is
 * 32 * 64 * 2 = 2048 half-steps. `visual().angle` is the rotor position in degrees and may
 * run past 360 or below 0 - the canvas rotates by it.
 *
 * shortcut: the coils are not an electrical load - no coil resistance/current, no holding
 * torque, no back-EMF - and only the 8-state half-step sequence is decoded, so a 4-state
 * full-step or a wave drive reads as "out of order" and is ignored. Add a coil model and a
 * per-drive sequence table when a design depends on current draw or full-step stepping.
 */

import type { DeviceModel } from '@/lib/types'

/** Half-step excitation order (in1..in4) as a 4-bit code, in1 the high bit. */
const SEQUENCE = [0b1000, 0b1100, 0b0100, 0b0110, 0b0010, 0b0011, 0b0001, 0b1001]
/** 32 internal steps/rev * 64:1 gearbox * 2 phases = 2048 half-steps per output turn. */
const HALF_STEPS_PER_TURN = 2048

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export const stepper: DeviceModel = {
  outputs: [],

  step(input, state) {
    // 'z' (unwired, or an input) reads as a de-energised coil, i.e. low.
    const code =
      (input.level('in1') === 1 ? 8 : 0) |
      (input.level('in2') === 1 ? 4 : 0) |
      (input.level('in3') === 1 ? 2 : 0) |
      (input.level('in4') === 1 ? 1 : 0)
    const index = SEQUENCE.indexOf(code)
    const phase = typeof state.phase === 'number' ? state.phase : -1
    let steps = int(state.steps)

    if (index >= 0) {
      if (phase < 0) {
        state.phase = index // first pattern: latch the phase, no direction to move in yet
      } else if (index !== phase) {
        const forward = (index - phase + 8) % 8
        if (forward === 1) {
          steps += 1
          state.phase = index
        } else if (forward === 7) {
          steps -= 1
          state.phase = index
        }
        // else: two or more entries away - the coils were energised out of order. Ignore it:
        // neither the rotor nor the phase reference moves, so a glitch cannot add a step. The
        // reference re-acquires when a pattern adjacent to the last good one arrives.
      }
    }

    state.steps = steps
    return {}
  },

  visual(state) {
    return { angle: ((int(state.steps) - int(state.stepsAtZero)) * 360) / HALF_STEPS_PER_TURN }
  },
}
