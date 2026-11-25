// Moves between rooms (src/ui/parallelUniverse.ts) never show the lobby. Bug caught: a newcomer
// refused by a full public room saw the full lobby again for seconds on the page that opened their
// parallel universe (reduced motion, v26.11.2405 review), as if their tap had been cancelled.
// What must stay true, at phone size, with reduced motion off and on, on every move: from the move
// until the first driving frame, the lobby's planets are never on screen uncovered by the loading
// veil, and the veil says what is happening. Paths: a refused newcomer after a long lobby wait,
// the Players & session button into a universe, Try the main world again while it is still full
// (back to the same universe), and Return to the main world once a seat is free.
//   MIRA_URL=http://127.0.0.1:8795/ node tests/ui/parallel-universe-entry.mjs [shot dir] [lobby wait ms]
//   THROTTLE=6 slows each page's CPU that many times (CDP), as a phone preparing a world is slow:
//   the review's failure showed the lobby while the destination prepared its world for 9 s.
//   PATHS=refused runs only the refused newcomer (the path most of a crowd takes); MOTIONS=reduce
//   one motion setting.
// What it proves and what it does not (25 November 2026): it passes on the fix, at both motion
// settings after a 65 s lobby wait. It also passed against a build with the veil hold disabled,
// unthrottled and with a 65 s wait: in this headless rig the destination prepares its world while
// its own loading veil is still up, so the review's failure (veil gone after 1.4 s, then 9 s of
// world preparation with the lobby showing) did not occur here. Until a run shows it failing
// without the hold, it is a weaker guard: it catches a lobby that shows on this machine, not
// every timing a phone can produce. The review's own reproduction on a phone-sized profile is the
// decisive test of the fix.
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import WebSocket from 'ws'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:8795/'
const out = process.argv[2]
const lobbyWait = Number(process.argv[3] ?? 65000)
if (out) mkdirSync(out, { recursive: true })
const ws = base.replace(/^http/, 'ws').replace(/\/$/, '') + '/ws'
const CAP = 16
const THROTTLE = Number(process.env.THROTTLE ?? 1)
const ONLY = process.env.PATHS ? new Set(process.env.PATHS.split(',')) : null
const run = name => !ONLY || ONLY.has(name)

/** Scripted players: a hello and nothing else (a room counts connections, not traffic). */
function fill(n) {
  const sockets = []
  return new Promise((resolve, reject) => {
    let welcomed = 0
    for (let i = 0; i < n; i++) {
      const s = new WebSocket(ws); sockets.push(s)
      s.on('open', () => s.send(JSON.stringify({ type: 'hello', v: 2, name: `crowd ${i + 1}`, params: {} })))
      s.on('message', (d, binary) => { if (!binary && String(d).startsWith('{"type":"welcome"') && ++welcomed === n) resolve(sockets) })
      s.on('error', reject)
    }
    setTimeout(() => reject(new Error(`only ${welcomed} of ${n} scripted players welcomed`)), 60000)
  })
}

/** In every page: after the move is armed, any frame with the lobby's planets on screen and not under the veil. */
const sampler = () => {
  if (!sessionStorage.getItem('check.armed')) return
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 }
  const tick = () => {
    const shell = document.querySelector('.mira-shell')
    if (shell?.classList.contains('is-playing') && !shell.classList.contains('is-descending') && document.documentElement.dataset.boot !== 'ready') { console.log('CHECK driving'); return }
    // The page a move starts from is its own entry until the move begins (data-room-move).
    const moving = document.documentElement.hasAttribute('data-room-move') || sessionStorage.getItem('check.dest') === location.href
    const veil = document.querySelector('.boot-veil'), vs = veil && getComputedStyle(veil)
    const covered = !!vs && vs.display !== 'none' && vs.visibility !== 'hidden' && Number(vs.opacity) >= 0.99
    // The lobby: its planets or its own buttons (Settings, Welcome), not under the veil.
    const lobby = [...document.querySelectorAll('.galaxy-label, .galaxy-ui button')].some(visible)
    if (moving && lobby && !covered) console.log(`CHECK lobby-visible ${location.search.slice(0, 40)} veil=${vs ? vs.opacity : 'none'}`)
    if (moving && covered) console.log(`CHECK veil ${document.querySelector('.boot-status')?.textContent ?? ''}`)
    requestAnimationFrame(tick)
  }
  // Mark the pages a move opens (autoplay with a move note waiting).
  if (new URL(location.href).searchParams.get('autoplay') === '1') sessionStorage.setItem('check.dest', location.href)
  requestAnimationFrame(tick)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const failures = []
