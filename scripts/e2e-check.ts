import { createAvrRuntime } from '@/lib/avr/runtime'
import { simulate } from '@/lib/circuit'
import { compileSketchInline } from '@/lib/compile'
import { allPartDefs, getPartDef } from '@/lib/parts'
import type { Diagram } from '@/lib/types'
import { DEFAULT_SKETCH } from '@/store/simulation'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const FRAME_MICROS = 16_000
const UNO_ID = 'uno'
const RESISTOR_ID = 'r1'
const LED_ID = 'led1'
const GND_ID = 'gnd'

/** Exactly what the user would draw: pin 13 -> 220R -> LED -> GND rail. */
const diagram: Diagram = {
  version: 1,
  parts: [
    { id: UNO_ID, def: 'arduino-uno', at: { x: 0, y: 0 }, rotation: 0 },
    { id: RESISTOR_ID, def: 'resistor', at: { x: 320, y: 0 }, rotation: 0 },
    { id: LED_ID, def: 'led', at: { x: 420, y: 0 }, rotation: 0 },
    { id: GND_ID, def: 'rail-gnd', at: { x: 520, y: 0 }, rotation: 0 },
  ],
  wires: [
    { id: 'w1', from: { part: UNO_ID, pin: 'd13' }, to: { part: RESISTOR_ID, pin: '1' } },
    { id: 'w2', from: { part: RESISTOR_ID, pin: '2' }, to: { part: LED_ID, pin: 'a' } },
    { id: 'w3', from: { part: LED_ID, pin: 'k' }, to: { part: GND_ID, pin: 'GND' } },
  ],
  notes: [],
}

const defs = new Map(allPartDefs().map((d) => [d.id, d]))
const unoPart = diagram.parts[0]
const unoDef = getPartDef('arduino-uno')!

const { hex, fitsTarget } = await compileSketchInline(DEFAULT_SKETCH)
ok('the default sketch compiles and fits the Uno', fitsTarget && hex.length > 1000)

const runtime = createAvrRuntime(unoPart, unoDef)
runtime.load(hex)

type Sample = { micros: number; brightness: number }
const samples: Sample[] = []
let convergedEveryFrame = true
let reason = ''

for (let frame = 0; frame < 160; frame++) {
  runtime.runFor(FRAME_MICROS)
  const state = simulate(diagram, defs, runtime.pinValues())
  if (!state.converged) {
    convergedEveryFrame = false
    reason = state.reason ?? ''
  }
  samples.push({ micros: runtime.elapsedMicros(), brightness: state.brightness[LED_ID] ?? 0 })
}

ok('the circuit converges on every frame', convergedEveryFrame)
if (!convergedEveryFrame) console.log('   reason:', reason)

const lit = samples.map((s) => s.brightness > 0.3)
const edges: number[] = []
for (let i = 1; i < samples.length; i++) if (lit[i] !== lit[i - 1]) edges.push(samples[i].micros)

const peak = Math.max(...samples.map((s) => s.brightness))
const floor = Math.min(...samples.map((s) => s.brightness))
const halfPeriods = edges.slice(1).map((e, i) => (e - edges[i]) / 1000)

console.log(`\n  frames: ${samples.length}, simulated: ${(runtime.elapsedMicros() / 1e6).toFixed(2)} s`)
console.log(`  LED brightness: peak ${peak.toFixed(3)}, floor ${floor.toFixed(3)}`)
console.log(`  lit transitions at (ms): ${edges.map((e) => (e / 1000).toFixed(1)).join(', ')}`)
console.log(`  half-periods (ms): ${halfPeriods.map((h) => h.toFixed(1)).join(', ')}\n`)

ok('the LED lights up at all', peak > 0.5)
ok('the LED goes dark between blinks', floor < 0.05)
ok('the LED blinks at least twice in 2.5 s', edges.length >= 4)
ok(
  'every half-period is 500 ms (+-3%)',
  halfPeriods.length >= 3 && halfPeriods.every((h) => Math.abs(h - 500) / 500 < 0.03),
)
ok('the peak brightness matches the hand-checked operating point (~0.63)', peak > 0.58 && peak < 0.68)

// The pin state must actually be what drives it: force it low and the LED must go dark.
const forced = simulate(diagram, defs, new Map([[`${UNO_ID}:d13`, 0 as const]]))
ok('driving pin 13 low leaves the LED dark', (forced.brightness[LED_ID] ?? 0) < 0.01)
const floating = simulate(diagram, defs, new Map([[`${UNO_ID}:d13`, 'z' as const]]))
ok('leaving pin 13 high-Z leaves the LED dark', (floating.brightness[LED_ID] ?? 0) < 0.01)

console.log(failed === 0 ? '\nBLINK: END TO END OK' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
