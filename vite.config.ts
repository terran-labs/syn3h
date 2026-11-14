import { defineConfig } from 'vite'

// When launched by the preview broker, PASEO_PREVIEW_ORIGIN is the HTTPS origin the owner
// opens. Hot reload has to connect back through it over WSS.
const origin = process.env.PASEO_PREVIEW_ORIGIN ? new URL(process.env.PASEO_PREVIEW_ORIGIN) : null

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    allowedHosts: origin ? [origin.hostname] : true,
    hmr: origin ? { protocol: 'wss', host: origin.hostname, clientPort: Number(origin.port || 443) } : undefined,
  },
  build: { target: 'es2022', sourcemap: true },
})
