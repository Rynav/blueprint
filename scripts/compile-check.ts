import { readdirSync, statSync } from 'node:fs'

import { compileSketchInline, parseIntelHex } from '../src/lib/compile/index'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

// ---- Intel HEX fixture, written by hand so it cannot inherit a parser bug ----
// address 0x0000: 01 02 03 04   and   address 0x0008: 05 06  (gap reads as erased 0xff)
const FIXTURE = [':0400000001020304F2', ':020008000506EB', ':00000001FF'].join('\n') + '\n'

const words = parseIntelHex(FIXTURE)
ok('fixture yields 16384 words (32 KB flash)', words.length === 16384)
ok('fixture words are little-endian', words[0] === 0x0201 && words[1] === 0x0403)
ok('fixture word at 0x8', words[4] === 0x0605)
ok('unwritten flash reads 0xff', words[2] === 0xffff && words[3] === 0xffff && words[16383] === 0xffff)
ok(
  'fixture writes exactly the three data words',
  JSON.stringify([...words.entries()].filter(([, w]) => w !== 0xffff).map(([i]) => i)) === '[0,1,4]',
)

// ---- the parser must reject junk instead of returning plausible bytes ----
const throws = (text: string) => {
  try {
    parseIntelHex(text)
    return false
  } catch (error) {
    return error instanceof Error && error.message.includes('Malformed Intel HEX')
  }
}
ok('throws on a truncated record (missing data + checksum)', throws(':0400000001020304'))
ok('throws on a bad checksum', throws(':0400000001020304F3'))
ok('throws on non-hex garbage', throws('this is not intel hex'))
ok('throws on a line with no leading colon', throws('0400000001020304F2'))
ok('throws on a record that runs past the flash', throws(':047FFE000102030475'))

// ---- Intel HEX emitted by the real toolchain ----
const BLINK = `#include <Arduino.h>

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
`

const startedAt = Date.now()
const blink = await compileSketchInline(BLINK)
console.log(`   compiled Blink in ${Date.now() - startedAt} ms, ${blink.hex.length} hex chars`)

ok('Blink compiles inline and fits the Uno', blink.fitsTarget === true)
ok('Blink HEX ends with the EOF record', blink.hex.trimEnd().endsWith(':00000001FF'))

const lines = blink.hex.split(/\r?\n/).filter(Boolean)
ok('every HEX line starts with a colon', lines.length > 3 && lines.every((l) => l.startsWith(':')))
ok(
  'every HEX line has a valid byte count and checksum',
  lines.every((line) => {
    const bytes = (i: number) => parseInt(line.slice(1 + i * 2, 3 + i * 2), 16)
    if (line.length !== 11 + bytes(0) * 2) return false
    let sum = 0
    for (let j = 1; j < line.length; j += 2) sum += parseInt(line.slice(j, j + 2), 16)
    return (sum & 0xff) === 0
  }),
)

const program = parseIntelHex(blink.hex)
ok('reset vector is a JMP (0x940c)', program[0] === 0x940c)
ok('Blink leaves real code in flash', program.filter((w) => w !== 0xffff).length > 100)

// ---- a broken sketch must fail loudly, not hang or return junk ----
const timer = setTimeout(() => ok('broken sketch rejects within 60 s', false), 60_000)
const error = await compileSketchInline('void setup() { this is not c++ }').then(
  () => null,
  (e: unknown) => String(e),
)
clearTimeout(timer)
ok('broken sketch rejects with an error', error !== null && error.length > 0)
if (error) console.log(`   rejected with: ${error.split('\n')[0].slice(0, 120)}`)

// ---- be honest about what the assets cost ----
const dirSize = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? dirSize(`${dir}/${e.name}`) : statSync(`${dir}/${e.name}`).size),
    0,
  )
const pkg = 'node_modules/@horang-corp/avr-gcc-wasm'
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
const [toolsBytes, assetsBytes] = ['tools', 'assets'].map((dir) => dirSize(`${pkg}/${dir}`))
console.log(`   ${pkg}/tools: ${mb(toolsBytes)} MB, assets: ${mb(assetsBytes)} MB (fetched at compile time, not bundled)`)
console.log(`   total toolchain payload: ${mb(toolsBytes + assetsBytes)} MB`)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
