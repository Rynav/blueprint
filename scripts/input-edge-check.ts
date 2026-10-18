/**
 * Device-driven input edges inside a frame.
 *
 * The gap this closes: a device output (the HC-SR04 `echo`) used to reach the AVR once per
 * 16 ms frame, so a sketch that *polls* it (`pulseIn`) could never time it. With a sliced
 * `runFor`, each ~2 us slice hands control back, the device is stepped, and its output is
 * pushed straight onto the matching AVR pin with `setInputPin` - no circuit solve. This check
 * drives that wiring exactly as `use-runner.ts` must, and proves:
 *   - a real `pulseIn` sketch measures the distance,
 *   - the same loop *without* slicing cannot,
 *   - slicing does not disturb Blink timing or `pinDuty`,
 *   - the extra cost per frame,
 *   - and that nothing crashes or goes NaN on degenerate diagrams.
 */

import { createAvrRuntime, type AvrRuntime } from '@/lib/avr/runtime'
import { compileSketchInline } from '@/lib/compile'
import { createDeviceHarness, type PinValue } from '@/lib/devices'
import { hcSr04 as hcSr04Device } from '@/lib/devices/hc-sr04'
import { buildNets } from '@/lib/netlist'
import { allPartDefs } from '@/lib/parts'
import { hcSr04 as hcSr04Part } from '@/lib/parts/sensors'
import type { Diagram, PartDef } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const FRAME = 16_000
const defs = new Map(allPartDefs().map((d) => [d.id, d]))
// The part is not registered in parts/index.ts yet (that is a separate integration step),
// so add it here for this check.
defs.set(hcSr04Part.id, hcSr04Part)

// ---------------------------------------------------------------- diagrams
const uno = (id = 'uno'): Diagram['parts'][number] => ({
  id,
  def: 'arduino-uno',
  at: { x: 0, y: 0 },
  rotation: 0,
})

/** An Uno wired to an HC-SR04: TRIG -> D9, ECHO -> D10, plus the supply pins. */
function sonarDiagram(distanceCm: number, wired: boolean): Diagram {
  return {
    version: 1,
    parts: [
      uno(),
      { id: 'sonar', def: 'hc-sr04', at: { x: 420, y: 0 }, rotation: 0, params: { distanceCm } },
    ],
    wires: wired
      ? [
          { id: 'w1', from: { part: 'uno', pin: 'd9' }, to: { part: 'sonar', pin: 'trig' } },
          { id: 'w2', from: { part: 'uno', pin: 'd10' }, to: { part: 'sonar', pin: 'echo' } },
          { id: 'w3', from: { part: 'uno', pin: '5v' }, to: { part: 'sonar', pin: 'vcc' } },
          { id: 'w4', from: { part: 'uno', pin: 'gnd1' }, to: { part: 'sonar', pin: 'gnd' } },
        ]
      : [],
    notes: [],
  }
}

// ---------------------------------------------------------------- fast-path wiring
// From the frozen netlist: which AVR pins sit on a device-output's net, and which net a
// device output drives. This is what replaces the analog solve on the per-slice fast path.
interface FastPin {
  pinId: string
}

interface Scene {
  diagram: Diagram
  boardId: string
  runtime: AvrRuntime
  state: Map<string, Record<string, unknown>>
  /** net id -> AVR pins on that net. */
  fastByNet: Map<string, FastPin[]>
  /** `${partId}:${outputPinId}` -> net id the device drives. */
  outNet: Map<string, string>
}

async function open(diagram: Diagram, source: string): Promise<Scene> {
  const board = diagram.parts.find((p) => defs.get(p.def)?.mcu)
  if (!board) throw new Error('diagram has no board')
  const def = defs.get(board.def)!
  const runtime = createAvrRuntime(board, def)
  const { hex } = await compileSketchInline(source)
  runtime.load(hex)

  const nets = buildNets(diagram, defs)
  const fastByNet = new Map<string, FastPin[]>()
  for (const part of diagram.parts) {
    const pdef = defs.get(part.def)
    if (!pdef?.mcu) continue
    for (const pinId of Object.keys(pdef.mcu.pins)) {
      const net = nets.netOf(part.id, pinId)
      if (net === undefined) continue
      fastByNet.set(net, [...(fastByNet.get(net) ?? []), { pinId }])
    }
  }
  const outNet = new Map<string, string>()
  for (const part of diagram.parts) {
    const pdef = defs.get(part.def)
    if (!pdef?.device) continue
    for (const pinId of pdef.device.outputs) {
      const net = nets.netOf(part.id, pinId)
      if (net !== undefined) outNet.set(`${part.id}:${pinId}`, net)
    }
  }

  const state = new Map<string, Record<string, unknown>>()
  for (const part of diagram.parts) {
    const params = part.params
    if (params) state.set(part.id, { ...params }) // devices see the bag, not the params
  }
  return { diagram, boardId: board.id, runtime, state, fastByNet, outNet }
}

