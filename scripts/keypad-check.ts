/**
 * Keypad checks: a 4x4 matrix wired to an Arduino Uno and scanned by a real sketch.
 * Run with `bun scripts/keypad-check.ts`.
 *
 * The scanning test is the headline: rows on d2-d5 drive LOW one at a time, columns on
 * d6-d9 read back through 10k pull-ups to 5 V, and the sketch prints the key it found.
 * The frame loop mirrors `scripts/sample-check.ts` step for step.
 */

import { createAvrRuntime, type AvrRuntime } from '@/lib/avr/runtime'
import { simulate, type CircuitState } from '@/lib/circuit'
import { compileSketchInline } from '@/lib/compile'
import { createDeviceHarness } from '@/lib/devices'
import { feedbackFromCircuit } from '@/lib/inputs'
import { buildNets } from '@/lib/netlist'
import { allPartDefs } from '@/lib/parts'
import { keypad } from '@/lib/parts/keypad'
import type { Diagram, Endpoint, PartDef, PartInstance, Wire } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

// The registry does not carry the keypad yet (a sibling agent registers it), so build the
// map the app will use once it lands. Index n is row n/4+1, column n%4+1.
const defs = new Map<string, PartDef>([
  ...allPartDefs().map((d) => [d.id, d] as const),
  ['keypad-4x4', keypad],
])
const LEGENDS = ['1', '2', '3', 'A', '4', '5', '6', 'B', '7', '8', '9', 'C', '*', '0', '#', 'D']

const part = (id: string, def: string): PartInstance => ({ id, def, at: { x: 0, y: 0 }, rotation: 0 })
const partP = (id: string, def: string, params: Record<string, number>): PartInstance => ({
  ...part(id, def),
  params,
})
const wire = (id: string, from: Endpoint, to: Endpoint): Wire => ({ id, from, to })
const diagram = (parts: PartInstance[], wires: Wire[] = []): Diagram => ({ version: 1, parts, wires, notes: [] })
const pinValues = (...entries: [string, 0 | 1 | 'z'][]) => new Map<string, 0 | 1 | 'z'>(entries)

/** Rows r1-r4 -> d2-d5, columns c1-c4 -> d6-d9, each column pulled up to 5 V through 10k. */
const keypadDiagram = (params: Record<string, number>): Diagram =>
  diagram(
    [
      part('uno', 'arduino-uno'),
      part('vcc', 'rail-5v'),
      part('gnd', 'rail-gnd'),
      partP('kp', 'keypad-4x4', params),
      ...[0, 1, 2, 3].map((i) => partP(`pu${i + 1}`, 'resistor', { ohms: 10000 })),
    ],
    [
      ...[0, 1, 2, 3].map((i) => wire(`wr${i + 1}`, { part: 'kp', pin: `r${i + 1}` }, { part: 'uno', pin: `d${i + 2}` })),
      ...[0, 1, 2, 3].map((i) => wire(`wc${i + 1}`, { part: 'kp', pin: `c${i + 1}` }, { part: 'uno', pin: `d${i + 6}` })),
      ...[0, 1, 2, 3].flatMap((i) => [
        wire(`wp${i + 1}a`, { part: 'vcc', pin: '5V' }, { part: `pu${i + 1}`, pin: '1' }),
        wire(`wp${i + 1}b`, { part: `pu${i + 1}`, pin: '2' }, { part: 'uno', pin: `d${i + 6}` }),
      ]),
    ],
  )

/** Column net voltages with the given rows (0-based) driven LOW and the rest HIGH. */
const columnVolts = (params: Record<string, number>, lowRows: number[]): number[] => {
  const d = keypadDiagram(params)
  const pins = pinValues(...[0, 1, 2, 3].map((r): [string, 0 | 1] => [`uno:d${r + 2}`, lowRows.includes(r) ? 0 : 1]))
  const st = simulate(d, defs, pins)
  const nets = buildNets(d, defs)
  return [1, 2, 3, 4].map((c) => st.volts[nets.netOf('kp', `c${c}`)!])
}
const near = (v: number, target: number) => Math.abs(v - target) < 0.2

