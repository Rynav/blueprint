import { useCallback, useEffect, useRef } from 'react'

import { createAvrRuntime } from '@/lib/avr/runtime'
import { simulate } from '@/lib/circuit'
import { compileSketch } from '@/lib/compile'
import { createDeviceHarness } from '@/lib/devices'
import { createI2cBus } from '@/lib/devices/i2c'
import { feedbackFromCircuit } from '@/lib/inputs'
import { buildNets } from '@/lib/netlist'
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
    sim.setVolts({})
    sim.setStatus('ready')
  }, [])

  const start = useCallback(async () => {
    stop()
    const sim = useSimulation.getState()
    sim.setMessage('')
    sim.setStatus('compiling')

    try {
      const defs = new Map(allPartDefs().map((d) => [d.id, d]))
      const diagram = useDiagram.getState().diagram
      // The toolchain only links libraries whose group is requested, and a part declares what it
      // needs, so union the groups across the diagram (a display pulls in the OLED object set).
      const sensors = [...new Set(diagram.parts.flatMap((p) => defs.get(p.def)?.sensors ?? []))]

      const { hex, fitsTarget } = await compileSketch(sim.source, '/avr/', sensors)
      if (!fitsTarget) {
        sim.setStatus('error')
        sim.setMessage("Sketch does not fit the board's flash.")
        return
      }

      const board = diagram.parts.find((p) => getPartDef(p.def)?.mcu)
      const def = board && getPartDef(board.def)
      if (!board || !def) {
        sim.setStatus('error')
        sim.setMessage('Add a board to the canvas before running.')
        return
      }

      deviceState.current = new Map()
      // The I2C bus routes controller traffic to the placed devices' own models. Built once
      // per run: adding a display mid-run needs a re-run, which the sketch needs anyway.
      const i2c = createI2cBus(diagram, defs, deviceState.current)
      const runtime = createAvrRuntime(board, def, { i2c })
      runtime.load(hex)
      sim.setStatus('running')

      const frame = () => {
        // Levels BEFORE the CPU runs are the start-of-frame state the replay must begin from.
        // Seeding with the end-of-frame values instead breaks any device that latches several
        // pins at once (a parallel LCD reading RS and data on an Enable edge).
        const startPins = runtime.pinValues()
        const diagram = useDiagram.getState().diagram

        // Netlist for this frame: used to route a device's output straight onto the MCU pins
        // that share its net, which is the fast path below.
        const nets = buildNets(diagram, defs)
        const boardPinsByNet = new Map<string, string[]>()
        for (const pin of def.pins) {
          const net = nets.netOf(board.id, pin.id)
          if (net === undefined) continue
          const list = boardPinsByNet.get(net)
          if (list) list.push(pin.id)
          else boardPinsByNet.set(net, [pin.id])
        }
        // Device outputs that land on a net the board can read, resolved once per frame so the
        // per-slice path is a couple of map lookups rather than a netlist walk.
        const outputsToBoard: { key: string; mcuPins: string[] }[] = []
        for (const part of diagram.parts) {
          const device = defs.get(part.def)?.device
          if (!device) continue
          for (const output of device.outputs) {
            const net = nets.netOf(part.id, output)
            const mcuPins = net === undefined ? undefined : boardPinsByNet.get(net)
            if (mcuPins?.length) outputsToBoard.push({ key: `${part.id}:${output}`, mcuPins })
          }
        }

        const harness = createDeviceHarness(diagram, defs, deviceState.current)

        // A `timed` device drives outputs on a microsecond timescale, so it has to be stepped
        // *inside* the frame - stepped only at its end, its pulse is born and dies unseen and
        // `pulseIn` reads a timeout. Everything else stays once-per-frame, because stepping a
        // frame-level model with a per-slice dt silently breaks it (the servo pairs a duty
        // measured over the whole frame with dt). Circuits with no timed device pay nothing.
        const timed = diagram.parts.some((p) => defs.get(p.def)?.device?.timed)
        if (timed) {
          harness.seed(startPins)
          let last = runtime.elapsedMicros()
          runtime.runFor(FRAME_MICROS, () => {
            const now = runtime.elapsedMicros()
            const dt = now - last
            last = now
            const merged = harness.tickTimed(runtime.pinValues(), dt)
            for (const { key, mcuPins } of outputsToBoard) {
              const level = merged.get(key)
              if (level !== 0 && level !== 1) continue
              for (const pinId of mcuPins) runtime.setInputPin(pinId, level)
            }
          })
        } else {
          runtime.runFor(FRAME_MICROS)
        }

        // Fraction of the frame each pin spent high. This is what lets a PWM pin dim an LED or
        // drive a motor proportionally, and what a servo will measure pulse width from.
        // Measured over the whole frame, so nothing may drain the transition window early.
        const duty = runtime.pinDuty()

        // Devices read the MCU's pin levels and drive their own outputs into the same solve.
        // A bit-banged clock pulse is far narrower than a frame, so replay every pin edge the
        // CPU produced this frame, in order, before sampling the final levels.
        harness.seed(startPins)
        for (const { key, value } of runtime.drainTransitions()) {
          if (harness.watched.has(key)) harness.applyTransition(key, value)
        }
        // Now the CPU has run, so these are the end-of-frame levels: what the solve should see.
        const livePins = runtime.pinValues()
        // Analog state is only solved once per frame: intermediate solves are invisible at
        // 60 fps, and the merge below already carries the devices' final outputs.
        const pins = harness.settle(livePins, FRAME_MICROS)

        // Inputs: the chip's internal pull-ups are part of the circuit, so tell the solve
        // which pins have one active before it runs.
        const pullUps = new Set(runtime.pullUps().filter((key) => key.startsWith(`${board.id}:`)))
        const circuit = simulate(diagram, defs, pins, { pullUps, duty })

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
        live.setVolts(circuit.volts)
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
