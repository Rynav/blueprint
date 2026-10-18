/**
 * Digital-peripheral checks: the whole chain, MCU firmware -> stepDevices -> simulate -> LED.
 * Run with `bun scripts/digital-check.ts`. Style mirrors scripts/check.tsx: assert-based,
 * non-zero exit on failure.
 *
 * The headline case compiles the real `shiftOut()` call onto an ATmega328P, steps the AVR in
 * sub-microsecond slices (so a bit-banged clock pulse is actually sampled), and measures the
 * eight LED currents the shift register drives. Nothing here tunes the expectation to the
 * result: the expected bit pattern is derived from the constant that was shifted out.
 */

import { createAvrRuntime } from '@/lib/avr/runtime'
import { simulate } from '@/lib/circuit'
import { compileSketchInline } from '@/lib/compile'
import { createDeviceHarness, stepDevices } from '@/lib/devices'
import type { PinValue } from '@/lib/devices'
import { allPartDefs, getPartDef } from '@/lib/parts'
import type { Diagram, Endpoint, PartDef, PartInstance, Wire } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const defs = new Map<string, PartDef>(allPartDefs().map((d) => [d.id, d]))
const part = (id: string, def: string): PartInstance => ({ id, def, at: { x: 0, y: 0 }, rotation: 0 })
const wire = (id: string, from: Endpoint, to: Endpoint): Wire => ({ id, from, to })
const diagram = (parts: PartInstance[], wires: Wire[] = []): Diagram => ({ version: 1, parts, wires, notes: [] })

const UNO = 'uno'
const SR = 'sr'
const GND = 'gnd'
const V5 = 'v5'
const LEDS = Array.from({ length: 8 }, (_, i) => `led${i}`)
const RES = Array.from({ length: 8 }, (_, i) => `r${i}`)

/** Exactly what the user draws: Uno <-> 595, each Qn through 220R into its own LED to GND. */
const srCircuit: Diagram = diagram(
  [
    part(UNO, 'arduino-uno'),
    part(SR, 'shift-register-74hc595'),
    ...RES.map((id) => part(id, 'resistor')),
    ...LEDS.map((id) => part(id, 'led')),
    part(V5, 'rail-5v'),
    part(GND, 'rail-gnd'),
  ],
  [
    wire('wa', { part: UNO, pin: 'd11' }, { part: SR, pin: 'ds' }),
    wire('wb', { part: UNO, pin: 'd13' }, { part: SR, pin: 'shcp' }),
    wire('wc', { part: UNO, pin: 'd12' }, { part: SR, pin: 'stcp' }),
    wire('wd', { part: SR, pin: 'oe' }, { part: GND, pin: 'GND' }),
    wire('we', { part: SR, pin: 'mr' }, { part: V5, pin: '5V' }),
    ...LEDS.flatMap((led, i) => [
      wire(`wq${i}`, { part: SR, pin: `q${i}` }, { part: RES[i], pin: '1' }),
      wire(`wr${i}`, { part: RES[i], pin: '2' }, { part: led, pin: 'a' }),
      wire(`wl${i}`, { part: led, pin: 'k' }, { part: GND, pin: 'GND' }),
    ]),
  ],
)

/** ledN current in mA, from a solved frame. */
const ledMa = (st: ReturnType<typeof simulate>, i: number) => (st.current[LEDS[i]] ?? 0) * 1e3
const patternOf = (st: ReturnType<typeof simulate>) => LEDS.map((_, i) => (ledMa(st, i) > 0.5 ? 1 : 0))
const expectedBits = (value: number) => Array.from({ length: 8 }, (_, i) => (value >> i) & 1)

const sketchFor = (value: number) => `
void setup() {
  pinMode(11, OUTPUT);
  pinMode(12, OUTPUT);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(12, LOW);
  shiftOut(11, 13, MSBFIRST, ${value});
  digitalWrite(12, HIGH);
  delay(1000);
}
`

/**
 * Run real firmware until the outputs are settled, stepping the devices on every slice.
 * A bit-banged clock is HIGH for only a few CPU cycles, so a whole Arduino frame (16 ms)
 * would sample straight past it: 0.5 us slices keep every shift edge visible.
 */
