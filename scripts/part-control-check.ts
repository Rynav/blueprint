/**
 * Part-control checks: the mouse controls of the push button, slide switch, potentiometer
 * and joystick, plus the visuals that show their params.
 *
 * Controls are pure, so each is called with a synthetic gesture (a point in the part's own
 * local frame) and no canvas. Visuals are rendered with react-dom/server and two different
 * param values, and the first differing fragment is printed as evidence.
 * Run with `bun scripts/part-control-check.ts`.
 * Style mirrors scripts/circuit-check.ts: assert-based, non-zero exit on failure.
 */

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { potentiometer, pushbutton, slideSwitch } from '@/lib/parts/basic'
import { joystick } from '@/lib/parts/sensors'
import type { ControlChange, PartDef, PartInstance, Vec } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

// The solver reads these param names; a rename here without one there would silently
// disconnect the control, so the names are checked against the source below.
const circuitSrc = readFileSync(new URL('../src/lib/circuit.ts', import.meta.url), 'utf8')

const part = (def: PartDef, params?: Record<string, number>): PartInstance => ({
  id: `x-${def.id}`,
  def: def.id,
  at: { x: 0, y: 0 },
  rotation: 0,
  ...(params ? { params } : {}),
})

/** Call a part's control with a synthetic gesture; the control is required to exist. */
const gesture = (
  def: PartDef,
  p: PartInstance,
  local: Vec,
  phase: 'down' | 'move' | 'up',
): ControlChange | null => {
  if (!def.control) throw new Error(`${def.id} has no control`)
  return def.control({ part: p, def, local, phase })
}

const markup = (def: PartDef, params?: Record<string, number>) =>
  renderToStaticMarkup(createElement('svg', null, def.render({ part: part(def, params), def })))

/** The first place two markups differ, with a window of context, for printed evidence. */
function firstDiff(a: string, b: string): { a: string; b: string } {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  const start = Math.max(0, i - 40)
  return { a: a.slice(start, i + 60), b: b.slice(start, i + 60) }
}

const visualDiff = (def: PartDef, params0: Record<string, number>, params1: Record<string, number>) => {
  const m0 = markup(def, params0)
  const m1 = markup(def, params1)
  ok(`${def.id}: two param values render differently`, m0 !== m1)
  if (m0 !== m1) {
    const d = firstDiff(m0, m1)
    console.log(`      a: ...${d.a}...`)
    console.log(`      b: ...${d.b}...`)
  }
  return { m0, m1 }
}

console.log('--- pushbutton ---')
{
  const cap = { x: 30, y: 30 }
  const down = gesture(pushbutton, part(pushbutton), cap, 'down')
  const off = gesture(pushbutton, part(pushbutton), { x: 8, y: 8 }, 'down')
  const up = gesture(pushbutton, part(pushbutton, { pressed: 1 }), cap, 'up')
  const move = gesture(pushbutton, part(pushbutton, { pressed: 1 }), cap, 'move')
  ok('down on the cap presses (pressed = 1)', down?.param === 'pressed' && down.value === 1)
  ok('down off the cap is ignored (null)', off === null)
  ok('up releases (pressed = 0)', up?.param === 'pressed' && up.value === 0)
  ok('move does nothing (null)', move === null)
  ok('circuit.ts reads params.pressed', circuitSrc.includes('params.pressed'))

  // Defaults, then the two visual states: the cap sinks and gains a ring when pressed.
  const dflt = markup(pushbutton)
  ok('pushbutton: renders at its default without throwing', dflt.length > 0)
  ok('pushbutton: default equals an explicit pressed = 0', dflt === markup(pushbutton, { pressed: 0 }))
  visualDiff(pushbutton, { pressed: 0 }, { pressed: 1 })
}

console.log('--- slide-switch ---')
{
  const at = (position: number) => ({ x: 4 + position * 40 + 5, y: 10 })
  const down0 = gesture(slideSwitch, part(slideSwitch, { position: 0 }), at(0), 'down')
  const down1 = gesture(slideSwitch, part(slideSwitch, { position: 1 }), at(1), 'down')
  const off = gesture(slideSwitch, part(slideSwitch, { position: 0 }), at(1), 'down')
  const move = gesture(slideSwitch, part(slideSwitch, { position: 0 }), at(0), 'move')
  const up = gesture(slideSwitch, part(slideSwitch, { position: 0 }), at(0), 'up')
  ok('down latches 0 -> 1', down0?.param === 'position' && down0.value === 1)
  ok('down latches 1 -> 0', down1?.param === 'position' && down1.value === 0)
  ok('down off the slider is ignored (null)', off === null)
  ok('move does nothing (null)', move === null)
  ok('up does nothing (null)', up === null)
  ok('circuit.ts reads params.position', circuitSrc.includes('params.position'))

  // Toggle round trip, as the canvas would drive it: apply 0 -> 1, then locate the moved slider.
  const after = down0!.value
  const back = gesture(slideSwitch, part(slideSwitch, { position: after }), at(after), 'down')
  ok('down twice toggles 0 -> 1 -> 0', after === 1 && back?.value === 0)

  const dflt = markup(slideSwitch)
  ok('slide-switch: renders at its default without throwing', dflt.length > 0)
  ok('slide-switch: default equals an explicit position = 0', dflt === markup(slideSwitch, { position: 0 }))
  visualDiff(slideSwitch, { position: 0 }, { position: 1 })
}

