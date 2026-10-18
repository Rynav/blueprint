/**
 * SSD1306 OLED checks: the whole chain, Wire firmware -> AVRTWI -> I2C bus -> GDDRAM -> canvas.
 * Run with `bun scripts/display-check.ts`. Assert-based, non-zero exit on failure.
 *
 * The headline case compiles a compact Wire driver onto an ATmega328P, runs it in the app's
 * frame order (`runFor(16_000)` + `pinDuty()` + device harness + `simulate`) with the I2C bus
 * wired into the runtime, and asserts the framebuffer holds exactly the bytes the sketch wrote.
 */

import { buildFirmware, SENSOR } from '@horang-corp/avr-gcc-wasm'

import { createAvrRuntime } from '@/lib/avr/runtime'
import { simulate } from '@/lib/circuit'
import { compileSketchInline, preprocessSketch } from '@/lib/compile'
import { createDeviceHarness } from '@/lib/devices'
import type { PinValue } from '@/lib/devices'
import { createI2cBus } from '@/lib/devices/i2c'
import { allPartDefs, getPartDef } from '@/lib/parts'
import { pixelPath } from '@/lib/parts/display'
import type { Diagram, Endpoint, PartDef, PartInstance, Wire } from '@/lib/types'

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

const defs = new Map<string, PartDef>(allPartDefs().map((d) => [d.id, d]))
const part = (id: string, def: string): PartInstance => ({ id, def, at: { x: 0, y: 0 }, rotation: 0 })
const wire = (id: string, from: Endpoint, to: Endpoint): Wire => ({ id, from, to })
const diagram = (parts: PartInstance[], wires: Wire[] = []): Diagram => ({ version: 1, parts, wires, notes: [] })

const UNO = 'uno'
const OLED = 'oled'
const DISPLAY_DEF = 'ssd1306-oled'
const ADDRESS = 0x3c

/** Uno SDA/SCL on A4/A5, with the module's rails. I2C is peripheral-driven, wiring is cosmetic. */
const displayCircuit = (): Diagram =>
  diagram(
    [part(UNO, 'arduino-uno'), part(OLED, DISPLAY_DEF), part('v5', 'rail-5v'), part('gnd', 'rail-gnd')],
    [
      wire('wSDA', { part: UNO, pin: 'a4' }, { part: OLED, pin: 'sda' }),
      wire('wSCL', { part: UNO, pin: 'a5' }, { part: OLED, pin: 'scl' }),
      wire('wVCC', { part: OLED, pin: 'vcc' }, { part: 'v5', pin: '5V' }),
      wire('wGND', { part: OLED, pin: 'gnd' }, { part: 'gnd', pin: 'GND' }),
    ],
  )

const bagOf = (state: Map<string, Record<string, unknown>>, id: string): Record<string, unknown> =>
  state.get(id) ?? {}
const fbOf = (bag: Record<string, unknown>): Uint8Array => bag.fb as Uint8Array

const bytesEqual = (a: ArrayLike<number>, b: ArrayLike<number>): boolean =>
  a.length === b.length && Array.from(a).every((v, i) => v === b[i] as number)
const countLit = (d: string): number => (d.match(/M/g) ?? []).length
const indicesOf = (pred: (v: number, i: number) => boolean, n: number): number[] =>
  Array.from({ length: n }, (_, i) => i).filter((i) => pred(i, i))

// ---- a compact Wire SSD1306 driver: init sequence + a known 1024-byte pattern ----
const PATTERN = (i: number) => (i * 37 + 11) & 0xff

