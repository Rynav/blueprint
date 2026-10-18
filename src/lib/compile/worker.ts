// Module Web Worker wrapper around buildFirmware. The toolchain's own `compile()`
// helper exists, but it lives in a Worker only it spawns; this one lets the app own
// the worker's lifetime and serves the message shapes typed below.
// @ts-expect-error -- @horang-corp/avr-gcc-wasm ships no type declarations (and an untyped module cannot be augmented)
import { buildFirmware } from '@horang-corp/avr-gcc-wasm'

export interface BuildRequest {
  id: number
  source: string
  /** Where tools/ and assets/ are served from (e.g. "/avr/"). Defaults to the package. */
  assetsBase?: string
}

export type BuildResponse =
  | { id: number; hex: string; fitsTarget: boolean }
  | { id: number; error: string }

addEventListener('message', async (event) => {
  const { id, source, assetsBase } = event.data as BuildRequest
  try {
    const { hex, fitsTarget } = await buildFirmware({ source, assetsBase })
    postMessage({ id, hex, fitsTarget } satisfies BuildResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Never let the worker die silently: report, and only give up if the port is gone.
    try {
      postMessage({ id, error: message } satisfies BuildResponse)
    } catch {
      /* port closed; nothing left to report with */
    }
  }
})
