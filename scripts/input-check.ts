/**
 * Input round-trip checks: MCU output -> nets -> solve -> read back into digitalRead/analogRead.
 * Run with `bun scripts/input-check.ts`.
 *
 * Each phase drives the loop the way the app will: feed the previous frame's solved levels
 * back into the runtime, run one 16 ms frame, solve, and capture the serial the sketch printed.
 * Assert-based, no framework, non-zero exit on failure (mirrors scripts/circuit-check.ts).
 */

import { buildFirmware } from '@horang-corp/avr-gcc-wasm'

import { createAvrRuntime } from '@/lib/avr/runtime'
import type { AvrRuntime } from '@/lib/avr/runtime'
import { simulate } from '@/lib/circuit'
import { feedbackFromCircuit } from '@/lib/inputs'
import { allPartDefs } from '@/lib/parts'
import type { Diagram, Endpoint, PartDef, PartInstance, Wire } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const defs = new Map<string, PartDef>(allPartDefs().map((d) => [d.id, d]))
const part = (id: string, def: string): PartInstance => ({ id, def, at: { x: 0, y: 0 }, rotation: 0 })
const partP = (id: string, def: string, params: Record<string, number>): PartInstance => ({
  ...part(id, def),
  params,
})
const wire = (id: string, from: Endpoint, to: Endpoint): Wire => ({ id, from, to })
const diagram = (parts: PartInstance[], wires: Wire[] = []): Diagram => ({
  version: 1,
  parts,
  wires,
  notes: [],
})
const pinOf = (key: string) => key.slice(key.indexOf(':') + 1)
const nums = (text: string): number[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(Number)
    .filter((n) => Number.isFinite(n))
const tail = (a: number[], n: number) => a.slice(Math.max(0, a.length - n))

const uno: PartInstance = { id: 'uno', def: 'arduino-uno', at: { x: 0, y: 0 }, rotation: 0 }
const unoDef = defs.get('arduino-uno')!
const runtimeOf = (hex: string): AvrRuntime => {
  const rt = createAvrRuntime(uno, unoDef)
  rt.load(hex)
  return rt
}
const FRAME_US = 16_000

interface Phase {
  serial: string
  values: number[]
  converged: boolean
  frame: number
}

/** Run `frames` frames, feeding the previous frame's solved levels back before each run. */
function runLoop(rt: AvrRuntime, d: Diagram, frames: number): Phase {
  let fb = { digital: new Map<string, 0 | 1>(), analog: new Map<string, number>() }
  let converged = false
  for (let f = 0; f < frames; f++) {
    for (const [key, level] of fb.digital) rt.setInputPin(pinOf(key), level)
    for (const [key, volts] of fb.analog) rt.setAnalogPin(pinOf(key), volts)
    rt.runFor(FRAME_US)
    const state = simulate(d, defs, rt.pinValues(), { pullUps: new Set(rt.pullUps()) })
    fb = feedbackFromCircuit(d, defs, state.volts)
    converged = state.converged
  }
  const serial = rt.serial()
  return { serial, values: nums(serial), converged, frame: rt.elapsedMicros() / FRAME_US }
}

// ---- 1. Button with an external pull-down: d2 -> 10k -> GND, 5V -> button -> d2 ----
const BUTTON = `#include <Arduino.h>

void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT);
}

void loop() {
  Serial.println(digitalRead(2));
  delay(50);
}
`
const buttonFirmware = await buildFirmware({ source: BUTTON })
ok('button sketch compiles and fits the Uno', buttonFirmware.fitsTarget === true)

const button = (pressed: number) =>
  diagram(
    [
      part('uno', 'arduino-uno'),
      part('vcc', 'rail-5v'),
      part('gnd', 'rail-gnd'),
      partP('rpd', 'resistor', { ohms: 10000 }),
      partP('sw', 'pushbutton', { pressed }),
    ],
    [
      wire('w1', { part: 'uno', pin: 'd2' }, { part: 'rpd', pin: '1' }),
      wire('w2', { part: 'rpd', pin: '2' }, { part: 'gnd', pin: 'GND' }),
      wire('w3', { part: 'vcc', pin: '5V' }, { part: 'sw', pin: '1a' }),
      wire('w4', { part: 'sw', pin: '2a' }, { part: 'uno', pin: 'd2' }),
    ],
  )

const btnRt = runtimeOf(buttonFirmware.hex)
const released = runLoop(btnRt, button(0), 60)
ok(`button released reads 0 (${JSON.stringify(released.serial.trim().split('\n').slice(-3))})`, tail(released.values, 5).length === 5 && tail(released.values, 5).every((v) => v === 0))
ok('button released captured real serial', released.values.length >= 10)

btnRt.clearSerial()
const pressed = runLoop(btnRt, button(1), 60)
ok(`button pressed reads 1 (${JSON.stringify(pressed.serial.trim().split('\n').slice(-3))})`, tail(pressed.values, 5).length === 5 && tail(pressed.values, 5).every((v) => v === 1))

// ---- 2. INPUT_PULLUP button to GND, no external resistor: the modelled internal pull-up ----
const PULLUP = `#include <Arduino.h>

void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT_PULLUP);
}

void loop() {
  Serial.println(digitalRead(2));
  delay(50);
}
`
const pullupFirmware = await buildFirmware({ source: PULLUP })
ok('INPUT_PULLUP sketch compiles and fits the Uno', pullupFirmware.fitsTarget === true)

const pullup = (pressed: number) =>
  diagram(
    [
      part('uno', 'arduino-uno'),
      part('gnd', 'rail-gnd'),
      partP('sw', 'pushbutton', { pressed }),
    ],
    [
      wire('w1', { part: 'uno', pin: 'd2' }, { part: 'sw', pin: '2a' }),
      wire('w2', { part: 'sw', pin: '1a' }, { part: 'gnd', pin: 'GND' }),
    ],
  )

const puRt = runtimeOf(pullupFirmware.hex)
const puReleased = runLoop(puRt, pullup(0), 60)
ok(
  `INPUT_PULLUP released reads 1 (internal pull-up; ${JSON.stringify(puReleased.serial.trim().split('\n').slice(-3))})`,
  tail(puReleased.values, 5).length === 5 && tail(puReleased.values, 5).every((v) => v === 1),
)
ok('runtime reports d2 pull-up active while released', puRt.pullUps().includes('uno:d2'))

puRt.clearSerial()
const puPressed = runLoop(puRt, pullup(1), 60)
ok(
  `INPUT_PULLUP pressed reads 0 (${JSON.stringify(puPressed.serial.trim().split('\n').slice(-3))})`,
  tail(puPressed.values, 5).length === 5 && tail(puPressed.values, 5).every((v) => v === 0),
)

// ---- 3. Potentiometer -> analogRead(A0) ----
const POT = `#include <Arduino.h>

void setup() {
  Serial.begin(9600);
}

void loop() {
  Serial.println(analogRead(A0));
  delay(50);
}
`
const potFirmware = await buildFirmware({ source: POT })
ok('pot sketch compiles and fits the Uno', potFirmware.fitsTarget === true)

const pot = (position: number) =>
  diagram(
    [
      part('uno', 'arduino-uno'),
      part('vcc', 'rail-5v'),
      part('gnd', 'rail-gnd'),
      partP('pot', 'potentiometer', { position }),
    ],
    [
      wire('w1', { part: 'vcc', pin: '5V' }, { part: 'pot', pin: '1' }),
      wire('w2', { part: 'pot', pin: '2' }, { part: 'uno', pin: 'a0' }),
      wire('w3', { part: 'pot', pin: '3' }, { part: 'gnd', pin: 'GND' }),
    ],
  )

const adcAt = async (position: number) => {
  const rt = runtimeOf(potFirmware.hex)
  const phase = runLoop(rt, pot(position), 50)
  return { ...phase, adc: tail(phase.values, 3) }
}
const mid = await adcAt(0.5)
const lo = await adcAt(0)
const hi = await adcAt(1)
console.log(`ADC at position 0.5: ${JSON.stringify(mid.adc)}  (serial tail: ${JSON.stringify(mid.serial.trim().split('\n').slice(-3))})`)
console.log(`ADC at position 0.0: ${JSON.stringify(lo.adc)}`)
console.log(`ADC at position 1.0: ${JSON.stringify(hi.adc)}`)
ok('analogRead(A0) at position 0.5 is ~512 (+-40)', mid.adc.length === 3 && mid.adc.every((v) => Math.abs(v - 512) <= 40))
// The repo's potentiometer model ties the wiper to pin 1 at position 0 (circuit-check.ts:
// "position 0 -> wiper tied to pin 1 (~5 V)"), so with 5 V on pin 1 the endpoints are full
// scale at 0 and zero at 1 - the reverse of the brief's wording.
ok('analogRead(A0) at position 0 is ~1023 (wiper at the 5 V end)', lo.adc.length === 3 && lo.adc.every((v) => v >= 1015))
ok('analogRead(A0) at position 1 is ~0 (wiper at the GND end)', hi.adc.length === 3 && hi.adc.every((v) => v <= 5))

// ---- 4. No self-fight: an OUTPUT pin wired elsewhere keeps what it drives ----
const BLINK = `#include <Arduino.h>

void setup() {
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);
}

void loop() {
  delay(50);
}
`
const blinkFirmware = await buildFirmware({ source: BLINK })
const led = diagram(
  [part('uno', 'arduino-uno'), partP('r1', 'resistor', { ohms: 220 }), part('d1', 'led'), part('gnd', 'rail-gnd')],
  [
    wire('w1', { part: 'uno', pin: 'd13' }, { part: 'r1', pin: '1' }),
    wire('w2', { part: 'r1', pin: '2' }, { part: 'd1', pin: 'a' }),
    wire('w3', { part: 'd1', pin: 'k' }, { part: 'gnd', pin: 'GND' }),
  ],
)
const ledRt = runtimeOf(blinkFirmware.hex)
const ledPhase = runLoop(ledRt, led, 30)
const ledState = simulate(led, defs, ledRt.pinValues(), { pullUps: new Set(ledRt.pullUps()) })
ok(`an OUTPUT pin still lights its LED (brightness ${ledState.brightness.d1?.toFixed(3)})`, ledPhase.converged && ledState.brightness.d1 > 0.4)
ledRt.setInputPin('d13', 0) // must be ignored: the MCU drives this pin
ok('setInputPin on a driven OUTPUT pin is a no-op', ledRt.pinValues().get('uno:d13') === 1)

// ---- 5. Robustness: unknown pins ignored, unwired pin omitted, no NaN ----
let threw = false
try {
  ledRt.setAnalogPin('nonsense', 3)
  ledRt.setInputPin('nonsense', 1)
} catch {
  threw = true
}
ok('setAnalogPin/setInputPin for an unknown pin are ignored', !threw)

const unwired = diagram(
  [part('uno', 'arduino-uno'), part('gnd', 'rail-gnd')],
  [wire('w1', { part: 'uno', pin: 'gnd1' }, { part: 'gnd', pin: 'GND' })],
)
const unwiredState = simulate(unwired, defs, ledRt.pinValues())
const unwiredFb = feedbackFromCircuit(unwired, defs, unwiredState.volts)
ok('unwired input pin (d9) is omitted from feedback', !unwiredFb.digital.has('uno:d9') && !unwiredFb.analog.has('uno:d9'))
ok('a diagram with an unwired MCU pin does not throw', unwiredState.converged)

const floating = diagram(
  [part('vcc', 'rail-5v'), part('r1', 'resistor'), part('gnd', 'rail-gnd')],
  [wire('w1', { part: 'vcc', pin: '5V' }, { part: 'r1', pin: '1' })],
)
const floatState = simulate(floating, defs, new Map())
ok('a floating net produces no NaN', floatState.converged && Object.values(floatState.volts).every(Number.isFinite))

console.log(
  `\nbutton released serial (first 20 lines):\n${released.serial.split('\n').slice(0, 20).join('|')}\nbutton pressed serial (first 20 lines):\n${pressed.serial.split('\n').slice(0, 20).join('|')}`,
)
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
