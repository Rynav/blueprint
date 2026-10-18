import { buildNets } from '@/lib/netlist'
import { allPartDefs } from '@/lib/parts'
import type { Diagram, Endpoint, PartInstance, Wire } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const defs = new Map(allPartDefs().map((d) => [d.id, d]))
const part = (id: string, def: string): PartInstance => ({
  id,
  def,
  at: { x: 0, y: 0 },
  rotation: 0,
})
const wire = (id: string, from: Endpoint, to: Endpoint): Wire => ({ id, from, to })
const diagram = (parts: PartInstance[], wires: Wire[] = []): Diagram => ({
  version: 1,
  parts,
  wires,
  notes: [],
})

// ---- two parts wired pin-to-pin share one net ----
{
  const nl = buildNets(
    diagram(
      [part('p1', 'resistor'), part('p2', 'resistor')],
      [wire('w1', { part: 'p1', pin: '1' }, { part: 'p2', pin: '1' })],
    ),
    defs,
  )
  const a = nl.netOf('p1', '1')
  const b = nl.netOf('p2', '1')
  ok('wired pins share one net', a !== undefined && a === b)
  ok('both sides agree on the net id', nl.netOf('p1', '1') === nl.netOf('p2', '1'))
  ok('the shared net holds exactly those two pins', (nl.nets.find((n) => n.id === a)?.pins.length ?? 0) === 2)
}

// ---- an unwired pin is its own single-pin net ----
{
  const nl = buildNets(diagram([part('r1', 'resistor')]), defs)
  const net = nl.nets.find((n) => n.id === nl.netOf('r1', '2'))
  ok('unwired pin is its own single-pin net', net !== undefined && net.pins.length === 1)
  ok('a resistor two pins are separate nets', nl.netOf('r1', '1') !== nl.netOf('r1', '2'))
}

// ---- breadboard column halves ----
{
  const nl = buildNets(diagram([part('bb', 'breadboard-half')]), defs)
  const same = (...pins: string[]) => pins.every((p) => nl.netOf('bb', p) === nl.netOf('bb', pins[0]))
  ok('breadboard a1/c1/e1 share a net', same('a1', 'c1', 'e1'))
  ok('breadboard f1/j1 share a net', same('f1', 'j1'))
  ok('top and bottom halves of a column are not connected', nl.netOf('bb', 'a1') !== nl.netOf('bb', 'f1'))
  ok('adjacent columns are not connected', nl.netOf('bb', 'a1') !== nl.netOf('bb', 'a2'))
  ok('breadboard has 4 rails + 60 column halves of nets', nl.nets.length === 64)
}

// ---- pushbutton internal ties ----
{
  const nl = buildNets(diagram([part('sw', 'pushbutton')]), defs)
  ok('pushbutton 1a and 1b are shorted', nl.netOf('sw', '1a') === nl.netOf('sw', '1b'))
  ok('pushbutton 2a and 2b are shorted', nl.netOf('sw', '2a') === nl.netOf('sw', '2b'))
  ok('pushbutton 1a and 2a are not connected', nl.netOf('sw', '1a') !== nl.netOf('sw', '2a'))
}

// ---- transitive merge: wires chained through a part's internal tie ----
{
  const nl = buildNets(
    diagram(
      [part('ra', 'resistor'), part('sw', 'pushbutton'), part('rc', 'resistor')],
      [
        wire('w1', { part: 'ra', pin: '1' }, { part: 'sw', pin: '1a' }),
        wire('w2', { part: 'sw', pin: '1b' }, { part: 'rc', pin: '1' }),
      ],
    ),
    defs,
  )
  const ids = new Set([
    nl.netOf('ra', '1'),
    nl.netOf('sw', '1a'),
    nl.netOf('sw', '1b'),
    nl.netOf('rc', '1'),
  ])
  ok('chained wires + internal tie merge into one net', ids.size === 1 && !ids.has(undefined))
}

// ---- robustness: dangling references and unknown part ids ----
{
  let threw = false
  let nl = buildNets(diagram([]), defs)
  try {
    nl = buildNets(
      diagram(
        [part('r1', 'resistor'), part('ghost', 'does-not-exist')],
        [
          wire('w1', { part: 'r1', pin: '1' }, { part: 'missing', pin: 'x' }),
          wire('w2', { part: 'r1', pin: 'nope' }, { part: 'ghost', pin: 'y' }),
        ],
      ),
      defs,
    )
  } catch {
    threw = true
  }
  ok('dangling wires and unknown parts do not throw', !threw)
  ok('a pin whose only wire dangles is its own net', nl.netOf('r1', '1') !== undefined)
  ok('an unknown part contributes no nets', nl.netOf('ghost', 'y') === undefined)
}

// ---- determinism ----
{
  const d = diagram(
    [part('ra', 'resistor'), part('sw', 'pushbutton'), part('bb', 'breadboard-half')],
    [wire('w1', { part: 'ra', pin: '1' }, { part: 'sw', pin: '1a' })],
  )
  const a = buildNets(d, defs)
  const b = buildNets(d, defs)
  ok(
    'two builds give identical ids and pin order',
    JSON.stringify(a.nets) === JSON.stringify(b.nets),
  )
}

// ---- empty / malformed diagrams ----
{
  const empty = buildNets(diagram([]), defs)
  ok('empty diagram yields zero nets', empty.nets.length === 0)
  ok('netOf on an empty diagram is undefined', empty.netOf('x', 'y') === undefined)

  const unknown = buildNets(diagram([part('z', 'not-a-part')]), defs)
  ok('a diagram of only unknown parts yields zero nets', unknown.nets.length === 0)
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
