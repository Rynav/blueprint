import { shiftRegister } from '@/lib/devices/shift-register'
import { sevenSegment } from '@/lib/devices/seven-segment'
import type { PartDef, PinDef } from '@/lib/types'
import { ACCENT, BODY, BODY_DARK, DIM, LINE, Pads, Txt } from './shared'

// A 7-segment digit: dark segments sit in the unlit colour, lit ones glow red.
const SEG_DARK = '#3a2420'
const SEG_LIT = '#ff5340'

/** [id, x1, y1, x2, y2] for the seven bars; the decimal point is drawn as a circle. */
const SEG_BARS: [string, number, number, number, number][] = [
  ['a', 14, 12, 46, 12],
  ['b', 48, 14, 48, 46],
  ['c', 48, 54, 48, 86],
  ['d', 46, 88, 14, 88],
  ['e', 12, 54, 12, 86],
  ['f', 12, 14, 12, 46],
  ['g', 14, 50, 46, 50],
]

// Pads along the top and bottom edges; each is drawn at exactly this coordinate.
const segPins: PinDef[] = [
  { id: 'f', label: 'F', x: 12, y: 0, kind: 'passive' },
  { id: 'a', label: 'A', x: 30, y: 0, kind: 'passive' },
  { id: 'b', label: 'B', x: 48, y: 0, kind: 'passive' },
  { id: 'g', label: 'G', x: 64, y: 0, kind: 'passive' },
  { id: 'e', label: 'E', x: 12, y: 100, kind: 'passive' },
  { id: 'd', label: 'D', x: 30, y: 100, kind: 'passive' },
  { id: 'c', label: 'C', x: 48, y: 100, kind: 'passive' },
  { id: 'dp', label: 'DP', x: 64, y: 100, kind: 'passive' },
]

const sevenSegmentPart: PartDef = {
  id: 'seven-segment',
  name: '7-Segment Display',
  category: 'digital',
  width: 70,
  height: 100,
  pins: segPins,
  device: sevenSegment,
  render: ({ state }) => {
    const lit = new Set(state?.lit ?? [])
    return (
      <>
        <rect x={2} y={2} width={66} height={96} rx={6} fill={BODY_DARK} stroke={LINE} strokeWidth={1.4} />
        {SEG_BARS.map(([id, x1, y1, x2, y2]) => (
          <line
            key={id}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={lit.has(id) ? SEG_LIT : SEG_DARK}
            strokeWidth={6}
            strokeLinecap="round"
          />
        ))}
        <circle cx={56} cy={86} r={4} fill={lit.has('dp') ? SEG_LIT : SEG_DARK} />
        <Pads pins={segPins} />
      </>
    )
  },
}

// 74HC595 DIP-16: pins 1-8 down the left, 9-16 back up the right.
const srPins: PinDef[] = [
  { id: 'q1', label: '1', x: 0, y: 8, kind: 'passive' },
  { id: 'q2', label: '2', x: 0, y: 22, kind: 'passive' },
  { id: 'q3', label: '3', x: 0, y: 36, kind: 'passive' },
  { id: 'q4', label: '4', x: 0, y: 50, kind: 'passive' },
  { id: 'q5', label: '5', x: 0, y: 64, kind: 'passive' },
  { id: 'q6', label: '6', x: 0, y: 78, kind: 'passive' },
  { id: 'q7', label: '7', x: 0, y: 92, kind: 'passive' },
  { id: 'gnd', label: '8', x: 0, y: 106, kind: 'ground' },
  { id: 'vcc', label: '16', x: 90, y: 8, kind: 'power' },
  { id: 'q0', label: '15', x: 90, y: 22, kind: 'io' },
  { id: 'ds', label: '14', x: 90, y: 36, kind: 'io' },
  { id: 'oe', label: '13', x: 90, y: 50, kind: 'io' },
  { id: 'stcp', label: '12', x: 90, y: 64, kind: 'io' },
  { id: 'shcp', label: '11', x: 90, y: 78, kind: 'io' },
  { id: 'mr', label: '10', x: 90, y: 92, kind: 'io' },
  { id: 'q7s', label: '9', x: 90, y: 106, kind: 'passive' },
]

const shiftRegisterPart: PartDef = {
  id: 'shift-register-74hc595',
  name: '74HC595 Shift Register',
  category: 'digital',
  width: 90,
  height: 110,
  pins: srPins,
  device: shiftRegister,
  render: ({ def, state }) => {
    const lit = new Set(state?.lit ?? [])
    return (
      <>
        <rect x={16} y={4} width={58} height={102} rx={4} fill={BODY} stroke={LINE} strokeWidth={1.4} />
        <path d="M40 4 A7 7 0 0 0 54 4" fill="none" stroke={LINE} strokeWidth={1.4} />
        <Txt x={45} y={50} size={9}>
          74HC595
        </Txt>
        <Txt x={45} y={62} size={6} fill={DIM}>
          8-BIT SHIFT
        </Txt>
        {def.pins.map((p) => {
          const left = p.x < 45
          return (
            <g key={p.id}>
              <circle
                cx={left ? 32 : 58}
                cy={p.y}
                r={2.8}
                fill={lit.has(p.id) ? ACCENT : BODY_DARK}
                stroke={LINE}
                strokeWidth={0.6}
              />
              <Txt x={left ? 20 : 70} y={p.y + 3} size={6} fill={DIM} anchor={left ? 'start' : 'end'}>
                {p.label}
              </Txt>
            </g>
          )
        })}
        <Pads pins={def.pins} />
      </>
    )
  },
}

export const digitalParts: PartDef[] = [sevenSegmentPart, shiftRegisterPart]
