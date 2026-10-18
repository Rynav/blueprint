import { servo } from '@/lib/devices/servo'
import type { PartDef, PinDef } from '@/lib/types'
import { BODY, BODY_DARK, DIM, LINE, Pads, Txt } from './shared'

// SG90-class micro servo: blue box, mounting tabs, and a horn that turns with the commanded
// angle. Shaft centre, in local coords, is where the horn rotates.
const SHAFT = { x: 30, y: 22 }
const HORN = '#e8eef7'
// The three leads a servo ships with: power red, ground brown, signal orange.
const LEAD_COLORS = { vcc: '#ef4444', gnd: '#a16207', signal: '#f59e0b' }

const servoPins: PinDef[] = [
  { id: 'vcc', label: 'V+', x: 15, y: 86, kind: 'power' },
  { id: 'gnd', label: 'GND', x: 30, y: 86, kind: 'ground' },
  { id: 'signal', label: 'SIG', x: 45, y: 86, kind: 'pwm' },
]

export const servoPart: PartDef = {
  id: 'servo',
  name: 'Servo (SG90)',
  category: 'motors',
  width: 60,
  height: 86,
  pins: servoPins,
  device: servo,
  render: ({ state }) => {
    const angle = Math.min(180, Math.max(0, state?.angle ?? 90))
    return (
      <>
        {/* mounting tabs */}
        <rect x={1} y={40} width={6} height={12} rx={1.5} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
        <rect x={53} y={40} width={6} height={12} rx={1.5} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
        {/* body */}
        <rect x={7} y={6} width={46} height={60} rx={5} fill={BODY} stroke={LINE} strokeWidth={1.4} />
        <rect x={13} y={44} width={34} height={16} rx={2} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
        <Txt x={30} y={55} size={6} fill={DIM}>
          SG90
        </Txt>
        {/* leads, in the servo's own colours */}
        {servoPins.map((p) => (
          <line
            key={p.id}
            x1={p.x}
            y1={66}
            x2={p.x}
            y2={p.y}
            stroke={LEAD_COLORS[p.id as keyof typeof LEAD_COLORS]}
            strokeWidth={1.6}
          />
        ))}
        {/* horn, rotated about the output shaft: 90 deg (default) points up */}
        <g transform={`rotate(${angle - 90} ${SHAFT.x} ${SHAFT.y})`}>
          <rect x={26.5} y={2} width={7} height={20} rx={3} fill={HORN} stroke={LINE} strokeWidth={1} />
          <circle cx={SHAFT.x} cy={7} r={1.6} fill={BODY_DARK} />
        </g>
        <circle cx={SHAFT.x} cy={SHAFT.y} r={5} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
        <Pads pins={servoPins} />
      </>
    )
  },
}
