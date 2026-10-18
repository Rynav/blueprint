/**
 * HC-SR04 ultrasonic rangefinder.
 *
 * A >10 us HIGH pulse on `trig` sends a burst of eight 40 kHz pings; the sensor then raises
 * `echo` and holds it HIGH for the round-trip time, 58 us per cm of distance (29 us each way).
 * A sketch reads the distance with `pulseIn(echo, HIGH)`.
 *
 * `echo` is a real-time output: the frame loop must step this device *within* a frame (with a
 * sliced `runFor`), because a whole-frame step would raise `echo` and drop it again before the
 * CPU ever sampled it - and `pulseIn` is a busy-wait that has to see both edges to time them.
 * The countdown is carried in `state.echoRemaining` and advanced by `input.dtMicros`.
 *
 * Distance comes from `state.distanceCm`, seeded by the caller from the part's `distanceCm`
 * param (the device model never sees `PartInstance.params`). Out of range values are clamped.
 *
 * shortcut: no temperature dependence, no burst ringing, no minimum cycle between triggers, and
 * `distanceCm` is a parameter rather than something a sketch can influence. Add a real acoustic
 * model and a trigger-to-echo delay when a design measures those.
 */

import type { DeviceModel } from '@/lib/types'

/** Physically sane range for the module, in cm. */
const MIN_CM = 2
const MAX_CM = 400
const DEFAULT_CM = 30
/** Round-trip sound time at ~20 C. */
const US_PER_CM = 58

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback
const levelOf = (v: unknown): 0 | 1 | 'z' => (v === 0 || v === 1 ? v : 'z')

/** Clamp a possibly-missing/invalid distance into the module's usable range. */
const clampCm = (v: unknown): number => Math.min(MAX_CM, Math.max(MIN_CM, num(v, DEFAULT_CM)))

export const hcSr04: DeviceModel = {
  outputs: ['echo'],
  /**
   * The echo is a pulse tens of microseconds to tens of milliseconds long, so this device
   * must be stepped inside the frame: stepped only at the frame boundary, the pulse is born
   * and dies within one settle and `pulseIn` reads a timeout.
   */
  timed: true,

  step(input, state) {
    const trig = input.level('trig')
    const prev = levelOf(state.trig)
    // A live echo is exactly "still has time left"; no separate flag needed.
    let remaining = Math.max(0, num(state.echoRemaining, 0))

    // Time passes: the echo a sketch is polling shrinks toward zero.
    if (remaining > 0 && input.dtMicros > 0) remaining -= input.dtMicros

    // Rising edge only, and only when no echo is in flight (a real one ignores the trigger then).
    if (prev !== 1 && trig === 1 && remaining <= 0) {
      remaining = clampCm(state.distanceCm) * US_PER_CM
    }

    if (remaining < 0) remaining = 0
    state.echoRemaining = remaining
    state.trig = trig
    return { echo: remaining > 0 ? 1 : 0 }
  },
}
