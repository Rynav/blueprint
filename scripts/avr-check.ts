/**
 * AVR runtime checks. Run with `bun scripts/avr-check.ts`.
 *
 * Compiles firmware with the same toolchain the app uses, loads it into
 * src/lib/avr/runtime.ts and drives the pins the way the canvas will.
 * Assert-based, no framework, non-zero exit on failure (mirrors scripts/check.tsx).
 */
import { buildFirmware } from '@horang-corp/avr-gcc-wasm'

import { createAvrRuntime } from '@/lib/avr/runtime'
import type { AvrRuntime, PinValue } from '@/lib/avr/runtime'
import { getPartDef } from '@/lib/parts'
import type { PartInstance } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const started = Date.now()

const uno: PartInstance = { id: 'uno1', def: 'arduino-uno', at: { x: 0, y: 0 }, rotation: 0 }
const unoDef = getPartDef('arduino-uno')!
const pin = (rt: AvrRuntime, id: string) => rt.pinValues().get(`uno1:${id}`)
const driven = (v: PinValue | undefined) => v === 0 || v === 1

interface Edge {
  us: number
  high: boolean
}

/**
 * Advance in `stepUs` slices, sampling every slice: a pin that never becomes an output
 * stays 'z' and never produces an edge, so `zOk` proves d12 was never driven.
 */
function trace(rt: AvrRuntime, totalUs: number, stepUs: number) {
  const edges: Edge[] = []
  let zOk = true
  let samples = 0
  let last = pin(rt, 'd13')
  for (let t = 0; t < totalUs; t += stepUs) {
    rt.runFor(stepUs)
    const values = rt.pinValues()
    const v = values.get('uno1:d13')
    if (v === 0 || v === 1) samples++
    if (values.get('uno1:d12') !== 'z') zOk = false
    if (driven(v) && v !== last) edges.push({ us: rt.elapsedMicros(), high: v === 1 })
    last = v
  }
  return { edges, zOk, samples }
}

// ---- Blink: compiles, runs, toggles pin 13 at 500 ms ----
const BLINK = `#include <Arduino.h>

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
`

const blink = await buildFirmware({ source: BLINK })
ok('Blink compiles and fits the Uno', blink.fitsTarget === true)
ok('compiler returned Intel HEX', blink.hex.startsWith(':'))

const rt = createAvrRuntime(uno, unoDef)
rt.load(blink.hex)
const blinkTrace = trace(rt, 2_500_000, 2_000) // 2 ms slices: 0.4% timing quantisation
const edges = blinkTrace.edges
ok('Blink produces at least 5 pin-13 edges in 2.5 simulated seconds', edges.length >= 5)
ok('the first edge is HIGH (pinMode + digitalWrite HIGH)', edges[0]?.high === true)
ok('edges alternate HIGH/LOW', edges.every((e, i) => i === 0 || e.high !== edges[i - 1].high))
const halves = edges.slice(1).map((e, i) => e.us - edges[i].us)
ok(
  `every half-period is 500 ms +-2% (${halves.map((h) => (h / 1000).toFixed(1)).join(', ')} ms)`,
  halves.length >= 4 && halves.every((h) => Math.abs(h - 500_000) <= 0.02 * 500_000),
)
// Each runFor call stops on an instruction boundary, so its span overshoots the request by
// up to a few cycles; over 1250 calls that is tens of microseconds in 2.5 s (~0.001%).
ok(
  `elapsed time tracks the requested span (${rt.elapsedMicros()} us, +${(((rt.elapsedMicros() - 2_500_000) / 2_500_000) * 100).toFixed(4)}%)`,
  rt.elapsedMicros() >= 2_500_000 && rt.elapsedMicros() - 2_500_000 < 2_500_000 * 5e-4,
)

// ---- pinValues ----
ok("d13 reports real levels while it toggles", blinkTrace.samples > 1000)
ok("d12 stays 'z' - never configured as an output", blinkTrace.zOk)
const values = rt.pinValues()
ok(
  'pinValues is keyed by the placed board id and pin id',
  values.has('uno1:d13') && values.has('uno1:a0') && values.get('uno1:a0') === 'z',
)
ok('pinValues covers exactly the mcu pins', values.size === 20)
ok('power/ground/AREF pins are not mcu pins', !values.has('uno1:5v') && !values.has('uno1:gnd1') && !values.has('uno1:aref'))

// ---- runFor is additive ----
const one = createAvrRuntime(uno, unoDef)
one.load(blink.hex)
one.runFor(1_000_000)
const four = createAvrRuntime(uno, unoDef)
four.load(blink.hex)
for (let i = 0; i < 4; i++) four.runFor(250_000)
ok(
  `1x runFor(1 s) and 4x runFor(250 ms) advance the same time (${one.elapsedMicros()} vs ${four.elapsedMicros()} us)`,
  Math.abs(one.elapsedMicros() - four.elapsedMicros()) < 1 && Math.abs(one.elapsedMicros() - 1_000_000) < 1,
)
ok('...and leave pin 13 in the same state', pin(one, 'd13') === pin(four, 'd13'))
// Edges cannot be sampled inside a single runFor call, so replay the same second on a 1 ms
// grid for both: the two call patterns must produce byte-identical edge traces.
const gridOne = trace(one, 1_000_000, 1_000).edges
const gridFour = trace(four, 1_000_000, 1_000).edges
ok(
  `...and the same number of edges in the following second (${gridOne.length} vs ${gridFour.length})`,
  gridOne.length >= 2 && gridOne.length === gridFour.length,
)
ok('...at the same times', JSON.stringify(gridOne) === JSON.stringify(gridFour))

// ---- serial ----
const SERIAL = `#include <Arduino.h>

void setup() {
  Serial.begin(9600);
  Serial.println("hello from avr");
}

void loop() {}
`
const serialFirmware = await buildFirmware({ source: SERIAL })
ok('serial sketch compiles', serialFirmware.fitsTarget === true)
const rs = createAvrRuntime(uno, unoDef)
rs.load(serialFirmware.hex)
ok('serial buffer starts empty', rs.serial() === '')
rs.runFor(1_000_000)
ok(`serial() captures Serial.println output (${JSON.stringify(rs.serial())})`, rs.serial().includes('hello from avr'))

// ---- reset / reload ----
rt.reset()
ok('reset zeroes elapsed time', rt.elapsedMicros() === 0)
rs.reset()
ok('reset clears the serial buffer', rs.serial() === '')
rt.load(blink.hex)
ok('load is safe to repeat (reload restarts the run)', rt.elapsedMicros() === 0 && rt.serial() === '')
const afterReset = trace(rt, 2_000_000, 2_000).edges
ok('the reloaded program still runs after reset', afterReset.length >= 3)

// ---- a def without mcu is rejected ----
let thrown = ''
try {
  createAvrRuntime({ id: 'led1', def: 'led', at: { x: 0, y: 0 }, rotation: 0 }, getPartDef('led')!)
} catch (e) {
  thrown = String(e)
}
ok(`createAvrRuntime throws for a def without mcu (${thrown})`, thrown.includes('no mcu spec'))

// ---- per-frame cost ----
const frame = createAvrRuntime(uno, unoDef)
frame.load(blink.hex)
const frames = 20
const before = performance.now()
for (let i = 0; i < frames; i++) frame.runFor(16_667) // one 60 fps frame
const perFrame = (performance.now() - before) / frames
console.log(`\nper-frame cost: ${perFrame.toFixed(1)} ms for 16.7 ms of simulated time (60 fps budget)`)
console.log(`suite wall clock: ${Date.now() - started} ms`)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
