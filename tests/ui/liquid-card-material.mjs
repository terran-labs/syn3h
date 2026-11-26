// Actual glass controls can pick up a shadow from their own text, a nested path, or
// the SVG or wrapper that composites the entire glyph. Check every painted layer.
// MIRA_URL=http://127.0.0.1:5213/ node tests/ui/liquid-card-material.mjs
import '../../tools/lib/legacy-env.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const controls = [
  'button.liquid-glass', 'button.wi-glass', 'button.inspector-toggle', 'button.panels-close',
  ':is(.liquid-glass, .wi-glass, .lobby-sheet, .in-play-about, .exit-confirm-card, .join-card) :is(button, summary, .s3-switch-field, .wi-row.is-switch)',
  '.rail-command > :is(.wi-search, .rail-search-icon)',
].join(',')

async function cleanInk(page, root, required) {
  await page.waitForFunction(selector => [...document.querySelectorAll(selector)].some(element => {
    if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
  }), required)
  const seen = await page.evaluate(({ controls, root }) => {
    const region = document.querySelector(root)
    const visible = element => {
      if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
      const rect = element.getBoundingClientRect()
      // A straight stroked SVG path can have zero geometric width and still paint.
      const hasInk = element instanceof SVGElement ? rect.width > 0 || rect.height > 0 : rect.width > 0 && rect.height > 0
      return hasInk && rect.bottom > 0 && rect.top < innerHeight
    }
    const result = { count: 0, ink: [], ancestors: [], layers: {} }
    for (const control of [...region.querySelectorAll(controls)].filter(visible)) {
      result.count++
      const label = control.getAttribute('aria-label') || control.getAttribute('placeholder') || control.textContent.trim()
      for (const node of [control, ...control.querySelectorAll('*')]) {
        if (node !== control && !visible(node)) continue
        result.layers[node.localName] = (result.layers[node.localName] ?? 0) + 1
        for (const pseudo of ['', '::before', '::after', ...(node.matches('input[placeholder]') ? ['::placeholder'] : [])]) {
          const style = getComputedStyle(node, pseudo || null)
          if (pseudo && pseudo !== '::placeholder' && (['none', 'normal'].includes(style.content) ||
              style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) continue
          if (style.textShadow !== 'none' || style.filter !== 'none') result.ink.push({ label, node: node.localName, pseudo, textShadow: style.textShadow, filter: style.filter })
        }
      }
      // A filter on a wrapper composites the button even when each of its glyphs is clean.
      for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const filter = getComputedStyle(ancestor).filter
        if (filter.includes('drop-shadow(')) result.ancestors.push({ label, ancestor: ancestor.className, filter })
      }
    }
    return result
  }, { controls, root })
  assert.ok(seen.count, root + ' shows actual controls')
  assert.deepEqual(seen.ink, [], root + ' paints no glyph shadows')
  assert.deepEqual(seen.ancestors, [], root + ' has no composited shadow on its control ancestors')
  return seen.layers
}

