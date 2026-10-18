/**
 * The Arduino API surface the editor offers as completions and hover docs.
 *
 * This is deliberately a curated table rather than a language server: a real C++ LSP needs
 * clangd, which would have to be wasm-compiled alongside the compiler. A hand-written table
 * is what actually helps here, because what someone writing an Arduino sketch needs is the
 * platform API and its constants, not C++ semantics.
 *
 * Pure data and pure functions, so the intelligence is testable without a browser.
 */

export type ApiKind = 'function' | 'constant' | 'class' | 'method' | 'type'

export interface ApiEntry {
  /** What the completion list shows, and what hover matches on. */
  label: string
  /** Snippet inserted on accept: `$1`, `${2:name}` placeholders. */
  insertText: string
  /** One-line signature shown next to the label. */
  detail: string
  /** Markdown documentation shown in the tooltip / hover. */
  doc: string
  kind: ApiKind
}

const fn = (label: string, detail: string, doc: string, insertText = `${label}($0)`): ApiEntry => ({
  label,
  insertText,
  detail,
  doc,
  kind: 'function',
})

const method = (
  label: string,
  detail: string,
  doc: string,
  insertText = `${label}($0)`,
): ApiEntry => ({ label, insertText, detail, doc, kind: 'method' })

const const_ = (label: string, doc: string, detail = `#define ${label}`): ApiEntry => ({
  label,
  insertText: label,
  detail,
  doc,
  kind: 'constant',
})

