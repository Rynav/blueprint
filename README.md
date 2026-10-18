# blueprint

A web playground for building and simulating electronics projects: a blueprint-style
canvas, a parts library, wiring, labels/notes, and in-browser Arduino C++ compilation.

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · shadcn/ui

## Package manager: bun

This project uses **bun**. `node` and `npm` are intentionally not used — `bun.lock`
is the lockfile and must be committed. Use `bun` / `bunx` for everything.

## Scripts

| Command                | What it does                                             |
| ---------------------- | -------------------------------------------------------- |
| `bun dev`              | Start the Vite dev server with HMR.                      |
| `bun run build`        | Type-check (`tsc -b`) and build for production.          |
| `bun run lint`         | Run oxlint.                                              |
| `bun run check`        | Headless checks: app (registry, store, undo/redo, persistence, wire routing, netlist) plus the SPICE solver suites. `check:app` / `check:spice` run them separately. |
| `bun run changelog`    | Regenerate `CHANGELOG.md` from Conventional Commits.     |

Other scripts: `bun run preview` (serve the production build), `bun run changelog:preview`
(print unreleased entries without writing the file).

## Editor

The sketch panel is Monaco: C++ syntax highlighting in the blueprint theme, plus **Arduino
intelligence** — completions and hover docs for the platform API and its constants
(`pinMode`, `analogRead`, `Serial.*`, `Wire.*`, `Servo.*`, the Adafruit display methods,
`HIGH`, `INPUT_PULLUP`, `SSD1306_WHITE`, …). Typing `Serial.` offers that object's methods.

It is **code-split** and wrapped in an error boundary with a plain textarea fallback: losing
syntax highlighting is cosmetic, losing the ability to write code is not.

The intelligence is a curated table in `src/lib/editor/arduino-api.ts`, not a language server
— a real C++ LSP needs clangd wasm-compiled alongside the compiler. Being pure data and pure
functions, it is unit-tested, including a check that every API name the shipped examples use
is actually documented.

## Operating parts with the mouse

Switches, buttons, potentiometers and the joystick can be **worked directly on the canvas**:
click a button to press it, click a slide switch to latch it, drag a potentiometer's knob to
turn it, drag the joystick to deflect it. Each shows the change — the actuator sinks, the
slider moves to its end, the knob's pointer rotates, the stick tilts.

Each part declares its own **control hotspot** (the actuator, the slider, the knob, the well),
so dragging the control operates it and dragging anywhere else on the part still moves the
part. The cursor changes over a hotspot, since a part cannot draw its own affordance.

Semantics follow the hardware rather than convenience: a push button is **momentary** (held
while the mouse is down, so `while (digitalRead(2) == LOW)` behaves), a slide switch
**latches**, and the joystick **self-centres** on release. A two-axis drag moves both
parameters in one gesture.

## Compile toolchain (P3)