async function setMaterial(page, value, material) {
  await page.evaluate(value => {
    mira.params.set('hud.glass', value)
    mira.params.set('hud.surfaceCoverage', 25)
  }, value)
  await page.waitForFunction(material => document.documentElement.dataset.glassMaterial === material, material)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function railStates(page) {
  const rail = '.mira-shell > .world-inspector:not(.lobby-settings)'
  const pause = rail + ' .rail-pause'
  const check = () => cleanInk(page, rail, pause)
  const layers = await check()
  assert.ok(layers.svg && layers.path && layers.input, 'the rail test includes icon root, path and Search')
  await page.locator(pause).hover()
  await check()
  await page.mouse.down()
  try {
    await check()
    await page.mouse.move(2, 2)
  } finally { await page.mouse.up() }
  // The real offer uses the same history publisher as the bottom-stack test.
  await page.evaluate(() => {
    const quality = mira.game.quality
    const history = quality.history, level = quality.governor.level
    const offer = Object.freeze({ level, targetLevel: level > 0 ? level - 1 : 1, observedFps: 24, bots: 4, fewerBots: false })
    const sample = history.sample.bind(history)
    history.sample = (...args) => { const change = sample(...args); history.recommendation = offer; return change }
    history.recommendation = offer
    quality.publishPerformance()
  })
  await cleanInk(page, '.mira-shell > .bottom-stack', '.bottom-stack > .performance-recommendation button:not([hidden])')
  for (const section of ['performance', 'chat', 'you', 'game', 'world', 'vehicles', 'players']) {
    const card = rail + ' .wi-card[data-section="' + section + '"]'
    if (!(await page.locator(card).count())) continue
    await page.evaluate(section => mira.shell.showCard(section), section)
    await cleanInk(page, card, card + ' > .wi-head')
    if (section === 'performance') {
      for (const selector of ['.wi-res-auto', '[data-quality=reset-all]', '[data-quality=up]', '[data-quality=down]', '.wi-auto input']) {
        assert.ok(await page.locator(card + ' ' + selector).isVisible(), selector + ' renders in the Performance card')
      }
    }
    if (section === 'chat') assert.ok(await page.locator(card).getByRole('button', { name: 'Send' }).isVisible(), 'Chat renders its Send control')
  }
}

const browser = await chromium.launch({
  channel: 'chrome', args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
})
try {
  for (const [width, height, touch] of [[1280, 800, false], [390, 844, true]]) {
    for (const [value, material] of [[0, 'liquid'], [2, 'flat']]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch })
      await context.routeWebSocket(/\/ws\?/, socket => socket.close().catch(() => {}))
      try {
        const page = await context.newPage()
        page.setDefaultTimeout(60000)
        const url = new URL(base)
        url.search = new URLSearchParams({ tap: '0', gfx: '3', planet: 'alpine', seed: '1' })
        await page.goto(url.href)
        await page.waitForFunction(() => window.mira?.shell && document.documentElement.dataset.boot === 'done')
        await setMaterial(page, value, material)
        await cleanInk(page, '.mira-shell .galaxy-ui', '.lobby-gear')
        await page.locator('.lobby-gear').click()
        await cleanInk(page, '#lobby-settings', '#lobby-settings .lobby-settings-close')
        await page.locator('#lobby-settings .lobby-settings-close').click()
        await page.locator('.lobby-about').click()
        await cleanInk(page, '.lobby-sheet[open]', '.lobby-sheet[open] .welcome-ring-arrow')
        await page.keyboard.press('Escape')
        await page.evaluate(() => { mira.params.set('bots.count', 0); mira.shell.play(false, true) })
        await page.waitForFunction(() => mira.shell.playing && !mira.shell.transitioning)
        if (touch) {
          await page.evaluate(() => mira.shell.returnToDriving())
          await cleanInk(page, '.mira-shell', '.touch-actions .glass-round:not([hidden])')
          await cleanInk(page, '.mira-shell .hud-navigation', '.hud-navigation .inspector-toggle')
        }
        await page.evaluate(() => mira.shell.showPanels())
        await railStates(page)
        await page.evaluate(() => mira.shell.requestPause())
        const pauseBar = '.mira-shell > .bottom-stack > .pause-actions'
        const pauseExit = pauseBar + ' > .pause-exit'
        const layers = await cleanInk(page, pauseBar, pauseExit)
        assert.ok(layers.svg && layers.path && layers.span && (touch || layers.kbd), 'pause covers SVG, path, labels and desktop shortcut')
        if (!touch) {
          await page.keyboard.press('Tab')
          await page.locator(pauseExit).focus()
          assert.ok(await page.locator(pauseExit).evaluate(el => el.matches(':focus-visible') &&
            getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) > 0),
          'the pause Exit button retains its keyboard focus outline')
          await cleanInk(page, pauseBar, pauseExit)
        }
        console.log(width + 'x' + height, material, await page.evaluate(() => mira.game.backend), 'glass ink ok')
      } finally { await context.close() }
    }
  }
} finally { await browser.close() }
