/**
 * Hobby servo checks. Run with `bun scripts/servo-check.ts`.
 *
 * Drives the loop the way the app does: one `runFor(16_000)` per frame, `pinDuty()` for the
 * frame's high fraction, replay the recorded transitions through a device harness, then
 * `simulate`. A bit-banged 50 Hz pulse train on D9 becomes a horn angle. Style mirrors
 * scripts/pwm-check.ts: assert-based, non-zero exit on failure.
 */
import { createAvrRuntime, type AvrRuntime } from '@/lib/avr/runtime'
import { simulate, type CircuitState } from '@/lib/circuit'
import { compileSketchInline } from '@/lib/compile'
import { createDeviceHarness } from '@/lib/devices'
import { servo } from '@/lib/devices/servo'
import { allPartDefs, getPartDef } from '@/lib/parts'
import type { DeviceInput, Diagram, Endpoint, PartInstance, Wire } from '@/lib/types'

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

// uno D9 -> servo signal, servo powered from the rails (only the signal is read).
const servoDiagram = diagram(
  [part('uno', 'arduino-uno'), part('s1', 'servo'), part('vcc', 'rail-5v'), part('gnd', 'rail-gnd')],
  [
    wire('w1', { part: 'uno', pin: 'd9' }, { part: 's1', pin: 'signal' }),
    wire('w2', { part: 's1', pin: 'vcc' }, { part: 'vcc', pin: '5V' }),
    wire('w3', { part: 's1', pin: 'gnd' }, { part: 'gnd', pin: 'GND' }),
  ],
)

interface Frame {
  duty: Map<string, number>
  angle: number
  pulseMicros: number
  circuit: CircuitState
}

