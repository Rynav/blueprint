# Changelog

All notable changes to this project. Generated from Conventional Commits.
## [0.8.0] - 2026-10-18

### Features
- (**avr**) measure per-pin PWM duty and average it into the solve
- shortcut: the averaging is a DC equivalent - right for an LED's apparent brightness, wrong for anything sensing the switching itself (RC ripple, a speaker, motor back-EMF). Upgrade to a time-domain solve when those land.
- (**ui**) live pin voltmeter and PWM duty in the run loop


### Tests
- (**sample**) verify the app frame body, including a PWM fade

## [0.7.0] - 2026-10-18

### Documentation
- (**examples**) add a no-code 74HC595 LED bar graph sample


### Features
- (**avr**) close the simulation loop with readable input pins and ADC
- (**circuit**) model the chip's internal pull-up and the SPDT slide switch
- shortcut: the pull-up is a fixed 30k to an ideal 5 V, with no Vcc or temperature variation. The slide switch swaps throws instantaneously, with no break-before-make gap.
- (**ui**) wire input feedback into the run loop and let the button be pressed
- shortcut: input feedback lands one frame (16 ms) after the CPU ran, so a sketch cannot see its own input change within the same frame.


### Tests
- (**input**) round-trip suites plus a button example

## [0.6.0] - 2026-10-18

### Features
- (**devices**) digital peripheral framework with 74HC595 and 7-segment
- shortcut: devices are stepped in diagram order with no fixed-point iteration, so a two-device feedback loop settles a frame late. No per-pin resolution beyond 0/1/z. The 595's Q7S is not gated by OE. Only rail-5v and rail-gnd drive a net as a reference.
- (**avr**) record pin transitions so bit-banged clocks survive a frame


### Tests
- (**devices**) digital suites plus a single-frame replay regression

## [0.5.0] - 2026-10-18

### Features
- (**spice**) two-junction Ebers-Moll BJT and square-law MOSFET
- shortcut: no Early effect or emitter/collector series resistance, so Vce(sat) sits near 40 mV rather than a real device's 100-200 mV. No subthreshold or mobility terms in the FET model.
- (**parts**) analog device library and circuit mapping
- shortcut: the motor is coil resistance only, with no inductance, back-EMF or speed under PWM. No transistor body diode. LED and diode forward voltages do not drift with temperature.
- (**ui**) edit part parameters in the inspector


### Tests
- (**devices**) independent hand-computed device checks

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

