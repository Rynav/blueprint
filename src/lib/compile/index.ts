// @ts-expect-error -- @horang-corp/avr-gcc-wasm ships no type declarations (and an untyped module cannot be augmented)
import { buildFirmware } from '@horang-corp/avr-gcc-wasm'

import type { BuildRequest, BuildResponse } from './worker'
import { preprocessSketch } from './sketch'

export { parseIntelHex } from './hex'
export { preprocessSketch } from './sketch'

export interface CompileResult {
  hex: string
  fitsTarget: boolean
}

/**
 * Compiles on the current thread. Also the path used by tests: no `Worker`/
 * `import.meta.url` handling, so it runs under bun and any non-DOM caller.
 *
 * @param assetsBase where the toolchain's tools/ and assets/ are served from;
 *   omit to use the package's own files (correct under bun, not in a browser).
 */
export async function compileSketchInline(source: string, assetsBase?: string | URL): Promise<CompileResult> {
  const { hex, fitsTarget } = await buildFirmware({ source: preprocessSketch(source), assetsBase })
  return { hex, fitsTarget }
}

let nextBuildId = 1

/**
 * Compiles in a dedicated Web Worker so the canvas never stutters. **Browser only**:
 * it requires `Worker` and import.meta.url resolution (Vite bundles worker.ts into
 * its own chunk). Use compileSketchInline anywhere else.
 *
 * A fresh worker per build is terminated as soon as it answers, which keeps the
 * toolchain's linear memory (a few MB per tool) from accumulating.
 *
 * shortcut: no timeout and no cancellation — the promise settles on the worker's
 * message/error only, so a wedged asset fetch would hang it. Add an AbortSignal
 * timeout when builds become user-cancellable.
 */
export function compileSketch(source: string, assetsBase?: string | URL): Promise<CompileResult> {
  const id = nextBuildId++
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

  return new Promise((resolve, reject) => {
    worker.addEventListener('message', (event) => {
      const data = event.data as BuildResponse
      if (data.id !== id) return
      worker.terminate()
      if ('error' in data) reject(new Error(data.error))
      else resolve({ hex: data.hex, fitsTarget: data.fitsTarget })
    })

    worker.addEventListener('error', (event) => {
      worker.terminate()
      reject(new Error(event.message || 'AVR compile worker failed'))
    })

    // A URL instance is not reliably structured-cloneable across browsers, so send a string.
    const request: BuildRequest = { id, source: preprocessSketch(source), assetsBase: assetsBase == null ? undefined : String(assetsBase) }
    worker.postMessage(request)
  })
}
