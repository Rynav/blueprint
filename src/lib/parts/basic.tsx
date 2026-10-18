import type { PartDef } from '@/lib/types'
import { ACCENT, BODY, BODY_DARK, LINE, Pad, TEXT, Txt } from './shared'

const led: PartDef = {
  id: 'led',
  name: 'LED',
  category: 'leds',
  width: 20,
  height: 30,
  pins: [
    { id: 'a', label: 'A', x: 10, y: 30, kind: 'passive' },
    { id: 'k', label: 'K', x: 10, y: 0, kind: 'passive' },
  ],
  defaultParams: { vf: 2.0 },
  render: ({ state }) => {
    const lit = Math.min(1, Math.max(0, state?.brightness ?? 0))
    return (
      <>
        <circle cx={10} cy={15} r={13 + 3 * lit} fill="#ef4444" opacity={0.12 + 0.45 * lit} />
        <line x1={10} y1={0} x2={10} y2={10} stroke={LINE} strokeWidth={1.2} />
        <line x1={10} y1={20} x2={10} y2={30} stroke={LINE} strokeWidth={1.2} />
        <polygon
          points="10,10 4,20 16,20"
          fill={lit > 0.05 ? '#f87171' : BODY_DARK}
          stroke={LINE}
          strokeWidth={1.2}
        />
        <line x1={4} y1={10} x2={16} y2={10} stroke={LINE} strokeWidth={1.5} />
        <Pad x={10} y={30} />
        <Pad x={10} y={0} />
      </>
    )
  },
}

const rgbLeads: [string, number][] = [
  ['#ef4444', 4],
  ['#22c55e', 12],
  ['#3b82f6', 20],
]

const rgbLed: PartDef = {
  id: 'rgb-led',
  name: 'RGB LED',
  category: 'leds',
  width: 24,
  height: 32,
  pins: [
    { id: 'r', label: 'R', x: 4, y: 0, kind: 'passive' },
    { id: 'g', label: 'G', x: 12, y: 0, kind: 'passive' },
    { id: 'b', label: 'B', x: 20, y: 0, kind: 'passive' },
    { id: 'k', label: 'K', x: 12, y: 32, kind: 'passive' },
  ],
  render: () => (
    <>
      <circle cx={12} cy={17} r={13} fill={ACCENT} opacity={0.08} />
      <circle cx={12} cy={17} r={11} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      {rgbLeads.map(([color, x]) => (
        <g key={color}>
          <line x1={x} y1={0} x2={x} y2={10} stroke={LINE} strokeWidth={1.2} />
          <polygon points={`${x},10 ${x - 3.5},5 ${x + 3.5},5`} fill={color} opacity={0.9} />
        </g>
      ))}
      <line x1={12} y1={28} x2={12} y2={32} stroke={LINE} strokeWidth={1.2} />
      <Pad x={4} y={0} />
      <Pad x={12} y={0} />
      <Pad x={20} y={0} />
      <Pad x={12} y={32} />
    </>
  ),
}

const resistor: PartDef = {
  id: 'resistor',
  name: 'Resistor',
  category: 'resistors',
  width: 50,
  height: 16,
  pins: [
    { id: '1', label: '1', x: 0, y: 8, kind: 'passive' },
    { id: '2', label: '2', x: 50, y: 8, kind: 'passive' },
  ],
  defaultParams: { ohms: 220 },
  render: () => (
    <>
      <line x1={0} y1={8} x2={13} y2={8} stroke={LINE} strokeWidth={1.2} />
      <line x1={37} y1={8} x2={50} y2={8} stroke={LINE} strokeWidth={1.2} />
      <rect x={13} y={3} width={24} height={10} rx={1} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      {[19, 25, 31].map((x) => (
        <line key={x} x1={x} y1={3} x2={x} y2={13} stroke={LINE} strokeWidth={0.7} opacity={0.7} />
      ))}
      <Pad x={0} y={8} />
      <Pad x={50} y={8} />
    </>
  ),
}

// The two pins on each side are tied inside the switch; the a/b throw across the middle is not modelled.
const pushbutton: PartDef = {
  id: 'pushbutton',
  name: 'Push Button',
  category: 'switches',
  width: 60,
  height: 60,
  pins: [
    { id: '1a', label: '1a', x: 0, y: 15, kind: 'passive' },
    { id: '1b', label: '1b', x: 0, y: 45, kind: 'passive' },
    { id: '2a', label: '2a', x: 60, y: 15, kind: 'passive' },
    { id: '2b', label: '2b', x: 60, y: 45, kind: 'passive' },
  ],
  internalNets: [
    ['1a', '1b'],
    ['2a', '2b'],
  ],
  render: () => (
    <>
      <line x1={0} y1={15} x2={18} y2={15} stroke={LINE} strokeWidth={1.2} />
      <line x1={0} y1={45} x2={18} y2={45} stroke={LINE} strokeWidth={1.2} />
      <line x1={60} y1={15} x2={42} y2={15} stroke={LINE} strokeWidth={1.2} />
      <line x1={60} y1={45} x2={42} y2={45} stroke={LINE} strokeWidth={1.2} />
      <rect x={18} y={12} width={24} height={36} rx={3} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      <rect x={21} y={16} width={5} height={28} rx={1} fill={BODY} stroke={LINE} strokeWidth={0.7} />
      <rect x={34} y={16} width={5} height={28} rx={1} fill={BODY} stroke={LINE} strokeWidth={0.7} />
      <circle cx={30} cy={30} r={8} fill={BODY} stroke={ACCENT} strokeWidth={1.2} />
      <circle cx={30} cy={30} r={2.5} fill={ACCENT} opacity={0.7} />
      <Txt x={10} y={12} size={6}>
        1a
      </Txt>
      <Txt x={10} y={42} size={6}>
        1b
      </Txt>
      <Txt x={50} y={12} size={6}>
        2a
      </Txt>
      <Txt x={50} y={42} size={6}>
        2b
      </Txt>
      <Pad x={0} y={15} />
      <Pad x={0} y={45} />
      <Pad x={60} y={15} />
      <Pad x={60} y={45} />
    </>
  ),
}