// ------------------------------------------------------------- circuit-level matrix
// Key 5 is row 2, column 2: only driving row 2 LOW pulls column 2 down.
{
  const onlyRow2 = columnVolts({ key: 5 }, [1])
  ok(`key 5, row 2 LOW: column 2 is pulled to the rail (~0 V) [${onlyRow2.map((v) => v.toFixed(2)).join(', ')}]`, near(onlyRow2[1], 0))
  ok('key 5, row 2 LOW: columns 1, 3, 4 stay at ~5 V', near(onlyRow2[0], 5) && near(onlyRow2[2], 5) && near(onlyRow2[3], 5))

  const onlyRow1 = columnVolts({ key: 5 }, [0])
  ok('key 5, row 1 LOW: every column stays at ~5 V', onlyRow1.every((v) => near(v, 5)))

  // All four rows LOW at once: if a second pair conducted, a second column would drop too.
  const allRows = columnVolts({ key: 5 }, [0, 1, 2, 3])
  ok(
    `key 5, all rows LOW: exactly one row/column pair conducts [${allRows.map((v) => v.toFixed(2)).join(', ')}]`,
    near(allRows[1], 0) && [0, 2, 3].every((c) => near(allRows[c], 5)),
  )

  // Orientation: key 0 is row 1, column 1. An off-by-one row/column would fail here.
  const key0 = columnVolts({ key: 0 }, [0])
  ok(
    `key 0 (row 1, column 1): row 1 LOW pulls column 1 down [${key0.map((v) => v.toFixed(2)).join(', ')}]`,
    near(key0[0], 0) && near(key0[1], 5) && near(key0[2], 5) && near(key0[3], 5),
  )
}

// ------------------------------------------------------------- nothing pressed
// Absent / empty / -1 params must leave all sixteen keys open: no row shorts a column, so
// with every row LOW every column still reads the pull-up rail. This catches an accidental short.
for (const [label, params] of [['-1', { key: -1 }], ['absent', {}]] as const) {
  const v = columnVolts(params, [0, 1, 2, 3])
  ok(`key ${label}: no row/column connection, every column stays at ~5 V [${v.map((x) => x.toFixed(2)).join(', ')}]`, v.every((x) => near(x, 5)))
}

// ------------------------------------------------------------- robustness
{
  let threw = false
  const ghost = diagram(
    [part('vcc', 'rail-5v'), part('gnd', 'rail-gnd'), part('ghost', 'does-not-exist')],
    [wire('w1', { part: 'vcc', pin: '5V' }, { part: 'ghost', pin: 'x' })],
  )
  let st: CircuitState | null = null
  try {
    st = simulate(ghost, defs, pinValues())
  } catch {
    threw = true
  }
  ok('an unknown part id does not throw', !threw)
  ok('and the rest of the circuit still solves', st?.converged === true)

  const dangling = diagram([part('gnd', 'rail-gnd'), partP('kp', 'keypad-4x4', { key: 7 })])
  const ds = simulate(dangling, defs, pinValues())
  ok('a keypad with every pin unwired converges', ds.converged)
  ok('a keypad with every pin unwired has no NaN', Object.values(ds.volts).every(Number.isFinite))
}