async function measureShiftOut(value: number): Promise<ReturnType<typeof simulate> | null> {
  const { hex, fitsTarget } = await compileSketchInline(sketchFor(value))
  ok(`0x${value.toString(16).toUpperCase().padStart(2, '0')}: sketch compiles and fits`, fitsTarget && hex.length > 1000)

  const runtime = createAvrRuntime(part(UNO, 'arduino-uno'), getPartDef('arduino-uno')!)
  runtime.load(hex)

  const SLICE_MICROS = 0.5
  const SLICES = 20_000 // 10 ms of simulated time: ample for setup() + one loop iteration
  const bags = new Map<string, Record<string, unknown>>()
  let merged: Map<string, PinValue> = new Map()
  for (let i = 0; i < SLICES; i++) {
    runtime.runFor(SLICE_MICROS)
    merged = stepDevices(srCircuit, defs, runtime.pinValues(), bags, SLICE_MICROS)
  }
  return simulate(srCircuit, defs, merged)
}

// ---- headline: 0xB5 through a real shiftOut ----
const headline = await measureShiftOut(0xb5)
if (!headline) {
  ok('headline: the shiftOut circuit solves', false)
} else {
  const pattern = patternOf(headline)
  console.log(
    `\n  headline 0xB5: measured q7..q0 = ${[...pattern].reverse().join('')} ` +
      `(${pattern.map((_, i) => ledMa(headline, 7 - i).toFixed(1)).join(', ')} mA)\n`,
  )
  ok('headline: circuit converged', headline.converged)
  ok('headline: bit pattern is exactly 0xB5', JSON.stringify(pattern) === JSON.stringify(expectedBits(0xb5)))
  const lit = pattern.flatMap((bit, i) => (bit ? [i] : []))
  ok('headline: five LEDs lit, three dark', lit.length === 5)
  ok(
    'headline: every lit LED carries 10-16 mA',
    lit.every((i) => ledMa(headline, i) >= 10 && ledMa(headline, i) <= 16),
  )
  ok(
    'headline: every dark LED is under 0.5 mA',
    pattern.every((bit, i) => bit || ledMa(headline, i) < 0.5),
  )
}

// ---- the app's real frame loop: one runFor(16_000) per frame, edges replayed ----
/**
 * Drive a sketch exactly the way `use-runner` does: one `runFor(16_000)` per frame, then
 * rebuild the harness (wiring can change), replay every recorded pin edge in order, settle
 * once and solve. Returns the solved state of each frame.
 */
function runFrames(
  runtime: ReturnType<typeof createAvrRuntime>,
  d: Diagram,
  frames: number,
  state: Map<string, Record<string, unknown>>,
): ReturnType<typeof simulate>[] {
  const out: ReturnType<typeof simulate>[] = []
  for (let f = 0; f < frames; f++) {
    runtime.runFor(16_000)
    const harness = createDeviceHarness(d, defs, state)
    for (const { key, value } of runtime.drainTransitions()) {
      if (harness.watched.has(key)) harness.applyTransition(key, value)
    }
    out.push(simulate(d, defs, harness.settle(runtime.pinValues(), 16_000)))
  }
  return out
}

async function compileRuntime(value: number): Promise<ReturnType<typeof createAvrRuntime> | null> {
  const { hex, fitsTarget } = await compileSketchInline(sketchFor(value))
  ok(`0x${value.toString(16).toUpperCase().padStart(2, '0')}: single-frame sketch compiles and fits`, fitsTarget && hex.length > 1000)
  if (!fitsTarget || hex.length <= 1000) return null
  const runtime = createAvrRuntime(part(UNO, 'arduino-uno'), getPartDef('arduino-uno')!)
  runtime.load(hex)
  return runtime
}