// shortcut: SPDT pins are static; slide position and the 1-2 / 2-3 throw are not modelled.
const slideSwitch: PartDef = {
  id: 'slide-switch',
  name: 'Slide Switch (SPDT)',
  category: 'switches',
  width: 60,
  height: 30,
  pins: [
    { id: '1', label: '1', x: 10, y: 30, kind: 'passive' },
    { id: '2', label: '2', x: 30, y: 30, kind: 'passive' },
    { id: '3', label: '3', x: 50, y: 30, kind: 'passive' },
  ],
  render: () => (
    <>
      <line x1={10} y1={20} x2={10} y2={30} stroke={LINE} strokeWidth={1.2} />
      <line x1={30} y1={20} x2={30} y2={30} stroke={LINE} strokeWidth={1.2} />
      <line x1={50} y1={20} x2={50} y2={30} stroke={LINE} strokeWidth={1.2} />
      <rect x={2} y={2} width={56} height={18} rx={3} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      <line x1={10} y1={11} x2={50} y2={11} stroke={LINE} strokeWidth={0.8} opacity={0.7} />
      <rect x={25} y={5} width={10} height={12} rx={2} fill={BODY} stroke={ACCENT} strokeWidth={1.2} />
      <Txt x={10} y={18} size={6} fill={TEXT}>
        1
      </Txt>
      <Txt x={30} y={18} size={6} fill={TEXT}>
        2
      </Txt>
      <Txt x={50} y={18} size={6} fill={TEXT}>
        3
      </Txt>
      <Pad x={10} y={30} />
      <Pad x={30} y={30} />
      <Pad x={50} y={30} />
    </>
  ),
}

const potentiometer: PartDef = {
  id: 'potentiometer',
  name: 'Potentiometer',
  category: 'resistors',
  width: 60,
  height: 50,
  pins: [
    { id: '1', label: '1', x: 10, y: 50, kind: 'passive' },
    { id: '2', label: '2', x: 30, y: 50, kind: 'passive' },
    { id: '3', label: '3', x: 50, y: 50, kind: 'passive' },
  ],
  render: () => (
    <>
      <line x1={10} y1={40} x2={10} y2={50} stroke={LINE} strokeWidth={1.2} />
      <line x1={30} y1={40} x2={30} y2={50} stroke={LINE} strokeWidth={1.2} />
      <line x1={50} y1={40} x2={50} y2={50} stroke={LINE} strokeWidth={1.2} />
      <line x1={10} y1={40} x2={50} y2={40} stroke={LINE} strokeWidth={1.2} />
      <circle cx={30} cy={24} r={16} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      <circle cx={30} cy={24} r={11} fill={BODY} stroke={LINE} strokeWidth={0.8} />
      <line x1={30} y1={24} x2={30} y2={14} stroke={ACCENT} strokeWidth={1.5} />
      <Txt x={4} y={47} size={6} fill={TEXT} anchor="start">
        1
      </Txt>
      <Txt x={56} y={47} size={6} fill={TEXT} anchor="end">
        3
      </Txt>
      <Pad x={10} y={50} />
      <Pad x={30} y={50} />
      <Pad x={50} y={50} />
    </>
  ),
}

const buzzer: PartDef = {
  id: 'buzzer',
  name: 'Buzzer',
  category: 'sound',
  width: 40,
  height: 40,
  pins: [
    { id: '+', label: '+', x: 13, y: 40, kind: 'passive' },
    { id: '-', label: '-', x: 27, y: 40, kind: 'passive' },
  ],
  render: () => (
    <>
      <line x1={13} y1={28} x2={13} y2={40} stroke={LINE} strokeWidth={1.2} />
      <line x1={27} y1={28} x2={27} y2={40} stroke={LINE} strokeWidth={1.2} />
      <circle cx={20} cy={17} r={16} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
      <circle cx={20} cy={17} r={5} fill={BODY} stroke={LINE} strokeWidth={0.8} />
      <circle cx={20} cy={17} r={1.6} fill={LINE} />
      <Txt x={5} y={38} size={7} fill={TEXT}>
        +
      </Txt>
      <Pad x={13} y={40} />
      <Pad x={27} y={40} />
    </>
  ),
}

export const basicParts: PartDef[] = [
  led,
  rgbLed,
  resistor,
  pushbutton,
  slideSwitch,
  potentiometer,
  buzzer,
]
