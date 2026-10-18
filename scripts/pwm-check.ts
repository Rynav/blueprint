/**
 * PWM / `analogWrite` checks. Run with `bun scripts/pwm-check.ts`.
 *
 * Drives the loop the way the app does: one `runFor(16_000)` per frame, `pinDuty()` for the
 * frame's high fraction, replay the recorded transitions through a device harness, then
 * `simulate` with the duty map. Asserts the full chain from AVR timer PWM to LED brightness.
 * Style mirrors scripts/avr-check.ts: assert-based, non-zero exit on failure.
 */
import { createAvrRuntime, type AvrRuntime } from '@/lib/avr/runtime'
import { simulate, type CircuitState } from '@/lib/circuit'
import { compileSketchInline } from '@/lib/compile'
import { createDeviceHarness } from '@/lib/devices'
import { allPartDefs, getPartDef } from '@/lib/parts'
import type { Diagram, Endpoint, PartDef, PartInstance, Wire } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const FRAME = 16_000
const BOARD = 'uno'
const PIN = `${BOARD}:d9`
const defs = new Map(allPartDefs().map((d) => [d.id, d]))
const uno: PartInstance = { id: BOARD, def: 'arduino-uno', at: { x: 0, y: 0 }, rotation: 0 }
const unoDef = getPartDef('arduino-uno')!

const part = (id: string, def: string): PartInstance => ({ id, def, at: { x: 0, y: 0 }, rotation: 0 })
const wire = (id: string, from: Endpoint, to: Endpoint): Wire => ({ id, from, to })
const diagram = (parts: PartInstance[], wires: Wire[] = []): Diagram => ({ version: 1, parts, wires, notes: [] })

// d9 -> 220R -> LED -> GND, the headline circuit: the LED's brightness must follow the duty.
const ledDiagram = diagram(
  [part('uno', 'arduino-uno'), { ...part('r1', 'resistor'), params: { ohms: 220 } }, part('d1', 'led'), part('gnd', 'rail-gnd')],
  [
    wire('w1', { part: 'uno', pin: 'd9' }, { part: 'r1', pin: '1' }),
    wire('w2', { part: 'r1', pin: '2' }, { part: 'd1', pin: 'a' }),
    wire('w3', { part: 'd1', pin: 'k' }, { part: 'gnd', pin: 'GND' }),
  ],
)

const analogSketch = (n: number) => `#include <Arduino.h>
void setup() { pinMode(9, OUTPUT); }
void loop() { analogWrite(9, ${n}); delay(500); }
`
const steadySketch = (high: boolean) => `#include <Arduino.h>
void setup() { pinMode(9, OUTPUT); digitalWrite(9, ${high ? 'HIGH' : 'LOW'}); }
void loop() {}
`
const BLINK = `#include <Arduino.h>
void setup() { pinMode(9, OUTPUT); }
void loop() { digitalWrite(9, HIGH); delay(500); digitalWrite(9, LOW); delay(500); }
`

interface Frame {
  /** pinDuty() before the drain, the open window. */
  before: Map<string, number>
  /** pinDuty() after the drain, the closed window. */
  after: Map<string, number>
  transitions: ReturnType<AvrRuntime['drainTransitions']>
  circuit: CircuitState
  pins: Map<string, 0 | 1 | 'z'>
}

/** Exactly the app's frame ordering, with `duty` threaded into harness and solve. */
function runFrames(
  rt: AvrRuntime,
  d: Diagram,
  state: Map<string, Record<string, unknown>>,
  frames: number,
): Frame[] {
  const out: Frame[] = []
  for (let f = 0; f < frames; f++) {
    rt.runFor(FRAME)
    const before = rt.pinDuty()
    const transitions = rt.drainTransitions()
    const after = rt.pinDuty()
    const harness = createDeviceHarness(d, defs, state, after)
    const pins = rt.pinValues()
    harness.seed(pins)
    for (const t of transitions) if (harness.watched.has(t.key)) harness.applyTransition(t.key, t.value)
    const merged = harness.settle(pins, FRAME)
    out.push({ before, after, transitions, circuit: simulate(d, defs, merged, { duty: after }), pins: merged })
  }
  return out
}

async function runtimeFor(source: string): Promise<AvrRuntime> {
  const { hex, fitsTarget } = await compileSketchInline(source)
  if (!fitsTarget) throw new Error('sketch does not fit')
  const rt = createAvrRuntime(uno, unoDef)
  rt.load(hex)
  return rt
}

const sameMap = (a: Map<string, number>, b: Map<string, number>) =>
  a.size === b.size && [...a].every(([k, v]) => b.get(k) === v)

// ---------------------------------------------------------- headline: analogWrite fades
console.log('\nanalogWrite duty sweep (d9 -> 220R -> LED):')
const sweep: Array<{ n: number; duty: number; brightness: number }> = []
for (const n of [0, 64, 128, 191, 255]) {
  const rt = await runtimeFor(analogSketch(n))
  const frames = runFrames(rt, ledDiagram, new Map(), 20)
  const last = frames[frames.length - 1]
  const duty = last.after.get(PIN) ?? -1
  const brightness = last.circuit.brightness.d1 ?? 0
  sweep.push({ n, duty, brightness })
  console.log(
    `  N=${String(n).padStart(3)}: duty ${duty.toFixed(4)} (want ${(n / 255).toFixed(4)}), ` +
      `LED brightness ${brightness.toFixed(4)}`,
  )
}

