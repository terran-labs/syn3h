// Run under tools/heavy.sh. Owns one temporary Vite server and closes it on exit.
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { createServer as netServer } from 'node:net'
import { spawn } from 'node:child_process'
const reservation = netServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
process.env.MIRA_ROOM_PORT = String(reservation.address().port)
await new Promise(resolve => reservation.close(resolve))
const { createServer } = await import('vite')
const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true } })
try {
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  for (const script of (process.argv.length > 2 ? process.argv.slice(2) : ['tests/audio/impact-game-render.mjs', 'tests/audio/impacts-render.mjs', 'tools/smoke.mjs'])) {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script, origin], { stdio: 'inherit' })
      child.once('error', reject); child.once('exit', resolve)
    })
    if (code !== 0) throw new Error(`${script} failed (${code})`)
  }
} finally { await server.close() }