/**
 * Push every device-driven output onto the AVR pins that share its net.
 *
 * shortcut: the level goes straight from the device output to the MCU pin, so anything on the
 * net between them (a series resistor, a divider, a diode drop) is ignored. Correct for a
 * directly wired digital line like ECHO; fall back to the per-frame circuit solve for a net
 * that conditions the signal.
 */
function pushFast(scene: Scene, merged: Map<string, PinValue>): void {
  for (const [key, value] of merged) {
    if (value !== 0 && value !== 1) continue
    const net = scene.outNet.get(key)
    if (net === undefined) continue
    for (const fp of scene.fastByNet.get(net) ?? []) scene.runtime.setInputPin(fp.pinId, value)
  }
}

interface FrameResult {
  duty: Map<string, number>
  transitions: { key: string; value: PinValue; cycles: number }[]
}

/**
 * The app's frame, with slicing wired in explicitly (use-runner is not edited here).
 *
 * Sliced: create the harness, run in ~2 us slices, and in each slice step every device and
 * push its outputs straight onto the AVR - that is the whole fast path. Frame-end still
 * replays the frame's edges so a *narrow* bit-banged pulse (a shift register clock) is seen.
 * Unsliced: the same, minus the per-slice callback - the old whole-frame behaviour.
 */
function frame(scene: Scene, sliced: boolean): FrameResult {
  const startPins = scene.runtime.pinValues()
  const harness = createDeviceHarness(scene.diagram, defs, scene.state)
  harness.seed(startPins)

  let lastMicros = scene.runtime.elapsedMicros()
  scene.runtime.runFor(
    FRAME,
    sliced
      ? () => {
          const now = scene.runtime.elapsedMicros()
          const dt = now - lastMicros
          lastMicros = now
          // Only the timed devices are advanced per slice; the rest are stepped once at the
          // frame end, because a frame-level model (the servo) would break on a per-slice dt.
          const merged = harness.tickTimed(scene.runtime.pinValues(), dt)
          pushFast(scene, merged)
        }
      : undefined,
  )

  const duty = scene.runtime.pinDuty()
  const transitions = scene.runtime.drainTransitions()
  // Re-seed so the frame's edges replay from the start-of-frame levels (a device latching two
  // pins on one edge must not see the end-of-frame levels during an earlier edge).
  harness.seed(startPins)
  for (const t of transitions) if (harness.watched.has(t.key)) harness.applyTransition(t.key, t.value, 0)
  if (!sliced) {
    // No slices: the only chance to deliver a device output is here, after the CPU has run.
    const pins = harness.settle(scene.runtime.pinValues(), FRAME)
    pushFast(scene, pins)
  }
  return { duty, transitions }
}

const numbersIn = (text: string): number[] => (text.match(/\d+/g) ?? []).map(Number)

// ---------------------------------------------------------------- the sketch
const PULSE_IN_SKETCH = `#include <Arduino.h>
void setup() {
  pinMode(9, OUTPUT);
  pinMode(10, INPUT);
  Serial.begin(9600);
}
void loop() {
  digitalWrite(9, LOW);
  delayMicroseconds(2);
  digitalWrite(9, HIGH);
  delayMicroseconds(10);
  digitalWrite(9, LOW);
  unsigned long us = pulseIn(10, HIGH);
  Serial.println(us);
  delay(50);
}
`

async function measurePulse(distanceCm: number, sliced: boolean, frames: number): Promise<number | null> {
  const scene = await open(sonarDiagram(distanceCm, true), PULSE_IN_SKETCH)
  for (let f = 0; f < frames; f++) frame(scene, sliced)
  const nums = numbersIn(scene.runtime.serial())
  return nums.length ? nums[0] : null
}

