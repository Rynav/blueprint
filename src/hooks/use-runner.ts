import { useCallback, useEffect, useRef } from 'react'

import { createAvrRuntime } from '@/lib/avr/runtime'
import { simulate } from '@/lib/circuit'
import { compileSketch } from '@/lib/compile'
import { allPartDefs, getPartDef } from '@/lib/parts'
import { useDiagram } from '@/store/diagram'
import { useSimulation } from '@/store/simulation'

/** Simulated time per animation frame, at 60 fps. */
const FRAME_MICROS = 16_000

/**
 * Compile the sketch and drive the simulated circuit one animation frame at a time.
 * Everything is read from the stores per frame, so edits to the wiring take effect live.
 */
export function useRunner() {
  const raf = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
    const sim = useSimulation.getState()
    sim.setBrightness({})
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
      sim.setStatus('running')

      const frame = () => {
        runtime.runFor(FRAME_MICROS)

        const state = simulate(useDiagram.getState().diagram, defs, runtime.pinValues())
        const live = useSimulation.getState()
        live.setBrightness(state.brightness)
        if (!state.converged) live.setMessage(state.reason ?? 'Circuit did not converge.')

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
