import { createElement as h, Fragment as F } from 'react'

import type { PartDef } from '@/lib/types'
import { ACCENT, BODY_DARK, LINE, Pad, TEXT, Txt } from './shared'

// The parts here render SVG without JSX: this module is `devices.ts` (not .tsx), so the
// visuals are built with `createElement`. `h` is the usual JSX transform, spelled out.

// Two-terminal diode, drawn vertical like the LED: current flows anode (bottom) to
// cathode (top), so the triangle points up into the bar.
const diode: PartDef = {
  id: 'diode',
  name: 'Diode',
  category: 'diodes',
  width: 20,
  height: 30,
  pins: [
    { id: 'a', label: 'A', x: 10, y: 30, kind: 'passive' },
    { id: 'k', label: 'K', x: 10, y: 0, kind: 'passive' },
  ],
  defaultParams: { vf: 0.7 },
  render: () =>
    h(
      F,
      null,
      h('line', { x1: 10, y1: 0, x2: 10, y2: 10, stroke: LINE, strokeWidth: 1.2 }),
      h('line', { x1: 10, y1: 20, x2: 10, y2: 30, stroke: LINE, strokeWidth: 1.2 }),
      h('polygon', { points: '10,10 4,20 16,20', fill: BODY_DARK, stroke: LINE, strokeWidth: 1.2 }),
      h('line', { x1: 4, y1: 10, x2: 16, y2: 10, stroke: LINE, strokeWidth: 1.5 }),
      h(Pad, { x: 10, y: 30 }),
      h(Pad, { x: 10, y: 0 }),
    ),
}

/** Emitter arrowhead on the lead (16,31)->(40,41): NPN points out, PNP points in. */
function bjtArrow(npn: boolean): string {
  const dx = 24
  const dy = 10
  const len = Math.hypot(dx, dy)
  const ux = dx / len
  const uy = dy / len
  const tipX = 16 + dx * (npn ? 0.62 : 0.34)
  const tipY = 31 + dy * (npn ? 0.62 : 0.34)
  const s = npn ? 1 : -1
  const backX = tipX - s * ux * 7
  const backY = tipY - s * uy * 7
  return `${tipX},${tipY} ${backX - uy * 3.2},${backY + ux * 3.2} ${backX + uy * 3.2},${backY - ux * 3.2}`
}

function bjt(id: string, name: string, npn: boolean): PartDef {
  return {
    id,
    name,
    category: 'transistors',
    width: 50,
    height: 50,
    pins: [
      { id: 'b', label: 'B', x: 0, y: 25, kind: 'passive' },
      { id: 'c', label: 'C', x: 40, y: 0, kind: 'passive' },
      { id: 'e', label: 'E', x: 40, y: 50, kind: 'passive' },
    ],
    defaultParams: { gain: 100 },
    render: () =>
      h(
        F,
        null,
        h('circle', { cx: 26, cy: 25, r: 21, fill: BODY_DARK, stroke: LINE, strokeWidth: 1.2 }),
        h('line', { x1: 0, y1: 25, x2: 16, y2: 25, stroke: LINE, strokeWidth: 1.2 }),
        h('line', { x1: 16, y1: 13, x2: 16, y2: 37, stroke: LINE, strokeWidth: 2 }),
        h('polyline', { points: '16,19 40,9 40,0', fill: 'none', stroke: LINE, strokeWidth: 1.2 }),
        h('polyline', { points: '16,31 40,41 40,50', fill: 'none', stroke: LINE, strokeWidth: 1.2 }),
        h('polygon', { points: bjtArrow(npn), fill: TEXT }),
        h(Pad, { x: 0, y: 25 }),
        h(Pad, { x: 40, y: 0 }),
        h(Pad, { x: 40, y: 50 }),
      ),
  }
}

/** Arrow on the body lead (y=25): N points into the channel, P points out. */
function mosfetArrow(n: boolean): string {
  return n ? '23,25 29,21.5 29,28.5' : '35,25 29,21.5 29,28.5'
}

// Enhancement symbol: full gate bar, broken channel, body tied down to the source lead.
function mosfet(id: string, name: string, n: boolean): PartDef {
  return {
    id,
    name,
    category: 'transistors',
    width: 50,
    height: 50,
    pins: [
      { id: 'g', label: 'G', x: 0, y: 25, kind: 'passive' },
      { id: 'd', label: 'D', x: 40, y: 0, kind: 'passive' },
      { id: 's', label: 'S', x: 40, y: 50, kind: 'passive' },
    ],
    defaultParams: { vth: 2.1 },
    render: () =>
      h(
        F,
        null,
        h('line', { x1: 0, y1: 25, x2: 15, y2: 25, stroke: LINE, strokeWidth: 1.2 }),
        h('line', { x1: 15, y1: 12, x2: 15, y2: 38, stroke: LINE, strokeWidth: 1.6 }),
        h('line', { x1: 21, y1: 10, x2: 21, y2: 19, stroke: LINE, strokeWidth: 1.6 }),
        h('line', { x1: 21, y1: 22, x2: 21, y2: 28, stroke: LINE, strokeWidth: 1.6 }),
        h('line', { x1: 21, y1: 31, x2: 21, y2: 40, stroke: LINE, strokeWidth: 1.6 }),
        h('polyline', { points: '21,14 40,14 40,0', fill: 'none', stroke: LINE, strokeWidth: 1.2 }),
        h('polyline', { points: '21,36 40,36 40,50', fill: 'none', stroke: LINE, strokeWidth: 1.2 }),
        h('line', { x1: 21, y1: 25, x2: 40, y2: 25, stroke: LINE, strokeWidth: 1.2 }),
        h('line', { x1: 40, y1: 25, x2: 40, y2: 36, stroke: LINE, strokeWidth: 1.2 }),
        h('polygon', { points: mosfetArrow(n), fill: TEXT }),
        h(Pad, { x: 0, y: 25 }),
        h(Pad, { x: 40, y: 0 }),
        h(Pad, { x: 40, y: 50 }),
      ),
  }
}