async function phone(motion) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: motion })
  const page = await context.newPage(), seen = { lobby: [], veil: new Set(), driving: 0 }
  page.on('console', m => { const t = m.text(); if (!t.startsWith('CHECK ')) return; if (t.startsWith('CHECK lobby')) seen.lobby.push(t); else if (t.startsWith('CHECK veil')) seen.veil.add(t.slice(11)); else seen.driving++ })
  await page.addInitScript(sampler)
  if (THROTTLE > 1) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); page.on('framenavigated', f => { if (f === page.mainFrame()) cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }).catch(() => {}) }) }
  return { context, page, seen }
}
const arm = page => page.evaluate(() => sessionStorage.setItem('check.armed', '1'))
const driving = page => page.waitForFunction(() => { const s = document.querySelector('.mira-shell'); return s?.classList.contains('is-playing') && !s.classList.contains('is-descending') && document.documentElement.dataset.boot !== 'ready' && window.miraNet?.welcomed === true }, null, { timeout: 180000 })
const room = page => page.evaluate(() => new URL(location.href).searchParams.get('room'))
const universeButton = (page, label) => page.evaluate(label => { const b = [...document.querySelectorAll('.rail-universe button')].find(x => x.textContent === label); if (!b) return false; b.click(); return true }, label)
function judge(name, seen, wantLine) {
  if (seen.lobby.length) failures.push(`${name}: the lobby showed ${seen.lobby.length} frame(s) during the move: ${seen.lobby[0]}`)
  const other = [...seen.veil].filter(t => !/universe|world/i.test(t))
  if (other.length) failures.push(`${name}: the veil said something else during the move: ${other.join(' | ')}`)
  if (wantLine && ![...seen.veil].some(t => t.includes(wantLine))) failures.push(`${name}: the veil never said "${wantLine}" (${[...seen.veil].join(' | ')})`)
  console.log(`${name}: ${seen.lobby.length ? 'LOBBY SHOWN' : 'veil held'}; veil said ${JSON.stringify([...seen.veil])}`)
  seen.lobby.length = 0; seen.veil.clear()
}

try {
  for (const motion of (process.env.MOTIONS ?? 'no-preference,reduce').split(',')) {
    const tag = motion === 'reduce' ? 'reduced motion' : 'motion'
    let context, page, seen
    // The menu button: in the public room with a seat, into a universe of this planet.
    if (run('menu')) {
    ;({ context, page, seen } = await phone(motion))
    await page.goto(base + '?autoplay=1'); await driving(page)
    await page.evaluate(() => document.querySelector('.inspector-toggle')?.click())
    await arm(page)
    assert.ok(await page.waitForFunction(() => !!document.querySelector('.rail-universe button'), null, { timeout: 30000 }).then(() => universeButton(page, 'Enter a parallel universe')), 'the card offers a universe')
    await driving(page); judge(`${tag}, menu into a universe`, seen, 'Opening a parallel universe of this planet.')
    assert.match(await room(page) ?? '', /^p-/, 'in a universe')
    await context.close()
    // (The menu player's seat in the public room is held for 30 s after it left.)
    await new Promise(r => setTimeout(r, 32000))
    }

    // A refused newcomer after a long wait in the lobby.
    const crowd = await fill(CAP)
    ;({ context, page, seen } = await phone(motion))
    await page.goto(base); await page.waitForSelector('.galaxy-label', { state: 'visible', timeout: 120000 })
    await page.waitForTimeout(lobbyWait)
    await arm(page)
    await page.evaluate(() => { const worlds = window.mira.shell.galaxyWorlds; window.mira.shell.galaxy.choose((worlds[1] ?? worlds[0]).id) })
    await driving(page); judge(`${tag}, refused newcomer after ${Math.round(lobbyWait / 1000)} s in the lobby`, seen, 'This world is full. Opening a parallel universe of it.')
    const universe = await room(page)
    assert.match(universe ?? '', /^p-/, 'the refused newcomer is in a universe')
    if (out) await page.screenshot({ path: `${out}/${motion}-refused.png` })

    if (run('still-full')) {
    // Try the main world again while it is still full: back to the same universe.
    await page.evaluate(() => document.querySelector('.inspector-toggle')?.click())
    await page.waitForFunction(() => !!document.querySelector('.rail-universe button'), null, { timeout: 30000 })
    await universeButton(page, 'Return to the main world')
    await page.waitForFunction(u => new URL(location.href).searchParams.get('room') === u && window.miraNet?.welcomed === true, universe, { timeout: 180000 })
    await driving(page); judge(`${tag}, main world still full`, seen, 'The main world is still full. Back to your parallel universe.')

    }
    if (run('return')) {
    // A seat frees (and its 30 s hold ends): Return reaches the main world.
    crowd[0].close(); await page.waitForTimeout(33000)
    await page.evaluate(() => document.querySelector('.inspector-toggle')?.click())
    await page.waitForFunction(() => !!document.querySelector('.rail-universe button'), null, { timeout: 30000 })
    await universeButton(page, 'Return to the main world')
    await page.waitForFunction(() => !new URL(location.href).searchParams.has('room') && window.miraNet?.welcomed === true, null, { timeout: 180000 })
    await driving(page); judge(`${tag}, return to the main world`, seen, 'Trying the main world.')
    }
    await context.close()
    for (const s of crowd) s.close()
    await new Promise(r => setTimeout(r, 32000)) // the held seats of the scripted players lapse
  }
  assert.deepEqual(failures, [], failures.join('\n'))
  console.log('parallel-universe-entry: ok')
} finally { await browser.close() }
