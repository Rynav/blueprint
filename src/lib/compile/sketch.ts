/**
 * Mirrors the Arduino IDE's sketch preprocessing: an `.ino` gets `#include <Arduino.h>`
 * added when it does not already include it. The WASM toolchain compiles C++ verbatim,
 * so without this a perfectly ordinary sketch fails with
 * `'HIGH' was not declared in this scope`.
 *
 * shortcut: no automatic function-prototype generation, which the real IDE also does.
 * A helper defined after `loop()` must be forward-declared by the author.
 */
export function preprocessSketch(source: string): string {
  if (/^\s*#\s*include\s*[<"]Arduino\.h[>"]/m.test(source)) return source
  return `#include <Arduino.h>\n\n${source}`
}
