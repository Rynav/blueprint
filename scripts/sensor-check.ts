/**
 * Stepper + ULN2003 and analog-joystick checks. Run with `bun scripts/sensor-check.ts`.
 *
 * Two new parts, each checked the way the app uses it: the stepper's phase sequence is driven
 * directly through `stepDevices` and then by real firmware bit-banging four pins through the
 * edge-replay harness; the joystick is solved by `circuit.ts` as two potentiometers and a
 * switch. Style mirrors scripts/circuit-check.ts: assert-based, non-zero exit on failure.
 */

import { createAvrRuntime } from '@/lib/avr/runtime'
import { simulate } from '@/lib/circuit'
import { compileSketchInline } from '@/lib/compile'
import { createDeviceHarness, stepDevices } from '@/lib/devices'
import type { PinValue } from '@/lib/devices'
import { stepper } from '@/lib/devices/stepper'
import { buildNets } from '@/lib/netlist'
import { allPartDefs, getPartDef } from '@/lib/parts'
import { joystick, uln2003 } from '@/lib/parts/sensors'
import type { Diagram, Endpoint, PartDef, PartInstance, Wire } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const defs = new Map<string, PartDef>(allPartDefs().map((d) => [d.id, d]))
defs.set(uln2003.id, uln2003)
defs.set(joystick.id, joystick)

const part = (id: string, def: string): PartInstance => ({ id, def, at: { x: 0, y: 0 }, rotation: 0 })
const partP = (id: string, def: string, params: Record<string, number>): PartInstance => ({
  ...part(id, def),
  params,
})
const wire = (id: string, from: Endpoint, to: Endpoint): Wire => ({ id, from, to })
const diagram = (parts: PartInstance[], wires: Wire[] = []): Diagram => ({
  version: 1,
  parts,
  wires,
  notes: [],
})
const pinValues = (...entries: [string, 0 | 1 | 'z'][]) => new Map<string, 0 | 1 | 'z'>(entries)

/** The half-step excitation order, written as the pattern strings a data sheet shows. */
const SEQUENCE = ['1000', '1100', '0100', '0110', '0010', '0011', '0001', '1001']
const FULL_TURN = 2048
/** 512 half-steps of a 2048-half-step turn, in degrees. */
const HALF_TURN_DEG = 512 * (360 / FULL_TURN)

// ---------------------------------------------------------------- part defs
{
  ok('the ULN2003 stepper part is registered in this map', defs.get('uln2003-stepper') === uln2003)
  ok('the ULN2003 stepper is a motor', uln2003.category === 'motors')
  ok('the stepper device is wired to the ULN2003 part', uln2003.device === stepper)
  ok(
    'the ULN2003 board exposes in1-in4, vcc and gnd',
    JSON.stringify(uln2003.pins.map((p) => p.id)) === JSON.stringify(['in1', 'in2', 'in3', 'in4', 'vcc', 'gnd']),
  )
  ok('the stepper drives no pins (it only counts phase edges)', stepper.outputs.length === 0)

  ok('the joystick part is registered in this map', defs.get('joystick') === joystick)
  ok('the joystick is a sensor', joystick.category === 'sensors')
  ok(
    'the joystick exposes vcc, gnd, vrx, vry and sw',
    JSON.stringify(joystick.pins.map((p) => p.id)) === JSON.stringify(['vcc', 'gnd', 'vrx', 'vry', 'sw']),
  )
  ok(
    'the joystick defaults to centred and released',
    JSON.stringify(joystick.defaultParams) === JSON.stringify({ x: 0.5, y: 0.5, pressed: 0 }),
  )
}

// ------------------------------------------------- stepper: phase-edge counting
// Uno D8/D9/D10/D11 -> IN1..IN4, so the device reads the same nets a real board does.
const PHASE_PINS = ['d8', 'd9', 'd10', 'd11'] as const
const stepperDiagram = diagram(
  [part('uno', 'arduino-uno'), part('st', 'uln2003-stepper'), part('v5', 'rail-5v'), part('gnd', 'rail-gnd')],
  [
    ...PHASE_PINS.map((p, i) => wire(`w${i}`, { part: 'uno', pin: p }, { part: 'st', pin: `in${i + 1}` })),
    wire('wv', { part: 'st', pin: 'vcc' }, { part: 'v5', pin: '5V' }),
    wire('wg', { part: 'st', pin: 'gnd' }, { part: 'gnd', pin: 'GND' }),
  ],
)

