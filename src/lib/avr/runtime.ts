import {
  AVRIOPort,
  AVRUSART,
  AVRTimer,
  CPU,
  PinState,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
} from 'avr8js'
import type { PartDef, PartInstance } from '@/lib/types'

export type PinValue = 0 | 1 | 'z'

export interface AvrRuntime {
  /** Load Intel HEX (or the raw words). Safe to call repeatedly. */
  load(hex: string): void
  /** Advance simulated time, dispatching interrupts. */
  runFor(micros: number): void
  /** Pin values keyed `${partId}:${pinId}`, only for pins in the board's `mcu.pins`. */
  pinValues(): Map<string, PinValue>
  /** Everything written to the USART so far, decoded as text. */
  serial(): string
  /** Clear the serial buffer. */
  clearSerial(): void
  reset(): void
  /** Simulated microseconds elapsed since the last reset. */
  elapsedMicros(): number
}

/** ATmega328P flash: 32 KiB, 16-bit words. Unwritten words read 0xff. */
const FLASH_BYTES = 0x8000
/** Per-call ceiling on simulated time, so one frame cannot stall the tab for seconds. */
const MAX_RUN_MICROS = 60_000_000

type PortName = 'B' | 'C' | 'D'

interface Machine {
  cpu: CPU
  ports: Record<PortName, AVRIOPort>
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
 * A fresh CPU with the peripherals an Arduino sketch expects. Timers and ports self-register
 * their hooks on the CPU; the USART forwards transmitted bytes to `onByte`.
 */
function buildMachine(prog: Uint16Array, clockHz: number, onByte: (value: number) => void): Machine {
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
  return { cpu, ports }
}

export function createAvrRuntime(board: PartInstance, def: PartDef): AvrRuntime {
  const mcu = def.mcu
  if (!mcu) throw new Error(`part "${def.id}" has no mcu spec, so it cannot run firmware`)

  const clockHz = mcu.clockHz
  // Pin table resolved once. The per-frame path only reads a pinState and sets a Map entry.
  const pins = Object.entries(mcu.pins).map(([pinId, p]) => ({
    key: `${board.id}:${pinId}`,
    port: p.port,
    bit: p.bit,
  }))

  let prog: Uint16Array = new Uint16Array(FLASH_BYTES / 2).fill(0xffff)
  let serial = ''
  const onByte = (value: number) => {
    serial += String.fromCharCode(value)
  }
  let machine = buildMachine(prog, clockHz, onByte)

  return {
    load(hex) {
      prog = parseIntelHex(hex)
      serial = ''
      machine = buildMachine(prog, clockHz, onByte)
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

    pinValues() {
      const values = new Map<string, PinValue>()
      for (const pin of pins) {
        const state = machine.ports[pin.port].pinState(pin.bit)
        const value: PinValue = state === PinState.High ? 1 : state === PinState.Low ? 0 : 'z'
        values.set(pin.key, value)
      }
      return values
    },

    serial: () => serial,
    clearSerial() {
      serial = ''
    },
    reset() {
      serial = ''
      machine = buildMachine(prog, clockHz, onByte)
    },
    elapsedMicros: () => (machine.cpu.cycles / clockHz) * 1e6,
  }
}

// shortcut: atmega328p only, no ADC input yet, no EEPROM persistence, and no external
// interrupts driven by wired pins (P4/P5). Upgrade when analog reads or cross-part
// interrupt simulation is needed.
