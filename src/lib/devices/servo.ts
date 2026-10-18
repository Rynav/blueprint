/**
 * Hobby servo (SG90 class): a 50 Hz pulse train read as an angle.
 *
 * The command is the *width* of the high pulse, not its average: 1 ms -> 0 deg, 1.5 ms ->
 * 90 deg, 2 ms -> 180 deg (0.5-2.5 ms is the full hobby range). The app only hands a device
 * the fraction of the 16 ms frame its pin spent high, so the high time actually seen is
 * `duty * dtMicros` - a whole pulse only when it fits inside the frame.
 *
 * A 50 Hz signal has a 20 ms period, so most 16 ms frames contain one pulse and many contain
 * none. A frame with no high time must HOLD the previous angle: snapping to 0 would make the
 * horn jitter violently once per beat. A pulse that straddles a frame boundary is the other
 * trap - the pin is still high at the frame end, so the fragment is carried and summed with
 * the next frame's so the pulse is measured whole.
 *
 * shortcut: one pulse per frame is assumed (true while the period > frame, i.e. below ~60 Hz).
 * A controller driving a servo faster than the 16 ms frame would need edge timing, not duty.
 */

import type { DeviceModel } from '@/lib/types'

/** Pulse width -> angle endpoints, in microseconds. */
const ZERO_US = 1000
const FULL_US = 2000
/** Below this there was no pulse at all (idle pin, or a noise glitch). */
const NO_SIGNAL_US = 100
/** Longer than any real command; also caps the cross-frame carry so a pin held high cannot grow forever. */
const MAX_PULSE_US = 2500
const DEFAULT_ANGLE = 90

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** 1 ms -> 0, 1.5 ms -> 90, 2 ms -> 180, clamped; 0.2 ms and 3 ms land on the ends, not NaN. */
const angleFor = (micros: number): number =>
  Math.min(180, Math.max(0, ((micros - ZERO_US) / (FULL_US - ZERO_US)) * 180))

export const servo: DeviceModel = {
  outputs: [],

  step(input, state) {
    if (typeof state.angle !== 'number' || !Number.isFinite(state.angle)) state.angle = DEFAULT_ANGLE
    // Edge replay steps with dtMicros 0 (no time has passed); only the per-frame settle has a
    // real dt. Ignore the former so a transient pin level cannot be latched into the carry.
    if (!(input.dtMicros > 0)) return {}

    const high = Math.max(0, input.duty('signal') * input.dtMicros)
    const carry = num(state.carry, 0) + high

    // High at the end of the frame means the pulse runs on into the next frame: remember the
    // fragment and hold, so a split pulse is summed rather than read as a shorter one.
    if (input.level('signal') === 1 && carry < MAX_PULSE_US) {
      state.carry = carry
      return {}
    }

    state.carry = 0
    if (carry < NO_SIGNAL_US) return {} // no signal this frame: hold the last angle

    state.angle = angleFor(carry)
    state.pulseMicros = carry
    return {}
  },

  visual(state) {
    return { angle: Math.min(180, Math.max(0, num(state.angle, DEFAULT_ANGLE))) }
  },
}