const WIRE_SKETCH = `#include <Wire.h>

static void oledCmd(uint8_t c) {
  Wire.beginTransmission(0x3C);
  Wire.write(0x00);
  Wire.write(c);
  Wire.endTransmission();
}

static void oledCmd1(uint8_t c, uint8_t a) {
  Wire.beginTransmission(0x3C);
  Wire.write(0x00);
  Wire.write(c);
  Wire.write(a);
  Wire.endTransmission();
}

static void oledCmd2(uint8_t c, uint8_t a, uint8_t b) {
  Wire.beginTransmission(0x3C);
  Wire.write(0x00);
  Wire.write(c);
  Wire.write(a);
  Wire.write(b);
  Wire.endTransmission();
}

void setup() {
  Wire.begin();
  oledCmd(0xAE);              // display off
  oledCmd1(0xD5, 0x80);       // clock divide
  oledCmd1(0xA8, 0x3F);       // multiplex ratio
  oledCmd1(0xD3, 0x00);       // display offset
  oledCmd(0x40);              // start line 0
  oledCmd1(0x8D, 0x14);       // charge pump on
  oledCmd1(0x20, 0x00);       // horizontal addressing mode
  oledCmd(0xA1);              // segment remap
  oledCmd(0xC8);              // COM scan direction
  oledCmd1(0xDA, 0x12);       // COM pins
  oledCmd1(0x81, 0xCF);       // contrast
  oledCmd(0xA6);              // normal (not inverted)
  oledCmd2(0x21, 0x00, 0x7F); // columns 0..127
  oledCmd2(0x22, 0x00, 0x07); // pages 0..7
  oledCmd(0xAF);              // display on

  for (uint16_t i = 0; i < 1024; ) {
    Wire.beginTransmission(0x3C);
    Wire.write(0x40);
    for (uint8_t n = 0; n < 16 && i < 1024; n++) {
      Wire.write((uint8_t)(i * 37u + 11u));
      i++;
    }
    Wire.endTransmission();
  }
}

void loop() {}
`

/** The app's real frame loop: one runFor(16_000), duty, device harness with the bus wired in. */
function runFrames(
  runtime: ReturnType<typeof createAvrRuntime>,
  d: Diagram,
  frames: number,
  state: Map<string, Record<string, unknown>>,
): ReturnType<typeof simulate>[] {
  const out: ReturnType<typeof simulate>[] = []
  for (let f = 0; f < frames; f++) {
    runtime.runFor(16_000)
    const duty = runtime.pinDuty()
    const harness = createDeviceHarness(d, defs, state, duty)
    const live = runtime.pinValues()
    harness.seed(live)
    for (const { key, value } of runtime.drainTransitions()) {
      if (harness.watched.has(key)) harness.applyTransition(key, value)
    }
    out.push(simulate(d, defs, harness.settle(live, 16_000), { duty }))
  }
  return out
}

// ============================ 1. a real sketch, end to end ============================
{
  const { hex, fitsTarget } = await compileSketchInline(WIRE_SKETCH)
  ok('Wire sketch links with no extra link options and fits the Uno', fitsTarget && hex.length > 1000)

  const report = await buildFirmware({ source: preprocessSketch(WIRE_SKETCH) })
  console.log(`  Wire SSD1306 driver: ${report.flashBytes} flash bytes of ${report.target.appFlashBytes} (${report.fitsTarget ? 'fits' : 'OVER'})`)

  const d = displayCircuit()
  const state = new Map<string, Record<string, unknown>>()
  const bus = createI2cBus(d, defs, state)
  const runtime = createAvrRuntime(part(UNO, 'arduino-uno'), getPartDef('arduino-uno')!, { i2c: bus })
  runtime.load(hex)

  const frames = runFrames(runtime, d, 8, state)
  const visual = getPartDef(DISPLAY_DEF)!.device!.visual!(bagOf(state, OLED))
  const fb = fbOf(bagOf(state, OLED))
  const expected = new Uint8Array(1024)
  for (let i = 0; i < 1024; i++) expected[i] = PATTERN(i)
  const mismatches = indicesOf((i) => fb[i] !== expected[i], 1024)

  ok('the circuit converges with the display attached', frames.every((s) => s.converged))
  ok(
    `the sketch painted all 1024 framebuffer bytes (${1024 - mismatches.length}/1024 match)`,
    mismatches.length === 0,
  )
  if (mismatches.length) console.log(`  first mismatches at indices ${mismatches.slice(0, 8).join(', ')}`)
  ok(
    'first page byte 0 and a distinctive page-3 byte match the written pattern',
    fb[0] === PATTERN(0) && fb[3 * 128 + 5] === PATTERN(3 * 128 + 5),
  )
  ok('visual().data.fb is the live buffer, not a copy', visual.data!.fb === bagOf(state, OLED).fb)
  ok('visual().data.fb agrees with the framebuffer', bytesEqual(visual.data!.fb as Uint8Array, expected))
  console.log(
    `  framebuffer: byte[0]=0x${fb[0].toString(16)}, byte[16]=0x${fb[16].toString(16)}, ` +
      `byte[384]=0x${fb[384].toString(16)} (expected ${PATTERN(0).toString(16)}, ${PATTERN(16).toString(16)}, ${PATTERN(384).toString(16)})`,
  )
}

