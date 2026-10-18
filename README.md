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

## Status / roadmap

| Phase | Scope                                  | Status |
| ----- | -------------------------------------- | ------ |
| P0    | App shell (four-panel blueprint layout) | done   |
| P1    | Canvas editor (pan, zoom, parts, wiring) | done   |
| P2    | SPICE core (analog simulation)          | done   |
| P3    | Blink end-to-end (in-browser Arduino C++ compile) | done   |
| P4a   | Analog devices, models and inspector params | done   |
| P4b   | Digital peripherals (displays, shift registers, keypads) | done   |
| P4c   | Input devices (buttons, keypads, analog sensors) | –      |
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
