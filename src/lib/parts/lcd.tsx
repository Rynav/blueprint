import { lcdHd44780 } from '@/lib/devices/lcd-hd44780'
import type { PartDef, PinDef } from '@/lib/types'
import { BODY, DIM, LINE, MONO, Pads, Txt } from './shared'

/** Module geometry: the 16-pin header on top, the backlit glass panel below. */
const PANEL_X = 8
const PANEL_Y = 15
const PANEL_W = 154
const PANEL_H = 64
/** Inner text margin and per-character cell width, so the cursor lines up with the text. */
const INSET = 6
const CELL_W = (PANEL_W - INSET * 2) / 16

const BACKLIGHT = '#63c96f'
const BACKLIGHT_OFF = '#1d2c22'
const INK = '#0d2413'
const INK_OFF = '#263a2c'

/**
 * The 16-pin header, laid out like the real module: signals 1-6 (VSS..E) on the left and the
 * four data lines at slots 11-14, leaving the gaps where D0-D3 and the backlight pins sit.
 */
const pins: PinDef[] = [
  { id: 'vss', label: 'VSS', x: 8, y: 0, kind: 'ground' },
  { id: 'vdd', label: 'VDD', x: 18, y: 0, kind: 'power' },
  { id: 'v0', label: 'V0', x: 28, y: 0, kind: 'passive' },
  { id: 'rs', label: 'RS', x: 38, y: 0, kind: 'io' },
  { id: 'rw', label: 'RW', x: 48, y: 0, kind: 'io' },
  { id: 'e', label: 'E', x: 58, y: 0, kind: 'io' },
  { id: 'd4', label: 'D4', x: 108, y: 0, kind: 'io' },
  { id: 'd5', label: 'D5', x: 118, y: 0, kind: 'io' },
  { id: 'd6', label: 'D6', x: 128, y: 0, kind: 'io' },
  { id: 'd7', label: 'D7', x: 138, y: 0, kind: 'io' },
]

export const lcd: PartDef = {
  id: 'lcd-16x2',
  name: 'LCD 16x2 (HD44780)',
  category: 'digital',
  width: 170,
  height: 100,
  pins,
  device: lcdHd44780,
  render: ({ state }) => {
    const data = state?.data
    const text = Array.isArray(data?.text) ? (data.text as string[]) : ['', '']
    const on = data?.on !== false
    const blink = data?.blink === true
    const cursor = (data?.cursor as { row: number; col: number } | undefined) ?? { row: 0, col: 0 }
    const rowY = [PANEL_Y + 26, PANEL_Y + 52]
    // shortcut: characters are drawn with a monospace <text>, not the HD44780 5x8 glyph ROM,
    // so unusual bytes (custom CGRAM glyphs, the Japanese ROM) render as their font's shape.
    return (
      <>
        {pins.map((p) => (
          <line key={`lead-${p.id}`} x1={p.x} y1={p.y} x2={p.x} y2={10} stroke={LINE} strokeWidth={1} />
        ))}
        <rect x={4} y={10} width={162} height={84} rx={4} fill={BODY} stroke={LINE} strokeWidth={1.4} />
        <rect
          x={PANEL_X}
          y={PANEL_Y}
          width={PANEL_W}
          height={PANEL_H}
          rx={2}
          fill={on ? BACKLIGHT : BACKLIGHT_OFF}
        />
        {text.slice(0, 2).map((line, r) => (
          <text
            key={`row-${r}`}
            x={PANEL_X + INSET}
            y={rowY[r]}
            fontFamily={MONO}
            fontSize={15}
            fill={on ? INK : INK_OFF}
            xmlSpace="preserve"
          >
            {line}
          </text>
        ))}
        {on && blink ? (
          <rect
            x={PANEL_X + INSET + cursor.col * CELL_W}
            y={rowY[cursor.row] - 3}
            width={CELL_W - 1}
            height={2.5}
            fill={INK}
          />
        ) : null}
        <Txt x={85} y={89} size={5} fill={DIM}>
          HD44780 16x2 · 4-BIT
        </Txt>
        <Pads pins={pins} />
      </>
    )
  },
}
