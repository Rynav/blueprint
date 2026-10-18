import type { PinDef, PartDef } from '@/lib/types'
import { BODY, BODY_DARK, DIM, LINE, Pads, Txt } from './shared'

const BB_W = 330
const BB_H = 180
const COLS = 30

/** Hole pitch is 10, first column at x=20 (30 columns -> x 20..310). */
const colX = (col: number) => 20 + (col - 1) * 10

/** Rows a-e are the top half, f-j the bottom half, with a centre gap between. */
const ROWS: [string, number][] = [
  ['a', 34],
  ['b', 46],
  ['c', 58],
  ['d', 70],
  ['e', 82],
  ['f', 98],
  ['g', 110],
  ['h', 122],
  ['i', 134],
  ['j', 146],
]

const RAIL_Y = { tp: 12, tn: 22, bp: 158, bn: 168 }
const RAIL_P = '#ef4444'
const RAIL_N = '#3b82f6'

// shortcut: breadboard internal bus connections are not modelled yet, only hole pins; add row/rail nets in P2.
const bbPins: PinDef[] = [
  { id: 'tp+', label: 'TP+', x: 20, y: RAIL_Y.tp, kind: 'power' },
  { id: 'tp-', label: 'TP-', x: 20, y: RAIL_Y.tn, kind: 'ground' },
  { id: 'bp+', label: 'BP+', x: 20, y: RAIL_Y.bp, kind: 'power' },
  { id: 'bp-', label: 'BP-', x: 20, y: RAIL_Y.bn, kind: 'ground' },
  ...ROWS.flatMap(([row, y]) =>
    Array.from(
      { length: COLS },
      (_, i): PinDef => ({
        id: `${row}${i + 1}`,
        label: `${row}${i + 1}`,
        x: colX(i + 1),
        y,
        kind: 'passive',
      }),
    ),
  ),
]

function Rail({ y, color, text }: { y: number; color: string; text: string }) {
  return (
    <g>
      <line x1={10} y1={y} x2={BB_W - 10} y2={y} stroke={color} strokeWidth={1.2} />
      {Array.from({ length: COLS }, (_, i) => (
        <line
          key={i}
          x1={colX(i + 1)}
          y1={y - 3.5}
          x2={colX(i + 1)}
          y2={y + 3.5}
          stroke={color}
          strokeWidth={0.7}
          opacity={0.55}
        />
      ))}
      <Txt x={12} y={y - 4} size={5.5} fill={color} anchor="start">
        {text}
      </Txt>
    </g>
  )
}

const breadboardHalf: PartDef = {
  id: 'breadboard-half',
  name: 'Breadboard (half)',
  category: 'breadboards',
  width: BB_W,
  height: BB_H,
  pins: bbPins,
  render: () => (
    <>
      <rect x={0} y={0} width={BB_W} height={BB_H} rx={5} fill={BODY} stroke={LINE} strokeWidth={1.5} />
      <Rail y={RAIL_Y.tp} color={RAIL_P} text="+" />
      <Rail y={RAIL_Y.tn} color={RAIL_N} text="-" />
      <Rail y={RAIL_Y.bp} color={RAIL_P} text="+" />
      <Rail y={RAIL_Y.bn} color={RAIL_N} text="-" />
      <rect x={8} y={86} width={BB_W - 16} height={8} rx={2} fill={BODY_DARK} />
      <line x1={8} y1={90} x2={BB_W - 8} y2={90} stroke={LINE} strokeWidth={0.6} />
      {ROWS.map(([row, y]) => (
        <g key={row}>
          {Array.from({ length: COLS }, (_, i) => (
            <circle key={i} cx={colX(i + 1)} cy={y} r={1.6} fill={BODY_DARK} stroke={LINE} strokeWidth={0.6} />
          ))}
          <Txt x={12} y={y + 2} size={6} fill={DIM}>
            {row}
          </Txt>
          <Txt x={BB_W - 12} y={y + 2} size={6} fill={DIM}>
            {row}
          </Txt>
        </g>
      ))}
      {Array.from({ length: COLS }, (_, i) => (
        <Txt key={i} x={colX(i + 1)} y={31} size={5} fill={DIM}>
          {i + 1}
        </Txt>
      ))}
      <Pads pins={bbPins} />
    </>
  ),
}

export const breadboardParts: PartDef[] = [breadboardHalf]