// ============================ 2. deterministic protocol, no sketch ============================
/** Drive the bus directly and return the bag the OLED model wrote into. */
function drive(script: (bus: ReturnType<typeof createI2cBus>) => void): Record<string, unknown> {
  const d = diagram([part(OLED, DISPLAY_DEF)])
  const state = new Map<string, Record<string, unknown>>()
  const bus = createI2cBus(d, defs, state)
  script(bus)
  return bagOf(state, OLED)
}
const tx = (bus: ReturnType<typeof createI2cBus>, control: number, bytes: number[]) => {
  bus.start(false)
  bus.connect(ADDRESS, true)
  bus.write(control)
  for (const b of bytes) bus.write(b)
  bus.stop()
}
/** A command transaction: control byte 0x00, then command bytes. */
const cmdTx = (bus: ReturnType<typeof createI2cBus>, bytes: number[]) => tx(bus, 0x00, bytes)
/** A data transaction: control byte 0x40, then framebuffer bytes. */
const dataTx = (bus: ReturnType<typeof createI2cBus>, bytes: number[]) => tx(bus, 0x40, bytes)

{
  // Page mode: set page 0, column 16, then one data byte with bit 5 set.
  const bag = drive((bus) => {
    cmdTx(bus, [0xb0, 0x00, 0x11])
    dataTx(bus, [0b0010_0000])
  })
  const fb = fbOf(bag)
  const lit = indicesOf((i) => fb[i] !== 0, 1024)
  ok('page mode: exactly one framebuffer byte is written', lit.length === 1)
  ok('page mode: that byte is at column 16 of page 0 with bit 5 set', fb[16] === 0b0010_0000)
  ok('page mode: only that byte is non-zero', lit[0] === 16)

  // Horizontal mode with a column window 5..10, page window 1..2: 6 bytes fill page 1, the 7th
  // wraps to page 2 column 5.
  const bag2 = drive((bus) => {
    cmdTx(bus, [0x20, 0x00, 0x21, 0x05, 0x0a, 0x22, 0x01, 0x02])
    dataTx(bus, [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40])
  })
  const fb2 = fbOf(bag2)
  const lit2 = indicesOf((i) => fb2[i] !== 0, 1024)
  ok('horizontal mode: seven bytes land in seven distinct cells', lit2.length === 7)
  ok('horizontal mode: columns 5..10 of page 1 hold 0x01..0x20', fb2[128 + 5] === 0x01 && fb2[128 + 10] === 0x20)
  ok('horizontal mode: the 7th byte wrapped to page 2 column 5', fb2[256 + 5] === 0x40)
  ok('horizontal mode: page 0 is untouched', fb2.slice(0, 128).every((v) => v === 0))
  console.log(
    `  horizontal: page1[5..10] = ${Array.from(fb2.slice(128 + 5, 128 + 11)).map((v) => v.toString(16)).join(' ')}, page2[5] = 0x${fb2[261].toString(16)}`,
  )
}