export const ARDUINO_API: ApiEntry[] = [
  // ---- digital and analog I/O ----
  fn('pinMode', 'void pinMode(uint8_t pin, uint8_t mode)', 'Configure a pin as `INPUT`, `OUTPUT` or `INPUT_PULLUP`.', 'pinMode(${1:pin}, ${2:OUTPUT})'),
  fn('digitalWrite', 'void digitalWrite(uint8_t pin, uint8_t value)', 'Drive a pin `HIGH` or `LOW`.', 'digitalWrite(${1:pin}, ${2:HIGH})'),
  fn('digitalRead', 'int digitalRead(uint8_t pin)', 'Read a pin as `HIGH` or `LOW`.'),
  fn('analogRead', 'int analogRead(uint8_t pin)', 'Read an analog pin as 0-1023 (10-bit, against 5 V).'),
  fn('analogWrite', 'void analogWrite(uint8_t pin, int value)', 'PWM a pin, 0-255. The LED dims rather than flickers in simulation.', 'analogWrite(${1:pin}, ${2:value})'),
  fn('analogReference', 'void analogReference(uint8_t type)', 'Select the ADC reference voltage.'),

  // ---- time ----
  fn('delay', 'void delay(unsigned long ms)', 'Pause for milliseconds.', 'delay(${1:500})'),
  fn('delayMicroseconds', 'void delayMicroseconds(unsigned int us)', 'Pause for microseconds.', 'delayMicroseconds(${1:10})'),
  fn('millis', 'unsigned long millis()', 'Milliseconds since the board started.'),
  fn('micros', 'unsigned long micros()', 'Microseconds since the board started.'),

  // ---- maths and randomness ----
  fn('map', 'long map(long x, long in_min, long in_max, long out_min, long out_max)', 'Re-map a number from one range to another.', 'map(${1:x}, ${2:0}, ${3:1023}, ${4:0}, ${5:255})'),
  fn('constrain', 'long constrain(long x, long a, long b)', 'Clamp `x` into the range `a`..`b`.', 'constrain(${1:x}, ${2:0}, ${3:255})'),
  fn('min', 'min(a, b)', 'The smaller of two values.', 'min(${1:a}, ${2:b})'),
  fn('max', 'max(a, b)', 'The larger of two values.', 'max(${1:a}, ${2:b})'),
  fn('abs', 'abs(x)', 'Absolute value.', 'abs(${1:x})'),
  fn('pow', 'double pow(double base, double exponent)', 'Raise to a power.', 'pow(${1:base}, ${2:exp})'),
  fn('sqrt', 'double sqrt(double x)', 'Square root.', 'sqrt(${1:x})'),
  fn('random', 'long random(long max)', 'A pseudo-random number between 0 and max-1.', 'random(${1:100})'),
  fn('randomSeed', 'void randomSeed(unsigned long seed)', 'Seed the random generator.', 'randomSeed(${1:seed})'),

  // ---- tone, pulses, shifting, interrupts ----
  fn('tone', 'void tone(uint8_t pin, unsigned int frequency)', 'Play a square wave on a pin. This is how a buzzer is driven.', 'tone(${1:pin}, ${2:440})'),
  fn('noTone', 'void noTone(uint8_t pin)', 'Stop the tone on a pin.'),
  fn('pulseIn', 'unsigned long pulseIn(uint8_t pin, uint8_t value)', 'Measure a pulse width in microseconds.', 'pulseIn(${1:pin}, ${2:HIGH})'),
  fn('shiftOut', 'void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t value)', 'Clock out a byte - how a 74HC595 is driven.', 'shiftOut(${1:dataPin}, ${2:clockPin}, ${3:MSBFIRST}, ${4:value})'),
  fn('shiftIn', 'uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder)', 'Clock in a byte.', 'shiftIn(${1:dataPin}, ${2:clockPin}, ${3:MSBFIRST})'),
  fn('attachInterrupt', 'void attachInterrupt(uint8_t interrupt, void (*)(void) isr, int mode)', 'Run a function when a pin changes.', 'attachInterrupt(${1:digitalPinToInterrupt(pin)}, ${2:isr}, ${3:CHANGE})'),
  fn('detachInterrupt', 'void detachInterrupt(uint8_t interrupt)', 'Stop an interrupt.'),
  fn('digitalPinToInterrupt', 'int digitalPinToInterrupt(uint8_t pin)', 'Translate a pin number to an interrupt number.'),

  // ---- Serial ----
  { label: 'Serial', insertText: 'Serial', detail: 'HardwareSerial', doc: 'The serial port. Output appears in the Serial tab.', kind: 'class' },
  method('Serial.begin', 'void Serial.begin(unsigned long baud)', 'Open the serial port. Output appears in the Serial tab.', 'Serial.begin(${1:9600})'),
  method('Serial.print', 'size_t Serial.print(value)', 'Print a value.'),
  method('Serial.println', 'size_t Serial.println(value)', 'Print a value followed by a newline.'),
  method('Serial.write', 'size_t Serial.write(uint8_t value)', 'Write a raw byte.'),
  method('Serial.available', 'int Serial.available()', 'Bytes waiting to be read.'),
  method('Serial.read', 'int Serial.read()', 'Read one byte, or -1.'),
  method('Serial.readString', 'String Serial.readString()', 'Read until a timeout.'),
  method('Serial.flush', 'void Serial.flush()', 'Wait for outgoing data to drain.'),
  method('Serial.end', 'void Serial.end()', 'Close the serial port.'),

  // ---- Wire (I2C) ----
  { label: 'Wire', insertText: 'Wire', detail: 'TwoWire', doc: 'The I2C bus. On an Uno, SDA is A4 and SCL is A5.', kind: 'class' },
  method('Wire.begin', 'void Wire.begin()', 'Join the I2C bus as controller.', 'Wire.begin()'),
  method('Wire.beginTransmission', 'void Wire.beginTransmission(uint8_t address)', 'Start a write to a device address.', 'Wire.beginTransmission(${1:0x3C})'),
  method('Wire.write', 'size_t Wire.write(uint8_t data)', 'Queue a byte to send.'),
  method('Wire.endTransmission', 'uint8_t Wire.endTransmission()', 'Send the queued bytes.'),
  method('Wire.requestFrom', 'uint8_t Wire.requestFrom(uint8_t address, uint8_t quantity)', 'Read bytes from a device.', 'Wire.requestFrom(${1:0x3C}, ${2:1})'),
  method('Wire.available', 'int Wire.available()', 'Bytes available from the last read.'),
  method('Wire.read', 'int Wire.read()', 'Read one byte from the device.'),

  // ---- SPI ----
  { label: 'SPI', insertText: 'SPI', detail: 'SPIClass', doc: 'The SPI bus.', kind: 'class' },
  method('SPI.begin', 'void SPI.begin()', 'Join the SPI bus.', 'SPI.begin()'),
  method('SPI.transfer', 'uint8_t SPI.transfer(uint8_t data)', 'Send a byte and receive one back.'),
  method('SPI.end', 'void SPI.end()', 'Leave the SPI bus.'),

  // ---- Servo ----
  method('attach', 'void Servo::attach(int pin)', 'Attach a servo to a pin.', 'attach(${1:9})'),
  method('write', 'void Servo::write(int angle)', 'Set the servo angle, 0-180 degrees.', 'write(${1:90})'),
  method('writeMicroseconds', 'void Servo::writeMicroseconds(int us)', 'Set the pulse width directly, 1000-2000 us.', 'writeMicroseconds(${1:1500})'),
  method('detach', 'void Servo::detach()', 'Detach the servo.'),

  // ---- SSD1306 / GFX ----
  method('display.begin', 'bool Adafruit_SSD1306::begin(uint8_t switchvcc, uint8_t i2caddr)', 'Initialise the OLED - address 0x3C for the common 128x64 module.', 'display.begin(${1:SSD1306_SWITCHCAPVCC}, ${2:0x3C})'),
  method('display.clearDisplay', 'void Adafruit_GFX::clearDisplay()', 'Blank the framebuffer.', 'clearDisplay()'),
  method('display.display', 'void Adafruit_SSD1306::display()', 'Push the framebuffer to the panel.', 'display()'),
  method('display.setCursor', 'void Adafruit_GFX::setCursor(int16_t x, int16_t y)', 'Move the text cursor.', 'setCursor(${1:0}, ${2:0})'),
  method('display.setTextSize', 'void Adafruit_GFX::setTextSize(uint8_t size)', 'Scale the text.', 'setTextSize(${1:2})'),
  method('display.setTextColor', 'void Adafruit_GFX::setTextColor(uint16_t color)', 'Set the text colour.', 'setTextColor(${1:SSD1306_WHITE})'),
  method('display.setRotation', 'void Adafruit_GFX::setRotation(uint8_t rotation)', 'Rotate the display.', 'setRotation(${1:0})'),
  method('display.drawPixel', 'void Adafruit_GFX::drawPixel(int16_t x, int16_t y, uint16_t color)', 'Light one pixel.', 'drawPixel(${1:0}, ${2:0}, ${3:SSD1306_WHITE})'),
  method('display.drawLine', 'void Adafruit_GFX::drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color)', 'Draw a line.', 'drawLine(${1:0}, ${2:0}, ${3:127}, ${4:63}, ${5:SSD1306_WHITE})'),
  method('display.drawRect', 'void Adafruit_GFX::drawRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color)', 'Draw a rectangle outline.', 'drawRect(${1:0}, ${2:0}, ${3:10}, ${4:10}, ${5:SSD1306_WHITE})'),
  method('display.fillRect', 'void Adafruit_GFX::fillRect(int16_t x, int16_t y, int16_t w, int16_t h, uint16_t color)', 'Draw a filled rectangle.', 'fillRect(${1:0}, ${2:0}, ${3:10}, ${4:10}, ${5:SSD1306_WHITE})'),
  method('display.fillScreen', 'void Adafruit_GFX::fillScreen(uint16_t color)', 'Fill the whole panel.', 'fillScreen(${1:SSD1306_WHITE})'),

  // ---- constants ----
  const_('HIGH', 'Logic high.'),
  const_('LOW', 'Logic low.'),
  const_('INPUT', 'Pin mode: read a level.'),
  const_('OUTPUT', 'Pin mode: drive a level.'),
  const_('INPUT_PULLUP', 'Pin mode: read, with the chip holding it high until something pulls it low.'),
  const_('LED_BUILTIN', 'The on-board LED, pin 13 on an Uno.'),
  const_('true', 'Boolean true.'),
  const_('false', 'Boolean false.'),
  const_('NULL', 'Null pointer.'),
  const_('A0', 'Analog pin 0 - also a digital pin.'),
  const_('A1', 'Analog pin 1.'),
  const_('A2', 'Analog pin 2.'),
  const_('A3', 'Analog pin 3.'),
  const_('A4', 'Analog pin 4 - also SDA on an Uno.'),
  const_('A5', 'Analog pin 5 - also SCL on an Uno.'),
  const_('CHANGE', 'Interrupt on any change.'),
  const_('RISING', 'Interrupt on a rising edge.'),
  const_('FALLING', 'Interrupt on a falling edge.'),
  const_('LSBFIRST', 'Shift the least significant bit first.'),
  const_('MSBFIRST', 'Shift the most significant bit first.'),
  const_('DEC', 'Print in decimal.'),
  const_('HEX', 'Print in hexadecimal.'),
  const_('BIN', 'Print in binary.'),
  const_('SSD1306_WHITE', 'OLED pixel on.'),
  const_('SSD1306_BLACK', 'OLED pixel off.'),
  const_('SSD1306_SWITCHCAPVCC', 'Power the OLED from its own charge pump.'),

  // ---- types and classes ----
  { label: 'byte', insertText: 'byte', detail: '8-bit unsigned', doc: 'An 8-bit unsigned integer.', kind: 'type' },
  { label: 'word', insertText: 'word', detail: '16-bit unsigned', doc: 'A 16-bit unsigned integer.', kind: 'type' },
  { label: 'boolean', insertText: 'boolean', detail: 'bool', doc: 'True or false.', kind: 'type' },
  { label: 'String', insertText: 'String', detail: 'Arduino String', doc: 'A heap-allocated string.', kind: 'type' },
  { label: 'uint8_t', insertText: 'uint8_t', detail: '8-bit unsigned', doc: 'A fixed-width unsigned integer.', kind: 'type' },
  { label: 'uint16_t', insertText: 'uint16_t', detail: '16-bit unsigned', doc: 'A fixed-width unsigned integer.', kind: 'type' },
  { label: 'uint32_t', insertText: 'uint32_t', detail: '32-bit unsigned', doc: 'A fixed-width unsigned integer.', kind: 'type' },
  { label: 'Servo', insertText: 'Servo', detail: 'Servo library class', doc: 'Declare one per servo: `Servo arm;`', kind: 'class' },
  { label: 'Adafruit_SSD1306', insertText: 'Adafruit_SSD1306', detail: 'OLED driver class', doc: '`Adafruit_SSD1306 display(128, 64, &Wire, -1);`', kind: 'class' },
  { label: 'Adafruit_GFX', insertText: 'Adafruit_GFX', detail: 'Graphics base class', doc: 'Base class for Adafruit displays.', kind: 'class' },

  // ---- sketch structure ----
  fn('setup', 'void setup()', 'Runs once at power-on.'),
  fn('loop', 'void loop()', 'Runs forever after setup().'),
]

