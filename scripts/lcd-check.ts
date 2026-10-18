/**
 * HD44780 16x2 character LCD checks. Run with `bun scripts/lcd-check.ts`.
 *
 * The headline case bit-bangs a raw 4-bit HD44780 driver onto an ATmega328P and drives the
 * app's real frame loop (one `runFor(16_000)` per frame, every pin edge replayed) so the ~1 us
 * Enable pulses are actually seen. The rest probe the model directly via `stepDevices`.
 */

import { createAvrRuntime, type AvrRuntime } from '@/lib/avr/runtime'
import { simulate, type CircuitState } from '@/lib/circuit'
import { compileSketchInline } from '@/lib/compile'
import { createDeviceHarness, stepDevices, type PinValue } from '@/lib/devices'
import { feedbackFromCircuit } from '@/lib/inputs'
import { allPartDefs } from '@/lib/parts'
import { lcd } from '@/lib/parts/lcd'
import type { Diagram, Endpoint, PartDef, PartInstance, Wire } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const FRAME = 16_000

// The registry does not know about the LCD yet, so this suite builds its own defs map.
const defs = new Map<string, PartDef>(allPartDefs().map((d) => [d.id, d]))
defs.set('lcd-16x2', lcd)
const lcdDevice = lcd.device!

const part = (id: string, def: string): PartInstance => ({ id, def, at: { x: 0, y: 0 }, rotation: 0 })
const wire = (id: string, from: Endpoint, to: Endpoint): Wire => ({ id, from, to })
const diagram = (parts: PartInstance[], wires: Wire[] = []): Diagram => ({ version: 1, parts, wires, notes: [] })

const LCD = 'lcd'
const UNO = 'uno'
const GND = 'gnd'
const V5 = 'v5'

// ---------------------------------------------------------------- a real 4-bit driver sketch
// RS -> D12, E -> D11, D4..D7 -> D5..D2, RW tied to GND. Raw bit-bang, so no library links.
const LCD_SKETCH = `
const int RS = 12, E = 11, D4 = 5, D5 = 4, D6 = 3, D7 = 2;

void lcdWrite4(int rs, int nib) {
  digitalWrite(RS, rs);
  digitalWrite(D4, (nib >> 0) & 1);
  digitalWrite(D5, (nib >> 1) & 1);
  digitalWrite(D6, (nib >> 2) & 1);
  digitalWrite(D7, (nib >> 3) & 1);
  digitalWrite(E, HIGH);
  delayMicroseconds(2);
  digitalWrite(E, LOW);
  delayMicroseconds(2);
}

void lcdWrite(int rs, int b) {
  lcdWrite4(rs, (b >> 4) & 0x0F); // high nibble first
  lcdWrite4(rs, b & 0x0F);
}

void setup() {
  pinMode(RS, OUTPUT);
  pinMode(E, OUTPUT);
  pinMode(D4, OUTPUT);
  pinMode(D5, OUTPUT);
  pinMode(D6, OUTPUT);
  pinMode(D7, OUTPUT);
  delay(50);
  lcdWrite4(0, 0x3); delay(5); // 8-bit wake-up
  lcdWrite4(0, 0x3); delay(1);
  lcdWrite4(0, 0x3);
  lcdWrite4(0, 0x2);            // switch to 4-bit
  lcdWrite(0, 0x28);            // function set: 4-bit, 2 lines, 5x8
  lcdWrite(0, 0x0C);            // display on, cursor off
  lcdWrite(0, 0x06);            // entry mode: increment
  lcdWrite(0, 0x01);            // clear
  delay(2);
  lcdWrite(1, 'H'); lcdWrite(1, 'E'); lcdWrite(1, 'L'); lcdWrite(1, 'L'); lcdWrite(1, 'O');
  lcdWrite(0, 0x80 | 0x40);     // cursor to row 2, col 0
  lcdWrite(1, 'W'); lcdWrite(1, 'O'); lcdWrite(1, 'R'); lcdWrite(1, 'L'); lcdWrite(1, 'D');
}

void loop() {}
`

