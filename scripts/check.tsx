import { createElement, StrictMode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import App from '@/App'
import { pinWorld } from '@/lib/geometry'
import { allPartDefs, getPartDef, listParts, PART_CATEGORIES } from '@/lib/parts'
import { parse, serialize } from '@/lib/persist'
import { useDiagram } from '@/store/diagram'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

// ---- registry invariants ----
const defs = allPartDefs()
ok('registry is populated', defs.length === 15)
ok('getPartDef resolves uno', getPartDef('arduino-uno')?.pins.length === 26)
ok('getPartDef miss is undefined', getPartDef('nope') === undefined)
ok('every category is non-empty', PART_CATEGORIES.every((c) => listParts(c.id).length > 0))
ok(
  'pin ids unique within each part',
  defs.every((d) => new Set(d.pins.map((p) => p.id)).size === d.pins.length),
)
ok(
  'part ids unique',
  new Set(defs.map((d) => d.id)).size === defs.length,
)

const outOfBox: string[] = []
for (const d of defs) {
  for (const p of d.pins) {
    if (p.x < 0 || p.x > d.width || p.y < 0 || p.y > d.height) outOfBox.push(`${d.id}.${p.id}`)
  }
}
ok('all pins lie within part bounds', outOfBox.length === 0)
if (outOfBox.length) console.log('   offenders:', outOfBox.slice(0, 8).join(', '))

let renderErr = ''
ok(
  'every part renders without throwing',
  defs.every((d) => {
    try {
      const part = { id: 'x', def: d.id, at: { x: 0, y: 0 }, rotation: 0 as const }
      return renderToStaticMarkup(createElement('svg', null, d.render({ part, def: d }))).length > 0
    } catch (e) {
      renderErr = `${d.id}: ${String(e)}`
      return false
    }
  }),
)
if (renderErr) console.log('   ', renderErr)

// ---- store session ----
useDiagram.getState().clear()
const uno = useDiagram.getState().addPart('arduino-uno', { x: 0, y: 0 })
const led = useDiagram.getState().addPart('led', { x: 300, y: 0 })
ok('two parts placed', useDiagram.getState().diagram.parts.length === 2)

ok('wire connects two pins', useDiagram.getState().addWire({ part: uno, pin: '13' }, { part: led, pin: 'a' }) !== undefined)
ok('duplicate wire rejected', useDiagram.getState().addWire({ part: led, pin: 'a' }, { part: uno, pin: '13' }) === undefined)
ok('self wire rejected', useDiagram.getState().addWire({ part: uno, pin: '13' }, { part: uno, pin: '13' }) === undefined)

useDiagram.getState().rotateSelection() // fresh add leaves `led` selected
ok('rotation applied to selection', useDiagram.getState().diagram.parts.find((p) => p.id === led)!.rotation === 90)

const ledPart = useDiagram.getState().diagram.parts.find((p) => p.id === led)!
const w = pinWorld(ledPart, getPartDef('led')!, 'a')
ok('pinWorld yields finite coords after rotation', !!w && Number.isFinite(w.x) && Number.isFinite(w.y))

const beforeDelete = useDiagram.getState().diagram.parts.length
useDiagram.getState().deleteSelection()
ok(
  'delete removes the part and its dangling wire',
  useDiagram.getState().diagram.parts.length === beforeDelete - 1 &&
    useDiagram.getState().diagram.wires.length === 0,
)
useDiagram.getState().undo()
ok(
  'undo restores part and wire',
  useDiagram.getState().diagram.parts.length === beforeDelete &&
    useDiagram.getState().diagram.wires.length === 1,
)
useDiagram.getState().redo()
ok('redo re-applies the delete', useDiagram.getState().diagram.parts.length === beforeDelete - 1)
useDiagram.getState().undo()

ok(
  'history never grows unbounded',
  useDiagram.getState().past.length <= 100,
)

// ---- persistence round trip on a real diagram ----
const live = useDiagram.getState().diagram
ok('serialize/parse round-trips a live diagram', JSON.stringify(parse(serialize(live))) === JSON.stringify(live))

// ---- whole-app render (canvas + palette + inspector + all part previews) ----
try {
  const html = renderToStaticMarkup(createElement(StrictMode, null, createElement(App)))
  ok('App renders to markup', html.length > 2000)
  ok('palette previews a part name', html.includes('Arduino Uno'))
} catch (e) {
  ok('App renders to markup', false)
  console.log('   ', String(e))
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
