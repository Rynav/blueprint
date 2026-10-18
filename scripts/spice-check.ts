/**
 * Analog solver checks. Run with `bun scripts/spice-check.ts`.
 *
 * Every expected value is hand-computed in the comment above it. Style mirrors
 * scripts/check.tsx: assert-based, no framework, non-zero exit on failure.
 */

import { diodeFromForwardVoltage, solve } from '@/lib/spice/solve'
import type { SpiceElement } from '@/lib/spice/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}
/** Relative comparison, floored at 1e-12 so comparisons against 0 stay meaningful. */
const near = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1e-12, Math.abs(b))
const finite = (n: number) => Number.isFinite(n)

// ---- voltage divider: 10 V across 1 k + 1 k ----
// I = 10 / 2000 = 5 mA; midpoint = 10 * 1000/2000 = 5 V; the source drives 5 mA
// out of its `a` terminal, so its element current (a->b) is -5 mA.
const div = solve(
  [
    { kind: 'voltage', a: 'in', b: 'g', volts: 10 },
    { kind: 'resistor', a: 'in', b: 'mid', ohms: 1000 },
    { kind: 'resistor', a: 'mid', b: 'g', ohms: 1000 },
  ],
  { ground: 'g' },
)
ok('divider converges', div.converged)
ok('divider midpoint = 5 V', near(div.voltages.mid, 5))
ok('divider top current = 5 mA', near(div.currents[1], 5e-3))
ok('divider bottom current = 5 mA', near(div.currents[2], 5e-3))
ok('divider source current = -5 mA (delivers)', near(div.currents[0], -5e-3))

// ---- series chain: 9 V across 1 k + 2 k ----
// I = 9 / 3000 = 3 mA; node after the 1 k = 9 * 2000/3000 = 6 V.
const chain = solve(
  [
    { kind: 'voltage', a: 'in', b: 'g', volts: 9 },
    { kind: 'resistor', a: 'in', b: 'a', ohms: 1000 },
    { kind: 'resistor', a: 'a', b: 'g', ohms: 2000 },
  ],
  { ground: 'g' },
)
ok('chain current = 3 mA', near(chain.currents[1], 3e-3))
ok('chain node = 6 V', near(chain.voltages.a, 6))

// ---- parallel resistors: 1 k || 1 k from 10 V ----
// Each branch = 10/1000 = 10 mA; total drawn = 20 mA, so the source is -20 mA.
const par = solve(
  [
    { kind: 'voltage', a: 'in', b: 'g', volts: 10 },
    { kind: 'resistor', a: 'in', b: 'g', ohms: 1000 },
    { kind: 'resistor', a: 'in', b: 'g', ohms: 1000 },
  ],
  { ground: 'g' },
)
ok('parallel branch current = 10 mA each', near(par.currents[1], 1e-2) && near(par.currents[2], 1e-2))
ok('parallel total = 20 mA', near(par.currents[0], -2e-2))

// ---- current source: 1 mA into 1 k to ground ----
// V = 1 mA * 1 k = 1 V. The source injects into `a`, so internally it runs b->a:
// its element current (a->b) is -1 mA. The resistor a->b carries +1 mA.
const isrc = solve(
  [
    { kind: 'current', a: 'n', b: 'g', amps: 1e-3 },
    { kind: 'resistor', a: 'n', b: 'g', ohms: 1000 },
  ],
  { ground: 'g' },
)
ok('current source raises node to 1 V', near(isrc.voltages.n, 1))
ok('current source element current = -1 mA (sign pinned)', near(isrc.currents[0], -1e-3))
ok('resistor carries +1 mA', near(isrc.currents[1], 1e-3))

// ---- switch: open vs closed, topology unchanged ----
const swBase: SpiceElement[] = [
  { kind: 'voltage', a: 'in', b: 'g', volts: 5 },
  { kind: 'resistor', a: 'in', b: 's', ohms: 1000 },
  { kind: 'switch', a: 's', b: 'g', closed: false },
]
const swOpen = solve(swBase, { ground: 'g' })
const swClosed = solve(
  [swBase[0], swBase[1], { kind: 'switch', a: 's', b: 'g', closed: true }],
  { ground: 'g' },
)
// Open (1e9 off): I = 5 / (1000 + 1e9) ~= 5 uA. Closed (1e-3 on): I ~= 5 / 1000 = 5 mA.
ok('open switch blocks current (< 100 uA)', swOpen.converged && Math.abs(swOpen.currents[1]) < 1e-4)
ok('closed switch passes ~5 mA', swClosed.converged && near(swClosed.currents[1], 5e-3, 1e-4))
ok(
  'switch does not change topology (same node set)',
  JSON.stringify(Object.keys(swOpen.voltages).sort()) ===
    JSON.stringify(Object.keys(swClosed.voltages).sort()),
)

