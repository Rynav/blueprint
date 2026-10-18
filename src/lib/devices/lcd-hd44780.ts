/**
 * HD44780 character LCD (16x2) on the parallel bus.
 *
 * The controller latches every write on the *falling* edge of Enable: RS low is a command
 * byte, RS high a data byte; RW high is a read (unmodelled). A device model is stepped on
 * every replayed pin transition, so a ~1 us Enable pulse a real sketch bit-bangs is seen —
 * the same edge trick the 74HC595 uses for its clock.
 *
 * Modes: the chip powers up in 8-bit mode, reads the four init nibbles (0x30 x3, 0x20) as
 * whole bytes, then switches to 4-bit mode, where a byte is two Enable pulses — high nibble
 * first, low nibble second. Both are handled; this part only breaks out D4-D7, so 8-bit mode
 * needs a custom def that also exposes D0-D3.
 *
 * DDRAM: two visible rows of 16, addressed 0x00-0x0F / 0x40-0x4F.
 * shortcut: the real DDRAM is 40 chars per line (0x00-0x27 / 0x40-0x67), so on real hardware
 * a line's 17th character lands off-screen; here the cursor wraps at 16. Upgrade if a sketch
 * relies on writing past a 16-char line.
 * shortcut: CGRAM (custom glyphs), read mode / busy flag, and display shift are not modelled;
 * data written while a CGRAM address is selected is discarded.
 */

import type { DeviceInput, DeviceModel } from '@/lib/types'

export const LCD_COLS = 16
export const LCD_ROWS = 2

/** A mutable device state bag; fields are created lazily by `ensure`. */
type Bag = Record<string, unknown>

const isByte = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const byte = (s: Bag, key: string, fallback: number): number =>
  isByte(s[key]) ? (s[key] as number) : fallback
const bool = (s: Bag, key: string, fallback: boolean): boolean =>
  typeof s[key] === 'boolean' ? (s[key] as boolean) : fallback
const bit = (input: DeviceInput, pin: string): number => (input.level(pin) === 1 ? 1 : 0)

/** The live 2x16 DDRAM (0x20 = blank), created on first use. */
function ddramOf(s: Bag): Uint8Array {
  const d = s.ddram
  if (d instanceof Uint8Array && d.length === LCD_ROWS * LCD_COLS) return d
  const fresh = new Uint8Array(LCD_ROWS * LCD_COLS).fill(0x20)
  s.ddram = fresh
  return fresh
}

function ensure(s: Bag): Bag {
  ddramOf(s)
  if (!isByte(s.cursor)) s.cursor = 0
  if (typeof s.on !== 'boolean') s.on = true
  if (typeof s.cursorOn !== 'boolean') s.cursorOn = false
  if (typeof s.blink !== 'boolean') s.blink = false
  if (typeof s.entryInc !== 'boolean') s.entryInc = true
  if (typeof s.fourBit !== 'boolean') s.fourBit = false
  if (typeof s.pending !== 'boolean') s.pending = false
  if (!isByte(s.nibble)) s.nibble = 0
  if (typeof s.cgram !== 'boolean') s.cgram = false
  return s
}

/** DDRAM address -> visible row, column (the common 16x2 mapping). */
const rowOf = (addr: number): number => (addr >= 0x40 ? 1 : 0)
const colOf = (addr: number): number => addr & 0x0f
const indexOf = (addr: number): number => rowOf(addr) * LCD_COLS + colOf(addr)

/** Step the address counter, wrapping at the 16-char line ends (see the header note). */
function advance(s: Bag, dir: 1 | -1): void {
  const addr = byte(s, 'cursor', 0) & 0x7f
  if (dir > 0) s.cursor = addr === 0x0f ? 0x40 : addr === 0x4f ? 0x00 : addr + 1
  else s.cursor = addr === 0x00 ? 0x4f : addr === 0x40 ? 0x0f : addr - 1
}

