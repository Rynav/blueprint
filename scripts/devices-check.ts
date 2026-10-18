import { diodeFromForwardVoltage, solve } from '@/lib/spice/solve'
import type { SpiceElement } from '@/lib/spice/types'

/** Independent, hand-computed verification of the transistor device models. */

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}
const mA = (a: number) => a * 1000
const between = (v: number, lo: number, hi: number) => v >= lo && v <= hi

const red = diodeFromForwardVoltage(2.0, 0.02, 1.8, 15)

/**
 * The classic transistor switch, which is what a user actually draws:
 *   5 V --220R-- LED -->|-- collector,  emitter -- gnd,  base --1k-- 5 V
 * The base current is (5 - Vbe)/1000 ~= 4.3 mA, so with gain 100 the device *wants*
 * ~430 mA but the 220R path can only supply ~20 mA: it must saturate, Vce ~0.05-0.3 V,
 * and the LED current must be (5 - Vled - Vce)/220 ~= 13 mA. Definitely not -92 V.
 */
const bjtSwitch: SpiceElement[] = [
  { kind: 'voltage', a: 'vcc', b: 'gnd', volts: 5 },
  { kind: 'resistor', a: 'vcc', b: 'anode', ohms: 220 },
  { kind: 'diode', a: 'anode', b: 'coll', ...red },
  { kind: 'resistor', a: 'vcc', b: 'base', ohms: 1000 },
  { kind: 'bjt', b: 'base', c: 'coll', e: 'gnd', npn: true, gain: 100 },
]
const sw = solve(bjtSwitch, { ground: 'gnd' })

ok('BJT switch converges', sw.converged)
ok('BJT switch: no NaN', Object.values(sw.voltages).every(Number.isFinite))

const vce = sw.voltages.coll
const vbe = sw.voltages.base
const iLed = sw.currents[2]
const iBase = (5 - vbe) / 1000

console.log(
  `\n  BJT switch: Vbe=${vbe?.toFixed(4)} V, Vce=${vce?.toFixed(4)} V, ` +
    `Ic=${mA(iLed).toFixed(2)} mA, Ib=${mA(iBase).toFixed(2)} mA\n`,
)

// Saturation: the collector must be pulled down to near ground, never driven negative.
ok('BJT switch: collector sits near ground in saturation (0 < Vce < 1 V)', vce > 0 && vce < 1)
ok('BJT switch: Vbe is a forward-biased junction (0.6-0.9 V)', between(vbe, 0.6, 0.9))
ok('BJT switch: LED current is 8-20 mA', between(mA(iLed), 8, 20))
ok('BJT switch: LED current obeys KVL (220*I + Vled + Vce == 5)', Math.abs(iLed * 220 + sw.voltages.anode - 5) < 1e-6)
ok('BJT switch: the device is saturated, so gain*Ib exceeds Ic', iBase * 100 > iLed)

// Cutoff: no base drive, no collector current.
const cutoff = solve(
  bjtSwitch.map((e) => (e.kind === 'resistor' && e.b === 'base' ? { ...e, a: 'gnd' } : e)),
  { ground: 'gnd' },
)
ok('BJT cutoff: converges', cutoff.converged)
ok('BJT cutoff: collector current is essentially zero', mA(cutoff.currents[2]) < 0.01)
ok('BJT cutoff: collector sits at the rail', cutoff.voltages.coll > 4)

// The N-MOSFET version of the same switch, for contrast.
const mosSwitch: SpiceElement[] = [
  { kind: 'voltage', a: 'vcc', b: 'gnd', volts: 5 },
  { kind: 'voltage', a: 'gate', b: 'gnd', volts: 5 },
  { kind: 'resistor', a: 'vcc', b: 'anode', ohms: 220 },
  { kind: 'diode', a: 'anode', b: 'drain', ...red },
  { kind: 'mosfet', g: 'gate', d: 'drain', s: 'gnd', n: true, vth: 2.1 },
]
const ms = solve(mosSwitch, { ground: 'gnd' })
ok('MOSFET switch converges', ms.converged)
ok('MOSFET switch: drain sits near ground (0 < Vds < 0.5 V)', ms.voltages.drain > 0 && ms.voltages.drain < 0.5)
ok('MOSFET switch: LED current is 8-20 mA', between(mA(ms.currents[3]), 8, 20))
ok('MOSFET switch: no NaN', Object.values(ms.voltages).every(Number.isFinite))

// Sweep the base drive: every point must be physical and finite.
let worstVce = -Infinity
let allFinite = true
for (let v = 0; v <= 5; v += 0.25) {
  const r = solve(
    bjtSwitch.map((e) => (e.kind === 'voltage' && e.a === 'vcc' && e.b === 'base' ? { ...e, volts: v } : e)),
    { ground: 'gnd' },
  )
  if (!Object.values(r.voltages).every(Number.isFinite)) allFinite = false
  worstVce = Math.max(worstVce, r.voltages.coll)
}
ok('BJT drive sweep stays finite (0-5 V)', allFinite)
ok('BJT drive sweep never drives the collector above the rail', worstVce <= 5.000001)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
