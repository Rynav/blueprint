import { solve } from '@/lib/spice/solve'
import type { SpiceElement } from '@/lib/spice/types'

let failed = 0
const ok = (n: string, c: boolean) => {
  console.log(`${c ? 'pass' : 'FAIL'}  ${n}`)
  if (!c) failed++
}
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol
const mA = (a: number) => a * 1000

// 1) Series-parallel: 5 V -> R1 1k -> (R2 2k || R3 3k) -> gnd
//    Rpar = 2000*3000/5000 = 1200; total 2200; I = 5/2200 = 2.272727 mA
//    Vmid = 5 * 1200/2200 = 2.727273 V; I2 = Vmid/2000 = 1.363636 mA; I3 = 0.909091 mA
const sp: SpiceElement[] = [
  { kind: 'voltage', a: 'vcc', b: 'gnd', volts: 5 },
  { kind: 'resistor', a: 'vcc', b: 'mid', ohms: 1000 },
  { kind: 'resistor', a: 'mid', b: 'gnd', ohms: 2000 },
  { kind: 'resistor', a: 'mid', b: 'gnd', ohms: 3000 },
]
const r1 = solve(sp, { ground: 'gnd' })
ok('series-parallel converges', r1.converged)
ok('vcc = 5 V', near(r1.voltages.vcc, 5))
ok('mid = 2.727273 V', near(r1.voltages.mid, 2.7272727272727273, 1e-9))
ok('R1 current = 2.272727 mA', near(mA(r1.currents[1]), 2.272727272727273, 1e-9))
ok('R2 current = 1.363636 mA', near(mA(r1.currents[2]), 1.3636363636363635, 1e-9))
ok('R3 current = 0.909091 mA', near(mA(r1.currents[3]), 0.9090909090909091, 1e-9))
// KCL at 'mid': currents out (R2 + R3) must equal current in (R1)
ok('KCL holds at mid', near(r1.currents[1], r1.currents[2] + r1.currents[3], 1e-12))

// 2) Current divider: 6 mA into 2k || 3k -> V = 6mA * 1200 = 7.2 V
//    I(2k) = 3.6 mA, I(3k) = 2.4 mA
const cd: SpiceElement[] = [
  { kind: 'current', a: 'x', b: 'gnd', amps: 0.006 },
  { kind: 'resistor', a: 'x', b: 'gnd', ohms: 2000 },
  { kind: 'resistor', a: 'x', b: 'gnd', ohms: 3000 },
]
const r2 = solve(cd, { ground: 'gnd' })
ok('current divider converges', r2.converged)
ok('current divider node = 7.2 V', near(r2.voltages.x, 7.2, 1e-9))
ok('2k branch = 3.6 mA', near(mA(r2.currents[1]), 3.6, 1e-9))
ok('3k branch = 2.4 mA', near(mA(r2.currents[2]), 2.4, 1e-9))
ok('divider branches sum to the source', near(r2.currents[1] + r2.currents[2], 0.006, 1e-12))

// 3) Series-aiding sources: 5 V + 3 V across 2k -> 8 V, 4 mA
const sa: SpiceElement[] = [
  { kind: 'voltage', a: 'n1', b: 'gnd', volts: 5 },
  { kind: 'voltage', a: 'n2', b: 'n1', volts: 3 },
  { kind: 'resistor', a: 'n2', b: 'gnd', ohms: 2000 },
]
const r3 = solve(sa, { ground: 'gnd' })
ok('aiding sources converge', r3.converged)
ok('n1 = 5 V', near(r3.voltages.n1, 5, 1e-9))
ok('n2 = 8 V', near(r3.voltages.n2, 8, 1e-9))
ok('load current = 4 mA', near(mA(r3.currents[2]), 4, 1e-9))

// 4) Reversing a resistor's terminals must flip its current sign (asymmetric stamps
//    would hide here, since every circuit above is symmetric in a/b)
const fwd = solve(
  [
    { kind: 'voltage', a: 'v', b: 'gnd', volts: 5 },
    { kind: 'resistor', a: 'v', b: 'gnd', ohms: 1000 },
  ] as SpiceElement[],
  { ground: 'gnd' },
)
const rev = solve(
  [
    { kind: 'voltage', a: 'v', b: 'gnd', volts: 5 },
    { kind: 'resistor', a: 'gnd', b: 'v', ohms: 1000 },
  ] as SpiceElement[],
  { ground: 'gnd' },
)
ok('reversed terminals flip the resistor current sign', near(fwd.currents[1], -rev.currents[1], 1e-12))

// 5) The Blink circuit: KVL must hold exactly at the LED operating point
import { diodeFromForwardVoltage } from '@/lib/spice/solve'
const red = diodeFromForwardVoltage(2.0, 0.02, 1.8, 15)
const led = solve(
  [
    { kind: 'voltage', a: 'vcc', b: 'gnd', volts: 5 },
    { kind: 'resistor', a: 'vcc', b: 'anode', ohms: 220 },
    { kind: 'diode', a: 'anode', b: 'gnd', ...red },
  ] as SpiceElement[],
  { ground: 'gnd' },
)
const iLed = led.currents[2]
const vLed = led.voltages.anode
ok('LED converges', led.converged)
ok('LED: 220*I + Vf == 5 V (KVL)', near(iLed * 220 + vLed, 5, 1e-6))
ok('LED resistor current equals diode current', near(led.currents[1], iLed, 1e-12))
ok('LED current is a sane 10-16 mA', mA(iLed) > 10 && mA(iLed) < 16)
ok('LED forward voltage is approximately its rated 2 V', vLed > 1.7 && vLed < 2.05)
console.log(`\n     hand-check: I=${mA(iLed).toFixed(3)} mA, Vf=${vLed.toFixed(4)} V (rated 2.0 V @ 20 mA)`)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
