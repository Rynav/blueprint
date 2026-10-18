import {
  ADCMuxInputType,
  AVRADC,
  AVRIOPort,
  AVRUSART,
  AVRTimer,
  AVRTWI,
  CPU,
  PinState,
  adcConfig,
  atmega328Channels,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  twiConfig,
  usart0Config,
} from 'avr8js'
import type { TWIEventHandler } from 'avr8js'
import type { I2cBus, PartDef, PartInstance } from '@/lib/types'

export type PinValue = 0 | 1 | 'z'

/** One recorded board-pin edge: the bit's new value and the CPU cycle at which it changed. */
export interface PinTransition {
  key: string
  value: PinValue
  cycles: number
}

export interface AvrRuntime {
  /** Load Intel HEX (or the raw words). Safe to call repeatedly. */
  load(hex: string): void
  /** Advance simulated time, dispatching interrupts. */
  runFor(micros: number): void
  /** Pin values keyed `${partId}:${pinId}`, only for pins in the board's `mcu.pins`. */
  pinValues(): Map<string, PinValue>
  /**
   * Every board-pin transition recorded since the last drain, in the order it happened:
   * `{ key, value, cycles }` per changed bit, `'z'` when a pin goes back to input. Returns and clears.
   */
  drainTransitions(): PinTransition[]
  /**
   * Fraction of the last frame each board pin spent high, keyed `${partId}:${pinId}` for
   * every pin in the board's `mcu.pins`. The window is the one closed by the most recent
   * `drainTransitions()` (or, before any drain, since load/reset); the two calls describe the
   * same window whichever order they are made in. A pin that never changed reads 1 when high,
   * 0 when low or `'z'`. This is how `analogWrite`'s duty reaches the analog solve.
   */
  pinDuty(): Map<string, number>
  /** Everything written to the USART so far, decoded as text. */
  serial(): string
  /** Clear the serial buffer. */
  clearSerial(): void
  reset(): void
  /** The logic level an input pin should see. Ignored when the MCU drives that pin. */
  setInputPin(pinId: string, level: 0 | 1): void
  /** Volts (0..5) on an analog-capable pin, e.g. 'a0'. Ignored for non-ADC pins. */
  setAnalogPin(pinId: string, volts: number): void
  /** Pins with an active internal pull-up right now: DDR bit clear and PORT bit set. */
  pullUps(): string[]
  /** Simulated microseconds elapsed since the last reset. */
  elapsedMicros(): number
}

/** ATmega328P flash: 32 KiB, 16-bit words. Unwritten words read 0xff. */
const FLASH_BYTES = 0x8000
/** Per-call ceiling on simulated time, so one frame cannot stall the tab for seconds. */
const MAX_RUN_MICROS = 60_000_000
/** Most pin transitions kept for replay after a single run; oldest are dropped past this. */
const MAX_TRANSITIONS = 4096

type PortName = 'B' | 'C' | 'D'

interface Machine {
  cpu: CPU
  ports: Record<PortName, AVRIOPort>
  adc: AVRADC
  twi: AVRTWI
}

/** A board pin resolved once from the mcu spec: port bit, plus its ADC channel if it has one. */
interface BoardPin {
  key: string
  pinId: string
  port: PortName
  bit: number
  /** ADC mux channel (atmega328: port C bits 0..7), or undefined when the pin has no ADC input. */
  channel?: number
}

/** ADC channel feeding a chip pin, or undefined when the pin is not an analog input. */
function adcChannel(port: PortName, bit: number): number | undefined {
  if (port !== 'C') return undefined
  const mux = atmega328Channels[bit]
  return mux?.type === ADCMuxInputType.SingleEnded ? bit : undefined
}