const dcMotor: PartDef = {
  id: 'dc-motor',
  name: 'DC Motor',
  category: 'motors',
  width: 44,
  height: 44,
  pins: [
    { id: '+', label: '+', x: 14, y: 44, kind: 'passive' },
    { id: '-', label: '-', x: 30, y: 44, kind: 'passive' },
  ],
  defaultParams: { ohms: 12 },
  render: () =>
    h(
      F,
      null,
      h('line', { x1: 14, y1: 28, x2: 14, y2: 44, stroke: LINE, strokeWidth: 1.2 }),
      h('line', { x1: 30, y1: 28, x2: 30, y2: 44, stroke: LINE, strokeWidth: 1.2 }),
      h('circle', { cx: 22, cy: 20, r: 16, fill: BODY_DARK, stroke: LINE, strokeWidth: 1.2 }),
      h(Txt, { x: 22, y: 25, size: 14, children: 'M' }),
      h(Txt, { x: 8, y: 42, size: 8, fill: TEXT, children: '+' }),
      h(Txt, { x: 36, y: 42, size: 8, fill: TEXT, children: '-' }),
      h(Pad, { x: 14, y: 44 }),
      h(Pad, { x: 30, y: 44 }),
    ),
}

// NTC: a resistor box with the diagonal-and-foot thermistor mark across it.
const thermistor: PartDef = {
  id: 'thermistor',
  name: 'Thermistor (NTC)',
  category: 'sensors',
  width: 50,
  height: 16,
  pins: [
    { id: '1', label: '1', x: 0, y: 8, kind: 'passive' },
    { id: '2', label: '2', x: 50, y: 8, kind: 'passive' },
  ],
  defaultParams: { ohms: 10000, beta: 3950, temperatureC: 25 },
  render: () =>
    h(
      F,
      null,
      h('line', { x1: 0, y1: 8, x2: 13, y2: 8, stroke: LINE, strokeWidth: 1.2 }),
      h('line', { x1: 37, y1: 8, x2: 50, y2: 8, stroke: LINE, strokeWidth: 1.2 }),
      h('rect', { x: 13, y: 3, width: 24, height: 10, rx: 1, fill: BODY_DARK, stroke: LINE, strokeWidth: 1.2 }),
      h('line', { x1: 13, y1: 13, x2: 37, y2: 3, stroke: LINE, strokeWidth: 1.2 }),
      h('line', { x1: 13, y1: 13, x2: 19, y2: 13, stroke: LINE, strokeWidth: 1.2 }),
      h(Pad, { x: 0, y: 8 }),
      h(Pad, { x: 50, y: 8 }),
    ),
}

// A resistor box with two light arrows striking it.
const ldr: PartDef = {
  id: 'ldr',
  name: 'LDR',
  category: 'sensors',
  width: 50,
  height: 16,
  pins: [
    { id: '1', label: '1', x: 0, y: 8, kind: 'passive' },
    { id: '2', label: '2', x: 50, y: 8, kind: 'passive' },
  ],
  defaultParams: { ohms: 10000 },
  render: () =>
    h(
      F,
      null,
      h('line', { x1: 0, y1: 8, x2: 13, y2: 8, stroke: LINE, strokeWidth: 1.2 }),
      h('line', { x1: 37, y1: 8, x2: 50, y2: 8, stroke: LINE, strokeWidth: 1.2 }),
      h('rect', { x: 13, y: 3, width: 24, height: 10, rx: 1, fill: BODY_DARK, stroke: LINE, strokeWidth: 1.2 }),
      h('line', { x1: 5, y1: 0, x2: 15, y2: 7, stroke: ACCENT, strokeWidth: 1.2 }),
      h('polygon', { points: '15,7 10,6 13.5,3', fill: ACCENT }),
      h('line', { x1: 20, y1: 0, x2: 30, y2: 7, stroke: ACCENT, strokeWidth: 1.2 }),
      h('polygon', { points: '30,7 25,6 28.5,3', fill: ACCENT }),
      h(Pad, { x: 0, y: 8 }),
      h(Pad, { x: 50, y: 8 }),
    ),
}

export const deviceParts: PartDef[] = [
  diode,
  bjt('npn-transistor', 'NPN Transistor', true),
  bjt('pnp-transistor', 'PNP Transistor', false),
  mosfet('nmos', 'N-MOSFET', true),
  mosfet('pmos', 'P-MOSFET', false),
  dcMotor,
  thermistor,
  ldr,
]
