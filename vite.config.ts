import { spawn, type ChildProcess } from 'node:child_process'
import { type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { manualReload } from './tools/manual-reload.mjs'

// When launched by the preview broker, PASEO_PREVIEW_ORIGIN is the HTTPS origin the owner
// opens. Hot reload has to connect back through it over WSS.
const origin = process.env.PASEO_PREVIEW_ORIGIN ? new URL(process.env.PASEO_PREVIEW_ORIGIN) : null

/**
 * Starts the multiplayer room server beside the dev server, so one command gives a working
 * multiplayer game. Skipped when SYN3H_NO_ROOM_SERVER is set (tests that run their own).
 */
function roomServer(): Plugin {
  let child: ChildProcess | null = null
  return {
    name: 'syn3h-room-server',
    apply: 'serve',
    configureServer(server) {
      // Vitest starts a Vite server too; tests must not spawn (and fight over) a room server.
      if (process.env.SYN3H_NO_ROOM_SERVER || process.env.VITEST) return
      child = spawn('npx', ['tsx', 'server/dev.ts'], { stdio: 'inherit', env: { ...process.env, PORT: '8787' } })
      const stop = () => child?.kill()
      server.httpServer?.once('close', stop)
      process.once('exit', stop)
    },
  }
}

export default defineConfig({
  // manualReload: a merge shows a "new build available" notice instead of resetting the page.
  plugins: [roomServer(), manualReload()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    allowedHosts: origin ? [origin.hostname] : true,
    // Same-origin /ws keeps HTTPS previews working: a secure page cannot open ws://.
    proxy: { '/ws': { target: 'ws://127.0.0.1:8787', ws: true } },
    hmr: origin ? { protocol: 'wss', host: origin.hostname, clientPort: Number(origin.port || 443) } : undefined,
  },
  build: { target: 'es2022', sourcemap: true },
  // tools/*.test.mjs use node:test and are run with `node --test`, not vitest.
  test: { exclude: ['**/node_modules/**', '**/dist/**', 'tools/**'] },
})
