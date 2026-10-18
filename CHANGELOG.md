# Changelog

All notable changes to this project. Generated from Conventional Commits.
## [0.4.0] - 2026-10-18

### Bug Fixes
- (**compile**) add the Arduino.h include the toolchain expects
- shortcut: no automatic function-prototype generation, which the real IDE also does; a helper defined after loop() must be forward-declared by hand.


### Features
- (**compile**) in-browser WASM sketch compiler in a worker
- shortcut: the toolchain binaries are GPLv3 and ~53 MB, fetched at runtime rather than committed. Only the libraries precompiled into the package are linkable; there is no Library Manager. compileSketch has no timeout or cancellation.
- (**avr**) atmega328p runtime harness with timers, GPIO and serial
- shortcut: atmega328p only, no ADC input, no EEPROM persistence and no external interrupts from wired pins yet.
- (**circuit**) drive the solver from the netlist and light the LEDs
- shortcut: no capacitors or inductors, no PWM averaging (a pin is a hard 5 V or 0 V per solve), button state comes from params.pressed rather than UI, no MOSFET or BJT.
- (**ui**) sketch editor, serial monitor, build output and the run loop
- shortcut: a plain textarea rather than Monaco, whose bundler worker config cannot be verified without a browser. Monaco in P4.


### Tests
- end-to-end blink check and the full gate

## [0.3.0] - 2026-10-18

### Bug Fixes
- (**canvas**) keep wires on the pin, and fix rotation units
- shortcut: routing has no obstacle avoidance and only the source end is edge-aligned; upgrade when wires cross parts often.


### Features
- (**spice**) dense LU and modified nodal analysis solver
- shortcut: fixed absolute pivot floor; a conductance below ~1e-12 S would read as singular. Upgrade to a scaled pivot when sub-nanoamp paths matter.
- (**netlist**) union-find connectivity with internal part nets
- shortcut: breadboard rails are a single pin each rather than a row of holes; widen when the rails are redrawn.


### Tests
- (**netlist**) netlist suite and breadboard wiring assertions
- (**spice**) solver suite plus independent cross-checks

## [0.2.0] - 2026-10-18

### Features
- (**canvas**) diagram model, rotation geometry and zustand store
- (**parts**) data-driven registry of 15 components
- shortcut: breadboard models hole pins only, no internal row/rail bus nets; add nets in P2
- (**canvas**) interactive canvas with wiring, selection and notes
- shortcut: elbow routing has no obstacle avoidance and the marquee uses AABB; upgrade if routing quality matters
- (**ui**) parts palette, selection inspector and local persistence


### Maintenance
- enforce conventional commits with a commit-msg hook
- shortcut: hook only checks the subject line, not body/footer format; tighten if footers start drifting


### Tests
- headless integration check

## [0.1.0] - 2026-10-18

### Features
- (**ui**) four-panel blueprint app shell
- shortcut: version string hardcoded in panels.tsx as VERSION; inject from package.json at build time when release automation needs a single source of truth


### Maintenance
- scaffold vite + react + typescript
- add tailwind v4, shadcn/ui and blueprint theme