{
  // The headline defect: 256k CPU cycles in one call, sampled once. Without replay the
  // bit-banged clock is invisible; with replay every edge is applied in order.
  const runtime = await compileRuntime(0xb5)
  if (!runtime) {
    ok('16ms frame: replay latches 0xB5', false)
  } else {
    const perFrame = runFrames(runtime, srCircuit, 60, new Map())
    const st = perFrame[perFrame.length - 1]
    const pattern = patternOf(st)
    const lit = pattern.flatMap((bit, i) => (bit ? [i] : []))
    console.log(
      `\n  16ms frame 0xB5: measured q7..q0 = ${[...pattern].reverse().join('')} ` +
        `(${pattern.map((_, i) => ledMa(st, 7 - i).toFixed(1)).join(', ')} mA)\n`,
    )
    ok('16ms frame: circuit converged', st.converged)
    ok('16ms frame: replay latches exactly 0xB5', JSON.stringify(pattern) === JSON.stringify(expectedBits(0xb5)))
    ok('16ms frame: five LEDs lit, three dark', lit.length === 5)
    ok(
      '16ms frame: every lit LED carries 10-16 mA',
      lit.every((i) => ledMa(st, i) >= 10 && ledMa(st, i) <= 16),
    )
  }
}

// ---- a second value in later frames: replay keeps working across frames ----
{
  const alternating = `
void setup() {
  pinMode(11, OUTPUT);
  pinMode(12, OUTPUT);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(12, LOW);
  shiftOut(11, 13, MSBFIRST, 0xB5);
  digitalWrite(12, HIGH);
  delay(1000);
  digitalWrite(12, LOW);
  shiftOut(11, 13, MSBFIRST, 0x3C);
  digitalWrite(12, HIGH);
  delay(1000);
}
`
  const { hex, fitsTarget } = await compileSketchInline(alternating)
  ok('two values: alternating sketch compiles and fits', fitsTarget && hex.length > 1000)
  const runtime = createAvrRuntime(part(UNO, 'arduino-uno'), getPartDef('arduino-uno')!)
  runtime.load(hex)

  const patterns = runFrames(runtime, srCircuit, 140, new Map()).map(patternOf)
  const key = (p: number[]) => p.join('')
  const firstB5 = patterns.findIndex((p) => key(p) === key(expectedBits(0xb5)))
  const first3c = patterns.findIndex((p) => key(p) === key(expectedBits(0x3c)))
  ok('two values: 0xB5 latched in an early frame', firstB5 >= 0)
  ok('two values: 0x3C latched in a later frame', first3c > firstB5)
}

for (const value of [0x00, 0xff]) {
  const st = await measureShiftOut(value)
  if (!st) {
    ok(`0x${value.toString(16)}: solves`, false)
    continue
  }
  const pattern = patternOf(st)
  console.log(`  0x${value.toString(16).toUpperCase().padStart(2, '0')}: q7..q0 = ${[...pattern].reverse().join('')}`)
  ok(`0x${value.toString(16).toUpperCase().padStart(2, '0')}: bit pattern matches`, JSON.stringify(pattern) === JSON.stringify(expectedBits(value)))
}

// ---- clock edge detection, latency, OE and MR, driven directly ----
const srPins = (levels: Record<string, PinValue>): Map<string, PinValue> =>
  new Map(Object.entries(levels).map(([id, v]) => [`${SR}:${id}`, v]))
const stepSR = (bag: Map<string, Record<string, unknown>>, levels: Record<string, PinValue>) =>
  stepDevices(srCircuit, defs, srPins(levels), bag, 0)
const qOf = (m: Map<string, PinValue>, i: number) => m.get(`${SR}:q${i}`)
const qPattern = (m: Map<string, PinValue>) => Array.from({ length: 8 }, (_, i) => (qOf(m, i) === 1 ? 1 : 0))

/** Clock 8 bits LSB-first, leaving SHCP low. */
function shiftByte(bag: Map<string, Record<string, unknown>>, byte: number) {
  let last = new Map<string, PinValue>()
  for (let i = 0; i < 8; i++) {
    const ds = ((byte >> i) & 1) as 0 | 1
    stepSR(bag, { ds, shcp: 0, stcp: 0 })
    last = stepSR(bag, { ds, shcp: 1, stcp: 0 })
    stepSR(bag, { ds, shcp: 0, stcp: 0 })
  }
  return last
}
const pulseLatch = (bag: Map<string, Record<string, unknown>>) => {
  stepSR(bag, { shcp: 0, stcp: 0 })
  return stepSR(bag, { shcp: 0, stcp: 1 })
}