// ================================================================ headline
console.log('\n== a real pulseIn sketch measures a device pulse ==')
{
  const distances = [10, 30, 100]
  for (const cm of distances) {
    const us = await measurePulse(cm, true, 30)
    const expected = cm * 58
    const err = us === null ? Infinity : Math.abs(us - expected) / expected
    console.log(
      `  ${String(cm).padStart(3)} cm -> expected ${String(expected).padStart(5)} us, ` +
        `measured ${us === null ? 'no output' : String(us).padStart(5)} us` +
        `${us === null ? '' : `  (${(err * 100).toFixed(1)}% off)`}`,
    )
    ok(`pulseIn at ${cm} cm is within 10% of ${expected} us`, us !== null && err <= 0.1)
  }
}

// ================================================================ without slicing
console.log('\n== the same test WITHOUT slicing (must fail) ==')
{
  const cm = 30
  // pulseIn times out after 1 s of simulated time (~63 frames); run past that.
  const us = await measurePulse(cm, false, 90)
  const expected = cm * 58
  console.log(
    `  ${cm} cm -> expected ${expected} us, measured ` +
      `${us === null ? 'no output (still busy-waiting)' : `${us} us`} without slicing`,
  )
  ok(
    'without slicing the measurement is badly wrong',
    us === null || us === 0 || Math.abs(us - expected) / expected > 0.5,
  )
}

// ================================================================ no regression
console.log('\n== slicing does not disturb Blink or pinDuty ==')
const BLINK_SKETCH = `#include <Arduino.h>
void setup() { pinMode(13, OUTPUT); }
void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`
{
  const scene = await open({ version: 1, parts: [uno()], wires: [], notes: [] }, BLINK_SKETCH)
  const key = 'uno:d13'
  let lastEdge: number | null = null
  const halves: number[] = []
  const duties: number[] = []
  for (let f = 0; f < 126; f++) {
    const { duty, transitions } = frame(scene, true)
    duties.push(duty.get(key) ?? 0)
    for (const t of transitions) {
      if (t.key !== key) continue
      // Ignore the port-listener's first edge ('z' -> 0 as the pin becomes an output).
      if (lastEdge !== null) {
        const ms = (t.cycles - lastEdge) / 16_000 // 16 MHz -> ms
        if (ms > 100) halves.push(ms)
      }
      lastEdge = t.cycles
    }
  }
  const avgHalf = halves.reduce((a, b) => a + b, 0) / halves.length
  const avgDuty = duties.reduce((a, b) => a + b, 0) / duties.length
  console.log(`  Blink half-periods: ${halves.length} edges, average ${avgHalf.toFixed(1)} ms (want 500)`)
  console.log(`  average pinDuty over the run: ${avgDuty.toFixed(3)} (want ~0.5)`)
  ok('Blink half-periods are 500 ms within 2%', halves.every((h) => Math.abs(h - 500) / 500 <= 0.02))
  ok('average pinDuty over a Blink cycle is ~0.5', Math.abs(avgDuty - 0.5) <= 0.02)

  const pwmScene = await open(
    { version: 1, parts: [uno()], wires: [], notes: [] },
    `#include <Arduino.h>
void setup() { pinMode(9, OUTPUT); analogWrite(9, 128); }
void loop() { delay(100); }
`,
  )
  let duty = 0
  for (let f = 0; f < 10; f++) duty = frame(pwmScene, true).duty.get('uno:d9') ?? 0
  console.log(`  analogWrite(9, 128) -> pinDuty ${duty.toFixed(3)} (want ~0.5)`)
  ok('pinDuty reports ~0.5 for a 50%-duty analogWrite, with slicing on', Math.abs(duty - 0.5) <= 0.03)
}

// ================================================================ cost
console.log('\n== per-frame cost ==')
{
  const scene = await open(sonarDiagram(30, true), PULSE_IN_SKETCH)
  const N = 30
  // Baseline: the bare CPU run, no callback, no device.
  for (let f = 0; f < 5; f++) scene.runtime.runFor(FRAME)
  scene.runtime.drainTransitions()
  let t0 = performance.now()
  for (let f = 0; f < N; f++) scene.runtime.runFor(FRAME)
  const baseMs = (performance.now() - t0) / N
  scene.runtime.drainTransitions()

  for (let f = 0; f < 3; f++) frame(scene, true)
  t0 = performance.now()
  for (let f = 0; f < N; f++) frame(scene, true)
  const slicedMs = (performance.now() - t0) / N

  for (let f = 0; f < 3; f++) frame(scene, false)
  t0 = performance.now()
  for (let f = 0; f < N; f++) frame(scene, false)
  const plainMs = (performance.now() - t0) / N

  console.log(`  bare runFor(16 ms):        ${baseMs.toFixed(2)} ms/frame`)
  console.log(`  frame, no slicing:         ${plainMs.toFixed(2)} ms/frame`)
  console.log(`  frame, sliced (~2 us):     ${slicedMs.toFixed(2)} ms/frame`)
  console.log(
    `  slicing adds ${(slicedMs - baseMs).toFixed(2)} ms/frame, ` +
      `${slicedMs < 16.67 ? 'staying under' : 'OVER'} the 16.67 ms budget ` +
      `(~8000 callbacks of pinValues + harness.settle per frame)`,
  )
}