const lcdCircuit: Diagram = diagram(
  [part(UNO, 'arduino-uno'), part(LCD, 'lcd-16x2'), part(GND, 'rail-gnd'), part(V5, 'rail-5v')],
  [
    wire('w1', { part: UNO, pin: 'd12' }, { part: LCD, pin: 'rs' }),
    wire('w2', { part: UNO, pin: 'd11' }, { part: LCD, pin: 'e' }),
    wire('w3', { part: UNO, pin: 'd5' }, { part: LCD, pin: 'd4' }),
    wire('w4', { part: UNO, pin: 'd4' }, { part: LCD, pin: 'd5' }),
    wire('w5', { part: UNO, pin: 'd3' }, { part: LCD, pin: 'd6' }),
    wire('w6', { part: UNO, pin: 'd2' }, { part: LCD, pin: 'd7' }),
    wire('w7', { part: LCD, pin: 'rw' }, { part: GND, pin: 'GND' }),
    wire('w8', { part: LCD, pin: 'vss' }, { part: GND, pin: 'GND' }),
    wire('w9', { part: LCD, pin: 'vdd' }, { part: V5, pin: '5V' }),
  ],
)

interface Scene {
  diagram: Diagram
  boardId: string
  runtime: AvrRuntime
  state: Map<string, Record<string, unknown>>
  /** Start-of-frame pin levels (the previous frame's end), used to seed the replay. */
  prev: Map<string, PinValue>
}

async function openScene(d: Diagram, source: string): Promise<Scene> {
  const board = d.parts.find((p) => defs.get(p.def)?.mcu)!
  const def = defs.get(board.def)!
  const state = new Map<string, Record<string, unknown>>()
  const runtime = createAvrRuntime(board, def)
  const { hex } = await compileSketchInline(source)
  runtime.load(hex)
  return { diagram: d, boardId: board.id, runtime, state, prev: runtime.pinValues() }
}

/**
 * The app's frame ordering. It seeds with the *start*-of-frame levels, not this frame's end:
 * a parallel bus (RS/RW/data) is read as a whole word at the Enable edge, so a pin whose
 * first edge lands late in the frame must start at its pre-frame value. `scripts/sensor-check.ts`
 * documents the same requirement for the stepper; `sample-check.ts` seeds the end-of-frame
 * levels, which only works because its devices are I2C-only and read no pins.
 */