// ------------------------------------------------------------- the scanning sketch
const SCAN_SKETCH = `#include <Arduino.h>

const int rowPins[4] = {2, 3, 4, 5};
const int colPins[4] = {6, 7, 8, 9};
const char legend[4][4] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'},
};

void setup() {
  Serial.begin(9600);
  for (int r = 0; r < 4; r++) {
    pinMode(rowPins[r], OUTPUT);
    digitalWrite(rowPins[r], HIGH);
  }
  for (int c = 0; c < 4; c++) pinMode(colPins[c], INPUT);
}

void loop() {
  char found = 0;
  for (int r = 0; r < 4; r++) {
    digitalWrite(rowPins[r], LOW);
    delay(80);                      // hold the row LOW across several simulated frames
    for (int c = 0; c < 4; c++) {
      if (digitalRead(colPins[c]) == LOW) found = legend[r][c];
    }
    digitalWrite(rowPins[r], HIGH);
    delay(20);                      // let the pull-ups settle before the next row
  }
  if (found) Serial.println(found);
  else Serial.println("none");
}
`

const FRAME = 16_000
const { hex } = await compileSketchInline(SCAN_SKETCH)

interface Scene {
  diagram: Diagram
  runtime: AvrRuntime
  state: Map<string, Record<string, unknown>>
}

/** Exactly the app's frame ordering (mirrors scripts/sample-check.ts). */
function step(scene: Scene): CircuitState {
  scene.runtime.runFor(FRAME)
  const duty = scene.runtime.pinDuty()
  const harness = createDeviceHarness(scene.diagram, defs, scene.state, duty)
  const livePins = scene.runtime.pinValues()
  harness.seed(livePins)
  for (const t of scene.runtime.drainTransitions()) {
    if (harness.watched.has(t.key)) harness.applyTransition(t.key, t.value)
  }
  const pins = harness.settle(livePins, FRAME)

  const prefix = 'uno:'
  const pullUps = new Set(scene.runtime.pullUps().filter((k) => k.startsWith(prefix)))
  const circuit = simulate(scene.diagram, defs, pins, { pullUps, duty })

  const feedback = feedbackFromCircuit(scene.diagram, defs, circuit.volts)
  for (const [key, level] of feedback.digital) {
    if (key.startsWith(prefix)) scene.runtime.setInputPin(key.slice(prefix.length), level)
  }
  for (const [key, volts] of feedback.analog) {
    if (key.startsWith(prefix)) scene.runtime.setAnalogPin(key.slice(prefix.length), volts)
  }
  return circuit
}

/** Run the scan with `params` in place and return the reported lines plus the last circuit. */
const scan = (params: Record<string, number>, frames = 320) => {
  const d = keypadDiagram(params)
  const board = d.parts.find((p) => p.def === 'arduino-uno')!
  const runtime = createAvrRuntime(board, defs.get('arduino-uno')!)
  runtime.load(hex)
  const scene: Scene = { diagram: d, runtime, state: new Map() }
  let circuit!: CircuitState
  for (let f = 0; f < frames; f++) circuit = step(scene)
  const reports = runtime
    .serial()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return { reports, circuit }
}

const tail = (a: string[], n: number) => a.slice(Math.max(0, a.length - n))

// A few keys spread across the matrix: 0, 5, 15, 12, 13 -> 1, 5, D, *, 0.
for (const key of [0, 5, 15, 12, 13]) {
  const { reports, circuit } = scan({ key })
  const expected = LEGENDS[key]
  const last = tail(reports, 4)
  console.log(`\n  key ${key} -> expected "${expected}", serial tail: ${JSON.stringify(last)}  (total ${reports.length} lines)`)
  ok(`key ${key}: the scan converges`, circuit.converged)
  ok(`key ${key}: the sketch reports "${expected}"`, last.length >= 2 && last.every((line) => line === expected))
  ok(
    `key ${key}: no second key is ever reported (only "${expected}")`,
    new Set(reports).size === 1 && reports[0] === expected,
  )
}

{
  const { reports } = scan({ key: -1 })
  const last = tail(reports, 4)
  console.log(`\n  key -1 -> expected "none", serial tail: ${JSON.stringify(last)}  (total ${reports.length} lines)`)
  ok('key -1: every column reads high, the sketch reports "none"', last.length >= 2 && last.every((line) => line === 'none'))
  ok('key -1: nothing else is ever reported', new Set(reports).size === 1 && reports[0] === 'none')
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
