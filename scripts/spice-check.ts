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

// ---- BJT: NPN common-emitter switch (saturated) ----
// Two-junction Ebers-Moll: Ic = is*(exp(Vbe/Vt) - exp(Vbc/Vt)) - (is/BR)*(exp(Vbc/Vt) - 1),
// Ib = (is/BF)*(exp(Vbe/Vt) - 1) + (is/BR)*(exp(Vbc/Vt) - 1). Base loop: (5 - Vbe)/Rb = Ib;
// collector loop: (5 - Vce)/1k = Ic. When Rb is small the base is over-driven, the
// base-collector junction forward-biases (Vbc -> Vbe), and Ic stops tracking gain*Ib: the
// device clamps its own collector current and Vce collapses toward 0. That is saturation.
const npnSwitch = (drive: number, rb: number): SpiceElement[] => [
  { kind: 'voltage', a: 'vcc', b: 'g', volts: 5 },
  { kind: 'resistor', a: 'vcc', b: 'c', ohms: 1000 },
  { kind: 'bjt', b: 'b', c: 'c', e: 'g', npn: true },
  { kind: 'voltage', a: 'drv', b: 'g', volts: drive },
  { kind: 'resistor', a: 'drv', b: 'b', ohms: rb },
]

// 1 k base resistor: the textbook switch. Vbe ~= 0.717 V => Ib ~= 4.28 mA, so gain would
// demand ~428 mA, but the 1 k collector load caps Ic at ~4.97 mA; Vce collapses to ~0.03 V.
const hardSat = solve(npnSwitch(5, 1000), { ground: 'g' })
ok('NPN 1k switch converges (hard saturated)', hardSat.converged)
ok('NPN 1k switch: no NaN', [...Object.values(hardSat.voltages), ...hardSat.currents].every(finite))
ok('NPN 1k Vce collapses near ground (0 < Vce < 0.35 V)', hardSat.voltages.c > 0 && hardSat.voltages.c < 0.35)
ok('NPN 1k Ic ~= (5 - Vce)/1k', near(hardSat.currents[2], (5 - hardSat.voltages.c) / 1000, 1e-3))
ok('NPN 1k Vbe is a forward junction (0.6-0.9 V)', hardSat.voltages.b > 0.6 && hardSat.voltages.b < 0.9)
ok('NPN 1k base current ~= (5 - Vbe)/1k', near(hardSat.currents[4], (5 - hardSat.voltages.b) / 1000, 1e-3))
ok('NPN 1k is saturated: gain*Ib exceeds Ic', 100 * hardSat.currents[4] > hardSat.currents[2])

// 10 k base resistor: still over-driven by ~0.43 mA, so still saturated but with a larger
// Vce (~0.07 V). The collector current is clamped just the same.
const midSat = solve(npnSwitch(5, 10000), { ground: 'g' })
ok('NPN 10k switch converges (saturated)', midSat.converged)
ok('NPN 10k Vce small (0 < Vce < 0.35 V)', midSat.voltages.c > 0 && midSat.voltages.c < 0.35)
ok('NPN 10k Ic ~= (5 - Vce)/1k', near(midSat.currents[2], (5 - midSat.voltages.c) / 1000, 1e-3))
ok('NPN 10k is saturated: gain*Ib exceeds Ic', 100 * midSat.currents[4] > midSat.currents[2])
ok('NPN 10k Ic/Ib is well below gain', midSat.currents[2] / midSat.currents[4] < 50)

// 90 k keeps the device just inside saturation (Ic/Ib ~= 99 of a gain of 100).
const sat = solve(npnSwitch(5, 90000), { ground: 'g' })
ok('NPN switch converges (saturated)', sat.converged)
ok('NPN saturated Vce = 0.05..0.35 V', sat.voltages.c > 0.05 && sat.voltages.c < 0.35)
ok('NPN saturated Ic ~= (5 - Vce)/1k', near(sat.currents[2], (5 - sat.voltages.c) / 1000, 1e-3))
ok('NPN saturated Ic ~= 4.7-5.0 mA', sat.currents[2] > 4.7e-3 && sat.currents[2] < 5.0e-3)
ok('NPN saturated: gain*Ib >= Ic', 100 * sat.currents[4] >= sat.currents[2])