// ============================ 3. address handling ============================
{
  const fakeDef: PartDef = {
    id: 'fake-i2c',
    name: 'Fake I2C Device',
    category: 'sensors',
    width: 10,
    height: 10,
    pins: [],
    device: {
      outputs: [],
      step: () => ({}),
      i2c: {
        address: 0x50,
        connect(this: any, _write: boolean) {
          this.connected = true
        },
        write(this: any, value: number) {
          this.count = (this.count ?? 0) + 1
          this.last = value
        },
        read() {},
        stop(this: any) {
          this.connected = false
        },
      },
    },
    render: () => null,
  }
  const testDefs = new Map(defs)
  testDefs.set('fake-i2c', fakeDef)
  const d = diagram([part(OLED, DISPLAY_DEF), part('other', 'fake-i2c')])
  const state = new Map<string, Record<string, unknown>>()
  const bus = createI2cBus(d, testDefs, state)

  ok('has() answers for the OLED', bus.has(ADDRESS) && !bus.has(0x99))

  let threw = false
  let acked = true
  try {
    bus.start(false)
    acked = bus.connect(0x99, true)
    bus.write(0x00)
    bus.write(0xaf)
    bus.stop()
  } catch {
    threw = true
  }
  ok('a transaction to an empty address is NACKed, does not throw', !threw && acked === false)

  // Writes to another address reach only that device.
  bus.start(false)
  bus.connect(0x50, true)
  bus.write(0xaa)
  bus.write(0xbb)
  bus.stop()
  const fakeBag = state.get('other')!
  const oledData = getPartDef(DISPLAY_DEF)!.device!.visual!(state.get(OLED)!).data as Record<string, unknown>
  const oledFb = oledData.fb as Uint8Array
  ok('another device received its own writes', fakeBag.count === 2 && fakeBag.last === 0xbb && fakeBag.connected === false)
  ok('another device did not touch the OLED framebuffer', oledFb.every((v) => v === 0))
}

// ============================ 4. controller-initiated read ============================
{
  const d = diagram([part(OLED, DISPLAY_DEF)])
  const state = new Map<string, Record<string, unknown>>()
  const bus = createI2cBus(d, defs, state)
  let value = -1
  let threw = false
  try {
    bus.start(false)
    const acked = bus.connect(ADDRESS, false) // SLA+R
    value = bus.read() // one byte, then controller NACKs
    bus.stop()
    ok('read: the OLED answers a read address', acked === true)
  } catch {
    threw = true
  }
  ok('read: returns a byte (0x00) and does not throw', !threw && value === 0x00)

  const READ_SKETCH = `#include <Wire.h>

void setup() {
  Wire.begin();
  Wire.requestFrom(0x3C, 1);
  while (Wire.available()) Wire.read();
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);
}

void loop() {}
`
  const { hex, fitsTarget } = await compileSketchInline(READ_SKETCH)
  ok('read: a requestFrom sketch compiles and fits', fitsTarget && hex.length > 1000)
  const readCircuit = displayCircuit()
  const readState = new Map<string, Record<string, unknown>>()
  const readBus = createI2cBus(readCircuit, defs, readState)
  const runtime = createAvrRuntime(part(UNO, 'arduino-uno'), getPartDef('arduino-uno')!, { i2c: readBus })
  runtime.load(hex)
  runFrames(runtime, readCircuit, 4, readState)
  const d13 = runtime.pinValues().get(`${UNO}:d13`)
  ok('read: the sketch gets past requestFrom and drives D13 (did not hang)', d13 === 1)
}

// ============================ 4b. no bus supplied: NACK, no hang ============================
{
  const NO_BUS_SKETCH = `#include <Wire.h>

void setup() {
  Wire.begin();
  Wire.beginTransmission(0x3C);
  Wire.write(0x00);
  Wire.write(0xAF);
  Wire.endTransmission();
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);
}

void loop() {}
`
  const { hex, fitsTarget } = await compileSketchInline(NO_BUS_SKETCH)
  ok('no bus: a Wire sketch still compiles and fits', fitsTarget && hex.length > 1000)
  const noBusCircuit = diagram([part(UNO, 'arduino-uno')])
  const runtime = createAvrRuntime(part(UNO, 'arduino-uno'), getPartDef('arduino-uno')!)
  runtime.load(hex)
  let threw = false
  try {
    runFrames(runtime, noBusCircuit, 4, new Map())
  } catch {
    threw = true
  }
  ok(
    'no bus: the transaction is NACKed and the sketch runs on (no hang)',
    !threw && runtime.pinValues().get(`${UNO}:d13`) === 1,
  )
}

