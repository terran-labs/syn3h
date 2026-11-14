/**
 * Capture driving inputs, PNG frames, a labelled contact sheet and per-frame telemetry.
 *
 * node tools/drive-capture.mjs --url http://localhost:5186/ \
 *   --scenario tools/scenarios/sprint-brake.json --out /tmp/syn3h-drive --interval 500
 * node tools/drive-capture.mjs --scenario tools/scenarios/slalom.json \
 *   --compare buggy-syn3h,buggy-classic --out /tmp/syn3h-compare
 *
 * JSON: {durationMs, captureEveryMs, settleMs, events:[{atMs,down:["KeyW"],
 * up:["KeyW"], params:{"bots.count":0}, teleport:{x,z,y?,clearance?:2,heading?:0}}]}.
 * Teleport y defaults to terrain height plus clearance. landmark:"dune" finds a
 * deterministic local crest and places the car on its approach; inspect the trace to
 * confirm this vehicle actually leaves the ground. This is not a guaranteed jump.
 * Input events use browser timers independent of screenshot latency. Trace timestamps
 * record actual time and simulation tick; late captures are labelled, not disguised.
 * Comparison runs are sequential in fresh contexts, with identical timelines; the
 * contact sheet pairs matching requested times. main.ts must honor ?vehicle=kind.
 * Room sockets are disabled by default to keep other vehicles out of captures;
 * use --network true to capture multiplayer.
 * No image libraries required: Chrome canvas builds the timestamped contact sheet.
 */
