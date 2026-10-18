import { stepper } from '@/lib/devices/stepper'
import type { PartDef } from '@/lib/types'
import { ACCENT, BODY, BODY_DARK, DIM, LINE, Pads, TEXT, Txt } from './shared'

// 28BYJ-48 + its ULN2003 driver board. The DIP drives the four coils from IN1..IN4; the
// shaft marker rotates with the device's half-step count (`state.angle`). The motor is drawn
// as a round can with a bar shaft, deliberately unlike the servo's rectangular body and horn.
const MOTOR = { x: 70, y: 46 }
const DIP_LEADS = [0, 1, 2, 3, 4, 5, 6, 7]

export const uln2003: PartDef = {
  id: 'uln2003-stepper',
  name: 'Stepper + ULN2003',
  category: 'motors',
  width: 90,
  height: 110,
  pins: [
    { id: 'in1', label: 'IN1', x: 0, y: 26, kind: 'io' },
    { id: 'in2', label: 'IN2', x: 0, y: 44, kind: 'io' },
    { id: 'in3', label: 'IN3', x: 0, y: 62, kind: 'io' },
    { id: 'in4', label: 'IN4', x: 0, y: 80, kind: 'io' },
    { id: 'vcc', label: 'VCC', x: 20, y: 110, kind: 'power' },
    { id: 'gnd', label: 'GND', x: 40, y: 110, kind: 'ground' },
  ],
  device: stepper,
  render: ({ def, state }) => {
    const angle = state?.angle ?? 0
    return (
      <>
        <rect x={1} y={1} width={88} height={108} rx={4} fill={BODY} stroke={LINE} strokeWidth={1.4} />

        {/* ULN2003A DIP-16: the darlington array that sinks the coil current */}
        <rect x={6} y={14} width={40} height={42} rx={2} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
        <path d="M18 14 A6 6 0 0 0 30 14" fill="none" stroke={LINE} strokeWidth={1.2} />
        {DIP_LEADS.map((i) => (
          <g key={i}>
            <line x1={2} y1={20 + i * 4.6} x2={6} y2={20 + i * 4.6} stroke={LINE} strokeWidth={1} />
            <line x1={46} y1={20 + i * 4.6} x2={50} y2={20 + i * 4.6} stroke={LINE} strokeWidth={1} />
          </g>
        ))}
        <Txt x={26} y={36} size={7}>
          ULN2003A
        </Txt>
        <Txt x={26} y={46} size={5} fill={DIM}>
          7x DARLINGTON
        </Txt>

        {/* 5-wire header to the motor */}
        <rect x={6} y={64} width={40} height={24} rx={2} fill={BODY_DARK} stroke={LINE} strokeWidth={1.2} />
        {[0, 1, 2, 3, 4].map((i) => (
          <circle key={i} cx={11 + i * 7.5} cy={72} r={2.6} fill={LINE} stroke={BODY_DARK} strokeWidth={0.6} />
        ))}
        <Txt x={26} y={84} size={5} fill={DIM}>
          5-WIRE
        </Txt>

        {/* power header: VCC / GND at the bottom edge */}
        <rect x={10} y={94} width={40} height={12} rx={2} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
        <line x1={20} y1={106} x2={20} y2={110} stroke={LINE} strokeWidth={1.2} />
        <line x1={40} y1={106} x2={40} y2={110} stroke={LINE} strokeWidth={1.2} />
        <Txt x={30} y={103} size={5} fill={DIM}>
          VCC GND
        </Txt>

        {/* the geared motor: round can, bar shaft marker rotated by the rotor angle */}
        <circle cx={MOTOR.x} cy={MOTOR.y} r={17} fill={BODY_DARK} stroke={LINE} strokeWidth={1.4} />
        <circle cx={MOTOR.x} cy={MOTOR.y} r={12} fill={BODY} stroke={LINE} strokeWidth={0.8} />
        <g transform={`rotate(${angle} ${MOTOR.x} ${MOTOR.y})`}>
          <line
            x1={MOTOR.x}
            y1={MOTOR.y}
            x2={MOTOR.x}
            y2={MOTOR.y - 14}
            stroke={ACCENT}
            strokeWidth={2.2}
            strokeLinecap="round"
          />
          <circle cx={MOTOR.x} cy={MOTOR.y - 14} r={3} fill={ACCENT} />
        </g>
        <circle cx={MOTOR.x} cy={MOTOR.y} r={4} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
        <Txt x={MOTOR.x} y={76} size={6} fill={TEXT}>
          28BYJ-48
        </Txt>

        <Pads pins={def.pins} />
      </>
    )
  },
}

// Analog joystick (KY-023 class): two potentiometers on X/Y plus a push switch, brought out
// to a 5-pin header. The dome is nudged by x/y so the stick's position reads on the canvas.
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export const joystick: PartDef = {
  id: 'joystick',
  name: 'Analog Joystick',
  category: 'sensors',
  width: 90,
  height: 90,
  pins: [
    { id: 'vcc', label: '5V', x: 12, y: 90, kind: 'power' },
    { id: 'gnd', label: 'GND', x: 28, y: 90, kind: 'ground' },
    { id: 'vrx', label: 'VRx', x: 44, y: 90, kind: 'analog' },
    { id: 'vry', label: 'VRy', x: 60, y: 90, kind: 'analog' },
    { id: 'sw', label: 'SW', x: 76, y: 90, kind: 'io' },
  ],
  defaultParams: { x: 0.5, y: 0.5, pressed: 0 },
  render: ({ def, part }) => {
    const x = clamp01(part.params?.x ?? def.defaultParams?.x ?? 0.5)
    const y = clamp01(part.params?.y ?? def.defaultParams?.y ?? 0.5)
    const cx = 45 + (x - 0.5) * 16
    const cy = 36 + (y - 0.5) * 16
    return (
      <>
        <rect x={2} y={2} width={86} height={72} rx={4} fill={BODY} stroke={LINE} strokeWidth={1.4} />
        <rect x={8} y={74} width={74} height={12} rx={2} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />

        {/* gimbal well */}
        <circle cx={45} cy={36} r={26} fill={BODY_DARK} stroke={LINE} strokeWidth={1.4} />
        <circle cx={45} cy={36} r={20} fill={BODY} stroke={LINE} strokeWidth={0.8} />

        {/* thumbstick dome, offset by the axis params for feedback */}
        <circle cx={cx} cy={cy} r={13} fill={BODY} stroke={ACCENT} strokeWidth={1.4} />
        <circle cx={cx - 4} cy={cy - 4} r={3} fill={ACCENT} opacity={0.45} />
        <circle cx={cx} cy={cy} r={2} fill={LINE} />
        <Txt x={45} y={64} size={5} fill={DIM}>
          KY-023
        </Txt>

        <Pads pins={def.pins} />
      </>
    )
  },
}