/** Intel HEX -> AVR program memory (little-endian 16-bit words). */
function parseIntelHex(text: string): Uint16Array {
  // shortcut: record types 02/04 (extended addressing) are ignored - fine below 64 KiB of
  // flash, add them if a board with more than 32 KiB of code shows up.
  const bytes = new Uint8Array(FLASH_BYTES).fill(0xff)
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith(':')) continue
    const byte = (i: number) => parseInt(line.slice(1 + i * 2, 3 + i * 2), 16)
    const length = byte(0)
    const address = (byte(1) << 8) | byte(2)
    if (byte(3) !== 0) continue // 01 = EOF
    for (let i = 0; i < length; i++) bytes[address + i] = byte(4 + i)
  }
  const words = new Uint16Array(bytes.length / 2)
  for (let i = 0; i < words.length; i++) words[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8)
  return words
}

/**
 * Bridge the AVR TWI peripheral to an I2C bus. Every TWI event must be answered with the
 * matching `complete*` call, or the sketch's Wire transaction spins on TWINT forever (a hang).
 * A device that ACKed its address ACKs its data bytes too, so the connect ack is reused.
 */
function twiHandler(twi: AVRTWI, bus: I2cBus): TWIEventHandler {
  let addressed = false
  return {
    start: (repeated) => {
      addressed = false
      bus.start(repeated)
      twi.completeStart()
    },
    stop: () => {
      bus.stop()
      twi.completeStop()
    },
    connectToSlave: (addr, write) => {
      addressed = bus.connect(addr, write)
      twi.completeConnect(addressed)
    },
    writeByte: (value) => {
      bus.write(value)
      twi.completeWrite(addressed)
    },
    readByte: () => {
      twi.completeRead(bus.read())
    },
  }
}

/**
 * A fresh CPU with the peripherals an Arduino sketch expects. Timers and ports self-register
 * their hooks on the CPU; the USART forwards transmitted bytes to `onByte`. When an I2C bus is
 * supplied, the TWI peripheral routes controller traffic to it.
 */
function buildMachine(
  prog: Uint16Array,
  clockHz: number,
  onByte: (value: number) => void,
  i2c: I2cBus | undefined,
): Machine {
  const cpu = new CPU(prog)
  const ports: Record<PortName, AVRIOPort> = {
    B: new AVRIOPort(cpu, portBConfig),
    C: new AVRIOPort(cpu, portCConfig),
    D: new AVRIOPort(cpu, portDConfig),
  }
  new AVRTimer(cpu, timer0Config) // millis()/delay()
  new AVRTimer(cpu, timer1Config) // Servo, analogWrite on 9/10
  new AVRTimer(cpu, timer2Config) // analogWrite on 3/11
  const usart = new AVRUSART(cpu, usart0Config, clockHz)
  usart.onByteTransmit = onByte
  const adc = new AVRADC(cpu, adcConfig)
  adc.avcc = 5 // analogRead scales against 5 V; channelValues carry volts, not counts
  const twi = new AVRTWI(cpu, twiConfig, clockHz)
  // With no bus the default handler NACKs everything, so a Wire sketch fails cleanly instead of
  // hanging even when there is no display on the canvas.
  if (i2c) twi.eventHandler = twiHandler(twi, i2c)
  return { cpu, ports, adc, twi }
}

