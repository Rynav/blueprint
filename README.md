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
  SPI, Adafruit GFX/SSD1306/BMP085/BusIO, DHT, VL53L0X…). There is no Library Manager.

`compileSketch()` runs in a Web Worker so the canvas never stutters; `compileSketchInline()`
runs on the current thread and is what the headless tests use.

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

A **button that actually controls an LED** — the sketch reads the circuit. Import it, then
paste this over the sketch and press Run, then flip the button's **Pressed** parameter in the
Inspector:

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
| P4e   | I²C/SPI displays (OLED, LCD)            | –      |
| P5    | Pico simulation                         | –      |

## Conventional Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org)
(`type(scope): summary`). Deliberate simplifications are noted in the commit body with a
`shortcut: ...` line.

`CHANGELOG.md` is **generated from these commits by git-cliff** (config in `cliff.toml`) —
do not hand-edit it. Run `bun run changelog` to regenerate.

The format is enforced by a `commit-msg` hook in `.githooks/`, wired up by the `prepare`
script on install. Non-conventional subjects are rejected, and `filter_unconventional = true`
means an unchecked one would silently vanish from the changelog — the hook prevents that.