for (const r of sweep) {
  ok(`duty for analogWrite(9, ${r.n}) is within 3% of ${r.n}/255`, Math.abs(r.duty - r.n / 255) <= 0.03)
}
ok('every duty is finite and in 0..1', sweep.every((r) => Number.isFinite(r.duty) && r.duty >= 0 && r.duty <= 1))
ok('duty 1 at N=255, duty 0 at N=0', Math.abs(sweep[4].duty - 1) < 0.02 && sweep[0].duty < 0.02)
ok(
  'brightness rises monotonically with the duty',
  sweep.every((r, i) => i === 0 || r.brightness > sweep[i - 1].brightness),
)
const half = sweep[2].brightness / sweep[4].brightness
console.log(`\n  brightness(N=128) / brightness(N=255) = ${half.toFixed(3)}`)
// The LED I-V is exponential: at half the pin voltage the current is ~27% of full, not 50%.
// The DC average is right (duty(128)/duty(255) ~= 0.5); the LED's own curve is what pulls
// brightness below a linear half. Asserted against the model, printed so the number is visible.
ok('brightness(128) is 0.20-0.40 of brightness(255) (LED exponential I-V, not linear)', half > 0.2 && half < 0.4)
ok('...while the duty itself is ~half', Math.abs(sweep[2].duty / sweep[4].duty - 0.5) < 0.05)

// ------------------------------------------------- steady pin: duty 1 or 0, exactly as before
{
  const hi = await runtimeFor(steadySketch(true))
  const frames = runFrames(hi, ledDiagram, new Map(), 5)
  const f = frames[frames.length - 1]
  ok('digitalWrite HIGH reads duty 1', f.after.get(PIN) === 1)
  const hard = simulate(ledDiagram, defs, f.pins)
  ok(
    'HIGH brightness equals the old hard-driven solve byte for byte',
    JSON.stringify(f.circuit) === JSON.stringify(hard),
  )
  ok('HIGH lights the LED (~0.63)', (f.circuit.brightness.d1 ?? 0) > 0.5)

  const lo = await runtimeFor(steadySketch(false))
  const lf = runFrames(lo, ledDiagram, new Map(), 5).slice(-1)[0]
  ok('digitalWrite LOW reads duty 0', lf.after.get(PIN) === 0)
  ok('LOW leaves the LED dark', (lf.circuit.brightness.d1 ?? 0) < 0.001)
  ok('LOW is finite with no NaN', Object.values(lf.circuit.volts).every(Number.isFinite))
  // A pin the sketch never configures stays 'z': it drives nothing, so duty 0.
  ok("an untouched pin (d8) stays 'z' and reads duty 0", lf.pins.get(`${BOARD}:d8`) === 'z' && lf.after.get(`${BOARD}:d8`) === 0)
}

// ------------------------------------------ the duty window matches the replayed transitions
{
  const rt = await runtimeFor(analogSketch(128))
  const frames = runFrames(rt, ledDiagram, new Map(), 12)
  let agree = true
  let boxes = true
  for (const f of frames) {
    if (!sameMap(f.before, f.after)) agree = false
    for (const v of f.after.values()) if (!(v >= 0 && v <= 1)) boxes = false
  }
  ok('pinDuty() before and after drainTransitions() agree every frame', agree)
  ok('duty covers all 20 board pins and is a fraction', frames[0].after.size === 20 && boxes)
  // The last frame's transitions are all high/low edges on the PWM pin.
  const lastT = frames[frames.length - 1].transitions
  ok('the PWM pin is toggling every frame', lastT.length > 0 && lastT.every((t) => t.key === PIN && (t.value === 0 || t.value === 1)))
  ok('each transition carries its CPU cycle', lastT.every((t) => Number.isInteger(t.cycles) && t.cycles >= 0))
}

// -------------------------------------------------- millis()/timing unaffected (Blink 500 ms)
{
  const rt = await runtimeFor(BLINK)
  const frames = runFrames(rt, ledDiagram, new Map(), 200)
  const edges: number[] = []
  for (const f of frames) for (const t of f.transitions) if (t.key === PIN) edges.push((t.cycles / 16_000_000) * 1e6)
  // Drop the ~0 ms glitch where pinMode drives LOW then digitalWrite HIGH within one instant.
  const halves = edges
    .slice(1)
    .map((e, i) => e - edges[i])
    .filter((h) => h > 100_000)
  const meanDuty = frames.reduce((a, f) => a + (f.after.get(PIN) ?? 0), 0) / frames.length
  console.log(
    `\n  Blink: ${edges.length} edges, half-periods ${halves.map((h) => (h / 1000).toFixed(1)).join(', ')} ms, ` +
      `mean frame duty ${meanDuty.toFixed(3)}`,
  )
  ok('Blink keeps 500 ms half-periods (+-2%)', halves.length >= 4 && halves.every((h) => Math.abs(h - 500_000) <= 0.02 * 500_000))
  ok('mean frame duty over a Blink cycle is ~0.5', Math.abs(meanDuty - 0.5) < 0.06)
}

