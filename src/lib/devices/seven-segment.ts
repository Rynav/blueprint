/**
 * Common-cathode 7-segment display: an indicator, not a driver.
 *
 * A segment lights when its pin is driven HIGH; an unwired ('z') or low pin leaves it dark.
 * It drives nothing (`outputs: []`) but still keeps its lit set in state so the canvas can
 * draw it.
 */

import type { DeviceModel } from '@/lib/types'

const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']

export const sevenSegment: DeviceModel = {
  outputs: [],

  step(input, state) {
    state.lit = SEGMENTS.filter((seg) => input.level(seg) === 1)
    return {}
  },

  visual(state) {
    return { lit: Array.isArray(state.lit) ? (state.lit as string[]) : [] }
  },
}