export function createAvrRuntime(
  board: PartInstance,
  def: PartDef,
  options?: { i2c?: I2cBus },
): AvrRuntime {
  const mcu = def.mcu
  if (!mcu) throw new Error(`part "${def.id}" has no mcu spec, so it cannot run firmware`)

  const i2c = options?.i2c

  const clockHz = mcu.clockHz
  // Pin table resolved once. The per-frame path only reads a pinState and sets a Map entry.
  const pins: BoardPin[] = Object.entries(mcu.pins).map(([pinId, p]) => ({
    key: `${board.id}:${pinId}`,
    pinId,
    port: p.port,
    bit: p.bit,
    channel: adcChannel(p.port, p.bit),
  }))
  const pinById = new Map(pins.map((p) => [p.pinId, p]))
  // Port bit -> board pin key, so a port write can be turned into per-bit transitions.
  const portBits: Record<PortName, Map<number, string>> = { B: new Map(), C: new Map(), D: new Map() }
  for (const pin of pins) portBits[pin.port].set(pin.bit, pin.key)

  /**
   * Board-pin transitions since the last drain. A bit-banged clock pulse can be a few CPU
   * cycles wide, far narrower than a frame, so the caller replays these instead of sampling.
   */
  const transitions: PinTransition[] = []
  const record = (key: string, value: PinValue, cycles: number) => {
    transitions.push({ key, value, cycles })
    // shortcut: buffer is capped (drops the oldest half when full), so a sketch that toggles a
    // pin more than ~4k times within one frame loses its earliest edges - and the complementing
    // duty measurement, whose base value was taken at window start, drifts with them. Upgrade to
    // a true ring buffer if a design ever needs every edge of a pathological bit-bang.
    if (transitions.length >= MAX_TRANSITIONS) transitions.splice(0, MAX_TRANSITIONS >> 1)
  }
  const attachListeners = (m: Machine) => {
    for (const name of ['B', 'C', 'D'] as const) {
      const bitKeys = portBits[name]
      if (bitKeys.size === 0) continue
      const port = m.ports[name]
      const last = new Map<number, PinValue>()
      for (const bit of bitKeys.keys()) last.set(bit, 'z') // fresh ports are all inputs
      port.addListener(() => {
        for (const [bit, key] of bitKeys) {
          const state = port.pinState(bit)
          const value: PinValue = state === PinState.High ? 1 : state === PinState.Low ? 0 : 'z'
          if (last.get(bit) !== value) {
            last.set(bit, value)
            record(key, value, m.cpu.cycles)
          }
        }
      })
    }
  }

  let prog: Uint16Array = new Uint16Array(FLASH_BYTES / 2).fill(0xffff)
  let serial = ''
  const onByte = (value: number) => {
    serial += String.fromCharCode(value)
  }
  // Requested input levels/analog volts, kept across load/reset so a rebuilt machine can be
  // restored in one pass (a rebuild starts from a fresh, floating ADC/port).
  const inputLevels = new Map<string, 0 | 1>()
  const analogVolts = new Map<string, number>()

  let machine = buildMachine(prog, clockHz, onByte, i2c)
  attachListeners(machine)

  /** Drive a pin's input level, unless the MCU drives it (DDR bit set). */
  const applyInput = (pin: BoardPin, level: 0 | 1) => {
    const port = machine.ports[pin.port]
    // No-op when the pin is an output: the MCU's own drive overrides setPin anyway, and
    // skipping it is what stops the feedback loop from fighting that drive.
    if (machine.cpu.data[port.portConfig.DDR] & (1 << pin.bit)) return
    port.setPin(pin.bit, level === 1)
  }
  const applyStored = () => {
    for (const [pinId, level] of inputLevels) {
      const pin = pinById.get(pinId)
      if (pin) applyInput(pin, level)
    }
    for (const [pinId, volts] of analogVolts) {
      const pin = pinById.get(pinId)
      if (pin?.channel !== undefined) machine.adc.channelValues[pin.channel] = volts
    }
  }
  const rebuild = () => {
    machine = buildMachine(prog, clockHz, onByte, i2c)
    attachListeners(machine)
    applyStored()
  }

  /** Every board pin's level right now. */
  const readValues = (): Map<string, PinValue> => {
    const values = new Map<string, PinValue>()
    for (const pin of pins) {
      const state = machine.ports[pin.port].pinState(pin.bit)
      values.set(pin.key, state === PinState.High ? 1 : state === PinState.Low ? 0 : 'z')
    }
    return values
  }

  // Duty window. `winStart` is the cycle the open window began; `base` is each pin's level at
  // that cycle, needed because only edges are recorded. `pendingDuty` holds the window the most
  // recent drain closed until pinDuty() reports it (same frame, same cycle count).
  let winStart = 0
  let base = readValues()
  let pendingDuty: { end: number; duty: Map<string, number> } | null = null
  const resetDutyWindow = () => {
    winStart = machine.cpu.cycles
    base = readValues()
    pendingDuty = null
  }

  /**
   * Fraction of [start, end] each board pin spent high, from the recorded edges. A pin with no
   * edge keeps its base level: 1 if high, 0 if low. `'z'` (the pin is an input / high impedance,
   * so it drives nothing) never counts as high and reads 0, exactly like a driven low.
   */
  const windowDuty = (start: number, end: number, edges: PinTransition[]): Map<string, number> => {
    const cur = new Map(base)
    const last = new Map<string, number>()
    const high = new Map<string, number>()
    for (const pin of pins) {
      last.set(pin.key, start)
      high.set(pin.key, 0)
    }
    for (const e of edges) {
      if (!cur.has(e.key)) continue // not a board pin
      if (cur.get(e.key) === 1) {
        high.set(e.key, high.get(e.key)! + Math.max(0, e.cycles - last.get(e.key)!))
      }
      cur.set(e.key, e.value)
      last.set(e.key, e.cycles)
    }
    const span = end - start
    const duty = new Map<string, number>()
    for (const pin of pins) {
      let h = high.get(pin.key)!
      if (cur.get(pin.key) === 1) h += Math.max(0, end - last.get(pin.key)!)
      duty.set(pin.key, span > 0 ? h / span : cur.get(pin.key) === 1 ? 1 : 0)
    }
    return duty
  }

  return {
    load(hex) {
      prog = parseIntelHex(hex)
      serial = ''
      transitions.length = 0
      rebuild()
      resetDutyWindow()
    },

    runFor(micros) {
      if (!Number.isFinite(micros) || micros <= 0) return
      const span = Math.min(micros, MAX_RUN_MICROS)
      // One `avrInstruction` + `tick` per loop turn. At 16 MHz that is ~16 000 turns per
      // simulated millisecond, so a 60 fps frame (~16.7 ms) costs ~267 000 turns - this
      // loop is essentially the entire cost of the runtime.
      const deadline = machine.cpu.cycles + Math.round((span / 1e6) * clockHz)
      while (machine.cpu.cycles < deadline) {
        avrInstruction(machine.cpu)
        machine.cpu.tick() // dispatches interrupts; without it timer0 never fires and delay() is wrong
      }
    },

    pinValues: readValues,

    drainTransitions() {
      const drained = transitions.slice()
      transitions.length = 0
      const end = machine.cpu.cycles
      pendingDuty = { end, duty: windowDuty(winStart, end, drained) }
      winStart = end
      base = readValues()
      return drained
    },

    pinDuty() {
      // The drain that just closed this frame's window is reported once; if CPU time advanced
      // since, the window has moved on, so compute the open one instead.
      if (pendingDuty && pendingDuty.end === machine.cpu.cycles) {
        const duty = pendingDuty.duty
        pendingDuty = null
        return duty
      }
      return windowDuty(winStart, machine.cpu.cycles, transitions)
    },

    serial: () => serial,
    clearSerial() {
      serial = ''
    },
    setInputPin(pinId, level) {
      const pin = pinById.get(pinId)
      if (!pin) return
      inputLevels.set(pinId, level)
      applyInput(pin, level)
    },
    setAnalogPin(pinId, volts) {
      const pin = pinById.get(pinId)
      // shortcut: volts are written straight to the ADC channel - the sample-and-hold and the
      // source impedance at the pin are not modelled. Upgrade if a high-impedance node must
      // read differently from a stiff one.
      if (pin?.channel === undefined || !Number.isFinite(volts)) return
      const clamped = Math.min(5, Math.max(0, volts))
      analogVolts.set(pinId, clamped)
      machine.adc.channelValues[pin.channel] = clamped
    },
    pullUps() {
      const keys: string[] = []
      for (const pin of pins) {
        const port = machine.ports[pin.port]
        const mask = 1 << pin.bit
        const ddr = machine.cpu.data[port.portConfig.DDR]
        const value = machine.cpu.data[port.portConfig.PORT]
        if (!(ddr & mask) && value & mask) keys.push(pin.key)
      }
      return keys
    },
    reset() {
      serial = ''
      transitions.length = 0
      rebuild()
      resetDutyWindow()
    },
    elapsedMicros: () => (machine.cpu.cycles / clockHz) * 1e6,
  }
}

// shortcut: atmega328p only, no EEPROM persistence, and no external interrupts driven by
// wired pins (P4/P5). Upgrade when cross-part interrupt simulation is needed.
