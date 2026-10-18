import { createAvrRuntime } from '@/lib/avr/runtime'
import { simulate } from '@/lib/circuit'
import { compileSketchInline } from '@/lib/compile'
import { createDeviceHarness } from '@/lib/devices'
import { allPartDefs, getPartDef } from '@/lib/parts'
import type { Diagram } from '@/lib/types'

// App-shaped loop: one 16 ms frame, transition replay, one analog solve — and timed.
const SOURCE = `#include <Arduino.h>
void setup() { pinMode(11, OUTPUT); pinMode(12, OUTPUT); pinMode(13, OUTPUT); }
void loop() {
  digitalWrite(12, LOW);
  shiftOut(11, 13, MSBFIRST, 0xB5);
  digitalWrite(12, HIGH);
  delay(200);
}`

const parts: Diagram['parts'] = [
  { id: 'uno', def: 'arduino-uno', at: { x: 0, y: 0 }, rotation: 0 },
  { id: 'sr', def: 'shift-register-74hc595', at: { x: 400, y: 0 }, rotation: 0 },
  { id: 'gnd', def: 'rail-gnd', at: { x: 400, y: 300 }, rotation: 0 },
  { id: 'vcc', def: 'rail-5v', at: { x: 460, y: 300 }, rotation: 0 },
]
const wires: Diagram['wires'] = [
  { id: 'w1', from: { part: 'uno', pin: 'd11' }, to: { part: 'sr', pin: 'ds' } },
  { id: 'w2', from: { part: 'uno', pin: 'd13' }, to: { part: 'sr', pin: 'shcp' } },
  { id: 'w3', from: { part: 'uno', pin: 'd12' }, to: { part: 'sr', pin: 'stcp' } },
  { id: 'w4', from: { part: 'gnd', pin: 'GND' }, to: { part: 'sr', pin: 'oe' } },
  { id: 'w5', from: { part: 'vcc', pin: '5V' }, to: { part: 'sr', pin: 'mr' } },
]
for (let i = 0; i < 8; i++) {
  parts.push({ id: `r${i}`, def: 'resistor', at: { x: 560, y: i * 40 }, rotation: 0 })
  parts.push({ id: `l${i}`, def: 'led', at: { x: 660, y: i * 40 }, rotation: 0 })
  wires.push({ id: `wr${i}`, from: { part: 'sr', pin: `q${i}` }, to: { part: `r${i}`, pin: '1' } })
  wires.push({ id: `wl${i}`, from: { part: `r${i}`, pin: '2' }, to: { part: `l${i}`, pin: 'a' } })
  wires.push({ id: `wg${i}`, from: { part: `l${i}`, pin: 'k' }, to: { part: 'gnd', pin: 'GND' } })
}
const diagram: Diagram = { version: 1, parts, wires, notes: [] }

const defs = new Map(allPartDefs().map((d) => [d.id, d]))
const { hex } = await compileSketchInline(SOURCE)
const runtime = createAvrRuntime(parts[0], getPartDef('arduino-uno')!)
runtime.load(hex)

const FRAME = 16_000
const state = new Map<string, Record<string, unknown>>()
const samples: number[][] = []
const frameMs: number[] = []
const traces: string[][] = []
const t0 = performance.now()

for (let frame = 0; frame < 60; frame++) {
  const f0 = performance.now()
  // Start-of-frame levels: an end-of-frame seed misreads a device that latches two
  // pins at once, so the replay must begin from before the CPU ran.
  const startPins = runtime.pinValues()
  runtime.runFor(FRAME)
  const harness = createDeviceHarness(diagram, defs, state)
  harness.seed(startPins)
  const transitions = runtime.drainTransitions()
  traces.push(transitions.map((t) => `${t.key.split(':')[1]}=${t.value}`))
  for (const t of transitions) harness.applyTransition(t.key, t.value)
  const pins = runtime.pinValues()
  const merged = harness.settle(pins, FRAME)
  const circuit = simulate(diagram, defs, merged)
  frameMs.push(performance.now() - f0)
  samples.push(Array.from({ length: 8 }, (_, i) => circuit.brightness[`l${i}`] ?? 0))
}
const total = performance.now() - t0

// pattern is q0..q7; 0xB5 is bit7..bit0 = 1011 0101, so q0..q7 = 1010 1101
const EXPECTED = '10101101'
const pattern = (row: number[]) => row.map((b) => (b > 0.3 ? '1' : '0')).join('')
const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length
const worst = Math.max(...frameMs)

console.log(`frames: 60, wall: ${total.toFixed(0)} ms`)
console.log(`frame cost: avg ${avg.toFixed(2)} ms, worst ${worst.toFixed(2)} ms (16.67 ms budget)`)
console.log(`expected q0..q7 = ${EXPECTED}  (0xB5, LSB first)`)
console.log('per-frame q0..q7 (first 16):', samples.slice(0, 16).map(pattern).join(' '))

// Find the frame where the pattern changes and dump the transitions around it.
const changeAt = samples.findIndex((s, i) => i > 0 && pattern(s) !== pattern(samples[i - 1]))
console.log(`\npattern changes at frame ${changeAt}`)
for (const f of [changeAt - 1, changeAt, changeAt + 1]) {
  if (f < 0 || f >= traces.length) continue
  console.log(`  frame ${f} (${traces[f].length} transitions): ${traces[f].join(' ')}`)
}
console.log('595 state (last frame):', JSON.stringify(state.get('sr')))
console.log(pattern(samples[samples.length - 1]) === EXPECTED ? '\nSINGLE-FRAME REPLAY OK' : '\nPATTERN WRONG')
process.exit(pattern(samples[samples.length - 1]) === EXPECTED ? 0 : 1)