// ============================ 5. invert and display-off in the rendered path ============================
{
  const bag = drive((bus) => {
    cmdTx(bus, [0xb0, 0x00, 0x11])
    dataTx(bus, [0b0000_0011])
  })
  const device = getPartDef(DISPLAY_DEF)!.device!
  const normal = device.visual!(bag).data as Record<string, unknown>
  const pathOn = pixelPath(normal)
  ok('render: two lit pixels draw two 1x1 subpaths', countLit(pathOn) === 2)
  ok('render: the path is well-formed for the canvas', pathOn === 'M22 10h1v1h-1zM22 11h1v1h-1z')

  const offBag = drive((bus) => cmdTx(bus, [0xae]))
  Object.assign(offBag, { fb: bag.fb, on: false })
  const pathOff = pixelPath(device.visual!(offBag).data as Record<string, unknown>)
  ok('render: display-off empties the path', pathOff === '')

  const invBag = drive((bus) => cmdTx(bus, [0xa7]))
  Object.assign(invBag, { fb: bag.fb })
  const pathInv = pixelPath(device.visual!(invBag).data as Record<string, unknown>)
  ok('render: invert flips the two lit pixels into the other 8190', countLit(pathInv) === 8192 - 2)
  ok('render: invert leaves the model buffer untouched', fbOf(bag)[16] === 0b0000_0011)
}

// ============================ 6. Adafruit_SSD1306 fit numbers ============================
{
  const ADAFRUIT_SKETCH = `#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(F("hello"));
  display.display();
}

void loop() {}
`
  const appError = await compileSketchInline(ADAFRUIT_SKETCH).then(
    () => null,
    (e: unknown) => String(e),
  )
  ok('Adafruit_SSD1306 does not link through the app compile path (OLED objects are not in the default link set)', appError !== null)
  if (appError) console.log(`  app compile rejected Adafruit_SSD1306 with: ${appError.split('\n').slice(0, 2).join(' ').slice(0, 160)}`)

  const withOled = await buildFirmware({ source: preprocessSketch(ADAFRUIT_SKETCH), sensors: [SENSOR.OLED] }).then(
    (r) => r,
    () => null,
  )
  if (withOled) {
    console.log(
      `  Adafruit_SSD1306 + Adafruit_GFX (OLED objects linked): ${withOled.flashBytes} flash bytes of ${withOled.target.appFlashBytes} (${withOled.fitsTarget ? 'fits' : 'OVER by ' + (withOled.flashBytes - withOled.target.appFlashBytes) + ' bytes'})`,
    )
    ok('Adafruit_SSD1306 fit is reported from a real link', typeof withOled.flashBytes === 'number' && withOled.flashBytes > 0)
  } else {
    ok('Adafruit_SSD1306 build with OLED objects reported a result', false)
  }
}

// ============================ 7. robustness ============================
{
  const empty = createI2cBus(diagram([part(UNO, 'arduino-uno')]), defs, new Map())
  ok('a diagram with no display gives a bus with nothing on it', !empty.has(ADDRESS))
  let acked = true
  let threw = false
  try {
    empty.start(false)
    acked = empty.connect(ADDRESS, true)
    empty.write(0x40)
    void empty.read()
    empty.stop()
  } catch {
    threw = true
  }
  ok('an empty bus NACKs and never throws', !threw && acked === false)

  let ghost = false
  try {
    createI2cBus(diagram([part('ghost', 'does-not-exist')]), defs, new Map())
  } catch {
    ghost = true
  }
  ok('an unknown part def does not throw', !ghost)

  const bag = drive((bus) => {
    cmdTx(bus, [0x21, 0x00, 0x7f, 0x22, 0x00, 0x07])
    dataTx(bus, [0xff])
  })
  const d = pixelPath(getPartDef(DISPLAY_DEF)!.device!.visual!(bag).data as Record<string, unknown>)
  ok('the rendered path has no NaN', !d.includes('NaN'))
  ok('a full row of 0xFF lights 8 pixels in one column-subpath run', countLit(d) === 8)
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
