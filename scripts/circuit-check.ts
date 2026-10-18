/**
 * Circuit-bridge checks: wired diagram -> simulate() -> voltages / LED brightness.
 * Run with `bun scripts/circuit-check.ts`. No AVR and no browser: diagrams are built
 * directly with the store's plain shapes.
 *
 * Style mirrors scripts/check.tsx: assert-based, no framework, non-zero exit on failure.
 */

import { simulate } from '@/lib/circuit'
import { buildNets } from '@/lib/netlist'
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
const pinValues = (...entries: [string, 0 | 1 | 'z'][]) => new Map<string, 0 | 1 | 'z'>(entries)

// ---- the Blink circuit as a diagram: 5V rail -> 220R -> LED -> GND rail ----
// Hand-checked operating point: 220*I + Vf(I) = 5 V at I ~= 14.1 mA, so brightness ~= 0.70.
const blink = diagram(
  [part('vcc', 'rail-5v'), part('r1', 'resistor'), part('d1', 'led'), part('gnd', 'rail-gnd')],
  [
    wire('w1', { part: 'vcc', pin: '5V' }, { part: 'r1', pin: '1' }),
    wire('w2', { part: 'r1', pin: '2' }, { part: 'd1', pin: 'a' }),
    wire('w3', { part: 'd1', pin: 'k' }, { part: 'gnd', pin: 'GND' }),
  ],
)
const s = simulate(blink, defs, pinValues())
ok('blink converges', s.converged)
ok('blink LED brightness ~0.70', Math.abs(s.brightness.d1 - 0.7) <= 0.05)
ok('blink current is 12-16 mA', s.current.d1 > 0.012 && s.current.d1 < 0.016)
ok('blink resistor current matches the LED', Math.abs(s.current.r1 - s.current.d1) < 1e-6)

// ---- driving the LED from an MCU pin (Thevenin: 5 V / 0 V through 30 R), not a rail ----
const mcuBlink = diagram(
  [part('uno', 'arduino-uno'), part('r1', 'resistor'), part('d1', 'led'), part('gnd', 'rail-gnd')],
  [
    wire('w1', { part: 'uno', pin: 'd13' }, { part: 'r1', pin: '1' }),
    wire('w2', { part: 'r1', pin: '2' }, { part: 'd1', pin: 'a' }),
    wire('w3', { part: 'd1', pin: 'k' }, { part: 'gnd', pin: 'GND' }),
  ],
)
const high = simulate(mcuBlink, defs, pinValues(['uno:d13', 1]))
const low = simulate(mcuBlink, defs, pinValues(['uno:d13', 0]))
const hiZ = simulate(mcuBlink, defs, pinValues(['uno:d13', 'z']))
ok('mcu d13 LOW leaves the LED dark (~0)', low.converged && low.brightness.d1 < 0.02)
ok(
  'mcu d13 HIGH lights the LED (~0.7; 30 R pin drop lowers it a little)',
  high.converged && high.brightness.d1 > 0.55 && high.brightness.d1 < 0.75,
)
ok("mcu d13 'z' leaves the LED dark (~0)", hiZ.converged && hiZ.brightness.d1 < 0.02)

// ---- no ground anywhere: reported, never thrown, no NaN ----
const noGround = diagram(
  [part('vcc', 'rail-5v'), part('r1', 'resistor')],
  [wire('w1', { part: 'vcc', pin: '5V' }, { part: 'r1', pin: '1' })],
)
const ng = simulate(noGround, defs, pinValues())
ok('no ground: converged is false', ng.converged === false)
ok('no ground: a reason is set', typeof ng.reason === 'string' && ng.reason.length > 0)
ok('no ground: no NaN in any voltage', Object.values(ng.volts).every(Number.isFinite))

// ---- a floating net must not make the solve singular (GMIN holds it) ----
const floating = diagram(
  [part('vcc', 'rail-5v'), part('r1', 'resistor'), part('gnd', 'rail-gnd')],
  [wire('w1', { part: 'vcc', pin: '5V' }, { part: 'r1', pin: '1' })], // r1.2 is wired to nothing
)
const fl = simulate(floating, defs, pinValues())
ok('floating net still converges', fl.converged)
ok('floating net voltages are finite', Object.values(fl.volts).every(Number.isFinite))

// ---- determinism: the same diagram solves identically ----
ok(
  'two solves of the same diagram are identical',
  JSON.stringify(simulate(blink, defs, pinValues())) === JSON.stringify(simulate(blink, defs, pinValues())),
)

// ---- an unknown part id is skipped, not fatal ----
const ghost = diagram(
  [part('vcc', 'rail-5v'), part('ghost', 'does-not-exist'), part('r1', 'resistor'), part('gnd', 'rail-gnd')],
  [
    wire('w1', { part: 'vcc', pin: '5V' }, { part: 'r1', pin: '1' }),
    wire('w2', { part: 'r1', pin: '2' }, { part: 'gnd', pin: 'GND' }),
  ],
)
let threw = false
let ghostState = null as ReturnType<typeof simulate> | null
try {
  ghostState = simulate(ghost, defs, pinValues())
} catch {
  threw = true
}
ok('a diagram with an unknown part id does not throw', !threw)
ok('and the rest of the circuit still solves', ghostState?.converged === true)

