import { createElement, StrictMode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import App from '@/App'
import { polylineMidpoint, toPath, WIRE_STUB, wirePoints } from '@/components/canvas/render'
import { pinDir, pinWorld } from '@/lib/geometry'
import { allPartDefs, getPartDef, listParts, PART_CATEGORIES } from '@/lib/parts'
import { parse, serialize } from '@/lib/persist'
import type { Vec } from '@/lib/types'
import { useDiagram } from '@/store/diagram'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

/** True if the polyline doubles back on itself (a spike), which no route should do. */
function hasReversal(pts: Vec[]): boolean {
  for (let i = 0; i + 2 < pts.length; i++) {
    const a = { x: pts[i + 1].x - pts[i].x, y: pts[i + 1].y - pts[i].y }
    const b = { x: pts[i + 2].x - pts[i + 1].x, y: pts[i + 2].y - pts[i + 1].y }
    if (a.x !== 0 && b.x !== 0 && Math.sign(a.x) !== Math.sign(b.x)) return true
    if (a.y !== 0 && b.y !== 0 && Math.sign(a.y) !== Math.sign(b.y)) return true
  }
  return false
}

function onPolyline(pts: Vec[], p: Vec): boolean {
  return pts.slice(1).some((q, i) => {
    const o = pts[i]
    const collinear = Math.abs((q.x - o.x) * (p.y - o.y) - (q.y - o.y) * (p.x - o.x)) < 1e-9
    const withinX = p.x >= Math.min(q.x, o.x) - 1e-9 && p.x <= Math.max(q.x, o.x) + 1e-9
    const withinY = p.y >= Math.min(q.y, o.y) - 1e-9 && p.y <= Math.max(q.y, o.y) + 1e-9
    return collinear && withinX && withinY
  })
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

// ---- wire routing leaves and enters along the pin's edge ----
const unoDef2 = getPartDef('arduino-uno')!
const ledDef2 = getPartDef('led')!
useDiagram.getState().clear()
const u2 = useDiagram.getState().addPart('arduino-uno', { x: 0, y: 0 })
const l2 = useDiagram.getState().addPart('led', { x: 420, y: -100 }) // above the Uno's top row
useDiagram.getState().addWire({ part: u2, pin: 'd13' }, { part: l2, pin: 'a' })
const uPart = useDiagram.getState().diagram.parts.find((p) => p.id === u2)!
const lPart = useDiagram.getState().diagram.parts.find((p) => p.id === l2)!

const A = { p: pinWorld(uPart, unoDef2, 'd13')!, dir: pinDir(uPart, unoDef2, 'd13')! }
const Bp = pinWorld(lPart, ledDef2, 'a')!
ok('Uno top-edge pin points outward (up)', A.dir.x === 0 && A.dir.y === -1)
ok('target sits outward of the pin', Bp.y < A.p.y)

const pts = wirePoints(A.p, A.dir, Bp)
ok('route starts on the pin', pts[0].x === A.p.x && pts[0].y === A.p.y)
ok('route ends on the pin', pts[pts.length - 1].x === Bp.x && pts[pts.length - 1].y === Bp.y)
ok(
  'wire exits straight out of the pin edge',
  pts[1].x === A.p.x && pts[1].y === A.p.y - WIRE_STUB,
)
ok(
  'every segment is axis-aligned',
  pts.slice(1).every((p, i) => p.x === pts[i].x || p.y === pts[i].y),
)
ok('route never doubles back on itself', !hasReversal(pts))
ok('one path command per point', (toPath(pts).match(/[ML]/g) ?? []).length === pts.length)
ok('label anchor lies on the routed wire', onPolyline(pts, polylineMidpoint(pts)))

// Target behind the pin: both directions would reverse, so it must fall back to the
// plain elbow instead of drawing a spike - while staying pinned and reversal-free.
const behind = { x: 430, y: 90 }
const fallback = wirePoints(A.p, A.dir, behind)
ok(
  'fallback still runs pin to pin',
  fallback[0].x === A.p.x &&
    fallback[0].y === A.p.y &&
    fallback[fallback.length - 1].x === behind.x &&
    fallback[fallback.length - 1].y === behind.y,
)
ok(
  'fallback is axis-aligned',
  fallback.slice(1).every((p, i) => p.x === fallback[i].x || p.y === fallback[i].y),
)
ok('fallback never doubles back', !hasReversal(fallback))

const rotated = { ...lPart, rotation: 90 as const }
const rdir = pinDir(rotated, ledDef2, 'a')!
ok('rotation rotates the pin direction', rdir.x === -1 && rdir.y === 0)

// A rotated part must place its pins exactly where the SVG transform draws them
// (rotate(rot, w/2, h/2) about the part centre).
const rp = pinWorld(rotated, ledDef2, 'a')!
ok(
  'rotated pin lands where the part is drawn',
  rp.x === lPart.at.x - 5 && rp.y === lPart.at.y + 15,
)
ok('rotating 180 degrees is a point reflection about the centre', (() => {
  const p180 = pinWorld({ ...lPart, rotation: 180 as const }, ledDef2, 'a')!
  return p180.x === lPart.at.x + 10 && p180.y === lPart.at.y
})())

// ---- whole-app render (palette + inspector + canvas mount, all part previews) ----
// Note: zustand reports its *initial* state during SSR, so a server render shows an
// empty canvas by design. Wire geometry is covered by the routing checks above.
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
