import { createAvrRuntime, type AvrRuntime } from '@/lib/avr/runtime'
import { simulate, type CircuitState } from '@/lib/circuit'
import { compileSketchInline } from '@/lib/compile'
import { createDeviceHarness } from '@/lib/devices'
import { createI2cBus } from '@/lib/devices/i2c'
import { feedbackFromCircuit } from '@/lib/inputs'
import { allPartDefs } from '@/lib/parts'
import { parse } from '@/lib/persist'
import type { Diagram, PartDef } from '@/lib/types'
import { DEFAULT_SKETCH } from '@/store/simulation'

/**
 * Verifies the shipped examples. The frame loop below deliberately mirrors
 * `src/hooks/use-runner.ts` step for step, so the examples also prove the live
 * ordering: devices, internal pull-ups and the input feedback path together.
 */

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const FRAME = 16_000
const defs = new Map(allPartDefs().map((d) => [d.id, d]))

interface Scene {
  diagram: Diagram
  boardId: string
  runtime: AvrRuntime
  state: Map<string, Record<string, unknown>>
  defs: Map<string, PartDef>
}

async function openDiagram(diagram: Diagram, source: string, sensors?: string[]): Promise<Scene> {
  const board = diagram.parts.find((p) => defs.get(p.def)?.mcu)
  if (!board) throw new Error('diagram has no board')
  const def = defs.get(board.def)
  if (!def) throw new Error('diagram references an unknown board')
  const state = new Map<string, Record<string, unknown>>()
  const runtime = createAvrRuntime(board, def, { i2c: createI2cBus(diagram, defs, state) })
  const { hex } = await compileSketchInline(source, undefined, sensors)
  runtime.load(hex)
  return { diagram, boardId: board.id, runtime, state, defs }
}

async function open(jsonPath: string, source: string, sensors?: string[]): Promise<Scene> {
  return openDiagram(parse(await Bun.file(jsonPath).text()), source, sensors)
}

/** Exactly the app's frame ordering. */
function step(scene: Scene): CircuitState {
  scene.runtime.runFor(FRAME)
  // Duty over the frame just run: this is what makes a PWM pin dim rather than flicker.
  const duty = scene.runtime.pinDuty()
  const harness = createDeviceHarness(scene.diagram, scene.defs, scene.state, duty)
  const livePins = scene.runtime.pinValues()
  harness.seed(livePins)
  for (const t of scene.runtime.drainTransitions()) {
    if (harness.watched.has(t.key)) harness.applyTransition(t.key, t.value)
  }
  const pins = harness.settle(livePins, FRAME)

  const prefix = `${scene.boardId}:`
  const pullUps = new Set(scene.runtime.pullUps().filter((k) => k.startsWith(prefix)))
  const circuit = simulate(scene.diagram, scene.defs, pins, { pullUps, duty })

  const feedback = feedbackFromCircuit(scene.diagram, scene.defs, circuit.volts)
  for (const [key, level] of feedback.digital) {
    if (key.startsWith(prefix)) scene.runtime.setInputPin(key.slice(prefix.length), level)
  }
  for (const [key, volts] of feedback.analog) {
    if (key.startsWith(prefix)) scene.runtime.setAnalogPin(key.slice(prefix.length), volts)
  }
  return circuit
}

function checkFile(name: string, diagram: Diagram) {
  ok(`${name}: every part id resolves`, diagram.parts.every((p) => defs.has(p.def)))
  ok(
    `${name}: every wired pin exists on its part`,
    diagram.wires.every((w) => {
      const a = diagram.parts.find((p) => p.id === w.from.part)
      const b = diagram.parts.find((p) => p.id === w.to.part)
      return (
        !!defs.get(a?.def ?? '')?.pins.some((pin) => pin.id === w.from.pin) &&
        !!defs.get(b?.def ?? '')?.pins.some((pin) => pin.id === w.to.pin)
      )
    }),
  )
  ok(
    `${name}: every wire endpoint names a placed part`,
    diagram.wires.every(
      (w) =>
        diagram.parts.some((p) => p.id === w.from.part) &&
        diagram.parts.some((p) => p.id === w.to.part),
    ),
  )
}

// ---------------------------------------------------------------- led-bar.json
{
  const scene = await open('examples/led-bar.json', DEFAULT_SKETCH)
  checkFile('led-bar', scene.diagram)
  const leds = scene.diagram.parts.filter((p) => p.def === 'led').map((p) => p.id)

  const litPerSecond: number[] = []
  let converged = true
  for (let second = 0; second < 10; second++) {
    let lit = 0
    for (let f = 0; f < 63; f++) {
      const circuit = step(scene)
      if (!circuit.converged) converged = false
      lit = leds.filter((id) => (circuit.brightness[id] ?? 0) > 0.3).length
    }
    litPerSecond.push(lit)
  }
  console.log(`\n  led-bar lit per second: ${litPerSecond.join(', ')} of ${leds.length}\n`)

  ok('led-bar: converges throughout', converged)
  ok('led-bar: starts partly dark', litPerSecond[0] > 0 && litPerSecond[0] < leds.length)
  ok('led-bar: only ever grows', litPerSecond.every((n, i) => i === 0 || n >= litPerSecond[i - 1]))
  ok('led-bar: every LED ends lit', litPerSecond[litPerSecond.length - 1] === leds.length)
}