type Bags = Map<string, Record<string, unknown>>
const pinsFor = (pattern: string): Map<string, PinValue> =>
  new Map(PHASE_PINS.map((p, i) => [`uno:${p}`, (pattern[i] === '1' ? 1 : 0) as PinValue]))
const drive = (bag: Bags, pattern: string) => stepDevices(stepperDiagram, defs, pinsFor(pattern), bag, 0)
const stepsOf = (bag: Bags) => Number(bag.get('st')?.steps)
const angleOf = (bag: Bags) => stepper.visual!(bag.get('st') ?? {}).angle as number
/** The eight patterns of one cycle, starting the move at the second entry. */
const oneCycle = [...SEQUENCE.slice(1), SEQUENCE[0]]

{
  const bag: Bags = new Map()
  drive(bag, SEQUENCE[0])
  ok('the first pattern only latches the phase (0 steps)', stepsOf(bag) === 0)
  for (const p of oneCycle) drive(bag, p)
  ok('a full 8-pattern cycle advances exactly 8 half-steps', stepsOf(bag) === 8)
  ok(`...which is exactly 8*360/2048 = ${((8 * 360) / FULL_TURN).toFixed(6)} deg`, angleOf(bag) === (8 * 360) / FULL_TURN)
}
{
  const bag: Bags = new Map()
  drive(bag, SEQUENCE[0])
  for (const i of [7, 6, 5, 4, 3, 2, 1, 0]) drive(bag, SEQUENCE[i])
  ok('running the sequence backwards retreats exactly 8 half-steps', stepsOf(bag) === -8)
  ok('...at a negative angle', angleOf(bag) === (-8 * 360) / FULL_TURN)
}
{
  const bag: Bags = new Map()
  drive(bag, SEQUENCE[0])
  drive(bag, SEQUENCE[3]) // three entries ahead, i.e. out of order
  ok('an out-of-order pattern does not jump the rotor', stepsOf(bag) === 0)
  drive(bag, '1111') // a pattern the sequence never produces
  ok('an invalid coil pattern does not move the rotor', stepsOf(bag) === 0)
  drive(bag, '0000') // all coils released
  ok('releasing every coil does not move the rotor', stepsOf(bag) === 0)
  drive(bag, SEQUENCE[1]) // adjacent to the last good phase, so it still tracks
  ok('the next adjacent pattern still advances by one', stepsOf(bag) === 1)
}
{
  const bag: Bags = new Map()
  drive(bag, SEQUENCE[0])
  for (let c = 0; c < 5; c++) for (const p of oneCycle) drive(bag, p)
  ok('five cycles advance 40 half-steps (angle 40*360/2048)', stepsOf(bag) === 40 && angleOf(bag) === (40 * 360) / FULL_TURN)
}

