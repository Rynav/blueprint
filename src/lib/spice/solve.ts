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
    touch(el.a)
    touch(el.b)
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

    // The raw node voltages can look settled while a diode is still being clamped, so the
    // junction voltages must agree with their linearisation points too.
    let diodesStable = true
    for (let i = 0; i < elements.length; i++) {
      const st = diodeState[i]
      if (!st) continue
      if (Math.abs(next[st.ja] - next[st.jb] - vlin[i]) > tol) diodesStable = false
    }

    volt = next
    if (maxDelta < tol && diodesStable) {
      converged = true
      break
    }

    for (let i = 0; i < elements.length; i++) {
      const st = diodeState[i]
      if (!st) continue
      const el = elements[i] as Diode
      const vcrit = vt * Math.log(vt / (Math.SQRT2 * el.is))
      vlin[i] = pnjlim(volt[st.ja] - volt[st.jb], vlin[i], vt, vcrit)
    }
  }
  if (!converged && reason === undefined) {
    reason = `Newton-Raphson did not converge within ${maxIter} iterations`
  }

  const voltages: Record<string, number> = {}
  for (let k = 0; k < nodes.length; k++) voltages[nodes[k]] = Number.isFinite(volt[k]) ? volt[k] : 0

  const currents = elements.map((el, i) => {
    const va = volt[nodeIdx.get(el.a)!]
    const vb = volt[nodeIdx.get(el.b)!]
    switch (el.kind) {
      case 'resistor':
        return (va - vb) / el.ohms
      case 'switch':
        return (va - vb) / (el.closed ? el.rClosed ?? 1e-3 : el.rOpen ?? 1e9)
      case 'current':
        return -el.amps
      case 'voltage':
        return x[vcol[i]]
      case 'diode': {
        const st = diodeState[i]!
        const vj = volt[st.ja] - volt[st.jb]
        return el.is * Math.expm1(Math.min(vj / (el.n * vt), EXP_CLAMP))
      }
    }
  })

  return { converged, iterations, voltages, currents, ...(reason ? { reason } : {}) }
}
