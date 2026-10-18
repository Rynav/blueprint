/**
 * SSD1306 128x64 monochrome OLED, driven over I2C at address 0x3C.
 *
 * Wire protocol: the first byte of a write transaction is a control byte — 0x00 selects the
 * command stream, 0x40 the display-data stream — and every following byte belongs to that
 * stream until STOP. Commands set the addressing window, contrast, remap and power; data lands
 * in the GDDRAM at the current pointer.
 *
 * GDDRAM layout (the canvas renderer depends on it): a flat `Uint8Array(1024)`, page-major.
 *   byte index = page * 128 + x      (page 0..7, each page is 8 display rows)
 *   bit (y & 7) is display row y within that page
 * The buffer is stored *raw*: segment remap, COM scan direction, invert and entire-display-on
 * are applied when the canvas draws, never by rewriting memory.
 */

import type { DeviceModel } from '@/lib/types'

export const SSD1306_ADDRESS = 0x3c

/** A mutable device state bag; fields are created lazily by `ensure`. */
type Bag = Record<string, unknown>

/**
 * Bytes-per-command table for the commands that take arguments. Unknown commands with no entry
 * are ignored one byte at a time, exactly as the datasheet requires of an unsupported command.
 */
const CMD_ARGS: Record<number, number> = {
  0x20: 1, // memory addressing mode
  0x21: 2, // column address start/end
  0x22: 2, // page address start/end
  0x81: 1, // contrast
  0x8d: 1, // charge pump
  0xd3: 1, // display offset (accepted, no effect)
  0xd5: 1, // display clock divide (accepted, no effect)
  0xd9: 1, // pre-charge period (accepted, no effect)
  0xda: 1, // COM pins (accepted, no effect)
  0xdb: 1, // VCOMH deselect (accepted, no effect)
}

const isByte = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const byte = (s: Bag, key: string, fallback: number): number =>
  isByte(s[key]) ? (s[key] as number) : fallback
const bool = (s: Bag, key: string, fallback: boolean): boolean =>
  typeof s[key] === 'boolean' ? (s[key] as boolean) : fallback

/** The live 1024-byte framebuffer, created on first use. */
function fbOf(s: Bag): Uint8Array {
  const fb = s.fb
  if (fb instanceof Uint8Array && fb.length === 1024) return fb
  const fresh = new Uint8Array(1024)
  s.fb = fresh
  return fresh
}

function ensure(s: Bag): Bag {
  fbOf(s)
  if (typeof s.on !== 'boolean') s.on = true
  if (typeof s.invert !== 'boolean') s.invert = false
  if (typeof s.segRemap !== 'boolean') s.segRemap = false
  if (typeof s.comScan !== 'boolean') s.comScan = false
  if (typeof s.entireOn !== 'boolean') s.entireOn = false
  if (typeof s.mode !== 'number') s.mode = 2 // page addressing mode
  if (typeof s.colStart !== 'number') s.colStart = 0
  if (typeof s.colEnd !== 'number') s.colEnd = 127
  if (typeof s.pageStart !== 'number') s.pageStart = 0
  if (typeof s.pageEnd !== 'number') s.pageEnd = 7
  if (typeof s.col !== 'number') s.col = 0
  if (typeof s.page !== 'number') s.page = 0
  if (typeof s.pendingCmd !== 'number') s.pendingCmd = 0
  if (!Array.isArray(s.pendingArgs)) s.pendingArgs = []
  if (typeof s.fresh !== 'boolean') s.fresh = true // first write of a transaction is the control byte
  if (typeof s.streamData !== 'boolean') s.streamData = false
  return s
}