{
  // A clock held high must not shift again: one 1 in, then hold SHCP high for several steps.
  const bag = new Map<string, Record<string, unknown>>()
  stepSR(bag, { ds: 1, shcp: 0, stcp: 0 })
  stepSR(bag, { ds: 1, shcp: 1, stcp: 0 }) // the one rising edge
  stepSR(bag, { ds: 0, shcp: 1, stcp: 0 }) // held high...
  stepSR(bag, { ds: 0, shcp: 1, stcp: 0 }) // ...and again
  stepSR(bag, { ds: 0, shcp: 0, stcp: 0 })
  const latched = pulseLatch(bag)
  ok('clock held high does not shift again (a single 1 stays in Q0)', JSON.stringify(qPattern(latched)) === JSON.stringify(expectedBits(0x01)))

  // Latency: a new value shifted in but not latched leaves the outputs alone.
  shiftByte(bag, 0x00)
  const stillOld = stepSR(bag, { shcp: 0, stcp: 0 })
  ok('shifting without an STCP pulse leaves the latch unchanged', JSON.stringify(qPattern(stillOld)) === JSON.stringify(expectedBits(0x01)))

  shiftByte(bag, 0xff)
  const stillOld2 = stepSR(bag, { shcp: 0, stcp: 0 })
  ok('still unchanged after a second shift', JSON.stringify(qPattern(stillOld2)) === JSON.stringify(expectedBits(0x01)))

  const remeasured = pulseLatch(bag)
  ok('after the STCP pulse the new latch (0xFF) appears', JSON.stringify(qPattern(remeasured)) === JSON.stringify(expectedBits(0xff)))

  // OE high: outputs tri-state, so every LED must go dark in the solve.
  const disabled = stepSR(bag, { shcp: 0, stcp: 0, oe: 1 })
  ok('OE high tri-states every output', Array.from({ length: 8 }, (_, i) => qOf(disabled, i)).every((v) => v === 'z'))
  const outputOnly = new Map<string, PinValue>(
    [...disabled].filter(([k]) => k.startsWith(`${SR}:q`)),
  )
  const dark = simulate(srCircuit, defs, outputOnly)
  ok('OE high leaves every LED dark', dark.converged && LEDS.every((_, i) => ledMa(dark, i) < 0.5))

  // MR low: both registers cleared.
  const cleared = stepSR(bag, { shcp: 0, stcp: 0, mr: 0 })
  ok('MR low clears every output', JSON.stringify(qPattern(cleared)) === JSON.stringify(expectedBits(0x00)))
}

