import './tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { createHash } from 'node:crypto'
import { execFileSync, execSync, spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { manualReload } from './tools/manual-reload.mjs'
import { releaseFeed } from './tools/release-feed.mjs'
import { rapierWasmAsset } from './tools/rapier-wasm.mjs'
import { devLabel } from './tools/build-label.mjs'
import { shareCardAsset } from './tools/brand/share-card.mjs'

// When launched by the preview broker, PASEO_PREVIEW_ORIGIN is the HTTPS origin the owner
// opens. Hot reload has to connect back through it over WSS.
const origin = process.env.PASEO_PREVIEW_ORIGIN ? new URL(process.env.PASEO_PREVIEW_ORIGIN) : null

/**
 * Starts the multiplayer room server beside the dev server, so one command gives a working
 * multiplayer game. Skipped when MIRA_NO_ROOM_SERVER is set (tests that run their own).
 */
const roomPort = process.env.MIRA_ROOM_PORT ?? '8787'

function roomServer(): Plugin {
  let child: ChildProcess | null = null
  return {
    name: 'mira-room-server',
    apply: 'serve',
    configureServer(server) {
      // Vitest starts a Vite server too; tests must not spawn (and fight over) a room server.
      if (process.env.MIRA_NO_ROOM_SERVER || process.env.VITEST) return
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
    name: 'mira-tweakpane-without-bitmap',
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
  if (process.env.MIRA_RELEASE_VERSION) return process.env.MIRA_RELEASE_VERSION
  // Development: "dev · <short commit>" (tools/build-label.mjs), never a long describe string.
  try { return devLabel(execSync("git describe --tags --always --exclude 'archive/*'", { encoding: 'utf8' })) } catch { return 'dev' }
}

function sourceCommit(): string | null {
  try { return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return null }
}

// Frozen releases also distribute the optional shader. Keep its notices beside
// the built assets without making the page fetch them on entry.
function glassNotices(): Plugin {
  // The original fixed-address NOTICE stays in public for archived releases.
  const notice = readFileSync(new URL('./src/liquid-glass/NOTICE.md', import.meta.url))
  const digest = createHash('sha256').update(notice).digest('hex')
  const noticePath = `liquid-glass/NOTICE-${digest}.md`
  const credit = `\n/*! Adapted from liquidglass, Copyright 2026 Shayan, Apache-2.0. See ${noticePath} and liquid-glass/licenses/ beside this file. */\n`
  const hasGlass = (ids: readonly string[]) => ids.some(id =>
    id.endsWith('/liquid-glass/regular.ts') || id.split('?')[0].endsWith('/liquid-glass/lobby.frag.glsl'))
  return {
    name: 'glass-distribution-notices',
    augmentChunkHash(chunk) {
      return hasGlass(chunk.moduleIds) ? credit : undefined
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk' && hasGlass(chunk.moduleIds)) chunk.code += credit
      }
      this.emitFile({ type: 'asset', fileName: 'assets/' + noticePath, source: notice })
      for (const path of ['licenses/Apache-2.0.txt', 'licenses/Shayan-NOTICE.txt']) {
        this.emitFile({ type: 'asset', fileName: 'assets/liquid-glass/' + path,
          source: readFileSync(new URL('./src/liquid-glass/' + path, import.meta.url)) })
      }
    },
  }
}

export default defineConfig({
  define: {
    __MIRA_BUILD__: JSON.stringify(buildLabel()),
    __MIRA_FREEZE_ID__: JSON.stringify(process.env.MIRA_FREEZE_ID || null),
    __MIRA_COMMIT__: JSON.stringify(sourceCommit()),
  },
  // manualReload: a merge shows a "new build available" notice instead of resetting the page.
  // rapierWasmAsset: the physics engine's WebAssembly ships as its own hashed file, preloaded.
  plugins: [glassNotices(), roomServer(), manualReload(), releaseFeed(), tweakpaneWithoutBitmap(), rapierWasmAsset(), shareCardAsset()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    allowedHosts: origin ? [origin.hostname] : true,
    // Same-origin /ws keeps HTTPS previews working: a secure page cannot open ws://.
    proxy: { '/presence': { target: `http://127.0.0.1:${roomPort}` }, '^/e(\\?|$)': { target: `http://127.0.0.1:${roomPort}` }, '/ws': { target: `ws://127.0.0.1:${roomPort}`, ws: true } },
    hmr: origin ? { protocol: 'wss', host: origin.hostname, clientPort: Number(origin.port || 443) } : undefined,
  },
  build: {
    target: 'es2022', sourcemap: true,
    // The startup code in several files along its third-party seams (three, then the other
    // libraries, each under half a megabyte) and the game's own code, instead of one 2.8 MB
    // file: the loading view's megabyte count is what the browser has received, and it can
    // only count files that have finished. Same bytes, fetched in parallel (each preloaded by
    // the entry). The game's code stays one file: split by size, its modules' circular imports
    // ran in the wrong order.
    rolldownOptions: { output: { codeSplitting: { groups: [
      { name: 'three', test: /node_modules[\\/]three[\\/]/, maxSize: 480_000 },
      { name: 'vendor', test: /node_modules[\\/]/, maxSize: 480_000 },
    ] } } },
  },
  // tools/*.test.mjs use node:test and run with `npm run test:tools`, not vitest; `npm test` runs both.
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tools/**'],
    // A timeout is there to stop a hung test, not to time one: vitest's 5 s default failed
    // world generation tests at a machine load of 45 with nothing wrong (AGENTS.md, testing:
    // a timing limit that fails on load must not block a release). A test that needs a real
    // time limit sets its own.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
