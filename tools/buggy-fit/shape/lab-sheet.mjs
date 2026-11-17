/**
 * Game-renderer sheets of the buggy shape exhibit: one page load, then for each state the
 * exhibit's own controls are set, the camera placed and a frame captured. Shots are tiled into
 * one labelled sheet per view. Desktop Chrome with WebGPU, as tools/lab-shot.mjs. Run it
 * through tools/heavy.sh.
 *
 *   node tools/buggy-fit/shape/lab-sheet.mjs <base url> <out dir> <spec.json>
 *
 * spec.json: { "query": "vehicle=buggy-shape", "controls": { "shape.whole": true },
 *   "views": [{ "name": "front", "orbit": [az, el, dist] } | { "name": "lamp", "look": [[x,y,z],[x,y,z]] }],
 *   "states": [{ "name": "default", "shape": { "noseLength": 0.25 } } | { "name": "seed 7", "seed": 7 }],
 *   "columns": 6, "size": [480, 300] }
 * A state's shape lists only the handles it changes; every other handle is reset first. A state's
 * optional "look": { "<view name>": [[camera], [target]] } aims that view for that state alone.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const [base, out, specPath] = process.argv.slice(2)
if (!base || !out || !specPath) { console.error('usage: lab-sheet.mjs <base url> <out dir> <spec.json>'); process.exit(2) }
const spec = JSON.parse(readFileSync(specPath, 'utf8'))
const [w, h] = spec.size ?? [480, 300], columns = spec.columns ?? 6
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=metal', '--ignore-gpu-blocklist'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: w * 2, height: h * 2 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.goto(new URL(`vehicle-lab.html?${spec.query ?? 'vehicle=buggy-shape'}&still=1`, base).href)
  await page.waitForFunction(() => window.vehicleLab?.ready, null, { timeout: 90000 })
  for (const [id, v] of Object.entries(spec.controls ?? {})) await page.evaluate(async ([id, v]) => { window.vehicleLab.control(id, v); await window.buggyShapeSettled?.() }, [id, v])
  const shots = {}
  for (const state of spec.states) {
    const readout = await page.evaluate(async state => {
      const lab = window.vehicleLab
      if (state.seed !== undefined) lab.control('shape.seed', state.seed)
      else { lab.control('shape.reset', true); for (const [id, v] of Object.entries(state.shape ?? {})) lab.control(`shape.${id}`, v) }
      await window.buggyShapeSettled?.()
      await lab.frames(3)
      return [...document.querySelectorAll('div')].find(d => / regenerated in /.test(d.textContent ?? '') && d.children.length === 0)?.textContent ?? ''
    }, state)
    console.log(state.name, '|', readout)
    for (const named of spec.views) {
      // A state may aim a view itself (close shots follow a feature that moved).
      const view = state.look?.[named.name] ? { ...named, look: state.look[named.name] } : named
      await page.evaluate(async view => {
        const lab = window.vehicleLab
        if (view.look) lab.look(view.look[0], view.look[1]); else lab.orbit(...view.orbit)
        await lab.frames(12)
      }, view)
      const buf = await page.screenshot({ type: 'jpeg', quality: 85 })
      ;(shots[named.name] ??= []).push({ name: state.name, src: `data:image/jpeg;base64,${buf.toString('base64')}` })
    }
  }
  // One sheet per view: a labelled grid at half resolution.
  for (const [view, list] of Object.entries(shots)) {
    const html = `<body style="margin:0;background:#222;font:15px system-ui;color:#fff"><div style="display:grid;grid-template-columns:repeat(${Math.min(columns, list.length)},${w}px)">${list.map(s => `<div style="position:relative;width:${w}px;height:${h}px;overflow:hidden"><img src="${s.src}" style="width:${w}px;height:${h}px;display:block"><div style="position:absolute;left:6px;top:4px;background:rgba(0,0,0,.6);padding:1px 6px;border-radius:3px">${s.name}</div></div>`).join('')}</div></body>`
    const sheet = await browser.newPage({ viewport: { width: Math.min(columns, list.length) * w, height: Math.ceil(list.length / columns) * h } })
    await sheet.setContent(html); await sheet.waitForTimeout(200)
    const path = join(out, `${view}.jpg`)
    await sheet.screenshot({ path, type: 'jpeg', quality: 88, fullPage: true }); await sheet.close()
    console.log(path)
  }
  writeFileSync(join(out, 'spec.json'), JSON.stringify(spec, null, 1))
} finally { await browser.close() }
if (errors.length) { console.error('PAGE ERRORS', errors.slice(0, 5)); process.exit(1) }