// ---- BJT: NPN cutoff ----
// Base held at 0 V: both junctions are reverse (Vbe = 0, Vbc = -5 V), so both exponentials
// sit at ~1 and only Ic = is + is/BR ~= 2e-14 A flows. The 1e-12 S GMIN adds ~5 pA.
const off = solve(npnSwitch(0, 1000), { ground: 'g' })
ok('NPN cutoff converges', off.converged)
ok('NPN cutoff Ic < 1 uA', Math.abs(off.currents[2]) < 1e-6)

// ---- BJT: NPN active region ----
// Rb = 1M keeps Ib tiny, so the collector load never saturates: Vbe ~= 0.63 V,
// Ic ~= 4.4e-4 A, Vce ~= 4.56 V, and with Vbc strongly reverse the reverse term vanishes,
// leaving Ic = gain*Ib.
const act = solve(npnSwitch(5, 1e6), { ground: 'g' })
ok('NPN active converges', act.converged)
ok('NPN active Vce well above 0.5 V', act.voltages.c > 0.5)
ok('NPN active Ic ~= gain*Ib (+-10%)', near(act.currents[2], 100 * act.currents[4], 0.1))

// ---- BJT: PNP mirror ----
// The 1 k switch mirrored: emitter at 5 V, collector through 1 k to ground, base through
// 1 k to ground. By symmetry |Vce| and |Ic| must match the NPN 1 k case.
const pnp: SpiceElement[] = [
  { kind: 'voltage', a: 'vcc', b: 'g', volts: 5 },
  { kind: 'resistor', a: 'c', b: 'g', ohms: 1000 },
  { kind: 'bjt', b: 'b', c: 'c', e: 'vcc', npn: false },
  { kind: 'voltage', a: 'drv', b: 'g', volts: 0 },
  { kind: 'resistor', a: 'drv', b: 'b', ohms: 1000 },
]
const mir = solve(pnp, { ground: 'g' })
ok('PNP mirror converges', mir.converged)
ok('PNP mirror |Vce| small and symmetric', near(Math.abs(mir.voltages.c - 5), hardSat.voltages.c, 1e-3))
ok('PNP mirror |Ic| ~= Vc/1k', near(Math.abs(mir.currents[2]), mir.voltages.c / 1000, 1e-3))
ok('PNP mirror is saturated: gain*|Ib| exceeds |Ic|', 100 * Math.abs(mir.currents[4]) > Math.abs(mir.currents[2]))

// ---- MOSFET: N-channel switch ----
// Enhancement square law, Vth = 2.1, kp = 0.05. Gate at 5 V => Vov = 2.9 V. Triode:
// Id = kp*(Vov*Vds - Vds^2/2) = 0.145*Vds - 0.025*Vds^2. Load line Id = (5 - Vds)/1k.
// Solving gives Vds ~= 0.0345 V, Id ~= 4.97 mA, which satisfies Vds < Vov (triode).
const nmos = (vg: number): SpiceElement[] => [
  { kind: 'voltage', a: 'vdd', b: 'g', volts: 5 },
  { kind: 'resistor', a: 'vdd', b: 'd', ohms: 1000 },
  { kind: 'mosfet', g: 'vg', d: 'd', s: 'g', n: true },
  { kind: 'voltage', a: 'vg', b: 'g', volts: vg },
]
const nOn = solve(nmos(5), { ground: 'g' })
ok('N-MOS switch converges (on)', nOn.converged)
ok('N-MOS on Vds small (triode, Vds < Vgs - Vth)', nOn.voltages.d < 5 - 2.1)
ok('N-MOS on Id ~= (5 - Vds)/1k', near(nOn.currents[2], (5 - nOn.voltages.d) / 1000, 1e-3))
const nOff = solve(nmos(0), { ground: 'g' })
ok('N-MOS cutoff converges', nOff.converged)
ok('N-MOS cutoff Id < 1 uA', Math.abs(nOff.currents[2]) < 1e-6)

