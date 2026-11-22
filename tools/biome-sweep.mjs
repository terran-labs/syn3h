/**
 * Biome sweep: is the quality ladder clean on every world? A replay for evidence, not a blocking
 * test. Run it against a local production build (vite preview plus a room server).
 *
 * For each world, on WebGPU and WebGL 2, enter at High (3) or Minimal (0) the way
 * tools/quality-drop-check.mjs does: setLevel, then automatic, unpinned, as host with the stock
 * four bots. Then stage the player's hovercraft in the nearest water or lava, with the camera on
 * it, and step the levels: from High 2, 1, 0, 1, 2, 3, 4, 5; from Minimal 1 to 5.
 *
 * How it steps, and why. The steps go through the real governor the way production takes them,
 * not through quality.beginDiagnosticSweep:
 *   - a drop is taken in play (replayLevelBoundary down, then apply);
 *   - a climb is taken in play only where the game allows a visible climb (governor.canClimbVisible:
 *     back to the level just left, with the same shadow cascades and a prepared post preset);
 *   - every other climb is left pending and taken at a covered moment: the menu opens, the game's
 *     own frame applies the pending climb and runs Game.prepareClimbedLevel, then play resumes.
 * The forced diagnostic sweep applies any climb in the middle of play, which production never
 * does; forced from High to Ultra it builds about 150 shaders that no player can meet. Do not
 * read its climb numbers as freezes.
 *
 * Real frame evidence is withheld between steps (governor.sample returns null), so only the
 * replay moves the level. WebGL 2's capability ceiling is Medium: climbs above it are refused,
 * which shows as "reached 2", and is correct.
 *
 * Every node graph and render pipeline the backend makes is recorded with its material, object,
 * named ancestors and owner (a bot's kind, or the player). Builds while covered are counted apart;
 * builds after play resumes are in-play builds. Those under the group "Showroom warm" are the
 * vehicles' staged warm-up (inWorldCheck counts them as preparation); any other is a cold draw.
 *
 *   SYN3H_URL=http://127.0.0.1:5491/ node tools/biome-sweep.mjs OUT.json [planet:seed,...] [webgpu,webgl2] [3,0]
 *
 * Defaults: archipelago:1, alpine:4, volcanic:1, ice:1, moon:1, swamp:1, desert:1, badlands:1,
 * obsidian:1 on both backends from both entries (36 runs, about 1.5 hours). Exits 0; the last
 * line says whether any run was dirty or failed, and OUT.json holds every build.
 */
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = (process.env.SYN3H_URL ?? '').replace(/\/+$/, '') + '/'
const out = process.argv[2]
const WORLDS = (process.argv[3] ?? 'archipelago:1,alpine:4,volcanic:1,ice:1,moon:1,swamp:1,desert:1,badlands:1,obsidian:1').split(',')
const BACKENDS = (process.argv[4] ?? 'webgpu,webgl2').split(',')
const ENTRIES = (process.argv[5] ?? '3,0').split(',').map(Number)
const STEPS = { 3: [2, 1, 0, 1, 2, 3, 4, 5], 0: [1, 2, 3, 4, 5] }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const runs = []
const save = () => writeFile(out, JSON.stringify(runs, null, 1))
try {
  for (const spec of WORLDS) for (const backend of BACKENDS) for (const entry of ENTRIES) {
    const [planet, seed] = spec.split(':')
    const run = { planet, seed, backend, entry, steps: [], errors: [] }
    runs.push(run)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await ctx.newPage()
    page.on('pageerror', e => run.errors.push(e.message))
    try {
      await page.goto(`${base}?planet=${planet}&seed=${seed}&vehicle=hovercraft&room=sweep-${Date.now()}${backend === 'webgl2' ? '&webgl=1' : ''}`)
      await page.waitForFunction(() => window.syn3h?.game, null, { timeout: 90000 })
      await page.evaluate(level => {
        const { game, shell, params } = window.syn3h
        params.set('bots.keepCount', true)
        game.quality.setLevel(level)
        game.quality.setAuto(true)
        window.__sample = game.quality.governor.sample
        game.quality.governor.sample = () => null
        void shell.play(true)
      }, entry)
      await page.waitForFunction(() => window.syn3hNet?.isHost && window.syn3h.shell.playing && !window.syn3h.shell.transitioning, null, { timeout: 120000 })
      await page.waitForFunction(() => { const { bots, materialize } = window.syn3h; return bots.vehicles.length === 4 && bots.vehicles.every(v => !materialize.isMaterializing(v)) }, null, { timeout: 150000 })
      Object.assign(run, await page.evaluate(async () => {
        const s = window.syn3h, { game, terrain, player, camera } = s, q = game.quality
        document.exitPointerLock?.()
        const state = q.state ?? {}
        // The nearest liquid to the player, searched on rings out to 2.4 km.
        const me = player.object.position
        let found = null
        for (let r = 0; r <= 2400 && !found; r += 40) {
          const n = Math.max(1, Math.round(r / 20))
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2, x = me.x + Math.cos(a) * r, z = me.z + Math.sin(a) * r
            const kind = terrain.liquidKindAt?.(x, z), h = terrain.liquidHeightAt?.(x, z)
            if (kind && Number.isFinite(h) && h > terrain.heightAt(x, z) + 0.5) { found = { kind, x, z, h }; break }
          }
        }
        if (found) {
          const at = me.clone().set(found.x, found.h + 1, found.z)
          player.teleport(at, 0)
          camera.setCinematicPose(at.clone().add({ x: 8, y: 5, z: 12 }), at)
        }
        for (let i = 0; i < 180; i++) await new Promise(requestAnimationFrame)
        const after = player.object.position
        return { entered: q.governor.level, auto: state.auto, pinned: state.pinned, liquid: found && { kind: found.kind, depth: +(found.h - terrain.heightAt(found.x, found.z)).toFixed(1), playerInLiquid: terrain.liquidKindAt?.(after.x, after.z) ?? null, dy: +(after.y - found.h).toFixed(1) }, bots: s.bots.vehicles.map(v => v.kind) }
      }))
      await page.evaluate(() => {
        const s = window.syn3h, b = s.game.renderer.backend, nb = b.createNodeBuilder, rp = b.createRenderPipeline
        window.__builds = []; window.__window = 'staged'
        const owner = src => {
          const o = src?.object, chain = []
          for (let p = o?.parent; p && chain.length < 4; p = p.parent) if (p.name && p.type !== 'Scene') chain.push(p.name)
          const bot = s.bots.vehicles.find(v => o && v.object.getObjectById(o.id))
          const isPlayer = o && s.player.object.getObjectById?.(o.id)
          return { material: src?.material?.name || src?.material?.type || '?', object: o?.name || o?.type || '?', chain: chain.join(' < '), who: bot ? 'bot ' + bot.kind : isPlayer ? 'player' : '' }
        }
        b.createNodeBuilder = function (object, renderer) { const x = nb.call(this, object, renderer), build = x.build; x.build = function (...a) { try { return build.apply(this, a) } finally { window.__builds.push({ w: window.__window, kind: 'graph', ...owner(this) }); x.build = build } }; return x }
        b.createRenderPipeline = function (source, ...a) { try { return rp.call(this, source, ...a) } finally { window.__builds.push({ w: window.__window, kind: 'pipeline', ...owner(source) }) } }
        const g = s.game.quality.governor
        if (window.__sample) { g.sample = window.__sample; delete window.__sample }
        // Real frames must not move the level between steps: evidence is withheld, as in the lead's manual replay.
        window.__realSample = g.sample; g.sample = () => null
      })
      for (const level of STEPS[entry]) {
        // How production takes this boundary: a drop in play; a climb in play only where the game
        // allows a visible climb (canClimbVisible); otherwise pending until a covered moment.
        const how = await page.evaluate(level => {
          const s = window.syn3h, q = s.game.quality, g = q.governor
          window.__window = 'play ' + level
          if (level < g.level) { q.lastReason = g.replayLevelBoundary(false).reason; q.apply('governor', false); return 'drop in play' }
          if (g.rung > 0) { g.rung = 0; q.apply('governor', false) }
          if (g.canClimbVisible?.(level)) { q.lastReason = g.replayLevelBoundary(true).reason; q.apply('governor', false); return 'climb in play' }
          g.pendingLevel = level
          window.__window = 'covered ' + level
          s.shell.openMenu()
          return 'climb at covered moment'
        }, level)
        if (how === 'climb at covered moment') {
          await page.waitForFunction(level => window.syn3h.game.quality.governor.level === level, level, { timeout: 20000 }).catch(() => {})
          await page.waitForTimeout(600)
          await page.evaluate(level => { window.__window = 'play ' + level; window.syn3h.shell.play() }, level)
          await page.waitForFunction(() => window.syn3h.shell.playing && !window.syn3h.shell.transitioning, null, { timeout: 30000 })
        }
        const row = await page.evaluate(async level => {
          const q = window.syn3h.game.quality
          document.exitPointerLock?.()
          for (let i = 0; i < 150; i++) await new Promise(requestAnimationFrame)
          await new Promise(r => setTimeout(r, 800))
          const builds = window.__builds.filter(x => x.w === 'play ' + level), covered = window.__builds.filter(x => x.w === 'covered ' + level)
          window.__builds = []
          return { level, reached: q.governor.level, graphs: builds.filter(x => x.kind === 'graph').length, pipelines: builds.filter(x => x.kind === 'pipeline').length, coveredBuilds: covered.length, builds }
        }, level)
        row.how = how
        run.steps.push(row)
        console.log(`${planet} ${backend} entry ${entry} -> ${level} (at ${row.reached}, ${how}${how.includes('covered') ? ', ' + row.coveredBuilds + ' built while covered' : ''}): ${row.graphs} graphs, ${row.pipelines} pipelines in play${row.builds.length ? ': ' + [...new Set(row.builds.map(x => `${x.material} | ${x.object}${x.chain ? ' < ' + x.chain : ''}${x.who ? ' [' + x.who + ']' : ''}`))].slice(0, 6).join('; ') : ''}`)
      }
    } catch (e) { run.failure = String(e.message ?? e).split('\n')[0]; console.log(`${planet} ${backend} entry ${entry} FAILED: ${run.failure}`) }
    if (run.errors.length) console.log(`${planet} ${backend} entry ${entry} page errors: ${run.errors.slice(0, 2).join(' | ')}`)
    console.log(`${planet} ${backend} entry ${entry} liquid: ${JSON.stringify(run.liquid)} bots: ${run.bots}`)
    await save()
    await ctx.close()
  }
} finally { await browser.close(); await save() }
const dirty = runs.filter(r => r.failure || r.steps.length < STEPS[r.entry].length || r.steps.some(s => s.graphs || s.pipelines || s.reached !== s.level))
console.log(dirty.length ? `DIRTY OR FAILED RUNS: ${dirty.length} of ${runs.length}` : `SWEEP CLEAN: ${runs.length} runs`)