/** Apply a command whose argument bytes have all arrived. */
function applyCommand(s: Bag, cmd: number, args: number[]): void {
  switch (cmd) {
    case 0x20:
      // 0x00 horizontal, 0x01 vertical, 0x02 page. Vertical is treated as page addressing.
      // shortcut: vertical addressing mode is not modelled; revisit if a sketch streams vertically.
      s.mode = args[0] === 0x00 ? 0 : 2
      break
    case 0x21:
      s.colStart = args[0] & 0x7f
      s.colEnd = Math.max(s.colStart as number, args[1] & 0x7f)
      s.col = s.colStart
      break
    case 0x22:
      s.pageStart = args[0] & 0x07
      s.pageEnd = Math.max(s.pageStart as number, args[1] & 0x07)
      s.page = s.pageStart
      break
    // 0x81 contrast, 0x8d charge pump and the init-only commands above are accepted and ignored.
  }
}

function command(s: Bag, value: number): void {
  if ((s.pendingCmd as number) !== 0) {
    const cmd = s.pendingCmd as number
    const args = s.pendingArgs as number[]
    args.push(value)
    if (args.length >= (CMD_ARGS[cmd] ?? 1)) {
      applyCommand(s, cmd, args)
      s.pendingCmd = 0
      s.pendingArgs = []
    }
    return
  }

  if (CMD_ARGS[value] !== undefined) {
    s.pendingCmd = value
    s.pendingArgs = []
    return
  }

  switch (value) {
    case 0xae:
      s.on = false
      break
    case 0xaf:
      s.on = true
      break
    case 0xa0:
      s.segRemap = false
      break
    case 0xa1:
      s.segRemap = true
      break
    case 0xc0:
      s.comScan = false
      break
    case 0xc8:
      s.comScan = true
      break
    case 0xa4:
      s.entireOn = false
      break
    case 0xa5:
      s.entireOn = true
      break
    case 0xa6:
      s.invert = false
      break
    case 0xa7:
      s.invert = true
      break
    default:
      if (value >= 0xb0 && value <= 0xb7) s.page = value & 0x07
      else if (value <= 0x0f) s.col = (byte(s, 'col', 0) & 0xf0) | value
      else if (value >= 0x10 && value <= 0x1f) s.col = (byte(s, 'col', 0) & 0x0f) | ((value & 0x0f) << 4)
    // anything else is an unsupported command: ignored, not fatal
  }
}

function writeData(s: Bag, value: number): void {
  const fb = fbOf(s)
  const page = byte(s, 'page', 0) & 0x07
  const col = byte(s, 'col', 0) & 0x7f
  fb[page * 128 + col] = value & 0xff

  if (byte(s, 'mode', 2) === 0) {
    // Horizontal addressing: columns first, then pages, wrapping inside the set window.
    if (col >= byte(s, 'colEnd', 127)) {
      s.col = byte(s, 'colStart', 0)
      s.page = page >= byte(s, 'pageEnd', 7) ? byte(s, 'pageStart', 0) : page + 1
    } else {
      s.col = col + 1
    }
  } else {
    // Page addressing: the column wraps at the panel edge, the page never advances.
    s.col = (col + 1) & 0x7f
  }
}

export const ssd1306: DeviceModel = {
  // The OLED drives no pins; it only listens on the I2C bus.
  outputs: [],

  step(_input, state) {
    ensure(state)
    return {}
  },

  visual(state) {
    ensure(state)
    return {
      data: {
        fb: state.fb, // the live buffer, by reference: no 1 KB copy per frame
        on: bool(state, 'on', true),
        invert: bool(state, 'invert', false),
        segRemap: bool(state, 'segRemap', false),
        comScan: bool(state, 'comScan', false),
        entireOn: bool(state, 'entireOn', false),
      },
    }
  },

  i2c: {
    address: SSD1306_ADDRESS,
    connect(this: Bag, _write: boolean) {
      ensure(this)
      this.fresh = true
    },
    write(this: Bag, value: number) {
      ensure(this)
      if (bool(this, 'fresh', true)) {
        this.fresh = false
        this.streamData = (value & 0x40) !== 0
        return
      }
      if (bool(this, 'streamData', false)) writeData(this, value)
      else command(this, value)
    },
    read(this: Bag, _ack: boolean) {
      // Register/status reads are not modelled; the bus answers the controller with 0x00.
      ensure(this)
    },
    stop(this: Bag) {
      ensure(this)
      this.fresh = true
    },
  },
}