// ---- rails drive nets: a control pin tied to a supply is a hard 0/1, not 'z' ----
{
  // A probe that reports the level it reads, so a rail's drive can be asserted directly.
  const seen: PinValue[] = []
  const probe: PartDef = {
    id: 'level-probe',
    name: 'Level Probe',
    category: 'digital',
    width: 1,
    height: 1,
    pins: [{ id: 'in', label: 'IN', x: 0, y: 0, kind: 'io' }],
    device: {
      outputs: [],
      step(input) {
        seen.push(input.level('in'))
        return {}
      },
    },
    render: () => null,
  }
  const probeDefs = new Map(defs)
  probeDefs.set('level-probe', probe)

  const probeCircuit = (railDef: string, pin: string) =>
    diagram(
      [part('p', 'level-probe'), part('rail', railDef)],
      [wire('w', { part: 'p', pin: 'in' }, { part: 'rail', pin })],
    )

  seen.length = 0
  createDeviceHarness(probeCircuit('rail-gnd', 'GND'), probeDefs).settle(new Map())
  ok('a pin wired to the GND rail reads 0, not z', seen[seen.length - 1] === 0)

  seen.length = 0
  createDeviceHarness(probeCircuit('rail-5v', '5V'), probeDefs).settle(new Map())
  ok('a pin wired to the 5V rail reads 1, not z', seen[seen.length - 1] === 1)

  // 595 with OE tied to a rail, MR tied to a rail, driven by (unwired) control pins.
  const RAILS: Record<0 | 1, [string, string]> = { 0: ['rail-gnd', 'GND'], 1: ['rail-5v', '5V'] }
  const srRails = (oe: 0 | 1, mr: 0 | 1) => {
    const [oeDef, oePin] = RAILS[oe]
    const [mrDef, mrPin] = RAILS[mr]
    return diagram(
      [part(SR, 'shift-register-74hc595'), part('oeRail', oeDef), part('mrRail', mrDef)],
      [
        wire('wo', { part: SR, pin: 'oe' }, { part: 'oeRail', pin: oePin }),
        wire('wm', { part: SR, pin: 'mr' }, { part: 'mrRail', pin: mrPin }),
      ],
    )
  }

  /** Shift a byte LSB-first via replayed edges, then one latch pulse; return the harness. */
  const replayByte = (h: ReturnType<typeof createDeviceHarness>, byte: number) => {
    for (let i = 0; i < 8; i++) {
      h.applyTransition(`${SR}:ds`, ((byte >> i) & 1) as 0 | 1)
      h.applyTransition(`${SR}:shcp`, 1)
      h.applyTransition(`${SR}:shcp`, 0)
    }
    h.applyTransition(`${SR}:stcp`, 1)
  }

  const oeLow = createDeviceHarness(srRails(0, 1), defs)
  replayByte(oeLow, 0xff)
  const enabled = oeLow.settle(new Map())
  ok(
    'OE tied to the GND rail is asserted-enable (every Q driven high, none z)',
    qPattern(enabled).every((b) => b === 1) && qOf(enabled, 0) !== 'z',
  )

  const oeHigh = createDeviceHarness(srRails(1, 1), defs)
  replayByte(oeHigh, 0xff)
  const triStated = oeHigh.settle(new Map())
  ok('OE tied to the 5V rail tri-states every output', Array.from({ length: 8 }, (_, i) => qOf(triStated, i)).every((v) => v === 'z'))

  const mrLow = createDeviceHarness(srRails(0, 0), defs)
  replayByte(mrLow, 0xff)
  const held = mrLow.settle(new Map())
  ok('MR tied to the GND rail clears the register', JSON.stringify(qPattern(held)) === JSON.stringify(expectedBits(0x00)))
}

// ---- 7-segment: driven segments light, unwired ones do not ----
{
  const segDiagram = diagram([part('seg', 'seven-segment')])
  const bag = new Map<string, Record<string, unknown>>()
  stepDevices(
    segDiagram,
    defs,
    new Map<string, PinValue>([['seg:a', 1], ['seg:b', 1], ['seg:c', 1], ['seg:d', 1]]),
    bag,
    0,
  )
  const visual = getPartDef('seven-segment')!.device!.visual!(bag.get('seg')!)
  ok('7-seg lights exactly a, b, c, d', JSON.stringify(visual.lit) === JSON.stringify(['a', 'b', 'c', 'd']))
  ok('an unwired segment (e) is not lit', !(visual.lit ?? []).includes('e'))
}

// ---- robustness ----
{
  const weird = diagram([part('ghost', 'does-not-exist'), part(SR, 'shift-register-74hc595'), part('seg', 'seven-segment')])
  let threw = false
  try {
    stepDevices(weird, defs, new Map(), new Map(), 0)
  } catch {
    threw = true
  }
  ok('unknown parts and unwired device pins do not throw', !threw)

  const noDevices = diagram([part(UNO, 'arduino-uno')])
  const pins = new Map<string, PinValue>([['uno:d13', 1], ['uno:d11', 0]])
  const same = stepDevices(noDevices, defs, pins, new Map(), 16_000)
  ok(
    'no devices: the MCU pins come back unchanged',
    same.size === pins.size && [...pins].every(([k, v]) => same.get(k) === v),
  )
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