// ================================================================ robustness
console.log('\n== robustness ==')
{
  // The part def is wired to the model and renders without touching global state.
  const node = hcSr04Part.render({
    part: { id: 'sonar', def: 'hc-sr04', at: { x: 0, y: 0 }, rotation: 0, params: { distanceCm: 30 } },
    def: hcSr04Part,
  })
  ok(
    'the part is a registered-shaped sensors def wired to the device',
    hcSr04Part.id === 'hc-sr04' &&
      hcSr04Part.category === 'sensors' &&
      hcSr04Part.device === hcSr04Device &&
      hcSr04Part.defaultParams?.distanceCm === 30 &&
      JSON.stringify(hcSr04Part.pins.map((p) => p.id)) === JSON.stringify(['vcc', 'trig', 'echo', 'gnd']),
  )
  ok('the part renders', node !== null && node !== undefined)

  // No device on the diagram at all.
  const bare = await open({ version: 1, parts: [uno()], wires: [], notes: [] }, BLINK_SKETCH)
  let bareDuty = 0
  for (let f = 0; f < 20; f++) bareDuty = frame(bare, true).duty.get('uno:d13') ?? 0
  ok('no device: the sliced loop runs and pinDuty is finite', Number.isFinite(bareDuty))

  // A placed but unwired sensor: TRIG floats, so it never fires and ECHO never moves.
  const unwired = await open(sonarDiagram(30, false), PULSE_IN_SKETCH)
  for (let f = 0; f < 90; f++) frame(unwired, true)
  const unwiredNums = numbersIn(unwired.runtime.serial())
  console.log(`  unwired sensor: pulseIn read ${unwiredNums[0] ?? 'no output'}`)
  ok('unwired sensor: pulseIn times out rather than reporting garbage', unwiredNums.length > 0 && unwiredNums[0] === 0)

  // Out-of-range distances are clamped, and a missing one falls back to the default.
  const input = (trig: 0 | 1 | 'z', dtMicros: number) => ({
    level: (pin: string) => (pin === 'trig' ? trig : ('z' as const)),
    duty: () => 0,
    dtMicros,
  })
  const start = (distanceCm?: number) => {
    const s: Record<string, unknown> = {}
    if (distanceCm !== undefined) s.distanceCm = distanceCm
    return s
  }
  const sLow = start(1)
  const low = hcSr04Device.step(input(1, 0), sLow).echo
  const sHigh = start(1000)
  const high = hcSr04Device.step(input(1, 0), sHigh).echo
  const sDefault = start()
  hcSr04Device.step(input(1, 0), sDefault)
  const dflt = sDefault
  const inFlight = start(30)
  hcSr04Device.step(input(1, 0), inFlight) // starts an echo
  hcSr04Device.step(input(0, 0), inFlight) // trig falls
  hcSr04Device.step(input(1, 0), inFlight) // re-trigger must be ignored while in flight
  console.log(
    `  distanceCm 1 -> ${sLow.echoRemaining} us, 1000 -> ${sHigh.echoRemaining} us, ` +
      `missing -> ${sDefault.echoRemaining} us, retrigger keeps ${inFlight.echoRemaining} us`,
  )
  ok('distanceCm 1 cm is clamped up to 2 cm (116 us)', sLow.echoRemaining === 116)
  ok('distanceCm 1000 cm is clamped down to 400 cm (23200 us)', sHigh.echoRemaining === 23200)
  ok('a missing distanceCm defaults to 30 cm (1740 us)', dflt.echoRemaining === 1740)
  ok('a trigger during an echo is ignored', inFlight.echoRemaining === 1740)
  ok('low -> clamped 2 cm echo is HIGH', low === 1)
  ok('a 400 cm echo is HIGH', high === 1)
  ok(
    'the device never produces NaN',
    [sLow, sHigh, sDefault, inFlight].every((s) => Number.isFinite(s.echoRemaining as number)),
  )
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
