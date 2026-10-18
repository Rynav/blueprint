import { SSD1306_ADDRESS, ssd1306 } from '@/lib/devices/ssd1306'
import type { PartDef, PinDef } from '@/lib/types'
import { BODY, DIM, LINE, Pads, Txt } from './shared'

// Panel geometry. One framebuffer pixel is one SVG unit, so a lit pixel is a 1x1 square at
// (PX + x, PY + y); the bezel and header are drawn around it.
const PANEL_W = 128
const PANEL_H = 64
const PX = 6
const PY = 10

const GLASS = '#07101d'
const LIT = '#bfe9ff'

const pins: PinDef[] = [
  { id: 'gnd', label: 'GND', x: 20, y: 0, kind: 'ground' },
  { id: 'vcc', label: 'VCC', x: 52, y: 0, kind: 'power' },
  { id: 'sda', label: 'SDA', x: 84, y: 0, kind: 'io' },
  { id: 'scl', label: 'SCL', x: 116, y: 0, kind: 'io' },
]

/**
 * One SVG path covering every lit pixel, in the panel's local frame. Each pixel is a separate
 * subpath (`M x y h1 v1 h-1 z`), so the whole 128x64 panel is a single DOM element: a typical
 * text line lights a few hundred pixels (~300-800 of 8192) and a full splash up to 8192, which
 * as individual <rect>s would be thousands of elements rebuilt every 60 fps frame.
 *
 * Segment remap (0xA1), COM scan direction (0xC8), invert (0xA7) and entire-display-on (0xA5)
 * are applied here, at render time: the model keeps the raw buffer untouched.
 */
export function pixelPath(data: Record<string, unknown> | undefined): string {
  const fb = data?.fb
  if (!data || !(fb instanceof Uint8Array) || data.on === false) return ''
  const invert = data.invert === true
  const segRemap = data.segRemap === true
  const comScan = data.comScan === true
  const entireOn = data.entireOn === true

  let d = ''
  for (let page = 0; page < PANEL_H / 8; page++) {
    for (let col = 0; col < PANEL_W; col++) {
      let value = fb[page * PANEL_W + col] ?? 0
      if (entireOn) value = 0xff
      else if (invert) value ^= 0xff
      if (value === 0) continue
      const x = segRemap ? PANEL_W - 1 - col : col
      for (let bit = 0; bit < 8; bit++) {
        if (!(value & (1 << bit))) continue
        const raw = page * 8 + bit
        const y = comScan ? 63 - raw : raw
        d += `M${PX + x} ${PY + y}h1v1h-1z`
      }
    }
  }
  return d
}

const ssd1306Part: PartDef = {
  id: 'ssd1306-oled',
  name: 'OLED 128x64 (SSD1306)',
  category: 'digital',
  width: 140,
  height: 92,
  pins,
  device: ssd1306,
  /** An SSD1306 sketch needs the toolchain's OLED object group linked in. */
  sensors: ['OLED'],
  render: ({ state }) => {
    const d = pixelPath(state?.data)
    return (
      <>
        {pins.map((p) => (
          <line key={`lead-${p.id}`} x1={p.x} y1={p.y} x2={p.x} y2={6} stroke={LINE} strokeWidth={1} />
        ))}
        <rect x={2} y={6} width={136} height={80} rx={3} fill={BODY} stroke={LINE} strokeWidth={1.4} />
        <rect x={5} y={9} width={130} height={66} rx={1} fill={GLASS} />
        {/* Glass tint: a faint wash over the dark panel, drawn under the pixels. */}
        <rect x={5} y={9} width={130} height={66} rx={1} fill={LIT} opacity={0.05} />
        {d ? <path d={d} fill={LIT} shapeRendering="crispEdges" /> : null}
        <Txt x={70} y={83} size={5} fill={DIM}>
          SSD1306 I2C 0x{SSD1306_ADDRESS.toString(16).toUpperCase()}
        </Txt>
        <Pads pins={pins} />
      </>
    )
  },
}

export const displayParts: PartDef[] = [ssd1306Part]