// ---- LED series (the Blink circuit) ----
// diodeFromForwardVoltage(2.0 V @ 20 mA, n=1.8, rs=15) => junction at 20 mA is
// 2.0 - 0.02*15 = 1.7 V, so Is = 0.02 / (exp(1.7/(1.8*0.0256927)) - 1) ~= 2.2e-18 A.
// Driven from 5 V through 220 R the operating point is ~14.1 mA: Vd(ext) ~= 1.89 V,
// junction ~= 1.68 V, drop across R = 220 * 0.0141 ~= 3.11 V, and 5 - 3.11 = 1.89 V.
const led = diodeFromForwardVoltage(2.0, 0.02, 1.8, 15)
const ledAt = (ohms: number) =>
  solve(
    [
      { kind: 'voltage', a: 'v5', b: 'g', volts: 5 },
      { kind: 'resistor', a: 'v5', b: 'd', ohms },
      { kind: 'diode', a: 'd', b: 'g', is: led.is, n: led.n, rs: led.rs },
    ],
    { ground: 'g' },
  )
const led220 = ledAt(220)
ok('LED converges', led220.converged)
ok('LED forward voltage ~1.7-2.2 V', led220.voltages.d > 1.7 && led220.voltages.d < 2.2)
ok('LED current ~11-16 mA', led220.currents[2] > 0.011 && led220.currents[2] < 0.016)
ok('LED resistor current matches diode current', near(led220.currents[1], led220.currents[2], 1e-6))
ok('LED internal node is prefixed # and finite', finite(led220.voltages['#d2'] ?? NaN))

// Current must fall as the series resistor rises (220 R -> 1 k), or the nonlinear
// solve is broken. 1 k gives ~3.3 mA.
const led1k = ledAt(1000)
ok('larger resistor => smaller LED current', led1k.converged && led1k.currents[2] < led220.currents[2])
ok('1 k gives ~3.3 mA', led1k.currents[2] > 3e-3 && led1k.currents[2] < 3.7e-3)

// ---- exponential guard ----
// A reverse-biased diode: 5 V through 1 k with the diode's cathode at the driven node,
// so the junction sits at -5 V and only the saturation current flows (~2.2e-18 A).
const rev = solve(
  [
    { kind: 'voltage', a: 'v5', b: 'g', volts: 5 },
    { kind: 'resistor', a: 'v5', b: 'd', ohms: 1000 },
    { kind: 'diode', a: 'g', b: 'd', is: led.is, n: led.n, rs: 0 },
  ],
  { ground: 'g' },
)
ok('reverse-biased diode converges', rev.converged)
ok('reverse diode is essentially off', Math.abs(rev.currents[2]) < 1e-12)

// An ideal diode straight across 5 V has no consistent operating point; Newton runs to
// the iteration cap. The exponential guard must keep it finite - no Infinity/NaN runaway.
const hard = solve(
  [
    { kind: 'voltage', a: 'v5', b: 'g', volts: 5 },
    { kind: 'diode', a: 'v5', b: 'g', is: led.is, n: led.n, rs: 0 },
  ],
  { ground: 'g' },
)
ok('ideal diode across a source never runs away to NaN', Object.values(hard.voltages).every(finite) && hard.currents.every(finite))

// ---- ground handling ----
// A resistor from ground to ground is degenerate (zero unknowns) but must stay finite.
const gg = solve([{ kind: 'resistor', a: 'g', b: 'g', ohms: 1000 }], { ground: 'g' })
ok('ground-to-ground resistor: zero current, no NaN', gg.currents[0] === 0 && Object.values(gg.voltages).every(finite))

// A floating island (no DC path to ground) is singular: it is reported, never thrown, and no NaN.
const float = solve([{ kind: 'resistor', a: 'x', b: 'y', ohms: 1000 }], { ground: 'g' })
ok('floating island is not converged', !float.converged)
ok('floating island carries a reason', typeof float.reason === 'string' && float.reason.length > 0)
ok('floating island has no NaN in voltages', Object.values(float.voltages).every(finite))

// ---- determinism ----
ok('solving twice is identical', JSON.stringify(led220) === JSON.stringify(ledAt(220)))

console.log(`\nLED 220 R: Vd=${led220.voltages.d.toFixed(6)} V, I=${(led220.currents[2] * 1e3).toFixed(4)} mA, iters=${led220.iterations}`)
console.log(`LED 1 k : Vd=${led1k.voltages.d.toFixed(6)} V, I=${(led1k.currents[2] * 1e3).toFixed(4)} mA, iters=${led1k.iterations}`)
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
