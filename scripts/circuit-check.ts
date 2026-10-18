/**
 * Circuit-bridge checks: wired diagram -> simulate() -> voltages / LED brightness.
 * Run with `bun scripts/circuit-check.ts`. No AVR and no browser: diagrams are built
 * directly with the store's plain shapes.
 *
 * Style mirrors scripts/check.tsx: assert-based, no framework, non-zero exit on failure.
 */

import { simulate } from '@/lib/circuit'
import { allPartDefs } from '@/lib/parts'
import type { Diagram, Endpoint, PartDef, PartInstance, Wire } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const defs = new Map<string, PartDef>(allPartDefs().map((d) => [d.id, d]))

const part = (id: string, def: string): PartInstance => ({ id, def, at: { x: 0, y: 0 }, rotation: 0 })
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

console.log(`\nBlink: I=${(s.current.d1 * 1e3).toFixed(2)} mA, brightness=${s.brightness.d1.toFixed(3)}`)
console.log(`MCU HIGH: I=${(high.current.d1 * 1e3).toFixed(2)} mA, brightness=${high.brightness.d1.toFixed(3)}`)
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