/** Index for O(1) hover lookups, built once. */
const BY_LABEL = new Map(ARDUINO_API.map((e) => [e.label, e]))
/** Case-insensitive index, so `digitalwrite` finds `digitalWrite`. */
const BY_LOWER = new Map(ARDUINO_API.map((e) => [e.label.toLowerCase(), e]))

/** The entry for an exact name, e.g. for hover. Case-insensitive. */
export function apiEntry(name: string): ApiEntry | undefined {
  return BY_LABEL.get(name) ?? BY_LOWER.get(name.toLowerCase())
}

/**
 * The object a dotted access is qualified by: 'Serial' for `Serial.` when the word starts
 * at `wordStart`. Monaco only ever gives the last identifier, so this is how a qualified
 * name gets reconstructed.
 */
export function qualifierAt(lineText: string, wordStart: number): string | undefined {
  if (lineText[wordStart - 1] !== '.') return undefined
  return lineText.slice(0, wordStart - 1).match(/([A-Za-z_][A-Za-z0-9_]*)$/)?.[1]
}

/**
 * Resolve the symbol under a cursor. Monaco's word at a position is only the last
 * identifier, so `Serial.begin` arrives as `begin` - the qualifier has to be read back
 * off the line or dotted methods never hover.
 */
export function resolveAt(
  lineText: string,
  wordStart: number,
  word: string,
): ApiEntry | undefined {
  const qualifier = qualifierAt(lineText, wordStart)
  if (qualifier) {
    const qualified = apiEntry(`${qualifier}.${word}`)
    if (qualified) return qualified
  }
  return apiEntry(word)
}

/**
 * Completions for a typed prefix. An empty prefix returns everything, which is what the
 * suggest widget asks for when it opens without a word under the cursor.
 */
export function complete(prefix: string): ApiEntry[] {
  const p = prefix.toLowerCase()
  if (!p) return ARDUINO_API
  return ARDUINO_API.filter((e) => e.label.toLowerCase().startsWith(p))
}

/** Identifiers in a sketch, for diagnostics and the coverage check. */
export function wordsUsedIn(source: string): Set<string> {
  return new Set(source.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])
}