// ---- transistor as a switch: NPN, 5V -> 220R -> LED -> C; E -> GND; d9 -> 1k -> B ----
// d9 HIGH: Ib = (5 - 0.7)/1000 = 4.3 mA, beta 100 would allow ~430 mA but the LED branch
// caps the collector current at ~14 mA, so the LED is firmly on. d9 LOW / 'z': no base drive.
const npnSwitch = diagram(
  [
    part('vcc', 'rail-5v'),
    part('r1', 'resistor'),
    part('d1', 'led'),
    part('q1', 'npn-transistor'),
    partP('rb', 'resistor', { ohms: 1000 }),
    part('uno', 'arduino-uno'),
    part('gnd', 'rail-gnd'),
  ],
  [
    wire('w1', { part: 'vcc', pin: '5V' }, { part: 'r1', pin: '1' }),
    wire('w2', { part: 'r1', pin: '2' }, { part: 'd1', pin: 'a' }),
    wire('w3', { part: 'd1', pin: 'k' }, { part: 'q1', pin: 'c' }),
    wire('w4', { part: 'q1', pin: 'e' }, { part: 'gnd', pin: 'GND' }),
    wire('w5', { part: 'uno', pin: 'd9' }, { part: 'rb', pin: '1' }),
    wire('w6', { part: 'rb', pin: '2' }, { part: 'q1', pin: 'b' }),
  ],
)
const npnHi = simulate(npnSwitch, defs, pinValues(['uno:d9', 1]))
const npnLo = simulate(npnSwitch, defs, pinValues(['uno:d9', 0]))
const npnZ = simulate(npnSwitch, defs, pinValues(['uno:d9', 'z']))
ok('npn d9 LOW keeps the LED dark (<0.02)', npnLo.converged && npnLo.brightness.d1 < 0.02)
ok('npn d9 HIGH lights the LED (>0.4)', npnHi.converged && npnHi.brightness.d1 > 0.4)
ok("npn d9 'z' keeps the LED dark (<0.02)", npnZ.converged && npnZ.brightness.d1 < 0.02)

// ---- MOSFET switch: the same chain with nmos, gate straight off d9, no gate resistor ----
const nmosSwitch = diagram(
  [
    part('vcc', 'rail-5v'),
    part('r1', 'resistor'),
    part('d1', 'led'),
    part('q1', 'nmos'),
    part('uno', 'arduino-uno'),
    part('gnd', 'rail-gnd'),
  ],
  [
    wire('w1', { part: 'vcc', pin: '5V' }, { part: 'r1', pin: '1' }),
    wire('w2', { part: 'r1', pin: '2' }, { part: 'd1', pin: 'a' }),
    wire('w3', { part: 'd1', pin: 'k' }, { part: 'q1', pin: 'd' }),
    wire('w4', { part: 'q1', pin: 's' }, { part: 'gnd', pin: 'GND' }),
    wire('w5', { part: 'uno', pin: 'd9' }, { part: 'q1', pin: 'g' }),
  ],
)
const mosHi = simulate(nmosSwitch, defs, pinValues(['uno:d9', 1]))
const mosLo = simulate(nmosSwitch, defs, pinValues(['uno:d9', 0]))
const mosZ = simulate(nmosSwitch, defs, pinValues(['uno:d9', 'z']))
ok('nmos d9 LOW keeps the LED dark (<0.02)', mosLo.converged && mosLo.brightness.d1 < 0.02)
ok('nmos d9 HIGH lights the LED (>0.4)', mosHi.converged && mosHi.brightness.d1 > 0.4)
ok("nmos d9 'z' keeps the LED dark (<0.02)", mosZ.converged && mosZ.brightness.d1 < 0.02)

// ---- potentiometer: 5 V across pins 1 and 3; wiper 2 divides by position ----
// position 0.5 -> 2.5 V; position 0 -> wiper tied to pin 1 (~5 V); position 1 -> ~0 V.
const potDiagram = (position: number) =>
  diagram(
    [part('vcc', 'rail-5v'), part('gnd', 'rail-gnd'), partP('pot', 'potentiometer', { position })],
    [
      wire('w1', { part: 'vcc', pin: '5V' }, { part: 'pot', pin: '1' }),
      wire('w2', { part: 'pot', pin: '3' }, { part: 'gnd', pin: 'GND' }),
    ],
  )
