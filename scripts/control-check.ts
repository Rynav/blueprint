import { controlDown, controlDrag, inRect } from '@/lib/controls'
import type { Diagram, PartDef, PartInstance, Vec } from '@/lib/types'

/**
 * Routing a gesture onto a part's control is pure, so it is testable with synthetic defs -
 * which also keeps this check independent of the real parts (edited concurrently).
 */

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const def = (id: string, control?: PartDef['control']): PartDef => ({
  id,
  name: id,
  category: 'test',
  width: 100,
  height: 50,
  pins: [],
  render: () => null,
  control,
})

const part = (
  id: string,
  defId: string,
  at: Vec,
  rotation: 0 | 90 | 180 | 270 = 0,
): PartInstance => ({ id, def: defId, at, rotation })

const diagramOf = (...parts: PartInstance[]): Diagram => ({
  version: 1,
  parts,
  wires: [],
  notes: [],
})

/** The knob lives in local x 20..40, y 20..30; everywhere else is a miss. */
const KNOB = { x: 20, y: 20, w: 20, h: 10 }
const knob: PartDef['control'] = ({ local, phase }) =>
  inRect(local, KNOB)
    ? { param: 'value', value: phase === 'down' ? 1 : phase === 'move' ? 0.5 : 0 }
    : null

const defs = new Map<string, PartDef>([
  ['knob', def('knob', knob)],
  ['bare', def('bare')],
])
const origin = { x: 1000, y: 1000 }
// Local knob centre (30,25) -> world, worked out by hand so the check is not circular.
const onKnob = { x: 1030, y: 1025 } // rotation 0
const missKnob = { x: 1080, y: 1025 } // still inside the part box, off the knob

// ---------------------------------------------------------------- down routing
const p = part('p', 'knob', origin)
const hit = controlDown(diagramOf(p), defs, onKnob)
ok('a down on the knob is a hit', hit?.part.id === 'p')
ok(
  'the down change comes from the def',
  hit?.changes[0]?.param === 'value' && hit?.changes[0]?.value === 1,
)
ok('a down off the knob is not a hit and moves the part', controlDown(diagramOf(p), defs, missKnob) === null)

// ---------------------------------------------------------------- rotation
// worldToLocal must undo the SVG rotation about the part centre, or a rotated control
// stops answering. These worlds are the hand-computed images of local (30,25).
const r90 = part('r90', 'knob', origin, 90)
const r180 = part('r180', 'knob', origin, 180)
ok('rotation 90: the knob still answers', controlDown(diagramOf(r90), defs, { x: 1050, y: 1005 })?.part.id === 'r90')
ok('rotation 180: the knob still answers', controlDown(diagramOf(r180), defs, { x: 1070, y: 1025 })?.part.id === 'r180')
ok(
  'rotation 180: the unrotated point is now off the knob',
  controlDown(diagramOf(r180), defs, onKnob) === null,
)

// ---------------------------------------------------------------- front to back
const a = part('a', 'knob', origin)
const b = part('b', 'knob', origin)
ok('two overlapping controls: the topmost wins', controlDown(diagramOf(a, b), defs, onKnob)?.part.id === 'b')

// ---------------------------------------------------------------- transparency
const lower = part('lower', 'knob', origin)
const top = part('top', 'bare', origin)
ok(
  'a part with no control is transparent to the one underneath',
  controlDown(diagramOf(lower, top), defs, onKnob)?.part.id === 'lower',
)

// ---------------------------------------------------------------- drag phases
const seen: string[] = []
const recorder: PartDef['control'] = ({ phase }) => {
  seen.push(phase)
  return { param: 'v', value: phase === 'move' ? 0.5 : 0 }
}
const recDef = def('rec', recorder)
const recPart = part('rec', 'rec', origin)
/** A two-axis control, like a joystick: proves several parameters can arrive at once. */
const twoAxisDef: PartDef = {
  ...recDef,
  id: 'two-axis',
  control: () => [
    { param: 'x', value: 0.25 },
    { param: 'y', value: 0.75 },
  ],
}
ok('controlDrag move reaches the def with the move phase', controlDrag(recPart, recDef, onKnob, 'move')?.[0]?.value === 0.5 && seen.at(-1) === 'move')
ok('controlDrag up reaches the def with the up phase', controlDrag(recPart, recDef, onKnob, 'up')?.[0]?.value === 0 && seen.at(-1) === 'up')
ok(
  'a control may drive several parameters at once',
  controlDrag(recPart, recDef, onKnob, 'move')?.length === 1 &&
    twoAxisDef.control?.({ part: recPart, def: twoAxisDef, local: onKnob, phase: 'move' })?.length === 2,
)

// ---------------------------------------------------------------- robustness
ok(
  'an unknown def id is skipped, not thrown',
  controlDown(diagramOf(part('ghost', 'missing', origin)), defs, onKnob) === null,
)
const boom = new Map<string, PartDef>([
  [
    'boom',
    def('boom', () => {
      throw new Error('control blew up')
    }),
  ],
])
ok(
  'a control that throws yields null, not a crash',
  controlDown(diagramOf(part('x', 'boom', origin)), boom, onKnob) === null,
)
ok('a point far outside every part is null', controlDown(diagramOf(p), defs, { x: -9999, y: -9999 }) === null)
ok('no parts at all is null', controlDown(diagramOf(), defs, onKnob) === null)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
