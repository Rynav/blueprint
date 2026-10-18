/**
 * Dense LU factorisation with partial pivoting.
 *
 * Circuits here are minuscule (well under 200 nodes), so dense is the right call —
 * sparse bookkeeping would cost more code than it saves. The inputs are never
 * mutated; a pivot below `PIVOT_EPS` means the matrix is singular, which for MNA
 * means some node has no DC path to ground.
 */

// shortcut: fixed absolute pivot floor, revisit if element magnitudes ever drop below ~1e-9 S
const PIVOT_EPS = 1e-12

export function luSolve(A: number[][], b: number[]): { x: number[]; singular: boolean } {
  const n = b.length
  const M = A.map((row) => row.slice())
  const y = b.slice()

  for (let k = 0; k < n; k++) {
    let pivot = k
    let best = Math.abs(M[k][k])
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i][k])
      if (v > best) {
        best = v
        pivot = i
      }
    }
    if (best < PIVOT_EPS) return { x: new Array(n).fill(0), singular: true }
    if (pivot !== k) {
      const tmp = M[k]
      M[k] = M[pivot]
      M[pivot] = tmp
      const t = y[k]
      y[k] = y[pivot]
      y[pivot] = t
    }
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k]
      if (f === 0) continue
      for (let j = k; j < n; j++) M[i][j] -= f * M[k][j]
      y[i] -= f * y[k]
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let j = i + 1; j < n; j++) s -= M[i][j] * y[j]
    y[i] = s / M[i][i]
  }
  return { x: y, singular: false }
}