Arduino C++ is compiled **entirely in the browser** — there is no build server. Sketches are
compiled to Intel HEX by AVR GCC and binutils built for WebAssembly
([`@horang-corp/avr-gcc-wasm`](https://www.npmjs.com/package/@horang-corp/avr-gcc-wasm)),
and the resulting HEX is executed by [`avr8js`](https://github.com/wokwi/avr8js).

Three things to know before deploying this anywhere public:

- **Licence.** The toolchain binaries are **GPLv3** (GCC + binutils). Serving them to a
  visitor's browser is distribution, which carries a corresponding-source obligation.
  Fine for local use; get it reviewed before a commercial release.
- **Weight.** ~53 MB of WASM and prebuilt Arduino objects are fetched at compile time and
  are deliberately **not** committed to the repo. `vite-plugin-avr-assets.ts` serves them at
  `/avr/` in dev and copies them into `dist/avr/` on build. The bundler additionally emits
  `cc1plus.wasm` (~14 MB) into `dist/assets/` because the package's Emscripten glue imports it
  statically; the runtime uses `/avr/tools/` instead, so that copy is redundant.
- **Libraries.** Only the libraries precompiled into that package are linkable (Servo, Wire,
  SPI, Adafruit GFX/SSD1306/BMP085/BusIO, DHT, VL53L0X…). There is no Library Manager. A part
  declares the object group it needs (`sensors: ['OLED']`) and the compile step unions those
  across the diagram; a library whose group nobody asked for will not link.

`compileSketch()` runs in a Web Worker so the canvas never stutters; `compileSketchInline()`
runs on the current thread and is what the headless tests use.

### Why the Pico is not simulated

The roadmap's P5 is **blocked, not skipped**: a Raspberry Pi Pico needs ARM firmware, and
there is no arm-gcc toolchain built for WebAssembly, no `picotool`, and the bundled toolchain
only carries AVR object groups (`base`, `oled`, `tof`). Since a Pico can only run a `.uf2`
that something else produced, adding `rp2040js` would give you a board you can *watch* but
never *program* — a picture, not a playground. It becomes worth building the moment either
(a) an in-browser arm-gcc exists, or (b) a backend compile for non-AVR boards is accepted.

## Examples

`examples/led-bar.json` — an **8-LED bar graph driven by a 74HC595**. Import it with the
inspector's Import button and press Run: it works with the **default Blink sketch, no code
needed**. D13 clocks the shift register while its data pin is tied high, so every rising edge
shifts in a 1 and latches it — one more LED lights each second until all eight are on.

`bun run check:sample` loads the shipped file through the real importer and asserts it still
does that, so the example cannot rot.

To make it a proper chaser instead, change the wiring (DS→D11, SHCP→D13, STCP→D12) and paste:

```cpp
void setup() {
  pinMode(11, OUTPUT);
  pinMode(12, OUTPUT);
  pinMode(13, OUTPUT);
}

void loop() {
  for (int i = 0; i < 8; i++) {
    digitalWrite(12, LOW);
    shiftOut(11, 13, MSBFIRST, 1 << i);
    digitalWrite(12, HIGH);
    delay(120);
  }
}
```

### `examples/button-led.json`

A **button that actually controls an LED** — the sketch reads the circuit. Import it, paste
this over the sketch, press Run, then **click the button on the canvas** (or set its *Pressed*
parameter in the Inspector):

```cpp
void setup() {
  pinMode(2, INPUT_PULLUP);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, digitalRead(2) == LOW ? HIGH : LOW);
}
```

The button pulls `D2` to GND and the chip's **internal pull-up** holds it high when released,
so `INPUT_PULLUP` works with no external resistor. `digitalRead` reads the *solved* net
voltage — a real round trip through the circuit, one frame of latency.

### `examples/oled-hello.json`

A **128×64 OLED on the I2C bus** (SDA→A4, SCL→A5), driven by the **real `Adafruit_SSD1306`
library** — not a stand-in. Import it, paste this, press Run:

```cpp
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(F("BLUEPRINT"));
  display.display();
}

void loop() {}
```

`display.println` paints a simulated SSD1306's framebuffer, and the canvas draws the pixels —
the 552 lit pixels of that text are what the chip was actually told to write.

The toolchain only links a library when its object group is requested, so a part **declares**
what it needs (`sensors: ['OLED']`) and the compile step unions those across the diagram.
Without that declaration an `Adafruit_SSD1306` sketch fails to link — there is a test for
exactly that, because it is easy to mistake for a code error.

## Status / roadmap

| Phase | Scope                                  | Status |
| ----- | -------------------------------------- | ------ |
| P0    | App shell (four-panel blueprint layout) | done   |
| P1    | Canvas editor (pan, zoom, parts, wiring) | done   |
| P2    | SPICE core (analog simulation)          | done   |
| P3    | Blink end-to-end (in-browser Arduino C++ compile) | done   |
| P4a   | Analog devices, models and inspector params | done   |
| P4b   | Digital peripherals (displays, shift registers, keypads) | done   |
| P4c   | Input devices (buttons, keypads, analog sensors) | done   |
| P4d   | PWM averaging and a live pin voltmeter | done   |
| P4e   | I²C/SPI displays (OLED, LCD)            | done (OLED) |
| P4f   | Servo and a 4x4 keypad (library depth)  | done   |
| P4g   | Parallel LCD, stepper and joystick      | done   |
| P4h   | Monaco: syntax highlighting and Arduino completions | done   |
| P4i   | Mouse-operable switches, button, pot and joystick | done   |
| P6    | Edge-driven input: timed devices and the ultrasonic sensor | done   |
| P5    | Pico simulation                         | blocked — no ARM toolchain |

## License

[MIT](LICENSE) — the app's own source, and nothing else.

The compile toolchain is **not** covered by it. `@horang-corp/avr-gcc-wasm` packages GCC and
GNU binutils built for WebAssembly, and those are **GPLv3 or later**. They are not part of
this repository, but deploying the app serves them to visitors, which carries the GPL's
corresponding-source obligation. Full details in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and
[Compile toolchain](#compile-toolchain-p3).

## Conventional Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org)
(`type(scope): summary`). Deliberate simplifications are noted in the commit body with a
`shortcut: ...` line.

`CHANGELOG.md` is **generated from these commits by git-cliff** (config in `cliff.toml`) —
do not hand-edit it. Run `bun run changelog` to regenerate.

The format is enforced by a `commit-msg` hook in `.githooks/`, wired up by the `prepare`
script on install. Non-conventional subjects are rejected, and `filter_unconventional = true`
means an unchecked one would silently vanish from the changelog — the hook prevents that.
