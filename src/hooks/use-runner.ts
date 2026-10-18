import { useCallback, useEffect, useRef } from 'react'

import { createAvrRuntime } from '@/lib/avr/runtime'
import { simulate } from '@/lib/circuit'
import { compileSketch } from '@/lib/compile'
import { createDeviceHarness } from '@/lib/devices'
import { feedbackFromCircuit } from '@/lib/inputs'
import { allPartDefs, getPartDef } from '@/lib/parts'
import type { PartRenderState } from '@/lib/types'
import { useDiagram } from '@/store/diagram'
import { useSimulation } from '@/store/simulation'

/** Simulated time per animation frame, at 60 fps. */
const FRAME_MICROS = 16_000

/**
 * Compile the sketch and drive the simulated circuit one animation frame at a time:
 * step the CPU, let peripheral devices read its pins and drive their own, solve the
 * analog circuit, then publish per-part render state for the canvas.
 */
export function useRunner() {
  const raf = useRef<number | null>(null)
  /** Per-part device state bags. Lives for one run; cleared on start/stop. */
  const deviceState = useRef(new Map<string, Record<string, unknown>>())

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    deviceState.current.clear()
    const sim = useSimulation.getState()
    sim.setPartState({})
    sim.setStatus('ready')
  }, [])

  const start = useCallback(async () => {
    stop()
    const sim = useSimulation.getState()
    sim.setMessage('')
    sim.setStatus('compiling')

    try {
      const { hex, fitsTarget } = await compileSketch(sim.source, '/avr/')
      if (!fitsTarget) {
        sim.setStatus('error')
        sim.setMessage("Sketch does not fit the board's flash.")
        return
      }

      const board = useDiagram.getState().diagram.parts.find((p) => getPartDef(p.def)?.mcu)
      const def = board && getPartDef(board.def)
      if (!board || !def) {
        sim.setStatus('error')
        sim.setMessage('Add a board to the canvas before running.')
        return
      }

      const runtime = createAvrRuntime(board, def)
      runtime.load(hex)
      const defs = new Map(allPartDefs().map((d) => [d.id, d]))
      deviceState.current = new Map()
      sim.setStatus('running')

      const frame = () => {
        runtime.runFor(FRAME_MICROS)
        const diagram = useDiagram.getState().diagram

        // Devices read the MCU's pin levels and drive their own outputs into the same solve.
        // A bit-banged clock pulse is far narrower than a frame, so replay every pin edge the
        // CPU produced this frame, in order, before sampling the final levels. One harness per
        // frame: the wiring can change while the sketch runs.
        const harness = createDeviceHarness(diagram, defs, deviceState.current)
        // Seed before replaying: a pin that did not change this frame emits no transition, so
        // without the seed the first clock edge reads 'z' instead of the pin's real level.
        const livePins = runtime.pinValues()
        harness.seed(livePins)
        for (const { key, value } of runtime.drainTransitions()) {
          if (harness.watched.has(key)) harness.applyTransition(key, value)
        }
        // Analog state is only solved once per frame: intermediate solves are invisible at
        // 60 fps, and the merge below already carries the devices' final outputs.
        const pins = harness.settle(livePins, FRAME_MICROS)

        // Inputs: the chip's internal pull-ups are part of the circuit, so tell the solve
        // which pins have one active before it runs.
        const pullUps = new Set(runtime.pullUps().filter((key) => key.startsWith(`${board.id}:`)))
        const circuit = simulate(diagram, defs, pins, { pullUps })

        // Close the loop: hand the solved net voltages back to the CPU as pin levels. This
        // lands one frame late (16 ms) — the CPU has already run for this frame.
        // shortcut: one-frame input latency; run a short second slice inside the frame if a
        // sketch ever needs to see its own input change within the same frame.
        const feedback = feedbackFromCircuit(diagram, defs, circuit.volts)
        for (const [key, level] of feedback.digital) {
          if (key.startsWith(`${board.id}:`)) runtime.setInputPin(key.slice(board.id.length + 1), level)
        }
        for (const [key, volts] of feedback.analog) {
          if (key.startsWith(`${board.id}:`)) runtime.setAnalogPin(key.slice(board.id.length + 1), volts)
        }

        const partState: Record<string, PartRenderState> = {}
        for (const [id, brightness] of Object.entries(circuit.brightness)) partState[id] = { brightness }
        for (const part of diagram.parts) {
          const visual = defs.get(part.def)?.device?.visual
          const bag = deviceState.current.get(part.id)
          if (visual && bag) partState[part.id] = { ...partState[part.id], ...visual(bag) }
        }

        const live = useSimulation.getState()
        live.setPartState(partState)
        if (!circuit.converged) live.setMessage(circuit.reason ?? 'Circuit did not converge.')

        const text = runtime.serial()
        if (text) {
          live.appendSerial(text)
          runtime.clearSerial()
        }
        raf.current = requestAnimationFrame(frame)
      }
      raf.current = requestAnimationFrame(frame)
    } catch (e) {
      const live = useSimulation.getState()
      live.setStatus('error')
      live.setMessage(e instanceof Error ? e.message : String(e))
    }
  }, [stop])

  useEffect(() => () => stop(), [stop])

  return { start, stop }
}
