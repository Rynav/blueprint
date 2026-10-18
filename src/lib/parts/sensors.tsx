import { clamp01, inCircle, roundTo } from '@/lib/controls'
import { hcSr04 as hcSr04Device } from '@/lib/devices/hc-sr04'
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
// Operated by dragging the stick inside the gimbal well; a control change carries one
// parameter, so each gesture drives the axis it leans on most (x: left 0 -> right 1, y: up
// 0 -> down 1, the sense circuit.ts solves), and a release re-centres the off-centre axis.
// shortcut: one axis per gesture; a truly 2-D stick needs ControlChange to carry both, which
// the frozen type does not allow. Upgrade when the gesture contract gains a second value.
const STICK = { x: 45, y: 36 }
const WELL_R = 26
const STICK_DEAD = 4

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
  control: ({ part, def, local, phase }) => {
    const cur = (axis: 'x' | 'y') => clamp01(part.params?.[axis] ?? def.defaultParams?.[axis] ?? 0.5)
    if (phase === 'up') {
      // Self-centring: a real stick springs back, so both axes return together.
      const back = []
      if (cur('x') !== 0.5) back.push({ param: 'x', value: 0.5 })
      if (cur('y') !== 0.5) back.push({ param: 'y', value: 0.5 })
      return back.length > 0 ? back : null
    }
    const dx = local.x - STICK.x
    const dy = local.y - STICK.y
    const d = Math.hypot(dx, dy)
    if (phase === 'down' && !inCircle(local, { ...STICK, r: WELL_R })) return null
    if (d <= STICK_DEAD) {
      // Dead zone: the stick is at rest, and claiming the gesture is what makes a `down`
      // here operate the stick rather than drag the part.
      return [
        { param: 'x', value: 0.5 },
        { param: 'y', value: 0.5 },
      ]
    }
    const eff = Math.min(1, (d - STICK_DEAD) / (WELL_R - STICK_DEAD))
    const ux = (dx / d) * eff
    const uy = (dy / d) * eff
    // Both axes in one gesture: a diagonal drag is one movement, not two.
    return [
      { param: 'x', value: roundTo(clamp01(0.5 + 0.5 * ux)) },
      { param: 'y', value: roundTo(clamp01(0.5 + 0.5 * uy)) },
    ]
  },
  render: ({ def, part }) => {
    const x = clamp01(part.params?.x ?? def.defaultParams?.x ?? 0.5)
    const y = clamp01(part.params?.y ?? def.defaultParams?.y ?? 0.5)
    const pressed = (part.params?.pressed ?? def.defaultParams?.pressed ?? 0) === 1
    const cx = 45 + (x - 0.5) * 16
    const cy = 36 + (y - 0.5) * 16
    return (
      <>
        <rect x={2} y={2} width={86} height={72} rx={4} fill={BODY} stroke={LINE} strokeWidth={1.4} />
        <rect x={8} y={74} width={74} height={12} rx={2} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />

        {/* the stick switch: this indicator lights while `pressed` */}
        <circle cx={12} cy={12} r={3.5} fill={pressed ? '#ef4444' : BODY_DARK} stroke={LINE} strokeWidth={1} />
        <Txt x={12} y={22} size={5} fill={DIM}>
          SW
        </Txt>

        {/* gimbal well */}
        <circle cx={45} cy={36} r={WELL_R} fill={BODY_DARK} stroke={LINE} strokeWidth={1.4} />
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

// HC-SR04 ultrasonic rangefinder: the classic four-pin board with two 40 kHz transducers
// (one transmits the burst, the other hears the echo). TRIG fires the burst; ECHO is held
// HIGH for 58 us per cm of round-trip distance, which a sketch times with pulseIn. The
// `distanceCm` param sets what the module "sees" and is editable in the Inspector.
export const hcSr04: PartDef = {
  id: 'hc-sr04',
  name: 'Ultrasonic (HC-SR04)',
  category: 'sensors',
  width: 84,
  height: 64,
  pins: [
    { id: 'vcc', label: 'VCC', x: 12, y: 64, kind: 'power' },
    { id: 'trig', label: 'TRIG', x: 32, y: 64, kind: 'io' },
    { id: 'echo', label: 'ECHO', x: 52, y: 64, kind: 'io' },
    { id: 'gnd', label: 'GND', x: 72, y: 64, kind: 'ground' },
  ],
  defaultParams: { distanceCm: 30 },
  device: hcSr04Device,
  render: ({ def, part }) => {
    const cm = part.params?.distanceCm ?? def.defaultParams?.distanceCm ?? 30
    return (
      <>
        <rect x={1} y={1} width={82} height={50} rx={4} fill={BODY} stroke={LINE} strokeWidth={1.4} />

        {/* the two transducer cans: T transmits the burst, R listens for the return echo */}
        <circle cx={27} cy={23} r={16} fill={BODY_DARK} stroke={LINE} strokeWidth={1.4} />
        <circle cx={27} cy={23} r={11} fill="none" stroke={LINE} strokeWidth={0.8} />
        <Txt x={27} y={26} size={8} fill={ACCENT}>
          T
        </Txt>
        <circle cx={61} cy={23} r={16} fill={BODY_DARK} stroke={LINE} strokeWidth={1.4} />
        <circle cx={61} cy={23} r={11} fill="none" stroke={LINE} strokeWidth={0.8} />
        <Txt x={61} y={26} size={8} fill={ACCENT}>
          R
        </Txt>

        <Txt x={44} y={9} size={6} fill={DIM}>
          HC-SR04
        </Txt>
        {/* what the module "sees", so the Inspector param reads on the canvas */}
        <Txt x={44} y={45} size={6} fill={TEXT}>
          {`${cm} cm`}
        </Txt>

        {/* 4-pin header: VCC / TRIG / ECHO / GND */}
        <rect x={6} y={52} width={72} height={11} rx={2} fill={BODY_DARK} stroke={LINE} strokeWidth={1} />
        <Txt x={44} y={60} size={5} fill={DIM}>
          VCC TRIG ECHO GND
        </Txt>

        <Pads pins={def.pins} />
      </>
    )
  },
}

