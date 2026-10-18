import { createAvrRuntime } from '@/lib/avr/runtime'
import { simulate } from '@/lib/circuit'
import { compileSketchInline } from '@/lib/compile'
import { createDeviceHarness } from '@/lib/devices'
import { allPartDefs, getPartDef } from '@/lib/parts'
import { parse } from '@/lib/persist'
import { DEFAULT_SKETCH } from '@/store/simulation'

/** Verifies the shipped example diagrams still import and still do what their notes claim. */

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const path = 'examples/led-bar.json'
const text = await Bun.file(path).text()
const diagram = parse(text)
const defs = new Map(allPartDefs().map((d) => [d.id, d]))

// --- the file must be self-consistent, so a typo cannot ship ---
ok('example parses', diagram.parts.length > 0)
ok('every part id resolves in the registry', diagram.parts.every((p) => defs.has(p.def)))
ok(
  'every wired pin exists on its part',
  diagram.wires.every((w) => {
    const a = diagram.parts.find((p) => p.id === w.from.part)
    const b = diagram.parts.find((p) => p.id === w.to.part)
    const da = a && defs.get(a.def)
    const db = b && defs.get(b.def)
    return (
      !!da?.pins.some((pin) => pin.id === w.from.pin) &&
      !!db?.pins.some((pin) => pin.id === w.to.pin)
    )
  }),
)
ok('every wire endpoint names a placed part', diagram.wires.every((w) =>
  diagram.parts.some((p) => p.id === w.from.part) && diagram.parts.some((p) => p.id === w.to.part),
))

// --- it must actually do something, with the default sketch and no edits ---
const { hex, fitsTarget } = await compileSketchInline(DEFAULT_SKETCH)
ok('the default sketch compiles', fitsTarget)

const board = diagram.parts.find((p) => defs.get(p.def)?.mcu)!
const runtime = createAvrRuntime(board, defs.get(board.def)!)
runtime.load(hex)
const state = new Map<string, Record<string, unknown>>()
const FRAME = 16_000
const ledIds = diagram.parts.filter((p) => p.def === 'led').map((p) => p.id)

const litPerSecond: number[] = []
let converged = true
for (let second = 0; second < 10; second++) {
  let lit = 0
  for (let frame = 0; frame < 63; frame++) {
    runtime.runFor(FRAME)
    const harness = createDeviceHarness(diagram, defs, state)
    const pins = runtime.pinValues()
    harness.seed(pins)
    for (const t of runtime.drainTransitions()) harness.applyTransition(t.key, t.value)
    const circuit = simulate(diagram, defs, harness.settle(pins, FRAME))
    if (!circuit.converged) converged = false
    lit = ledIds.filter((id) => (circuit.brightness[id] ?? 0) > 0.3).length
  }
  litPerSecond.push(lit)
}

console.log(`\n  lit LEDs per second: ${litPerSecond.join(', ')} of ${ledIds.length}\n`)

ok('the circuit converges throughout', converged)
ok('it starts partly dark', litPerSecond[0] > 0 && litPerSecond[0] < ledIds.length)
ok('the bar only ever grows', litPerSecond.every((n, i) => i === 0 || n >= litPerSecond[i - 1]))
ok('every LED ends up lit', litPerSecond[litPerSecond.length - 1] === ledIds.length)
ok('it says something within the first 3 seconds', litPerSecond[2] > litPerSecond[0])

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