const wiperVolts = (d: Diagram) => simulate(d, defs, pinValues()).volts[buildNets(d, defs).netOf('pot', '2')!]
ok('pot wiper at position 0.5 sits at ~2.5 V', Math.abs(wiperVolts(potDiagram(0.5)) - 2.5) <= 0.2)
ok('pot wiper at position 0 sits at ~5 V', Math.abs(wiperVolts(potDiagram(0)) - 5) <= 0.2)
ok('pot wiper at position 1 sits at ~0 V', Math.abs(wiperVolts(potDiagram(1)) - 0) <= 0.2)

// ---- thermistor: 10k top / NTC bottom divider ----
// 25 C: R = 10k -> mid = 2.5 V. 40 C: R = 10k*exp(3950*(1/313.15 - 1/298.15)) ~= 5.3k
// -> mid ~= 1.73 V: a hot NTC has less resistance, so the mid voltage drops.
const thermistorDiagram = (temperatureC: number) =>
  diagram(
    [
      part('vcc', 'rail-5v'),
      part('gnd', 'rail-gnd'),
      partP('r1', 'resistor', { ohms: 10000 }),
      partP('th', 'thermistor', { temperatureC }),
    ],
    [
      wire('w1', { part: 'vcc', pin: '5V' }, { part: 'r1', pin: '1' }),
      wire('w2', { part: 'r1', pin: '2' }, { part: 'th', pin: '1' }),
      wire('w3', { part: 'th', pin: '2' }, { part: 'gnd', pin: 'GND' }),
    ],
  )
const thermMid = (temperatureC: number) => {
  const d = thermistorDiagram(temperatureC)
  const st = simulate(d, defs, pinValues())
  return { v: st.volts[buildNets(d, defs).netOf('th', '1')!], converged: st.converged }
}
const warm = thermMid(25)
const hot = thermMid(40)
ok('thermistor divider converges cold and hot', warm.converged && hot.converged)
ok('thermistor mid is ~2.5 V at 25 C (10k/10k)', Math.abs(warm.v - 2.5) < 0.1)
ok('thermistor mid is lower at 40 C than at 25 C', hot.v < warm.v - 0.1)

// ---- RGB LED: only the red channel driven, 220 R in series ----
// 5 V through the 30 R pin + 220 R + the red diode (2.0 V @ 20 mA, 15 R) lands at ~11-12 mA.
const rgb = diagram(
  [
    part('uno', 'arduino-uno'),
    partP('r1', 'resistor', { ohms: 220 }),
    part('rgb', 'rgb-led'),
    part('gnd', 'rail-gnd'),
  ],
  [
    wire('w1', { part: 'uno', pin: 'd9' }, { part: 'r1', pin: '1' }),
    wire('w2', { part: 'r1', pin: '2' }, { part: 'rgb', pin: 'r' }),
    wire('w3', { part: 'rgb', pin: 'k' }, { part: 'gnd', pin: 'GND' }),
  ],
)
const rgbState = simulate(rgb, defs, pinValues(['uno:d9', 1]))
const rgbMa = (ch: string) => (rgbState.current[`rgb:${ch}`] ?? 0) * 1e3
ok('rgb red channel carries 10-16 mA', rgbState.converged && rgbMa('r') > 10 && rgbMa('r') < 16)
ok('rgb green channel stays dark (<0.1 mA)', rgbMa('g') < 0.1)
ok('rgb blue channel stays dark (<0.1 mA)', rgbMa('b') < 0.1)

// ---- determinism and robustness across the whole diagram set ----
const suite: [string, Diagram][] = [
  ['blink', blink],
  ['mcu blink', mcuBlink],
  ['npn switch', npnSwitch],
  ['nmos switch', nmosSwitch],
  ['pot', potDiagram(0.5)],
  ['thermistor', thermistorDiagram(40)],
  ['rgb', rgb],
]
for (const [name, d] of suite) {
  let st: ReturnType<typeof simulate> | null = null
  let threw = false
  try {
    st = simulate(d, defs, pinValues())
  } catch {
    threw = true
  }
  ok(`${name}: does not throw`, !threw)
  ok(`${name}: every voltage is finite`, !!st && Object.values(st.volts).every(Number.isFinite))
  ok(
    `${name}: solves identically twice`,
    JSON.stringify(simulate(d, defs, pinValues())) === JSON.stringify(simulate(d, defs, pinValues())),
  )
}

console.log(`\nBlink: I=${(s.current.d1 * 1e3).toFixed(2)} mA, brightness=${s.brightness.d1.toFixed(3)}`)
console.log(`MCU HIGH: I=${(high.current.d1 * 1e3).toFixed(2)} mA, brightness=${high.brightness.d1.toFixed(3)}`)
console.log(`NPN HIGH: I=${(npnHi.current.d1 * 1e3).toFixed(2)} mA, brightness=${npnHi.brightness.d1.toFixed(3)}`)
console.log(`NMOS HIGH: I=${(mosHi.current.d1 * 1e3).toFixed(2)} mA, brightness=${mosHi.brightness.d1.toFixed(3)}`)
console.log(`RGB red: I=${rgbMa('r').toFixed(2)} mA`)
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
