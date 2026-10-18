/**
 * Modified nodal analysis (MNA) element set for the analog solver.
 *
 * Nodes are opaque net-name strings; the solver never invents them. Exactly one node
 * must be designated as ground in `SolveOptions`.
 *
 * Sign convention for every element: `a` and `b` are the two terminals, and a positive
 * element current flows from `a` to `b` *through the element* (i.e. externally, in the
 * circuit). For a voltage source, `V(a) - V(b) = volts`.
 */

/** Ohmic resistor. `ohms` must be > 0. */
export interface Resistor {
  kind: 'resistor'
  a: string
  b: string
  ohms: number
}

/** Ideal voltage source holding V(a) - V(b) = volts. */
export interface VoltageSource {
  kind: 'voltage'
  a: string
  b: string
  volts: number
}

/** Ideal current source injecting `amps` into node `a` and drawing it from node `b`. */
export interface CurrentSource {
  kind: 'current'
  a: string
  b: string
  amps: number
}

/**
 * Shockley diode conducting from anode `a` to cathode `b`.
 * I = Is * (exp(Vd / (n * Vt)) - 1), with an optional series resistance `rs`.
 */
export interface Diode {
  kind: 'diode'
  a: string
  b: string
  /** Saturation current, amps. */
  is: number
  /** Ideality factor, typically 1..2. */
  n: number
  /** Optional series resistance, ohms (LEDs need ~10-30). */
  rs?: number
}

/** Two-terminal switch, modelled as a resistor so the topology never changes. */
export interface Switch {
  kind: 'switch'
  a: string
  b: string
  closed: boolean
  /** On resistance when closed. Default 1e-3. */
  rClosed?: number
  /** Off resistance when open. Default 1e9. */
  rOpen?: number
}

export type SpiceElement = Resistor | VoltageSource | CurrentSource | Diode | Switch

export interface SolveOptions {
  /** The one node held at 0 V. Must appear in the element list. */
  ground: string
  /** Newton-Raphson iteration cap. Default 100. */
  maxIterations?: number
  /** Convergence threshold on the largest node-voltage change, volts. Default 1e-6. */
  tolerance?: number
  /** Ambient temperature for the thermal voltage. Default 25. */
  temperatureC?: number
}

export interface SolveResult {
  converged: boolean
  /** Newton-Raphson iterations actually used. */
  iterations: number
  /** Node name -> volts relative to ground. Includes ground at 0. */
  voltages: Record<string, number>
  /** Current from `a` to `b` for each element, in element order, amps. */
  currents: number[]
  /** Set when `converged` is false. */
  reason?: string
}
