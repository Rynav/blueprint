// ATmega328P: 32 KB of program flash, addressable with 16 bits.
const FLASH_BYTES = 0x8000

/**
 * Intel HEX -> AVR program memory. Words are little-endian, i.e.
 * `words[i] = bytes[2i] | (bytes[2i + 1] << 8)`. Unwritten flash reads as 0xff
 * (the erased state of AVR flash). Throws on a malformed record rather than
 * silently returning wrong bytes.
 */
export function parseIntelHex(text: string): Uint16Array {
  const bytes = new Uint8Array(FLASH_BYTES).fill(0xff)
  const lines = text.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const bad = (why: string): never => {
      throw new Error(`Malformed Intel HEX line ${i + 1}: ${why} ("${line.slice(0, 24)}")`)
    }

    // ":LLAAAATT<LL data bytes>CC" -> ':' plus an even number of hex digits.
    if (!/^:[0-9a-fA-F]+$/.test(line) || line.length % 2 === 0)
      bad('expected ":" followed by an even number of hex digits')

    const byte = (index: number) => parseInt(line.slice(1 + index * 2, 3 + index * 2), 16)
    const count = byte(0)
    if (line.length !== 11 + count * 2)
      bad(`record declares ${count} data bytes but is ${line.length} characters long`)

    let sum = 0
    for (let j = 1; j < line.length; j += 2) sum += byte(j >> 1)
    if ((sum & 0xff) !== 0) bad('checksum mismatch')

    const address = (byte(1) << 8) | byte(2)
    const type = byte(3)
    if (type === 1) break // 01 = EOF
    // shortcut: record types 02/04 (extended addressing) are ignored — a 32 KB Uno fits
    // 16-bit addresses; teach this to track a base address before targeting a bigger part.
    if (type !== 0) continue

    if (address + count > bytes.length) bad(`data at 0x${address.toString(16)} runs past the 32 KB flash`)
    for (let j = 0; j < count; j++) bytes[address + j] = byte(4 + j)
  }

  const words = new Uint16Array(bytes.length / 2)
  for (let i = 0; i < words.length; i++) words[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8)
  return words
}
