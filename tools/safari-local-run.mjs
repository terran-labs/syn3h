/** Run one browser at a time against an isolated local server; invoke through heavy.sh. */
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
const server = await createServer({ configFile: false, define: { __MIRA_BUILD__: JSON.stringify('safari-diagnostics') }, server: { host: '127.0.0.1', port: 5186, strictPort: true } })
const run = args => new Promise((resolve, reject) => { const child = spawn(process.execPath, args, { stdio: 'inherit' }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`capture exited ${code}`))) })
try {
  await server.listen()
  for (const backend of ['gpu', 'gl']) await run(['tools/safari-capture.mjs', `http://127.0.0.1:5186/?diag=1&gfx=0${backend === 'gl' ? '&webgl=1' : ''}`, `/tmp/syn3h-safari-${backend}`, 'ipad'])
  await run(['tools/smoke.mjs', 'http://127.0.0.1:5186/?diag=1&gfx=0', '/tmp/syn3h-safari-chrome.png'])
} finally { await server.close() }
