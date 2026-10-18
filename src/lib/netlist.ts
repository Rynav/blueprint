import type { Diagram, Endpoint, PartDef } from '@/lib/types'

export interface Net {
  id: string
  pins: Endpoint[]
}

export interface Netlist {
  nets: Net[]
  /** Net containing a pin, or undefined when the part or pin is unknown. */
  netOf(partId: string, pinId: string): string | undefined
}

// shortcut: a placed part cannot override its def's internalNets (no instance-level grouping yet); upgrade when a part needs placement-dependent internals (e.g. jumpers).
/**
 * Connectivity from two sources: each placed part's `internalNets` groups and each
 * wire's two endpoints, merged with union-find. Pins are keyed "<part>\0<pin>"; only
 * pins on a placed part are unionable, so dangling references are ignored rather than
 * fatal. Net ids come from a stable traversal (parts in diagram order, pins in def
 * order) so two builds of the same diagram produce identical ids and pin order.
 */
export function buildNets(diagram: Diagram, defs: Map<string, PartDef>): Netlist {
  const parent = new Map<string, string>()
  const key = (partId: string, pinId: string) => `${partId}\u0000${pinId}`

  // Register every pin of every placed part with a known def, in traversal order.
  const order: Endpoint[] = []
  const valid = new Set<string>()
  for (const part of diagram.parts) {
    const def = defs.get(part.def)
    if (!def) continue
    for (const pin of def.pins) {
      const k = key(part.id, pin.id)
      if (valid.has(k)) continue
      valid.add(k)
      parent.set(k, k)
      order.push({ part: part.id, pin: pin.id })
    }
  }

  const find = (k: string): string => {
    let root = k
    while (parent.get(root) !== root) root = parent.get(root)!
    for (let cur = k; cur !== root; ) {
      const next = parent.get(cur)!
      parent.set(cur, root)
      cur = next
    }
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }
  const unionPins = (a: Endpoint, b: Endpoint) => {
    const ka = key(a.part, a.pin)
    const kb = key(b.part, b.pin)
    if (valid.has(ka) && valid.has(kb)) union(ka, kb)
  }

  // (a) internal shorts declared by the part def.
  for (const part of diagram.parts) {
    const groups = defs.get(part.def)?.internalNets
    if (!groups) continue
    for (const group of groups) {
      let anchor: string | undefined
      for (const pinId of group) {
        const k = key(part.id, pinId)
        if (!valid.has(k)) continue
        if (anchor === undefined) anchor = k
        else union(anchor, k)
      }
    }
  }

  // (b) wires.
  for (const wire of diagram.wires) unionPins(wire.from, wire.to)

  // Assign ids in traversal order; a pin is never dropped, so isolated pins get their own net.
  const nets: Net[] = []
  const netById = new Map<string, Net>()
  const netOfPin = new Map<string, string>()
  for (const e of order) {
    const k = key(e.part, e.pin)
    const root = find(k)
    let net = netById.get(root)
    if (!net) {
      net = { id: `n${nets.length}`, pins: [] }
      netById.set(root, net)
      nets.push(net)
    }
    net.pins.push(e)
    netOfPin.set(k, net.id)
  }

  return { nets, netOf: (partId, pinId) => netOfPin.get(key(partId, pinId)) }
}