// --------------------------------------------- no duty entry => byte-for-byte current behaviour
{
  const hi = await runtimeFor(steadySketch(true))
  const pins = runFrames(hi, ledDiagram, new Map(), 3).slice(-1)[0].pins
  const bare = simulate(ledDiagram, defs, pins)
  ok('absent duty equals an empty duty map', JSON.stringify(bare) === JSON.stringify(simulate(ledDiagram, defs, pins, { duty: new Map() })))
  ok('an explicit duty of 1 equals the hard solve', JSON.stringify(bare) === JSON.stringify(simulate(ledDiagram, defs, pins, { duty: new Map([[PIN, 1]]) })))
  const lo = await runtimeFor(steadySketch(false))
  const loPins = runFrames(lo, ledDiagram, new Map(), 3).slice(-1)[0].pins
  const dark = simulate(ledDiagram, defs, loPins)
  ok('an explicit duty of 0 equals the hard solve', JSON.stringify(dark) === JSON.stringify(simulate(ledDiagram, defs, loPins, { duty: new Map([[PIN, 0]]) })))
}

// ------------------------------------------------------------------------------- robustness
{
  const rt = await runtimeFor(analogSketch(128))
  const pins = runFrames(rt, ledDiagram, new Map(), 3).slice(-1)[0].pins
  const base = simulate(ledDiagram, defs, pins)
  const ghost = simulate(ledDiagram, defs, pins, {
    duty: new Map([
      ['ghost:zz', 0.5],
      [`${BOARD}:not-a-pin`, 0.9],
    ]),
  })
  ok('unknown duty keys are ignored', JSON.stringify(base) === JSON.stringify(ghost))
  const allFinite = (c: CircuitState) =>
    Object.values(c.volts).every(Number.isFinite) &&
    Object.values(c.brightness).every(Number.isFinite) &&
    Object.values(c.current).every(Number.isFinite)
  ok('no NaN anywhere in the solve', allFinite(base) && base.converged)
}

// ------------------------------------------- devices sense the duty (createDeviceHarness)
{
  const probe: PartDef = {
    id: 'duty-probe',
    name: 'Duty Probe',
    category: 'test',
    width: 10,
    height: 10,
    pins: [
      { id: 'in', x: 0, y: 0, kind: 'io' },
      { id: 'out', x: 10, y: 0, kind: 'io' },
    ],
    device: {
      outputs: ['out'],
      step: (input, state) => {
        const d = input.duty('in')
        state.duty = d
        return { out: d > 0.25 ? 1 : 0 }
      },
    },
    render: () => null,
  }
  const probeDefs = new Map(defs)
  probeDefs.set(probe.id, probe)
  const probeDiagram = diagram(
    [part('uno', 'arduino-uno'), part('probe', 'duty-probe'), { ...part('r1', 'resistor'), params: { ohms: 220 } }, part('d1', 'led'), part('gnd', 'rail-gnd')],
    [
      wire('w1', { part: 'uno', pin: 'd9' }, { part: 'probe', pin: 'in' }),
      wire('w2', { part: 'probe', pin: 'out' }, { part: 'r1', pin: '1' }),
      wire('w3', { part: 'r1', pin: '2' }, { part: 'd1', pin: 'a' }),
      wire('w4', { part: 'd1', pin: 'k' }, { part: 'gnd', pin: 'GND' }),
    ],
  )
  const measure = async (n: number) => {
    const rt = await runtimeFor(analogSketch(n))
    const state = new Map<string, Record<string, unknown>>()
    let circuit!: CircuitState
    for (let f = 0; f < 20; f++) {
      rt.runFor(FRAME)
      const before = rt.pinDuty()
      const transitions = rt.drainTransitions()
      const duty = rt.pinDuty()
      void before
      const harness = createDeviceHarness(probeDiagram, probeDefs, state, duty)
      const pins = rt.pinValues()
      harness.seed(pins)
      for (const t of transitions) if (harness.watched.has(t.key)) harness.applyTransition(t.key, t.value)
      circuit = simulate(probeDiagram, probeDefs, harness.settle(pins, FRAME), { duty })
    }
    return { duty: state.get('probe')?.duty as number, brightness: circuit.brightness.d1 ?? 0 }
  }
  const mid = await measure(128)
  const none = await measure(0)
  console.log(`\n  duty-probe: sees duty ${mid.duty.toFixed(4)}, drives the LED to ${mid.brightness.toFixed(4)}`)
  ok('a device sees the PWM duty on its input net', Math.abs(mid.duty - 128 / 255) <= 0.03)
  ok('...and can act on it (LED lit at N=128, dark at N=0)', mid.brightness > 0.1 && none.brightness < 0.001)
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
