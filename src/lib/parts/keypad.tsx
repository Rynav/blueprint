import type { PinDef, PartDef } from '@/lib/types'
import { ACCENT, BODY, BODY_DARK, LINE, Pads, TEXT, Txt } from './shared'

/** Key legends in row-major matrix order: index n is row n/4+1, column n%4+1. */
const LEGENDS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D']

/** Key centres, each row/column aligned with its pin on the edge. */
const CENTRES = [25, 47, 69, 91]
const COL = (n: number) => CENTRES[n]
const ROW = (n: number) => CENTRES[n]

const pins: PinDef[] = [
  ...Array.from({ length: 4 }, (_, i): PinDef => ({ id: `r${i + 1}`, label: `R${i + 1}`, kind: 'passive', x: 0, y: ROW(i) })),
  ...Array.from({ length: 4 }, (_, i): PinDef => ({ id: `c${i + 1}`, label: `C${i + 1}`, kind: 'passive', x: COL(i), y: 110 })),
]

/**
 * 4x4 membrane keypad. Rows r1-r4 on the left, columns c1-c4 along the bottom; the 16 keys
 * run 1-9, *, 0, # and A-D in the usual layout. `params.key` is the pressed key by row-major
 * index (0..15), or -1 for none.
 */
export const keypad: PartDef = {
  id: 'keypad-4x4',
  name: 'Keypad 4x4',
  category: 'switches',
  width: 110,
  height: 110,
  pins,
  // No internalNets: a matrix deliberately does not short anything by itself.
  defaultParams: { key: -1 },
  render: ({ part, def }) => {
    const pressed = part.params?.key ?? def.defaultParams?.key ?? -1
    return (
      <>
        <rect x={1} y={1} width={108} height={108} rx={8} fill={BODY_DARK} stroke={LINE} strokeWidth={1.5} />
        {LEGENDS.map((legend, n) => {
          const cx = COL(n % 4)
          const cy = ROW(Math.floor(n / 4))
          const on = n === pressed
          return (
            <g key={legend}>
              <rect
                x={cx - 8}
                y={cy - 8}
                width={16}
                height={16}
                rx={3}
                fill={on ? ACCENT : BODY}
                stroke={on ? ACCENT : LINE}
                strokeWidth={1.2}
              />
              <Txt x={cx} y={cy + 3} size={8} fill={on ? BODY_DARK : TEXT}>
                {legend}
              </Txt>
            </g>
          )
        })}
        {CENTRES.map((cy, i) => (
          <Txt key={`r${i}`} x={8} y={cy + 2} size={5.5} anchor="start" fill={TEXT}>
            R{i + 1}
          </Txt>
        ))}
        {CENTRES.map((cx, i) => (
          <Txt key={`c${i}`} x={cx} y={106} size={5.5} fill={TEXT}>
            C{i + 1}
          </Txt>
        ))}
        <Pads pins={pins} />
      </>
    )
  },
}