function step(scene: Scene): CircuitState {
  scene.runtime.runFor(FRAME)
  const duty = scene.runtime.pinDuty()
  const harness = createDeviceHarness(scene.diagram, defs, scene.state, duty)
  const livePins = scene.runtime.pinValues()
  harness.seed(scene.prev)
  for (const t of scene.runtime.drainTransitions()) {
    if (harness.watched.has(t.key)) harness.applyTransition(t.key, t.value)
  }
  const pins = harness.settle(livePins, FRAME)
  scene.prev = livePins

  const prefix = `${scene.boardId}:`
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

interface LcdData {
  text: string[]
  cursor: { row: number; col: number }
  on: boolean
  blink: boolean
}
const visualOf = (bag: Record<string, unknown>): LcdData => lcdDevice.visual!(bag).data as unknown as LcdData

// ------------------------------------------------------------- headline: HELLO / WORLD
{
  const scene = await openScene(lcdCircuit, LCD_SKETCH)
  let circuit!: CircuitState
  for (let i = 0; i < 40; i++) circuit = step(scene)

  const bag = scene.state.get(LCD) ?? {}
  const data = visualOf(bag)
  const ddram = bag.ddram as Uint8Array
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')

  console.log(`\n  4-bit driver "HELLO" row 0: "${data.text[0]}"`)
  console.log(`                    "WORLD" row 1: "${data.text[1]}"`)
  console.log(`  DDRAM bytes 0..4 = ${Array.from(ddram.slice(0, 5)).map(hex).join(' ')}  (HELLO), row 2 starts at byte 16`)
  console.log(`  cursor = row ${data.cursor.row}, col ${data.cursor.col}; display on = ${data.on}\n`)

  ok('lcd: the circuit converges with the LCD attached', circuit.converged)
  ok(
    'lcd: row 0 decodes to "HELLO" padded to 16',
    data.text[0] === 'HELLO' + ' '.repeat(11),
  )
  ok(
    'lcd: row 1 decodes to "WORLD" padded to 16',
    data.text[1] === 'WORLD' + ' '.repeat(11),
  )
  ok('lcd: the sketch turned the display on', data.on)
  ok('lcd: cursor wrapped to row 2 (0x40) and advanced 5 cells', data.cursor.row === 1 && data.cursor.col === 5)
}

// ------------------------------------------------------------- direct model probes
const lcdOnly = diagram([part(LCD, 'lcd-16x2')])

/** One falling-Enable pulse with RS and a 4-bit nibble on the bus. */
const lcdPins = (rs: 0 | 1, e: 0 | 1, nib: number): Map<string, PinValue> =>
  new Map<string, PinValue>([
    ['lcd:rs', rs],
    ['lcd:rw', 0],
    ['lcd:e', e],
    ['lcd:d4', ((nib >> 0) & 1) as 0 | 1],
    ['lcd:d5', ((nib >> 1) & 1) as 0 | 1],
    ['lcd:d6', ((nib >> 2) & 1) as 0 | 1],
    ['lcd:d7', ((nib >> 3) & 1) as 0 | 1],
  ])
const stepLcd = (bag: Map<string, Record<string, unknown>>, rs: 0 | 1, e: 0 | 1, nib: number) =>
  stepDevices(lcdOnly, defs, lcdPins(rs, e, nib), bag, 0)

/** Pulse E low-high-low for one nibble (in 8-bit mode this is a complete byte). */
const nibble = (bag: Map<string, Record<string, unknown>>, rs: 0 | 1, nib: number) => {
  stepLcd(bag, rs, 0, nib)
  stepLcd(bag, rs, 1, nib)
  stepLcd(bag, rs, 0, nib)
}
/** High nibble then low nibble. */
const pushByte = (bag: Map<string, Record<string, unknown>>, rs: 0 | 1, b: number) => {
  nibble(bag, rs, (b >> 4) & 0x0f)
  nibble(bag, rs, b & 0x0f)
}
const initLcd = (bag: Map<string, Record<string, unknown>>) => {
  nibble(bag, 0, 0x3)
  nibble(bag, 0, 0x3)
  nibble(bag, 0, 0x3)
  nibble(bag, 0, 0x2) // 4-bit
  pushByte(bag, 0, 0x28)
  pushByte(bag, 0, 0x0c)
  pushByte(bag, 0, 0x06)
}
const bagOf = (bag: Map<string, Record<string, unknown>>): Record<string, unknown> => bag.get(LCD)!
const cursorOf = (s: Record<string, unknown>) => Number(s.cursor)

// ---- nibble ordering: 0xA5 must not come back as 0x5A ----
{
  const bag = new Map<string, Record<string, unknown>>()
  initLcd(bag)
  pushByte(bag, 0, 0x01) // clear
  pushByte(bag, 1, 0xa5)
  const ddram = bagOf(bag).ddram as Uint8Array
  console.log(`  nibble order: sent data 0xA5 -> stored 0x${ddram[0].toString(16).toUpperCase()}`)
  ok('nibble order: high nibble first stores exactly 0xA5 (not 0x5A)', ddram[0] === 0xa5)
}

// ---- E held high across several steps latches only once ----
{
  const bag = new Map<string, Record<string, unknown>>()
  initLcd(bag)
  pushByte(bag, 0, 0x01) // clear -> cursor 0

  stepLcd(bag, 1, 0, 0x4) // high nibble of 'A' on the bus, E low
  stepLcd(bag, 1, 1, 0x4) // E rising
  stepLcd(bag, 1, 1, 0x4) // held high...
  stepLcd(bag, 1, 1, 0x4) // ...still held high
  const held = bagOf(bag)
  ok('E held high latches no byte', (held.ddram as Uint8Array)[0] === 0x20 && cursorOf(held) === 0)

  stepLcd(bag, 1, 0, 0x4) // falling: high nibble pending
  stepLcd(bag, 1, 1, 0x1) // low nibble
  stepLcd(bag, 1, 1, 0x1) // held high...
  stepLcd(bag, 1, 1, 0x1) // ...still held high
  stepLcd(bag, 1, 0, 0x1) // one falling edge completes the byte

  const s = bagOf(bag)
  const ddram = s.ddram as Uint8Array
  console.log(`  E held high: after the sequence ddram[0]=0x${ddram[0].toString(16).toUpperCase()}, cursor=${cursorOf(s)}`)
  ok('exactly one byte landed ("A" at col 0, cursor advanced once)', ddram[0] === 0x41 && cursorOf(s) === 1)
}

// ---- clear, home, explicit cursor set and line wrap ----
{
  const bag = new Map<string, Record<string, unknown>>()
  initLcd(bag)
  pushByte(bag, 0, 0x01) // clear
  pushByte(bag, 0, 0x80 | 0x40) // explicit address 0x40 -> row 2, col 0
  pushByte(bag, 1, 0x58) // 'X'
  pushByte(bag, 1, 0x59) // 'Y'
  const s = bagOf(bag)
  const ddram = s.ddram as Uint8Array
  ok('explicit DDRAM 0x40 lands on row 2 (ddram[16], ddram[17])', ddram[16] === 0x58 && ddram[17] === 0x59)
  ok('cursor tracks row 2 col 2 (address 0x42)', cursorOf(s) === 0x42)

  pushByte(bag, 0, 0x02) // return home
  ok('home returns the cursor to address 0x00', cursorOf(s) === 0)
  pushByte(bag, 1, 0x5a) // 'Z'
  ok('writing after home lands on row 1 col 0', ddram[0] === 0x5a)

  pushByte(bag, 0, 0x01) // clear
  ok('clear blanks the whole buffer and homes the cursor', ddram.every((b) => b === 0x20) && cursorOf(s) === 0)

  // Cursor at row 2 col 16 (0x4F): a write wraps back to row 1 col 0.
  pushByte(bag, 0, 0x80 | 0x4f)
  pushByte(bag, 1, 0x21) // '!'
  ok('writing past row 2 col 16 wraps to address 0x00', ddram[31] === 0x21 && cursorOf(s) === 0)
}

// ---- robustness: no LCD, and every pin unwired ----
{
  let threw = false
  try {
    stepDevices(diagram([part(UNO, 'arduino-uno')]), defs, new Map([['uno:d13', 1]]), new Map(), FRAME)
  } catch {
    threw = true
  }
  ok('no LCD on the diagram does not throw', !threw)

  const bag = new Map<string, Record<string, unknown>>()
  threw = false
  try {
    const d = diagram([part(LCD, 'lcd-16x2')])
    stepDevices(d, defs, new Map(), bag, FRAME) // every level 'z'
    stepDevices(d, defs, new Map(), bag, FRAME)
  } catch {
    threw = true
  }
  ok('an LCD with every pin unwired does not throw', !threw)

  const s = bagOf(bag)
  const data = visualOf(s)
  console.log(`  unwired LCD -> row 0 "${data.text[0]}", cursor (${data.cursor.row},${data.cursor.col})`)
  ok('unwired LCD decodes two 16-char blank rows', data.text.length === 2 && data.text.every((l) => l.length === 16))
  ok('unwired LCD cursor is finite', Number.isFinite(data.cursor.row) && Number.isFinite(data.cursor.col))
  ok('no NaN in the LCD state', cursorOf(s) === cursorOf(s) && (s.ddram as Uint8Array).every((b) => Number.isFinite(b)))
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