import { chromium } from 'playwright-core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const options = {}
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i + 1]) throw new Error('Use --name value pairs; see file header')
  options[process.argv[i].slice(2)] = process.argv[i + 1]
}
const scenario = JSON.parse(await readFile(options.scenario ?? 'tools/scenarios/sprint-brake.json', 'utf8'))
const interval = Number(options.interval ?? scenario.captureEveryMs ?? 500)
if (!(interval >= 50) || !(scenario.durationMs > 0) || scenario.durationMs > 120000) throw new Error('Interval must be >=50ms and duration <=120000ms')
for (const event of scenario.events) if (!(event.atMs >= 0 && event.atMs <= scenario.durationMs)) throw new Error('Event outside scenario duration')
const output = resolve(options.out ?? '/tmp/syn3h-drive')
await mkdir(output, { recursive: true })
const kinds = options.compare ? options.compare.split(',') : [options.vehicle ?? 'current']
if (kinds.length > 2 || kinds.some(kind => !/^[\w-]+$/.test(kind))) throw new Error('Use one or two vehicle names')
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const runs = []
try {
  for (const kind of kinds) {
    const context = await browser.newContext({ viewport: { width: 960, height: 540 } })
    if (options.network !== 'true') await context.routeWebSocket(/\/ws(?:\?|$)/, socket => socket.close())
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(e.message))
    const url = new URL(options.url ?? 'http://localhost:5186/')
    url.searchParams.set('autoplay', '1')
    // Isolate captures from live players and shared world-parameter changes.
    url.searchParams.set('room', `capture-${Date.now()}-${kind}`)
    if (kind !== 'current') url.searchParams.set('vehicle', kind)
    await page.goto(url.href)
    await page.waitForFunction(() => window.syn3h?.game?.tick > 10, null, { timeout: 90000 })
    await page.waitForTimeout(scenario.settleMs ?? 1000)
    await page.evaluate(scenario => {
      const s = window.syn3h
      const pressed = new Set(), applied = []
      const key = (code, down) => {
        window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }))
        if (down) pressed.add(code); else pressed.delete(code)
      }
      function dune() {
        let best = null, score = -Infinity
        // Search actual heights rather than relying on coordinates tied to one seed.
        for (let x = -280; x <= 280; x += 40) for (let z = -280; z <= 280; z += 40) {
          if (Math.hypot(x, z) < 100) continue
          for (let a = 0; a < 16; a++) {
            const heading = a * Math.PI / 8, dx = -Math.sin(heading), dz = -Math.cos(heading)
            const h = d => s.terrain.heightAt(x + dx * d, z + dz * d)
            const rise = h(0) - h(-25), fall = h(0) - h(25)
            const liquid = s.terrain.liquidHeightAt?.(x, z) ?? -Infinity
            if (rise > 1 && rise < 8 && fall > 2 && fall < 12 && h(-45) > liquid + 2) {
              const value = rise + fall
              if (value > score) { score = value; best = { x: x - dx * 45, z: z - dz * 45, heading, clearance: 2 } }
            }
          }
        }
        if (!best) throw new Error('No suitable dune approach for this terrain seed')
        return best
      }
      const start = performance.now()
      const apply = event => {
        for (const [id, value] of Object.entries(event.params ?? {})) {
          if (!s.params.get(id)) throw new Error(`Unknown parameter ${id}`)
          s.params.set(id, value)
        }
        if (event.teleport) {
          const t = event.teleport.landmark === 'dune' ? dune() : event.teleport
          const position = { x: t.x, y: t.y ?? s.terrain.heightAt(t.x, t.z) + (t.clearance ?? 2), z: t.z }
          s.player.teleport(position, t.heading ?? 0)
          applied.push({ teleport: { ...position, heading: t.heading ?? 0 }, atMs: performance.now() - start })
        }
        for (const code of event.up ?? []) key(code, false)
        for (const code of event.down ?? []) key(code, true)
        applied.push({ ...event, actualMs: performance.now() - start, tick: s.game.tick })
      }
      const timers = scenario.events.map(event => event.atMs === 0 ? (apply(event), null) : setTimeout(() => apply(event), event.atMs))
      window.driveCapture = { start, applied, stop() { for (const timer of timers) clearTimeout(timer); for (const code of pressed) key(code, false) } }
    }, scenario)
    const frames = [], images = []
    for (let requestedMs = 0; requestedMs <= scenario.durationMs; requestedMs += interval) {
      const delay = await page.evaluate(t => Math.max(0, t - (performance.now() - window.driveCapture.start)), requestedMs)
      if (delay) await page.waitForTimeout(delay)
      const trace = await page.evaluate(() => {
        const s = window.syn3h, p = s.player.body.translation(), q = s.player.body.rotation(), v = s.player.body.linvel()
        // Quaternion -> Euler YXZ, matching Three's usual yaw/pitch/roll convention.
        const m11 = 1 - 2 * (q.y * q.y + q.z * q.z), m13 = 2 * (q.x * q.z + q.y * q.w)
        const m21 = 2 * (q.x * q.y + q.z * q.w), m22 = 1 - 2 * (q.x * q.x + q.z * q.z)
        const m23 = 2 * (q.y * q.z - q.x * q.w), m31 = 2 * (q.x * q.z - q.y * q.w), m33 = 1 - 2 * (q.x * q.x + q.y * q.y)
        const pitch = Math.asin(-Math.max(-1, Math.min(1, m23)))
        const yaw = Math.abs(m23) < 0.9999999 ? Math.atan2(m13, m33) : Math.atan2(-m31, m11)
        const roll = Math.abs(m23) < 0.9999999 ? Math.atan2(m21, m22) : 0
        return { actualMs: performance.now() - window.driveCapture.start, tick: s.game.tick, simulatedSeconds: s.game.time, position: { ...p }, speedMps: Math.hypot(v.x, v.y, v.z), quaternion: { ...q }, orientationDegrees: { pitch: pitch * 180 / Math.PI, yaw: yaw * 180 / Math.PI, roll: roll * 180 / Math.PI }, heightAboveTerrain: p.y - s.terrain.heightAt(p.x, p.z), wheelsGrounded: s.player.wheelsGrounded ?? null, camera: { position: s.game.camera.position.toArray(), clearance: s.game.camera.position.y - s.terrain.heightAt(s.game.camera.position.x, s.game.camera.position.z), distance: s.game.camera.position.distanceTo(s.player.object.position), fov: s.game.camera.fov }, backend: s.game.backend }
      })
      const name = `${kind}-${String(frames.length).padStart(3, '0')}.png`
      const png = await page.screenshot({ path: join(output, name) })
      images.push(png.toString('base64')); frames.push({ requestedMs, ...trace, file: name })
    }
    const events = await page.evaluate(() => { window.driveCapture.stop(); return window.driveCapture.applied })
    await writeFile(join(output, `${kind}-trace.json`), JSON.stringify({ url: url.href, scenario, frames, events, errors }, null, 2))
    runs.push({ kind, frames, images, errors })
    await context.close()
  }
  const sheetPage = await browser.newPage()
  const sheet = await sheetPage.evaluate(async runs => {
    const columns = runs.length === 2 ? 2 : 4, width = 384, height = 244
    const entries = runs.length === 2 ? runs[0].frames.flatMap((_, i) => runs.map(run => ({ run, i }))) : runs[0].frames.map((_, i) => ({ run: runs[0], i }))
    const canvas = document.createElement('canvas'); canvas.width = columns * width; canvas.height = Math.ceil(entries.length / columns) * height
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#151219'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    for (let index = 0; index < entries.length; index++) {
      const { run, i } = entries[index], frame = run.frames[i], image = new Image()
      image.src = 'data:image/png;base64,' + run.images[i]; await image.decode()
      const x = index % columns * width, y = Math.floor(index / columns) * height
      ctx.drawImage(image, x, y, width, 216); ctx.fillStyle = '#ffffff'; ctx.font = '12px monospace'
      ctx.fillText(`${run.kind} ${(frame.actualMs / 1000).toFixed(2)}s ${frame.speedMps.toFixed(1)}m/s h${frame.heightAboveTerrain.toFixed(1)}m`, x + 6, y + 234)
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }, runs)
  const sheetPath = join(output, 'contact-sheet.png')
  await writeFile(sheetPath, Buffer.from(sheet, 'base64'))
  console.log(JSON.stringify({ contactSheet: sheetPath, runs: runs.map(({ kind, frames, errors }) => ({ kind, frames: frames.length, errors })) }, null, 2))
  if (runs.some(run => run.errors.length)) process.exitCode = 1
} finally { await browser.close() }
