import { apiEntry, ARDUINO_API, complete, resolveAt, wordsUsedIn } from '@/lib/editor/arduino-api'

/**
 * The editor intelligence is pure data + pure functions, so it is testable without a
 * browser - which matters, because the Monaco widget around it cannot be.
 */

let failed = 0
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${name}`)
  if (!cond) failed++
}

// ---------------------------------------------------------------- table integrity
ok('the API table is populated', ARDUINO_API.length >= 80)
ok(
  'every entry is complete',
  ARDUINO_API.every((e) => e.label && e.insertText && e.detail && e.doc),
)
ok('labels are unique', new Set(ARDUINO_API.map((e) => e.label)).size === ARDUINO_API.length)
ok(
  'every kind is one we declared',
  ARDUINO_API.every((e) => ['function', 'constant', 'class', 'method', 'type'].includes(e.kind)),
)
ok(
  'a function inserts a call, a constant inserts itself',
  ARDUINO_API.filter((e) => e.kind === 'function').every((e) => e.insertText.includes('(')) &&
    ARDUINO_API.filter((e) => e.kind === 'constant').every((e) => e.insertText === e.label),
)
ok(
  'snippet placeholders are well formed',
  ARDUINO_API.every((e) => {
    const opens = (e.insertText.match(/\$\{?/g) ?? []).length
    const closes = (e.insertText.match(/\}/g) ?? []).length + (e.insertText.match(/\$\d(?!\{)/g) ?? []).length
    return opens === closes
  }),
)

// ---------------------------------------------------------------- completion
ok('an empty prefix offers everything', complete('').length === ARDUINO_API.length)
ok(
  'a prefix filters case-insensitively',
  ['dig', 'DIG', 'Dig'].every((p) =>
    complete(p).some((e) => e.label === 'digitalWrite'),
  ),
)
ok('digitalWrite and digitalRead are both offered', complete('digital').length >= 2)
ok('function names complete', complete('analogW').some((e) => e.label === 'analogWrite'))
ok('constants complete', complete('INPUT_').some((e) => e.label === 'INPUT_PULLUP'))
ok('methods complete on their object', complete('Serial.pr').some((e) => e.label === 'Serial.println'))
ok('an unknown prefix offers nothing', complete('zzzzz').length === 0)

// ---------------------------------------------------------------- hover
ok('hover resolves an exact name', apiEntry('pinMode')?.detail.includes('pinMode'))
ok('hover resolves a method', apiEntry('Wire.requestFrom')?.detail.includes('requestFrom'))
ok('hover resolves a constant', apiEntry('MSBFIRST') !== undefined)
ok('hover is case-insensitive', apiEntry('digitalwrite')?.label === 'digitalWrite')
ok('hover misses are undefined', apiEntry('nonsense') === undefined)

// Dotted methods: Monaco hands over only the last word, so the qualifier must be recovered.
ok(
  'a dotted method resolves (Serial.begin)',
  resolveAt('  Serial.begin(9600);', 9, 'begin')?.label === 'Serial.begin',
)
ok(
  'a dotted method resolves (display.setTextSize)',
  resolveAt('  display.setTextSize(2);', 10, 'setTextSize')?.label === 'display.setTextSize',
)
ok('a bare name still resolves', resolveAt('  delay(500);', 2, 'delay')?.label === 'delay')
ok('an unknown dotted method resolves to nothing', resolveAt('x.foo();', 2, 'foo') === undefined)

// ---------------------------------------------------------------- what our own docs teach
// Every API name the shipped examples and the README use must be documented, or the
// completions are useless exactly where a reader needs them.
const TAUGHT = [
  'pinMode',
  'digitalWrite',
  'digitalRead',
  'analogWrite',
  'analogRead',
  'delay',
  'shiftOut',
  'Serial',
  'Serial.begin',
  'Serial.println',
  'Wire',
  'loop',
  'delayMicroseconds',
  'writeMicroseconds',
  'attach',
  'display.begin',
  'display.clearDisplay',
  'display.display',
  'display.setCursor',
  'display.setTextSize',
  'display.setTextColor',
  'Adafruit_SSD1306',
  'Servo',
  'HIGH',
  'LOW',
  'OUTPUT',
  'INPUT_PULLUP',
  'LED_BUILTIN',
  'MSBFIRST',
  'SSD1306_WHITE',
  'SSD1306_SWITCHCAPVCC',
]
const missing = TAUGHT.filter((name) => apiEntry(name) === undefined)
ok(`every API name our docs use is documented (${TAUGHT.length} checked)`, missing.length === 0)
if (missing.length) console.log('   undocumented:', missing.join(', '))

// ---------------------------------------------------------------- sketch scanning
const sketch = `void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
}
void loop() {
  digitalWrite(13, HIGH);
  delay(500);
}`
const words = wordsUsedIn(sketch)
ok('scanning finds identifiers', words.has('digitalWrite') && words.has('delay'))
ok('scanning ignores punctuation and numbers', !words.has('500') && !words.has('void('))
const unknown = [...words].filter(
  (w) => apiEntry(w) === undefined && !['void', 'setup', 'loop', 'int', 'if', 'for', 'while'].includes(w),
)
console.log(`\n  identifiers in a blink sketch not in the API table: ${unknown.join(', ') || 'none'}\n`)

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`)
process.exit(failed === 0 ? 0 : 1)