console.log('--- potentiometer ---')
{
  const KNOB = { x: 30, y: 24 }
  // A point at `deg` clockwise from straight up, on a 12-unit radius inside the knob hotspot.
  const ray = (deg: number): Vec => {
    const rad = (deg * Math.PI) / 180
    return { x: KNOB.x + 12 * Math.sin(rad), y: KNOB.y - 12 * Math.cos(rad) }
  }
  const at = (deg: number) => gesture(potentiometer, part(potentiometer), ray(deg), 'down')
  const up_ = at(0)
  const down_ = at(180)
  const right = at(90)
  const off = gesture(potentiometer, part(potentiometer), { x: 30, y: 50 }, 'down')
  const move = gesture(potentiometer, part(potentiometer), ray(90), 'move')
  const released = gesture(potentiometer, part(potentiometer), ray(90), 'up')
  ok('straight up is one extreme (position = 0)', up_?.param === 'position' && up_.value === 0)
  ok('straight down is the other extreme (position = 1)', down_?.value === 1)
  ok('to the right is the sweep midpoint (position ~ 0.5)', right?.value === 0.5)
  ok('down off the knob is ignored (null)', off === null)
  ok('move keeps turning the pot (value set)', move?.param === 'position' && typeof move.value === 'number')
  ok('up does nothing (null)', released === null)
  ok('circuit.ts reads params.position', circuitSrc.includes('params.position'))

  let inRange = true
  for (let deg = 0; deg < 360; deg += 10) {
    const v = at(deg)?.value
    if (typeof v !== 'number' || v < 0 || v > 1) inRange = false
  }
  ok('a full circle of angles stays within 0..1', inRange)

  const dflt = markup(potentiometer)
  ok('potentiometer: renders at its default without throwing', dflt.length > 0)
  ok('potentiometer: default position 0.5 points right (rotate 90)', dflt.includes('rotate(90 30 24)'))
  visualDiff(potentiometer, { ohms: 10000, position: 0 }, { ohms: 10000, position: 1 })
}

console.log('--- joystick ---')
{
  const STICK = { x: 45, y: 36 }
  const jp = (params: Record<string, number>) => part(joystick, params)
  const right = gesture(joystick, jp({ x: 0.5, y: 0.5 }), { x: STICK.x + 25, y: STICK.y }, 'down')
  const up_ = gesture(joystick, jp({ x: 0.5, y: 0.5 }), { x: STICK.x, y: STICK.y - 25 }, 'down')
  const centre = gesture(joystick, jp({ x: 0.5, y: 0.5 }), STICK, 'down')
  const off = gesture(joystick, jp({ x: 0.5, y: 0.5 }), { x: 5, y: 5 }, 'down')
  const move = gesture(joystick, jp({ x: 0.5, y: 0.5 }), { x: STICK.x + 25, y: STICK.y }, 'move')
  const reX = gesture(joystick, jp({ x: 1, y: 0.5 }), STICK, 'up')
  const reY = gesture(joystick, jp({ x: 0.5, y: 0 }), STICK, 'up')
  const reNone = gesture(joystick, jp({ x: 0.5, y: 0.5 }), STICK, 'up')

  // A control may drive several parameters at once (a joystick's two axes), so values are
  // looked up by name rather than by position.
  const valueOf = (
    result: ControlChange | ControlChange[] | null,
    param: string,
  ): number | undefined => {
    const list = result === null ? [] : Array.isArray(result) ? result : [result]
    return list.find((c) => c.param === param)?.value
  }
  const diag = gesture(joystick, jp({ x: 0.5, y: 0.5 }), { x: STICK.x + 16, y: STICK.y + 16 }, 'move')

  ok('point right drives x near 1 (param x, value > 0.9)', (valueOf(right, 'x') ?? 0) > 0.9)
  ok('...and leaves y at its centred 0.5', valueOf(right, 'y') === 0.5)
  ok('point up drives y near 0 (param y, value < 0.1)', (valueOf(up_, 'y') ?? 1) < 0.1)
  ok('a diagonal drag moves both axes in one gesture', (valueOf(diag, 'x') ?? 0) > 0.6 && (valueOf(diag, 'y') ?? 0) > 0.6)
  ok('the exact centre sits in the dead zone (0.5)', valueOf(centre, 'x') === 0.5 && valueOf(centre, 'y') === 0.5)
  ok('down off the well is ignored (null)', off === null)
  ok('move keeps driving the stick (value set)', typeof valueOf(move, 'x') === 'number')
  ok('up re-centres x', valueOf(reX, 'x') === 0.5)
  ok(
    'up writes only the axis that is off centre',
    Array.isArray(reX) && reX.length === 1 && reX[0].param === 'x',
  )
  ok('up re-centres a y-only deflection', valueOf(reY, 'y') === 0.5)
  ok('up on a centred stick does nothing (null)', reNone === null)
  ok('circuit.ts reads params.x', circuitSrc.includes('params.x'))
  ok('circuit.ts reads params.y', circuitSrc.includes('params.y'))
  // The stick switch is not a mouse gesture here (one change carries one param, and `up`
  // must re-centre); the indicator shows it, and the solver still reads the same name.
  ok('circuit.ts reads params.pressed (the stick switch the indicator shows)', circuitSrc.includes('params.pressed'))

  const dflt = markup(joystick)
  ok('joystick: renders at its default without throwing', dflt.length > 0)
  ok(
    'joystick: default is centred (dome at 45,36) and released',
    dflt.includes('cx="45" cy="36" r="13"') && dflt === markup(joystick, { x: 0.5, y: 0.5, pressed: 0 }),
  )
  visualDiff(joystick, { x: 0, y: 0.5, pressed: 0 }, { x: 1, y: 0.5, pressed: 1 })
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
