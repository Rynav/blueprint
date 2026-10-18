# Third-party notices

The MIT licence in [LICENSE](LICENSE) covers this project's own source code only.
Everything below is covered by its own licence instead.

## The AVR compile toolchain — GPLv3 or later

`@horang-corp/avr-gcc-wasm` packages the **GCC AVR compiler** and **GNU binutils**
(`cc1plus`, `avr-as`, `avr-ld`, `avr-objcopy`) built for WebAssembly. Those components are
**GNU GPL v3 or later**, as is their avr-libc-derived material.

It is a declared dependency, fetched at install time and served at runtime — it is **not**
part of this repository, and the MIT licence above does not apply to it.

**If you deploy this app, you are distributing those GPLv3 binaries to your visitors**, which
carries the GPL's corresponding-source obligation: anyone who receives the binaries must be
able to get their source. Complying means offering the GCC/binutils sources and the build
scripts used to produce them. Running it locally carries no such obligation.

Its own `THIRD_PARTY_NOTICES.md`, in the installed package, lists the exact inputs
(Arduino AVR core, Wire, SPI, Servo, Firmata, Adafruit GFX/SSD1306/BMP085/BusIO, DHT,
VL53L0X) and their upstream licenses. See also the "Compile toolchain" section of README.md.

## Runtime and build dependencies

All permissively licensed: React, React DOM and `react-resizable-panels` (MIT);
`avr8js` (MIT); Tailwind CSS (MIT); shadcn/ui components, which are copied into
`src/components/ui` rather than depended on (MIT); Radix UI (MIT); `lucide-react` (ISC);
`class-variance-authority`, `zustand` and `cn` (MIT); Geist, via
`@fontsource-variable/geist` (SIL OFL 1.1).