// ------------------------------------------ stepper: real firmware, edge-replayed
// The app's frame loop: 16 ms per frame, every recorded edge replayed in order through a
// fresh harness. Seed with the *start*-of-frame levels so a multibit device's replay is
// exact: a stepper reads all four phases on every step, not just the pin that changed.
async function runSketchFrames(bag: Bags, frames: number): Promise<void> {
  const source = `
const byte SEQ[8] = {0b1000, 0b1100, 0b0100, 0b0110, 0b0010, 0b0011, 0b0001, 0b1001};

void setup() {
  pinMode(8, OUTPUT);
  pinMode(9, OUTPUT);
  pinMode(10, OUTPUT);
  pinMode(11, OUTPUT);
  for (int i = 0; i < 512; i++) {
    byte p = SEQ[i % 8];
    digitalWrite(8, (p >> 3) & 1);
    digitalWrite(9, (p >> 2) & 1);
    digitalWrite(10, (p >> 1) & 1);
    digitalWrite(11, p & 1);
    delay(1);
  }
}

void loop() { delay(1000); }
`
  const { hex, fitsTarget } = await compileSketchInline(source)
  ok('the 512-half-step sketch compiles and fits', fitsTarget && hex.length > 1000)
  const rt = createAvrRuntime(part('uno', 'arduino-uno'), getPartDef('arduino-uno')!)
  rt.load(hex)
  let prev = rt.pinValues()
  for (let f = 0; f < frames; f++) {
    rt.runFor(16_000)
    const transitions = rt.drainTransitions()
    const pins = rt.pinValues()
    const harness = createDeviceHarness(stepperDiagram, defs, bag)
    harness.seed(prev)
    for (const t of transitions) if (harness.watched.has(t.key)) harness.applyTransition(t.key, t.value)
    harness.settle(pins, 16_000)
    prev = pins
  }
}

{
  const bag: Bags = new Map()
  await runSketchFrames(bag, 80)
  const measured = stepsOf(bag)
  const measuredAngle = angleOf(bag)
  // 512 writes walk the sequence 512 times, but the very first one can only acquire the
  // phase (no direction yet), so 512 bit-banged half-steps land on 511 counted steps.
  console.log(
    `\n  firmware: ${measured} half-steps counted -> rotor ${measuredAngle.toFixed(4)} deg ` +
      `(${measured}/2048 of a turn; 512 writes x 360/2048 = ${HALF_TURN_DEG.toFixed(4)} deg, one step spent acquiring the phase)\n`,
  )
  ok('512 bit-banged half-steps count 511 steps (the first only acquires the phase)', measured === 511)
  ok('the reported angle is ~90 deg', Math.abs(measuredAngle - 90) <= 0.5)
  ok('...and the angle is exactly 511*360/2048', measuredAngle === (511 * 360) / FULL_TURN)
}

// ------------------------------------------------------------ joystick mapping
const joystickDiagram = (params: Record<string, number>) =>
  diagram(
    [part('v5', 'rail-5v'), part('gnd', 'rail-gnd'), partP('js', 'joystick', params)],
    [
      wire('w1', { part: 'js', pin: 'vcc' }, { part: 'v5', pin: '5V' }),
      wire('w2', { part: 'js', pin: 'gnd' }, { part: 'gnd', pin: 'GND' }),
    ],
  )
const voltsAt = (d: Diagram, id: string, pin: string) => {
  const st = simulate(d, defs, pinValues())
  return { v: st.volts[buildNets(d, defs).netOf(id, pin)!], converged: st.converged }
}

{
  const centre = joystickDiagram({ x: 0.5, y: 0.5 })
  const vx = voltsAt(centre, 'js', 'vrx')
  const vy = voltsAt(centre, 'js', 'vry')
  ok('joystick centre: converges', vx.converged && vy.converged)
  ok('joystick centre: VRx sits at ~2.5 V', Math.abs(vx.v - 2.5) <= 0.1)
  ok('joystick centre: VRy sits at ~2.5 V', Math.abs(vy.v - 2.5) <= 0.1)

  const x0 = voltsAt(joystickDiagram({ x: 0, y: 0.5 }), 'js', 'vrx')
  const x1 = voltsAt(joystickDiagram({ x: 1, y: 0.5 }), 'js', 'vrx')
  const y0 = voltsAt(joystickDiagram({ x: 0.5, y: 0 }), 'js', 'vry')
  const y1 = voltsAt(joystickDiagram({ x: 0.5, y: 1 }), 'js', 'vry')
  ok('joystick x=0 puts VRx at ~5 V', Math.abs(x0.v - 5) <= 0.05)
  ok('joystick x=1 puts VRx at ~0 V', Math.abs(x1.v - 0) <= 0.05)
  ok('joystick y=0 puts VRy at ~5 V', Math.abs(y0.v - 5) <= 0.05)
  ok('joystick y=1 puts VRy at ~0 V', Math.abs(y1.v - 0) <= 0.05)

  // The switch: a 10k pull-up to 5 V on SW. Released leaves the net high; pressed shorts it
  // to the module ground, so the net connects and reads low.
  const switchDiagram = (pressed: number) =>
    diagram(
      [
        part('v5', 'rail-5v'),
        part('gnd', 'rail-gnd'),
        partP('r', 'resistor', { ohms: 10000 }),
        partP('js', 'joystick', { x: 0.5, y: 0.5, pressed }),
      ],
      [
        wire('w1', { part: 'js', pin: 'gnd' }, { part: 'gnd', pin: 'GND' }),
        wire('w2', { part: 'v5', pin: '5V' }, { part: 'r', pin: '1' }),
        wire('w3', { part: 'r', pin: '2' }, { part: 'js', pin: 'sw' }),
      ],
    )
  const open = voltsAt(switchDiagram(0), 'js', 'sw')
  const closed = voltsAt(switchDiagram(1), 'js', 'sw')
  ok('joystick switch released: SW stays pulled up to ~5 V (net open)', Math.abs(open.v - 5) < 0.2)
  ok('joystick switch pressed: SW shorts to ground, ~0 V (net closed)', Math.abs(closed.v) < 0.2)
}