/** Interpret one latched command byte. */
function command(s: Bag, value: number): void {
  const cmd = value & 0xff
  if (cmd === 0x01) {
    // Clear display: blank DDRAM, home the cursor.
    ddramOf(s).fill(0x20)
    s.cursor = 0
    s.cgram = false
    return
  }
  if (cmd === 0x02 || cmd === 0x03) {
    // Return home (0x03 is not a real command; accepted as home).
    s.cursor = 0
    s.cgram = false
    return
  }
  if (cmd >= 0x04 && cmd <= 0x07) {
    // Entry mode: bit1 = increment/decrement, bit0 = display shift on write (unmodelled).
    s.entryInc = (cmd & 0x02) !== 0
    return
  }
  if (cmd >= 0x08 && cmd <= 0x0f) {
    // Display on/off: bit2 = on, bit1 = cursor, bit0 = blink.
    s.on = (cmd & 0x04) !== 0
    s.cursorOn = (cmd & 0x02) !== 0
    s.blink = (cmd & 0x01) !== 0
    return
  }
  if (cmd >= 0x10 && cmd <= 0x1f) {
    // Cursor / display shift: bit3 selects display shift (unmodelled), bit2 the direction.
    if ((cmd & 0x08) !== 0) return
    advance(s, (cmd & 0x04) !== 0 ? 1 : -1)
    return
  }
  if (cmd >= 0x20 && cmd <= 0x3f) {
    // Function set: bit4 = data length (0 -> 4-bit). Line count / font (bits 3-2) ignored.
    s.fourBit = (cmd & 0x10) === 0
    s.pending = false
    return
  }
  if (cmd >= 0x40 && cmd <= 0x7f) {
    // Set CGRAM address: custom glyphs are not modelled, so writes are discarded.
    s.cgram = true
    return
  }
  if (cmd >= 0x80) {
    // Set DDRAM address.
    s.cursor = cmd & 0x7f
    s.cgram = false
  }
}

/** Store one latched data byte at the cursor and advance it. */
function data(s: Bag, value: number): void {
  if (bool(s, 'cgram', false)) return // CGRAM write: discarded
  const addr = byte(s, 'cursor', 0) & 0x7f
  ddramOf(s)[indexOf(addr)] = value & 0xff
  advance(s, bool(s, 'entryInc', true) ? 1 : -1)
}

/** A complete byte arrived on the falling Enable edge; route it to command or data. */
function latch(s: Bag, input: DeviceInput): void {
  if (input.level('rw') === 1) return // read cycle: the data bus is not driven
  const rs = input.level('rs') === 1 ? 1 : 0

  let value: number
  if (bool(s, 'fourBit', false)) {
    const nib = bit(input, 'd4') | (bit(input, 'd5') << 1) | (bit(input, 'd6') << 2) | (bit(input, 'd7') << 3)
    if (!bool(s, 'pending', false)) {
      s.nibble = nib
      s.pending = true
      return
    }
    value = ((byte(s, 'nibble', 0) & 0x0f) << 4) | (nib & 0x0f)
    s.pending = false
  } else {
    value = 0
    for (let i = 0; i < 8; i++) value |= bit(input, `d${i}`) << i
  }

  if (rs === 1) data(s, value)
  else command(s, value)
}

export const lcdHd44780: DeviceModel = {
  // The LCD is a sink: it drives no pins (read mode / busy flag is not modelled).
  outputs: [],

  step(input, state) {
    ensure(state)
    const e = input.level('e')
    // Falling edge only: an Enable held high must not latch again.
    if (state.e === 1 && e === 0) latch(state, input)
    state.e = e
    return {}
  },

  visual(state) {
    ensure(state)
    const ddram = ddramOf(state)
    const text: string[] = []
    for (let r = 0; r < LCD_ROWS; r++) {
      let line = ''
      for (let c = 0; c < LCD_COLS; c++) line += String.fromCharCode(ddram[r * LCD_COLS + c])
      text.push(line)
    }
    const addr = byte(state, 'cursor', 0)
    return {
      data: {
        text, // the decoded 2x16 characters, not a copy of the state
        cursor: { row: rowOf(addr), col: colOf(addr) },
        on: bool(state, 'on', true),
        // One flag for the canvas: show the cursor when either the steady cursor or the blink bit is set.
        blink: bool(state, 'blink', false) || bool(state, 'cursorOn', false),
      },
    }
  },
}