// ---- MOSFET: P-channel mirror ----
// Source at 5 V, drain through 1k to ground, gate at 0 V => |Vgs| = 5 V. Symmetric to
// the N-channel case: |Vsd| ~= 0.0345 V and |Id| ~= 4.97 mA, in triode.
const pmos = (vg: number): SpiceElement[] => [
  { kind: 'voltage', a: 'vcc', b: 'g', volts: 5 },
  { kind: 'resistor', a: 'd', b: 'g', ohms: 1000 },
  { kind: 'mosfet', g: 'vg', d: 'd', s: 'vcc', n: false },
  { kind: 'voltage', a: 'vg', b: 'g', volts: vg },
]
const pOn = solve(pmos(0), { ground: 'g' })
ok('P-MOS mirror converges (on)', pOn.converged)
ok('P-MOS on Vsd small (triode)', 5 - pOn.voltages.d < 5 - 2.1)
ok('P-MOS on |Id| ~= Vd/1k', near(Math.abs(pOn.currents[2]), pOn.voltages.d / 1000, 1e-3))
ok('P-MOS on |Vsd| matches N-MOS Vds', near(5 - pOn.voltages.d, nOn.voltages.d, 1e-3))
const pOff = solve(pmos(5), { ground: 'g' })
ok('P-MOS cutoff converges', pOff.converged)
ok('P-MOS cutoff |Id| < 1 uA', Math.abs(pOff.currents[2]) < 1e-6)

// ---- transistors never produce NaN over the whole drive range ----
// Sweep the base/gate from 0 to 5 V in 0.25 V steps, on the 1 k over-driven switch. Every
// solve must either converge or report a reason, and no voltage/current may be NaN or Infinity.
let sweepOk = true
const sweepBad: string[] = []
for (let v = 0; v <= 5.0001; v += 0.25) {
  const bjtAt = solve(npnSwitch(v, 1000), { ground: 'g' })
  const mosAt = solve(nmos(v), { ground: 'g' })
  const settles = (r: ReturnType<typeof solve>) =>
    (r.converged || !!r.reason) && [...Object.values(r.voltages), ...r.currents].every(finite)
  if (!settles(bjtAt)) sweepBad.push(`bjt@${v.toFixed(2)}`)
  if (!settles(mosAt)) sweepBad.push(`mos@${v.toFixed(2)}`)
  sweepOk = sweepOk && settles(bjtAt) && settles(mosAt)
}
ok('transistor drive sweep: no NaN, every solve settles or reports', sweepOk)
if (!sweepOk) console.log(`     sweep failures: ${sweepBad.join(', ')}`)

console.log(`\nLED 220 R: Vd=${led220.voltages.d.toFixed(6)} V, I=${(led220.currents[2] * 1e3).toFixed(4)} mA, iters=${led220.iterations}`)
console.log(`LED 1 k : Vd=${led1k.voltages.d.toFixed(6)} V, I=${(led1k.currents[2] * 1e3).toFixed(4)} mA, iters=${led1k.iterations}`)
console.log(`NPN 1k  : Vce=${hardSat.voltages.c.toFixed(4)} V, Ic=${(hardSat.currents[2] * 1e3).toFixed(4)} mA, Ib=${(hardSat.currents[4] * 1e3).toFixed(4)} mA, iters=${hardSat.iterations}`)
console.log(`NPN 10k : Vce=${midSat.voltages.c.toFixed(4)} V, Ic=${(midSat.currents[2] * 1e3).toFixed(4)} mA, Ib=${(midSat.currents[4] * 1e6).toFixed(2)} uA, iters=${midSat.iterations}`)
console.log(`NPN 90k : Vce=${sat.voltages.c.toFixed(4)} V, Ic=${(sat.currents[2] * 1e3).toFixed(4)} mA, Ib=${(sat.currents[4] * 1e6).toFixed(2)} uA, iters=${sat.iterations}`)
console.log(`NPN act : Vce=${act.voltages.c.toFixed(4)} V, Ic=${(act.currents[2] * 1e6).toFixed(2)} uA, iters=${act.iterations}`)
console.log(`N-MOS on: Vds=${nOn.voltages.d.toFixed(4)} V, Id=${(nOn.currents[2] * 1e3).toFixed(4)} mA, iters=${nOn.iterations}`)
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