// ------------------------------------------------------------- button-led.json
const BUTTON_SKETCH = `#include <Arduino.h>
void setup() {
  pinMode(2, INPUT_PULLUP);
  pinMode(13, OUTPUT);
}
void loop() {
  digitalWrite(13, digitalRead(2) == LOW ? HIGH : LOW);
}
`
{
  const scene = await open('examples/button-led.json', BUTTON_SKETCH)
  checkFile('button-led', scene.diagram)
  const button = scene.diagram.parts.find((p) => p.def === 'pushbutton')
  ok('button-led: has a button and an LED', !!button && scene.diagram.parts.some((p) => p.def === 'led'))

  const setPressed = (v: number) => {
    if (button) button.params = { pressed: v }
  }
  const run = (frames: number) => {
    let circuit!: CircuitState
    for (let i = 0; i < frames; i++) circuit = step(scene)
    return circuit
  }

  setPressed(0)
  const released = run(40)
  const ledBrightness = (c: CircuitState) => c.brightness['l1'] ?? 0
  console.log(`\n  released: LED ${ledBrightness(released).toFixed(3)}, pressed:`, '...')
  ok('button-led: released leaves the LED dark', ledBrightness(released) < 0.02)

  setPressed(1)
  const pressed = run(40)
  console.log(`  pressed:  LED ${ledBrightness(pressed).toFixed(3)}\n`)
  ok('button-led: pressing the button lights the LED', ledBrightness(pressed) > 0.5)

  setPressed(0)
  const again = run(40)
  console.log(`  released again: LED ${ledBrightness(again).toFixed(3)}\n`)
  ok('button-led: releasing it turns the LED off again', ledBrightness(again) < 0.02)
}

// ----------------------------------------------------------- analogWrite fade
// Verifies the app's duty plumbing end to end: runtime.pinDuty() -> harness -> solve.
{
  const fadeDiagram: Diagram = {
    version: 1,
    parts: [
      { id: 'uno', def: 'arduino-uno', at: { x: 0, y: 0 }, rotation: 0 },
      { id: 'gnd', def: 'rail-gnd', at: { x: 320, y: 0 }, rotation: 0 },
      { id: 'r1', def: 'resistor', at: { x: 120, y: 0 }, rotation: 0 },
      { id: 'l1', def: 'led', at: { x: 220, y: 0 }, rotation: 0 },
    ],
    wires: [
      { id: 'w1', from: { part: 'uno', pin: 'd9' }, to: { part: 'r1', pin: '1' } },
      { id: 'w2', from: { part: 'r1', pin: '2' }, to: { part: 'l1', pin: 'a' } },
      { id: 'w3', from: { part: 'l1', pin: 'k' }, to: { part: 'gnd', pin: 'GND' } },
    ],
    notes: [],
  }
  const fadeSketch = (n: number) => `#include <Arduino.h>
void setup() { pinMode(9, OUTPUT); analogWrite(9, ${n}); }
void loop() { delay(100); }
`
  const brightnessAt = async (n: number) => {
    const scene = await openDiagram(fadeDiagram, fadeSketch(n))
    let circuit!: CircuitState
    for (let i = 0; i < 30; i++) circuit = step(scene)
    return circuit.brightness['l1'] ?? 0
  }
  const off = await brightnessAt(0)
  const half = await brightnessAt(128)
  const full = await brightnessAt(255)
  console.log(`\n  analogWrite fade: N=0 -> ${off.toFixed(4)}, N=128 -> ${half.toFixed(4)}, N=255 -> ${full.toFixed(4)}\n`)

  ok('fade: analogWrite(9, 0) leaves the LED dark', off < 0.02)
  ok('fade: analogWrite(9, 255) lights it fully', full > 0.5)
  ok('fade: half duty dims the LED', half > 0.02 && half < full)
}

// ------------------------------------------------- Adafruit_SSD1306 over I2C
// The toolchain only links the OLED object group when it is requested, and a part declares
// that need. Proves the sensors plumbing and the I2C bus in one go.
{
  const oledSketch = `#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(F("BLUEPRINT"));
  display.display();
}

void loop() {
  delay(100);
}
`
  const scene = await open('examples/oled-hello.json', oledSketch, ['OLED'])
  checkFile('oled-hello', scene.diagram)
  let circuit!: CircuitState
  for (let i = 0; i < 40; i++) circuit = step(scene)

  const oledDef = defs.get('ssd1306-oled')!
  const bag = scene.state.get('oled') ?? {}
  const fb = (oledDef.device!.visual!(bag).data as { fb: Uint8Array }).fb
  let lit = 0
  for (const byte of fb) for (let b = 0; b < 8; b++) if (byte & (1 << b)) lit++

  console.log(`\n  Adafruit_SSD1306 "BLUEPRINT" -> ${lit} lit pixels of ${fb.length * 8}\n`)

  ok('oled: the circuit converges with the display attached', circuit.converged)
  ok('oled: the sketch painted text onto the framebuffer', lit > 50)
  ok('oled: it did not fill the whole panel', lit < fb.length * 4)

  // Without the part declaring its link group the sketch cannot link at all, so the
  // declarative `sensors` field is load-bearing rather than cosmetic.
  let linkedWithoutSensors = true
  try {
    await compileSketchInline(oledSketch)
  } catch {
    linkedWithoutSensors = false
  }
  ok('oled: the Adafruit library does NOT link unless the part declares its group', !linkedWithoutSensors)
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
