import type { PartDef } from '@/lib/types'
import { BODY_DARK, LINE, Pad, Txt } from './shared'

const RAIL_RED = '#ef4444'
const RAIL_DARK = '#64748b'
const RAIL_W = 20
const RAIL_H = 70

/** A vertical supply rail: coloured bar, tie ticks, one pin at the open end. */
function rail(
  id: string,
  name: string,
  label: string,
  color: string,
  pinKind: 'power' | 'ground',
): PartDef {
  return {
    id,
    name,
    category: 'power',
    width: RAIL_W,
    height: RAIL_H,
    pins: [{ id: label, label, x: 10, y: RAIL_H, kind: pinKind }],
    render: () => (
      <>
        <line x1={10} y1={2} x2={10} y2={RAIL_H} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
        {[24, 36, 48, 60].map((y) => (
          <line key={y} x1={5} y1={y} x2={15} y2={y} stroke={color} strokeWidth={1} opacity={0.7} />
        ))}
        <g transform={`translate(${13} 20) rotate(-90)`}>
          <Txt x={0} y={0} size={9} fill={color} anchor="start">
            {label}
          </Txt>
        </g>
        <Pad x={10} y={RAIL_H} kind={pinKind} />
      </>
    ),
  }
}

const battery9v: PartDef = {
  id: 'battery-9v',
  name: '9V Battery',
  category: 'power',
  width: 70,
  height: 50,
  pins: [
    { id: '+', label: '+', x: 25, y: 0, kind: 'power' },
    { id: '-', label: '-', x: 45, y: 0, kind: 'ground' },
  ],
  render: () => (
    <>
      <rect x={6} y={16} width={58} height={30} rx={3} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      <rect x={11} y={21} width={48} height={20} rx={2} fill="none" stroke={LINE} strokeWidth={0.7} />
      <line x1={25} y1={0} x2={25} y2={16} stroke={LINE} strokeWidth={1.2} />
      <line x1={45} y1={0} x2={45} y2={16} stroke={LINE} strokeWidth={1.2} />
      <circle cx={25} cy={16} r={4} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
      <circle cx={45} cy={16} r={4} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
      <Txt x={18} y={12} size={9} fill={RAIL_RED} anchor="end">
        +
      </Txt>
      <Txt x={52} y={12} size={9} fill={RAIL_DARK} anchor="start">
        -
      </Txt>
      <Txt x={35} y={36} size={11}>
        9V
      </Txt>
      <Pad x={25} y={0} kind="power" />
      <Pad x={45} y={0} kind="ground" />
    </>
  ),
}

export const powerParts: PartDef[] = [
  rail('rail-5v', '5V Rail', '5V', RAIL_RED, 'power'),
  rail('rail-gnd', 'GND Rail', 'GND', RAIL_DARK, 'ground'),
  battery9v,
]
