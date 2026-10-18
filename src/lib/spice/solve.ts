/**
 * Modified nodal analysis (MNA) for the analog solver.
 *
 * Unknowns, in order: every non-ground node voltage, then one branch current per
 * voltage source. Ground is the single node named in `SolveOptions.ground` and is
 * pinned to 0 V by simply omitting its row/column.
 *
 * Sign convention, for every element: `currents[i]` is the current from `a` to `b`
 * *through* the element (positive = conventional current leaves the element at `b`).
 * For a resistor/diode that is `(V(a)-V(b))/R`-style, for a voltage source it is the
 * solved branch current, and for a current source that injects into `a` it is
 * `-amps` (the source pushes current out of `a`, so internally it runs `b`->`a`).
 */

import { luSolve } from './linalg'
import type { Diode, SolveOptions, SolveResult, SpiceElement } from './types'

const K_B = 1.380649e-23
const Q_E = 1.602176634e-19
const DEFAULT_TEMP_C = 25
/** Hard guard on the diode exponent, on top of junction limiting, so exp can never overflow. */
const EXP_CLAMP = 40

const thermalVoltage = (tempC: number) => (K_B * (tempC + 273.15)) / Q_E

/**
 * Derive a diode's saturation current from a *rated* forward voltage (the way LEDs are
 * specified). Uses the solver's default temperature so the pair round-trips.
 */
export function diodeFromForwardVoltage(
  vf: number,
  atAmps: number,
  n = 1.8,
  rs = 0,
): { is: number; n: number; rs: number } {
  // The rated voltage is external: the series resistance eats `atAmps * rs` of it.
  const vj = vf - atAmps * rs
  return { is: atAmps / Math.expm1(vj / (n * thermalVoltage(DEFAULT_TEMP_C))), n, rs }
}

/** SPICE's `pnjlim`: step the junction voltage by at most ~one log-step toward a forward jump. */
function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit
    }
    return vt * Math.log(vnew / vt)
  }
  return vnew
}

/**
 * Minimum conductance across a transistor's output pair, so a cut-off device still anchors
 * its collector/drain node instead of leaving the matrix singular (SPICE's GMIN).
 */
// shortcut: fixed absolute GMIN, revisit if element magnitudes approach ~1e-9 S (mirrors linalg's pivot floor)
const GMIN = 1e-12
/** Channel-length modulation on the MOSFET saturation branch; small, for convergence only. */
const LAMBDA = 0.02
/** Default reverse current gain (BR) of the base-collector junction. */
const DEFAULT_BR = 1

/**
 * Two-junction Ebers-Moll transport model. With `vbe`/`vbc` the sign-mirrored, forward-positive
 * base-emitter and base-collector voltages:
 *   Ic = is*(exp(vbe/Vt) - exp(vbc/Vt)) - (is/BR)*(exp(vbc/Vt) - 1)
 *   Ib = (is/BF)*(exp(vbe/Vt) - 1)      + (is/BR)*(exp(vbc/Vt) - 1)
 * The base-collector term is what lets the device clamp its own collector current as `Vce`
 * approaches 0 (saturation) instead of demanding `gain*Ib` forever. Returns both currents and
 * their four partials, with the diode's exp clamp on each junction.
 */
// shortcut: no Early effect or collector/emitter series resistance, so Vce(sat) sits at ~40 mV (a little ideal) and the output conductance is infinite; add them for analog accuracy
function bjtModel(
  vbe: number,
  vbc: number,
  is: number,
  bf: number,
  br: number,
  vt: number,
): { ic: number; ib: number; gcf: number; gcb: number; gbf: number; gbb: number } {
  const ebe = Math.exp(Math.min(vbe / vt, EXP_CLAMP))
  const ebc = Math.exp(Math.min(vbc / vt, EXP_CLAMP))
  const ic = is * (ebe - ebc) - (is / br) * (ebc - 1)
  const ib = (is / bf) * (ebe - 1) + (is / br) * (ebc - 1)
  const gbe = (is / vt) * ebe
  const gbc = (is / vt) * ebc
  return {
    ic,
    ib,
    gcf: gbe,
    gcb: gbc * (1 + 1 / br),
    gbf: gbe / bf,
    gbb: gbc / br,
  }
}

/**
 * Enhancement-mode square-law MOSFET. `vds >= 0` is the normal case; for `vds < 0` the
 * device is symmetric, so the terminals are swapped and the result negated. Returns Id and
 * both partials.
 */
