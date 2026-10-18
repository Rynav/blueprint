import { createReadStream, existsSync } from 'node:fs'
import { cp, mkdir } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { Connect, Plugin, ResolvedConfig } from 'vite'

// Why this plugin exists: @horang-corp/avr-gcc-wasm discovers its 16 MB of WASM and
// 37 MB of prebuilt Arduino objects at runtime, from a JSON manifest and a
// `locateFile()` callback. No bundler can statically see those URLs, so Vite never
// emits them. Serving the package's own directories under /avr/ - and pointing the
// toolchain there with `{ assetsBase: '/avr/' }` - is the whole job.
const PKG = '@horang-corp/avr-gcc-wasm'
const PREFIX = '/avr/'
const MIME: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.map': 'application/json',
}

/** Serve `<pkgDir>/…` for `/avr/…`, leaving everything else to Vite. */
function serveAvr(pkgDir: string): Connect.NextHandleFunction {
  return (req, res, next) => {
    const path = req.url?.split('?')[0]
    if (!path?.startsWith(PREFIX)) return next()

    const file = resolve(pkgDir, decodeURIComponent(path.slice(PREFIX.length)))
    if (!file.startsWith(pkgDir + sep) || !existsSync(file)) return next()

    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream')
    createReadStream(file).pipe(res)
  }
}

export default function avrAssets(): Plugin {
  let pkgDir = ''
  let outDir = ''
  let logger: ResolvedConfig['logger']

  return {
    name: 'blueprint:avr-assets',

    configResolved(config) {
      pkgDir = resolve(config.root, 'node_modules', PKG)
      outDir = resolve(config.root, config.build.outDir)
      logger = config.logger
    },

    configureServer(server) {
      if (!existsSync(pkgDir)) return logger.warn(`avr-assets: ${PKG} not installed; /avr/* will 404`)
      server.middlewares.use(serveAvr(pkgDir))
    },

    configurePreviewServer(server) {
      if (!existsSync(pkgDir)) return logger.warn(`avr-assets: ${PKG} not installed; /avr/* will 404`)
      server.middlewares.use(serveAvr(pkgDir))
    },

    async closeBundle() {
      if (!existsSync(pkgDir)) {
        logger.warn(`avr-assets: ${PKG} not installed; skipping the copy to dist/avr/ (toolchain will be unavailable)`)
        return
      }
      const dest = join(outDir, 'avr')
      await mkdir(dest, { recursive: true })
      for (const dir of ['tools', 'assets']) await cp(join(pkgDir, dir), join(dest, dir), { recursive: true })
      logger.info(`avr-assets: copied tools/ and assets/ to ${dest}`)
    },
  }
}
