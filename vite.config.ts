import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { manualReload } from './tools/manual-reload.mjs'
import { releaseFeed } from './tools/release-feed.mjs'
import { rapierWasmAsset } from './tools/rapier-wasm.mjs'

// When launched by the preview broker, PASEO_PREVIEW_ORIGIN is the HTTPS origin the owner
// opens. Hot reload has to connect back through it over WSS.
const origin = process.env.PASEO_PREVIEW_ORIGIN ? new URL(process.env.PASEO_PREVIEW_ORIGIN) : null

/**
 * Starts the multiplayer room server beside the dev server, so one command gives a working
 * multiplayer game. Skipped when SYN3H_NO_ROOM_SERVER is set (tests that run their own).
 */
const roomPort = process.env.SYN3H_ROOM_PORT ?? '8787'

function roomServer(): Plugin {
  let child: ChildProcess | null = null
  return {
    name: 'syn3h-room-server',
    apply: 'serve',
    configureServer(server) {
      // Vitest starts a Vite server too; tests must not spawn (and fight over) a room server.
      if (process.env.SYN3H_NO_ROOM_SERVER || process.env.VITEST) return
      child = spawn('npx', ['tsx', 'server/dev.ts'], { stdio: 'inherit', env: { ...process.env, PORT: roomPort } })
      const stop = () => child?.kill()
      server.httpServer?.once('close', stop)
      process.once('exit', stop)
    },
  }
}

/**
 * Tweakpane's stylesheet carries one bitmap: a 126 byte PNG, inlined as a data URL, for the
 * colour picker's hue strip. The owner's rule is that the running game loads no bitmaps, and a
 * hue strip is six colour stops, so the production build swaps it for the gradient it depicts.
 * Fails the build if the library changes shape, so a new inlined image cannot slip through.
 * Dev servers pre-bundle dependencies and keep the PNG; the release gate runs on the build.
 */
function tweakpaneWithoutBitmap(): Plugin {
  const image = /url\(data:image\/png;base64,[A-Za-z0-9+/=]+\)/g
  const hue = 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)'
  return {
    name: 'syn3h-tweakpane-without-bitmap',
    apply: 'build',
    transform(code, id) {
      if (!/node_modules\/tweakpane\/dist\/tweakpane\.js/.test(id.replaceAll('\\', '/'))) return
      const found = code.match(image)?.length ?? 0
      if (found !== 1) throw new Error(`Tweakpane changed: expected 1 inlined image, found ${found}. Review vite.config.ts before shipping.`)
      return { code: code.replace(image, hue), map: null }
    },
  }
}

/** Shown in the lobby as the build version: the nearest tag and commit, read at build time. */
function buildLabel(): string {
  if (process.env.SYN3H_RELEASE_VERSION) return process.env.SYN3H_RELEASE_VERSION
  try { return execSync('git describe --tags --always', { encoding: 'utf8' }).trim() } catch { return 'dev' }
}

export default defineConfig({
  define: { __SYN3H_BUILD__: JSON.stringify(buildLabel()) },
  // manualReload: a merge shows a "new build available" notice instead of resetting the page.
  // rapierWasmAsset: the physics engine's WebAssembly ships as its own hashed file, preloaded.
  plugins: [roomServer(), manualReload(), releaseFeed(), tweakpaneWithoutBitmap(), rapierWasmAsset()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    allowedHosts: origin ? [origin.hostname] : true,
    // Same-origin /ws keeps HTTPS previews working: a secure page cannot open ws://.
    proxy: { '/presence': { target: `http://127.0.0.1:${roomPort}` }, '/ws': { target: `ws://127.0.0.1:${roomPort}`, ws: true } },
    hmr: origin ? { protocol: 'wss', host: origin.hostname, clientPort: Number(origin.port || 443) } : undefined,
  },
  build: { target: 'es2022', sourcemap: true },
  // tools/*.test.mjs use node:test and are run with `node --test`, not vitest.
  test: { exclude: ['**/node_modules/**', '**/dist/**', 'tools/**'] },
})