/** Exactly the app's frame ordering, servo state threaded frame to frame. */
function runFrames(rt: AvrRuntime, state: Map<string, Record<string, unknown>>, frames: number): Frame[] {
  const out: Frame[] = []
  for (let f = 0; f < frames; f++) {
    rt.runFor(FRAME)
    const transitions = rt.drainTransitions()
    const duty = rt.pinDuty()
    const harness = createDeviceHarness(servoDiagram, defs, state, duty)
    const pins = rt.pinValues()
    harness.seed(pins)
    for (const t of transitions) if (harness.watched.has(t.key)) harness.applyTransition(t.key, t.value)
    const merged = harness.settle(pins, FRAME)
    const circuit = simulate(servoDiagram, defs, merged, { duty })
    const bag = state.get('s1') ?? {}
    out.push({ duty, angle: Number(bag.angle), pulseMicros: Number(bag.pulseMicros), circuit })
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

// A 50 Hz pulse: HIGH for `us`, then low for the rest of the 20 ms period. delayMicroseconds
// cannot take 18 500, so the low half is delay(18) + delayMicroseconds(500).
const pulseFn = `void pulse(unsigned int us) {
  digitalWrite(9, HIGH);
  delayMicroseconds(us);
  digitalWrite(9, LOW);
  delay(18);
  delayMicroseconds(500);
}`
const header = `#include <Arduino.h>
void setup() { pinMode(9, OUTPUT); }
${pulseFn}`

// ------------------------------------------------------------ registry + part def
{
  const def = getPartDef('servo')
  ok('the servo part is registered', def !== undefined)
  ok('the servo is in the motors category', def?.category === 'motors')
  ok('the servo model is wired to the part', def?.device === servo)
  ok('the servo has vcc/gnd/signal pins', JSON.stringify(def?.pins.map((p) => p.id)) === JSON.stringify(['vcc', 'gnd', 'signal']))
}

// ------------------------------------------------- a real sketch sweeps 0 / 90 / 180
console.log('\nbit-banged pulse sweep (D9 -> servo signal, 1 ms / 1.5 ms / 2 ms, ~480 ms each):')
{
  const rt = await runtimeFor(`${header}
void loop() {
  for (int i = 0; i < 24; i++) pulse(1000);
  for (int i = 0; i < 24; i++) pulse(1500);
  for (int i = 0; i < 24; i++) pulse(2000);
}`)
  const frames = runFrames(rt, new Map(), 200)
  const shown = frames.filter((f) => Number.isFinite(f.pulseMicros) && f.pulseMicros > 0)
  // One line per distinct measured pulse width, so the mapping is visible.
  const seen = new Map<number, number>()
  for (const f of shown) seen.set(Math.round(f.pulseMicros), f.angle)
  for (const [us, angle] of [...seen].sort((a, b) => a[0] - b[0])) {
    console.log(`  pulse ${String(us).padStart(4)} us -> horn ${angle.toFixed(1).padStart(5)} deg`)
  }
  const angles = frames.map((f) => f.angle)
  ok('sweep reaches ~0 deg (1 ms)', angles.some((a) => Math.abs(a - 0) <= 10))
  ok('sweep reaches ~90 deg (1.5 ms)', angles.some((a) => Math.abs(a - 90) <= 10))
  ok('sweep reaches ~180 deg (2 ms)', angles.some((a) => Math.abs(a - 180) <= 10))
  ok(
    'the widths seen are ~1000 / 1500 / 2000 us',
    [1000, 1500, 2000].every((want) => [...seen.keys()].some((us) => Math.abs(us - want) <= 60)),
  )
  ok('every swept angle is finite and in 0..180', angles.every((a) => Number.isFinite(a) && a >= 0 && a <= 180))
  ok('the servo drives nothing (outputs empty)', servo.outputs.length === 0)
  ok('the solved circuit stays finite', Object.values(frames[frames.length - 1].circuit.volts).every(Number.isFinite))
}

// ------------------------------------- missing pulses hold, not snap to zero
console.log('\nsteady 1.5 ms / 20 ms signal: frames with no pulse must hold ~90 deg:')
{
  const rt = await runtimeFor(`${header}
void loop() { pulse(1500); }`)
  const frames = runFrames(rt, new Map(), 200).slice(5)
  const blank = frames.filter((f) => (f.duty.get(PIN) ?? 0) === 0)
  const held = blank.map((f) => f.angle)
  const angles = frames.map((f) => f.angle)
  const lo = Math.min(...angles)
  const hi = Math.max(...angles)
  console.log(
    `  ${blank.length}/${frames.length} frames contained no pulse; horn stayed ${lo.toFixed(1)}..${hi.toFixed(1)} deg`,
  )
  // A requested 1.5 ms comes out ~1.516 ms on the wire (digitalWrite + delayMicroseconds
  // overhead), which is honestly ~3 deg above 90 - so "a few degrees" means +-5 here.
  ok('the hold path is actually exercised (some frames read duty 0)', blank.length > 10)
  ok('...and a no-pulse frame holds the previous angle, never snapping to 0', held.every((a) => a > 80 && a < 100))
  ok('the horn never leaves ~90 deg, and the reading is stable', lo >= 85 && hi <= 95 && hi - lo <= 4)
}

// ----------------------------------------------------------- no signal at all
{
  const rt = await runtimeFor(`#include <Arduino.h>
void setup() {}
void loop() { delay(1); }`)
  const state = new Map<string, Record<string, unknown>>()
  const frames = runFrames(rt, state, 30)
  const angles = frames.map((f) => f.angle)
  const vis = servo.visual!(state.get('s1') ?? {})
  ok('a pin that is never driven leaves the angle at its default 90', angles.every((a) => a === 90))
  ok('...nothing throws and the run produces no pulse', frames.every((f) => f.pulseMicros === 0 || !Number.isFinite(f.pulseMicros)))
  ok('...and visual() is still finite and in 0..180', Number.isFinite(vis.angle) && vis.angle! >= 0 && vis.angle! <= 180)
}

// ------------------------------------------------------- clamping + visual range
{
  const step = (dutyMicros: number, level: 0 | 1 | 'z', bag: Record<string, unknown> = {}) => {
    const input: DeviceInput = { level: () => level, duty: () => dutyMicros / FRAME, dtMicros: FRAME }
    servo.step(input, bag)
    return bag
  }
  const angleOf = (bag: Record<string, unknown>) => servo.visual!(bag).angle as number

  const short = step(200, 0)
  const long = step(3000, 0)
  const noise = step(50, 0)
  console.log(`\n  0.2 ms -> ${angleOf(short).toFixed(1)} deg, 3 ms -> ${angleOf(long).toFixed(1)} deg, 50 us -> ${angleOf(noise).toFixed(1)} deg`)
  ok('a 0.2 ms pulse clamps to 0 deg', angleOf(short) === 0)
  ok('a 3 ms pulse clamps to 180 deg', angleOf(long) === 180)
  ok('a sub-100 us glitch is treated as no signal (holds 90)', angleOf(noise) === 90)
  ok(
    'visual() is finite and in 0..180 for every case',
    [short, long, noise].every((b) => {
      const a = angleOf(b)
      return Number.isFinite(a) && a >= 0 && a <= 180
    }),
  )

  // A pulse split across a frame boundary: high at the frame end, so the 0.4 ms fragment
  // must be carried and summed with the next frame's 0.6 ms, not read as a 0.4 ms command.
  const prior = step(2000, 0)
  const beforeSplit = angleOf(prior)
  const carried = step(400, 1, { ...prior })
  const heldMid = angleOf(carried) // read before the next step mutates the same bag
  const afterSplit = step(600, 0, carried)
  ok('a split 1 ms pulse is summed whole -> 0 deg (not the 0.4 ms fragment)',
    beforeSplit === 180 && heldMid === 180 && angleOf(afterSplit) === 0)
  ok('...and the summed width is recorded', Math.abs(Number(afterSplit.pulseMicros) - 1000) <= 1)
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