// shortcut: square-law with a fixed LAMBDA, no subthreshold or mobility terms; add them if analog accuracy near threshold matters
function mosForward(
  vgs: number,
  vds: number,
  vth: number,
  kp: number,
): { id: number; gm: number; gds: number } {
  const vov = vgs - vth
  if (vov <= 0) return { id: 0, gm: 0, gds: 0 }
  if (vds >= vov) {
    return {
      id: 0.5 * kp * vov * vov * (1 + LAMBDA * vds),
      gm: kp * vov * (1 + LAMBDA * vds),
      gds: 0.5 * kp * vov * vov * LAMBDA,
    }
  }
  return { id: kp * (vov * vds - 0.5 * vds * vds), gm: kp * vds, gds: kp * (vov - vds) }
}

function mosDrain(
  vgs: number,
  vds: number,
  vth: number,
  kp: number,
): { id: number; gm: number; gds: number } {
  if (vds >= 0) return mosForward(vgs, vds, vth, kp)
  const r = mosForward(vgs - vds, -vds, vth, kp)
  return { id: -r.id, gm: -r.gm, gds: r.gm + r.gds }
}

/**
 * SPICE's `fetlim`: cap how far a MOSFET's gate voltage may move in one Newton step. Near
 * threshold the square-law derivative collapses, so an unlimited step can jump straight
 * across it and oscillate; this keeps each step local.
 */
function fetlim(vnew: number, vold: number, vto: number): number {
  const vtsthi = Math.abs(2 * (vold - vto)) + 2
  const vtstlo = vtsthi / 2 + 2
  const vtox = vto + 3.5
  const delv = vnew - vold
  if (vold >= vto) {
    if (vold >= vtox) {
      if (delv <= 0) {
        if (vnew >= vtox) {
          if (-delv > vtstlo) vnew = vold - vtstlo
        } else {
          vnew = Math.max(vnew, vto + 2)
        }
      } else if (delv >= vtsthi) {
        vnew = vold + vtsthi
      }
    } else {
      if (delv <= 0) {
        if (-delv > vtstlo) vnew = vold - vtstlo
      } else if (delv >= vtsthi) {
        vnew = vold + vtsthi
      }
    }
  } else {
    if (delv <= 0) {
      if (-delv > vtsthi) vnew = vold - vtsthi
    } else if (vnew > vto + 2) {
      vnew = vto + 2
    }
  }
  return vnew
}

/**
 * SPICE's `limvds`: bound how far a MOSFET's drain-source voltage may move in one Newton
 * step. In saturation the output conductance is tiny, so an unlimited step makes the drain
 * overshoot by tens of volts; clamping it keeps the drain near the operating region.
 */
function limvds(vnew: number, vold: number): number {
  if (vold >= 3.5) {
    if (vnew > vold) return Math.min(vnew, 3 * vold + 2)
    return Math.max(vnew, 2)
  }
  if (vnew > vold) return Math.min(vnew, 4)
  return Math.max(vnew, -0.5)
}