// ------------------------------------------------------------- robustness
{
  // vrx/vry/sw left unwired: those axes and the switch are simply skipped, not fatal.
  const partial = diagram(
    [part('v5', 'rail-5v'), part('gnd', 'rail-gnd'), partP('js', 'joystick', { x: 0.25, y: 0.75 })],
    [
      wire('w1', { part: 'js', pin: 'vcc' }, { part: 'v5', pin: '5V' }),
      wire('w2', { part: 'js', pin: 'gnd' }, { part: 'gnd', pin: 'GND' }),
    ],
  )
  const ps = simulate(partial, defs, pinValues())
  ok('joystick with unwired wipers still converges', ps.converged)
  ok('...and every voltage is finite', Object.values(ps.volts).every(Number.isFinite))

  // A stepper with nothing wired: every phase reads 'z', so it never moves and never throws.
  const bare: Bags = new Map()
  let threw = false
  try {
    stepDevices(diagram([part('st', 'uln2003-stepper')]), defs, new Map(), bare, 0)
  } catch {
    threw = true
  }
  ok('an unwired stepper does not throw', !threw)
  ok('...counts no steps and has a finite angle', stepsOf(bare) === 0 && Number.isFinite(angleOf(bare)))

  // Unknown part ids, mixed in with the new parts.
  let ghostThrew = false
  const ghost = diagram(
    [part('ghost', 'does-not-exist'), part('st', 'uln2003-stepper'), part('js', 'joystick'), part('gnd', 'rail-gnd')],
  )
  try {
    stepDevices(ghost, defs, new Map(), new Map(), 0)
    simulate(ghost, defs, pinValues())
  } catch {
    ghostThrew = true
  }
  ok('a diagram with an unknown part id does not throw', !ghostThrew)

  // No ground anywhere is reported, never a NaN.
  const noGround = simulate(diagram([part('js', 'joystick')]), defs, pinValues())
  ok('no ground: converged is false with a reason', noGround.converged === false && !!noGround.reason)
}

// ---- determinism and convergence across the new diagrams ----
{
  const suite: [string, Diagram][] = [
    ['stepper wired to an Uno', stepperDiagram],
    ['joystick centre', joystickDiagram({ x: 0.5, y: 0.5 })],
    ['joystick corner', joystickDiagram({ x: 0, y: 1 })],
  ]
  for (const [name, d] of suite) {
    const st = simulate(d, defs, pinValues())
    ok(`${name}: converges`, st.converged)
    ok(`${name}: every voltage is finite`, Object.values(st.volts).every(Number.isFinite))
    ok(
      `${name}: solves identically twice`,
      JSON.stringify(simulate(d, defs, pinValues())) === JSON.stringify(simulate(d, defs, pinValues())),
    )
  }
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