export function solve(elements: SpiceElement[], options: SolveOptions): SolveResult {
  const tempC = options.temperatureC ?? DEFAULT_TEMP_C
  const vt = thermalVoltage(tempC)
  const maxIter = options.maxIterations ?? 100
  const tol = options.tolerance ?? 1e-6

  // Nodes in order of first appearance; ground is forced in so it always shows up in `voltages`.
  const nodeIdx = new Map<string, number>()
  const nodes: string[] = []
  const touch = (name: string) => {
    if (!nodeIdx.has(name)) {
      nodeIdx.set(name, nodes.length)
      nodes.push(name)
    }
  }
  for (const el of elements) {
    switch (el.kind) {
      case 'bjt':
        touch(el.b)
        touch(el.c)
        touch(el.e)
        break
      case 'mosfet':
        touch(el.g)
        touch(el.d)
        touch(el.s)
        break
      default:
        touch(el.a)
        touch(el.b)
    }
  }
  if (!nodeIdx.has(options.ground)) touch(options.ground)

  // A diode's series resistance becomes an internal node, prefixed `#` so it can never
  // collide with a real net name. Absent when rs is 0.
  const innerNode: (string | null)[] = elements.map((el, i) => {
    if (el.kind === 'diode' && el.rs !== undefined && el.rs > 0) {
      const name = `#d${i}`
      touch(name)
      return name
    }
    return null
  })

  const gIdx = nodeIdx.get(options.ground)!
  const unknownNodes: number[] = []
  for (let k = 0; k < nodes.length; k++) if (k !== gIdx) unknownNodes.push(k)
  const rowOf = new Map<number, number>()
  unknownNodes.forEach((n, r) => rowOf.set(n, r))
  const u = (node: number) => rowOf.get(node) ?? -1 // -1 == ground: no row/column

  // One branch-current unknown per voltage source, numbered after the node unknowns.
  const vcol = new Array<number>(elements.length).fill(-1)
  let next = unknownNodes.length
  elements.forEach((el, i) => {
    if (el.kind === 'voltage') vcol[i] = next++
  })
  const size = next

  const stampG = (A: number[][], a: number, b: number, g: number) => {
    if (a >= 0) A[a][a] += g
    if (b >= 0) A[b][b] += g
    if (a >= 0 && b >= 0) {
      A[a][b] -= g
      A[b][a] -= g
    }
  }

  // Linearise each diode's Shockley junction around `vlin` (its last junction voltage).
  const diodeState = elements.map((el, i) => {
    if (el.kind !== 'diode') return null
    const ja = innerNode[i] ? nodeIdx.get(innerNode[i]!)! : nodeIdx.get(el.a)!
    return { ja, jb: nodeIdx.get(el.b)!, rs: el.rs && el.rs > 0 ? el.rs : 0 }
  })
  const vlin = new Array<number>(elements.length).fill(0)

  // BJT mirrored sign: +1 NPN (Vbe = Vb-Ve, Vbc = Vb-Vc), -1 PNP, so both junction
  // exponentials cover either polarity. `vbeLin`/`vbcLin` are the last (pnjlim-limited)
  // base-emitter and base-collector voltages.
  const bjtState = elements.map((el) => {
    if (el.kind !== 'bjt') return null
    return {
      b: nodeIdx.get(el.b)!,
      c: nodeIdx.get(el.c)!,
      e: nodeIdx.get(el.e)!,
      s: el.npn ? 1 : -1,
      is: el.is ?? 1e-14,
      gain: el.gain ?? 100,
      br: el.gainReverse ?? DEFAULT_BR,
    }
  })
  // MOSFET mirrored sign: +1 N-channel, -1 P-channel; `vgsLin`/`vdsLin` are the last
  // (fetlim-limited) gate-source and drain-source voltages.
  const mosState = elements.map((el) => {
    if (el.kind !== 'mosfet') return null
    return {
      g: nodeIdx.get(el.g)!,
      d: nodeIdx.get(el.d)!,
      s: nodeIdx.get(el.s)!,
      sign: el.n ? 1 : -1,
      vth: el.vth ?? 2.1,
      kp: el.kp ?? 0.05,
    }
  })
  const vbeLin = new Array<number>(elements.length).fill(0)
  const vbcLin = new Array<number>(elements.length).fill(0)
  const vgsLin = new Array<number>(elements.length).fill(0)
  const vdsLin = new Array<number>(elements.length).fill(0)

  const assemble = () => {
    const A: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0))
    const rhs = new Array<number>(size).fill(0)

    elements.forEach((el, i) => {
      switch (el.kind) {
        case 'resistor':
          stampG(A, u(nodeIdx.get(el.a)!), u(nodeIdx.get(el.b)!), 1 / el.ohms)
          break
        case 'switch': {
          const r = el.closed ? el.rClosed ?? 1e-3 : el.rOpen ?? 1e9
          stampG(A, u(nodeIdx.get(el.a)!), u(nodeIdx.get(el.b)!), 1 / r)
          break
        }
        case 'current': {
          const a = u(nodeIdx.get(el.a)!)
          const b = u(nodeIdx.get(el.b)!)
          if (a >= 0) rhs[a] += el.amps
          if (b >= 0) rhs[b] -= el.amps
          break
        }
        case 'voltage': {
          const col = vcol[i]
          const a = u(nodeIdx.get(el.a)!)
          const b = u(nodeIdx.get(el.b)!)
          if (a >= 0) {
            A[a][col] += 1
            A[col][a] += 1
          }
          if (b >= 0) {
            A[b][col] -= 1
            A[col][b] -= 1
          }
          rhs[col] = el.volts
          break
        }
        case 'diode': {
          const st = diodeState[i]!
          const e = Math.exp(Math.min(vlin[i] / (el.n * vt), EXP_CLAMP))
          const id = el.is * (e - 1)
          const gd = (el.is / (el.n * vt)) * e
          const ieq = id - gd * vlin[i]
          const a = u(st.ja)
          const b = u(st.jb)
          stampG(A, a, b, gd)
          // Companion current source carrying `ieq` from anode to cathode.
          if (a >= 0) rhs[a] -= ieq
          if (b >= 0) rhs[b] += ieq
          if (st.rs > 0) {
            const outer = u(nodeIdx.get(el.a)!)
            if (outer >= 0) A[outer][outer] += 1 / st.rs
            if (a >= 0) A[a][a] += 1 / st.rs
            if (outer >= 0 && a >= 0) {
              A[outer][a] -= 1 / st.rs
              A[a][outer] -= 1 / st.rs
            }
          }
          break
        }
        case 'bjt': {
          // Two-junction three-port linearised at (vbeLin, vbcLin). Terminal currents (out of
          // each node, into the device) are Jc = s*Ic, Jb = s*Ib, Je = -(Jc+Jb). Both junction
          // voltages control every port, so each row gets four conductances:
          //   Jc on (Vb,Vc,Ve) = (gcf-gcb, gcb, -gcf)
          //   Jb on (Vb,Vc,Ve) = (gbf+gbb, -gbb, -gbf)
          const st = bjtState[i]!
          const { ic, ib, gcf, gcb, gbf, gbb } = bjtModel(
            vbeLin[i],
            vbcLin[i],
            st.is,
            st.gain,
            st.br,
            vt,
          )
          const s = st.s
          const cJcB = gcf - gcb
          const cJbB = gbf + gbb
          const ieqC = s * (ic - gcf * vbeLin[i] + gcb * vbcLin[i])
          const ieqB = s * (ib - gbf * vbeLin[i] - gbb * vbcLin[i])
          const ieqE = -(ieqC + ieqB)
          const bn = u(st.b)
          const cn = u(st.c)
          const en = u(st.e)
          if (cn >= 0) {
            if (bn >= 0) A[cn][bn] += cJcB
            A[cn][cn] += gcb
            if (en >= 0) A[cn][en] -= gcf
            rhs[cn] -= ieqC
          }
          if (bn >= 0) {
            A[bn][bn] += cJbB
            if (cn >= 0) A[bn][cn] -= gbb
            if (en >= 0) A[bn][en] -= gbf
            rhs[bn] -= ieqB
          }
          if (en >= 0) {
            if (bn >= 0) A[en][bn] -= cJcB + cJbB
            if (cn >= 0) A[en][cn] -= gcb - gbb
            A[en][en] += gcf + gbf
            rhs[en] -= ieqE
          }
          stampG(A, cn, en, GMIN)
          break
        }
        case 'mosfet': {
          // Square-law FET linearised at (vgsLin, vdsLin). Only the drain and source carry
          // current (the gate is insulated): Jd = sign*Id, Js = -sign*Id, with both Id
          // partials stamped on the g/d/s rows. The linearisation constant collapses to the
          // two stored voltages, so no per-node operating point is needed.
          const st = mosState[i]!
          const { id, gm, gds } = mosDrain(vgsLin[i], vdsLin[i], st.vth, st.kp)
          const lin = st.sign * (gm * vgsLin[i] + gds * vdsLin[i])
          const ieqD = st.sign * id - lin
          const ieqS = -st.sign * id + lin
          const gn = u(st.g)
          const dn = u(st.d)
          const sn = u(st.s)
          if (dn >= 0) {
            if (gn >= 0) A[dn][gn] += gm
            A[dn][dn] += gds
            if (sn >= 0) A[dn][sn] -= gm + gds
            rhs[dn] -= ieqD
          }
          if (sn >= 0) {
            if (gn >= 0) A[sn][gn] -= gm
            if (dn >= 0) A[sn][dn] -= gds
            A[sn][sn] += gm + gds
            rhs[sn] -= ieqS
          }
          stampG(A, dn, sn, GMIN)
          break
        }
      }
    })
    return { A, rhs }
  }

  let volt = new Array<number>(nodes.length).fill(0)
  let x: number[] = new Array<number>(size).fill(0)
  let iterations = 0
  let converged = false
  let reason: string | undefined

  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1
    const { A, rhs } = assemble()
    const res = luSolve(A, rhs)
    if (res.singular) {
      reason = 'singular matrix: a node has no DC path to ground'
      break
    }
    x = res.x
    const prev = volt
    const next = prev.slice()
    for (let k = 0; k < unknownNodes.length; k++) next[unknownNodes[k]] = x[k]

    let maxDelta = 0
    for (const n of unknownNodes) maxDelta = Math.max(maxDelta, Math.abs(next[n] - prev[n]))

    // The raw node voltages can look settled while a junction is still being clamped, so
    // every device's terminal voltage must agree with its linearisation point too.
    let devicesStable = true
    for (let i = 0; i < elements.length; i++) {
      const ds = diodeState[i]
      if (ds && Math.abs(next[ds.ja] - next[ds.jb] - vlin[i]) > tol) devicesStable = false
      const bs = bjtState[i]
      if (
        bs &&
        (Math.abs(bs.s * (next[bs.b] - next[bs.e]) - vbeLin[i]) > tol ||
          Math.abs(bs.s * (next[bs.b] - next[bs.c]) - vbcLin[i]) > tol)
      ) {
        devicesStable = false
      }
      const ms = mosState[i]
      if (
        ms &&
        (Math.abs(ms.sign * (next[ms.g] - next[ms.s]) - vgsLin[i]) > tol ||
          Math.abs(ms.sign * (next[ms.d] - next[ms.s]) - vdsLin[i]) > tol)
      ) {
        devicesStable = false
      }
    }

    volt = next
    if (maxDelta < tol && devicesStable) {
      converged = true
      break
    }

    for (let i = 0; i < elements.length; i++) {
      const ds = diodeState[i]
      if (ds) {
        const el = elements[i] as Diode
        const vcrit = vt * Math.log(vt / (Math.SQRT2 * el.is))
        vlin[i] = pnjlim(volt[ds.ja] - volt[ds.jb], vlin[i], vt, vcrit)
        continue
      }
      const bs = bjtState[i]
      if (bs) {
        const vcrit = vt * Math.log(vt / (Math.SQRT2 * bs.is))
        vbeLin[i] = pnjlim(bs.s * (volt[bs.b] - volt[bs.e]), vbeLin[i], vt, vcrit)
        vbcLin[i] = pnjlim(bs.s * (volt[bs.b] - volt[bs.c]), vbcLin[i], vt, vcrit)
        continue
      }
      const ms = mosState[i]
      if (ms) {
        vgsLin[i] = fetlim(ms.sign * (volt[ms.g] - volt[ms.s]), vgsLin[i], ms.vth)
        vdsLin[i] = limvds(ms.sign * (volt[ms.d] - volt[ms.s]), vdsLin[i])
      }
    }
  }
  if (!converged && reason === undefined) {
    reason = `Newton-Raphson did not converge within ${maxIter} iterations`
  }

  const voltages: Record<string, number> = {}
  for (let k = 0; k < nodes.length; k++) voltages[nodes[k]] = Number.isFinite(volt[k]) ? volt[k] : 0

  const currents = elements.map((el, i) => {
    const v = (node: string) => volt[nodeIdx.get(node)!]
    switch (el.kind) {
      case 'resistor':
        return (v(el.a) - v(el.b)) / el.ohms
      case 'switch':
        return (v(el.a) - v(el.b)) / (el.closed ? el.rClosed ?? 1e-3 : el.rOpen ?? 1e9)
      case 'current':
        return -el.amps
      case 'voltage':
        return x[vcol[i]]
      case 'diode': {
        const st = diodeState[i]!
        const vj = volt[st.ja] - volt[st.jb]
        return el.is * Math.expm1(Math.min(vj / (el.n * vt), EXP_CLAMP))
      }
      // For a three-terminal device there is no single axis current, so `currents[i]` is the
      // through-current at the *collector* (BJT) / *drain* (MOSFET): positive when current
      // flows c->e (NPN) or d->s (N-FET), negative for the mirrored types.
      case 'bjt': {
        const st = bjtState[i]!
        const { ic } = bjtModel(
          st.s * (v(el.b) - v(el.e)),
          st.s * (v(el.b) - v(el.c)),
          st.is,
          st.gain,
          st.br,
          vt,
        )
        return st.s * ic
      }
      case 'mosfet': {
        const st = mosState[i]!
        const id = mosDrain(
          st.sign * (v(el.g) - v(el.s)),
          st.sign * (v(el.d) - v(el.s)),
          st.vth,
          st.kp,
        ).id
        return st.sign * id
      }
    }
  })

  return { converged, iterations, voltages, currents, ...(reason ? { reason } : {}) }
}
