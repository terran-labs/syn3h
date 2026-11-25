// A player can read and interact with content at both native scroll endpoints.
// MIRA_URL=http://127.0.0.1:5213/ node tests/ui/scroll-boundary-fade.mjs
// MIRA_SCROLL_EVIDENCE saves frames, MIRA_SCROLL_BASELINE enables before/after comparison.
// MIRA_SCROLL_TIMING=1 captures same-page compositor traces in separate runs.
// MIRA_SCROLL_CELL can narrow a run to one cell, for example 390-flat.
import '../../tools/lib/legacy-env.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const base = process.env.MIRA_URL ?? 'http://127.0.0.1:5213/'
const evidence = process.env.MIRA_SCROLL_EVIDENCE
const baseline = process.env.MIRA_SCROLL_BASELINE
const timing = process.env.MIRA_SCROLL_TIMING
const selectedCell = process.env.MIRA_SCROLL_CELL
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] })

async function exerciseRail(page) {
  await page.evaluate(() => {
    const root = document.querySelector('.mira-shell')
    const rail = document.createElement('div')
    rail.className = 'update-table'
    rail.id = 'fade-rail-probe'
    rail.style.cssText = 'position:fixed; top:20px; left:20px; width:240px; height:80px; z-index:9999; pointer-events:auto; overflow:auto'
    const content = document.createElement('button')
    content.style.cssText = 'width:480px;height:44px'
    content.textContent = 'Wide row'
    const nested = document.createElement('span')
    nested.className = 'wi-body'
    nested.textContent = 'Fitting content'
    content.append(nested)
    content.onclick = () => content.dataset.clicked = 'true'
    rail.append(content)
    root.append(rail)
  })
  await page.addStyleTag({ content: '#fade-rail-probe::-webkit-scrollbar { width: 12px; height: 12px }' })
  const rail = page.locator('#fade-rail-probe')
  const read = () => rail.evaluate(el => {
    const style = getComputedStyle(el)
    return {
      top: el.scrollLeft, range: el.scrollWidth - el.clientWidth,
      gutter: el.offsetHeight - el.clientHeight,
      mask: style.getPropertyValue('--scroll-boundary-mask').trim(), client: el.clientWidth,
    }
  })
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade-rail-probe')).maskImage !== 'none')
  const start = await read()
  assert.equal(await rail.locator('.wi-body').evaluate(el => getComputedStyle(el).maskImage), 'none', 'a fitting nested scroller does not inherit the rail mask')
  if (evidence) await page.screenshot({ path: evidence + '/horizontal-top.png' })
  assert.equal(start.top, 0)
  assert.ok(start.gutter > 0, 'a native horizontal scrollbar has a real gutter')
  assert.match(start.mask, /#000 0px, #000 0px, #000 0px, #000 176px, transparent 240px/)
  const bounds = await rail.boundingBox()
  await page.mouse.move(bounds.x + 40, bounds.y + bounds.height - 5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 96, bounds.y + bounds.height - 5, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('#fade-rail-probe').scrollLeft > 0)
  const middle = await read()
  assert.ok(middle.top < start.range, 'native scrollbar thumb drags through the gutter')
  if (evidence) await page.screenshot({ path: evidence + '/horizontal-middle.png' })
  assert.equal(middle.gutter, start.gutter)
  assert.match(middle.mask, /transparent 0px.*transparent 240px/)
  await page.mouse.click(bounds.x + 8, bounds.y + 20)
  assert.equal(await rail.locator('button').getAttribute('data-clicked'), 'true', 'a faded edge keeps its pointer target')
  await rail.evaluate(el => { el.scrollLeft = el.scrollWidth })
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade-rail-probe')).getPropertyValue('--scroll-boundary-mask').includes('#000 240px, #000 240px, #000 240px'))
  assert.equal((await read()).top, start.range)
  if (evidence) await page.screenshot({ path: evidence + '/horizontal-end.png' })
  await rail.evaluate(el => { el.firstElementChild.style.width = '200px' })
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#fade-rail-probe')).maskImage === 'none')
  if (evidence) {
    await page.screenshot({ path: evidence + '/horizontal-fitting.png' })
    writeFileSync(evidence + '/horizontal.json', JSON.stringify({ start, middle, fitting: await read() }, null, 2))
  }
  await rail.evaluate(el => el.remove())
}

async function openGame(context, url, material) {
  const page = await context.newPage()
  const address = new URL(url)
  address.search = new URLSearchParams({ autoplay: '1', gfx: '3', planet: 'alpine', seed: '4', room: 'fade-local-' + Date.now(), ...(material === 'flat' ? { ui: 'flat' } : {}) })
  await page.goto(address.href)
  await page.waitForFunction(() => window.miraChat?.panel && window.mira?.shell.playing && !mira.shell.transitioning, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  await page.evaluate(material => {
    mira.params.set('hud.glass', material === 'flat' ? 2 : 0)
    mira.params.set('bots.count', 0)
    mira.params.set('sun.dayLength', 0)
  }, material)
  await page.waitForFunction(material => document.documentElement.dataset.glassMaterial === material, material)
  return page
}

async function sample(page, cardName, file, before) {
  const card = page.locator(`.world-inspector:not(.lobby-settings) .wi-card[data-section="${cardName}"]`)
  if (cardName === 'chat') {
    await page.evaluate(() => {
      miraChat.net.chat.receive({ type: 'chat', from: 0xff00, text: 'A short line.', t: 0 })
      miraChat.panel.openAndFocus()
      document.activeElement?.blur()
    })
  } else {
    await page.evaluate(() => mira.shell.showCard('performance'))
  }
  await card.locator('.wi-body').waitFor()
  await page.waitForTimeout(450)
  const port = card.locator(cardName === 'chat' ? '.chat-log' : '.wi-body')
  const grab = () => port.evaluate(el => {
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    const cardBox = el.closest('.wi-card').getBoundingClientRect()
    const lines = [...el.querySelectorAll('.chat-text')].map(line => {
      const range = document.createRange()
      range.selectNodeContents(line)
      return new Set([...range.getClientRects()].map(rect => rect.top)).size
    })
    return { width: el.clientWidth, height: el.clientHeight, gutter: el.offsetWidth - el.clientWidth,
      top: el.scrollTop, range: el.scrollHeight - el.clientHeight,
      port: [box.width, box.height], card: [cardBox.width, cardBox.height], lines,
      mask: style.getPropertyValue('--scroll-boundary-mask').trim() }
  })
  const samples = { fitting: await grab() }
  if (cardName === 'chat') assert.ok(samples.fitting.range <= 1, 'a short chat log fits')
  if (samples.fitting.range <= 1 && !before) assert.equal(samples.fitting.mask, 'none')
  if (file) await page.screenshot({ path: file + '-fitting.png' })
  if (cardName === 'chat') {
    await page.evaluate(() => {
      for (let i = 0; i < 36; i++) {
        miraChat.net.chat.receive({ type: 'chat', from: 0xff00 + i % 4, text: `${i} The quiet trail over this hill keeps going past the old lighthouse.`, t: 0 })
      }
    })
  } else {
    await card.locator('details.performance-diagnostics > summary').click()
    const switches = card.locator('.performance-field-switches > summary')
    if (await switches.count() && await switches.isVisible()) await switches.click()
  }
  await page.waitForTimeout(500)
  const range = await port.evaluate(el => el.scrollHeight - el.clientHeight)
  assert.ok(range > 8, cardName + ' can scroll')
  for (const [name, fraction] of [['top', 0], ['middle', 0.5], ['end', 1]]) {
    await port.evaluate((el, fraction) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * fraction }, fraction)
    await page.waitForTimeout(120)
    const state = samples[name] = await grab()
    if (!before) {
      assert.ok(state.mask, cardName + ' has a mask at ' + name)
      const gradient = state.mask.split('linear-gradient(to bottom, ').at(-1)
      assert.equal((gradient.match(/transparent/g) ?? []).length, name === 'middle' ? 2 : 1)
      if (name === 'top') assert.match(gradient, /^#000 \d+px, #000/)
      if (name === 'end') assert.match(gradient, /#000 (\d+)px, #000 \1px, #000 \1px\)$/)
    }
    if (file) await page.screenshot({ path: file + '-' + name + '.png' })
  }
  assert.deepEqual(samples.top.port, samples.end.port)
  assert.deepEqual(samples.top.lines, samples.end.lines)
  if (!before) {
    const box = await port.boundingBox()
    const viewport = page.viewportSize()
    const x = Math.round(box.x + box.width / 2)
    const y = Math.round((Math.max(0, box.y) + Math.min(viewport.height, box.y + box.height)) / 2)
    if (viewport.width > 390) {
      await page.mouse.move(x, y)
      await page.mouse.wheel(0, -120)
    } else {
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: 120, speed: 500, gestureSourceType: 'touch', preventFling: true })
      await cdp.detach()
    }
    const deadline = Date.now() + 2000
    while ((await grab()).top >= samples.end.top - 2 && Date.now() < deadline) await page.waitForTimeout(50)
    assert.ok((await grab()).top < samples.end.top - 2, cardName + ' accepts real scrolling input')
  }
  if (file) writeFileSync(file + '.json', JSON.stringify(samples, null, 2))
  return { samples, port }
}

async function measure(page, port, file) {
  await port.evaluate(el => { el.scrollTop = (el.scrollHeight - el.clientHeight) / 2 })
  const cdp = await page.context().newCDPSession(page)
  const events = []
  cdp.on('Tracing.dataCollected', ({ value }) => {
    for (const event of value) {
      if (/DrawAndSwap|SubmitCompositorFrame|SwapBuffers|fade:/.test(event.name)) events.push(event)
    }
  })
  await cdp.send('Tracing.start', { categories: 'viz,benchmark,blink.user_timing', transferMode: 'ReportEvents' })
  const override = await page.addStyleTag({ content: '.mira-shell [style*="--scroll-boundary-mask"] { mask-image: none !important }' })
  const histograms = []
  for (const [index, enabled] of [false, true, true, false, false, true].entries()) {
    await override.evaluate((style, disabled) => { style.disabled = disabled }, enabled)
    await page.waitForTimeout(250)
    assert.equal(await port.evaluate(el => getComputedStyle(el).maskImage !== 'none'), enabled)
    await cdp.send('Browser.getHistograms', { query: 'Compositing.Display', delta: true })
    const tag = `fade:${index}:${enabled ? 'on' : 'off'}`
    const frames = await page.evaluate(async tag => {
      const times = []
      performance.mark(tag + ':start')
      while (times.length < 45) times.push(await new Promise(requestAnimationFrame))
      performance.mark(tag + ':end')
      return times.slice(1).map((time, index) => time - times[index])
    }, tag)
    const hist = await cdp.send('Browser.getHistograms', { query: 'Compositing.Display', delta: true })
    histograms.push({ tag, frames, histograms: hist.histograms })
  }
  const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
  await cdp.send('Tracing.end')
  await done
  await override.evaluate(style => style.remove())
  const median = values => {
    const sorted = values.toSorted((a, b) => a - b)
    if (!sorted.length) return null
    return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2
  }
  const results = histograms.map(({ tag, frames }) => {
    const start = events.find(event => event.name === tag + ':start')?.ts
    const end = events.find(event => event.name === tag + ':end')?.ts
    const draws = events
      .filter(event => event.name === 'Display::DrawAndSwap' && event.dur !== undefined
        && event.ts >= start && event.ts + event.dur <= end)
      .map(event => event.dur / 1000)
    return { tag, draws: draws.length, medianDisplayDrawAndSwapMs: median(draws), medianRafMs: median(frames) }
  })
  writeFileSync(file + '-compositor.json', JSON.stringify({ results, histograms, events }))
  assert.ok(results.every(result => result.draws > 0), 'each timing arm captured compositor draws')
  console.log(file, JSON.stringify(results))
}

try {
  if (evidence) mkdirSync(evidence, { recursive: true })
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    for (const material of ['liquid', 'flat']) {
      if (selectedCell && selectedCell !== `${width}-${material}`) continue
      const options = { viewport: { width, height }, isMobile: width === 390, hasTouch: width === 390, reducedMotion: 'reduce' }
      const context = await browser.newContext(options)
      const cards = ['performance', 'chat']
      const prefixFor = card => evidence && `${evidence}/${width}x${height}-${material}-${card}`
      const earlier = new Map()
      if (baseline) {
        const beforeContext = await browser.newContext(options)
        const before = await openGame(beforeContext, baseline, material)
        for (const card of cards) {
          const prefix = prefixFor(card)
          earlier.set(card, await sample(before, card, prefix && prefix + '-before', true))
        }
        await beforeContext.close()
      }
      const page = await openGame(context, base, material)
      for (const card of cards) {
        const prefix = prefixFor(card)
        const prior = earlier.get(card)
        const after = await sample(page, card, !timing && prefix && prefix + '-after', false)
        if (prior) {
          for (const phase of ['top', 'middle', 'end']) {
            for (const key of ['width', 'height', 'gutter', 'port', 'card', 'lines']) {
              assert.deepEqual(after.samples[phase][key], prior.samples[phase][key], `${prefix} ${phase} ${key}`)
            }
          }
        }
        if (timing && prefix) await measure(page, after.port, prefix)
      }
      if (!timing && width === 1280 && material === 'liquid') await exerciseRail(page)
      await context.close()
      console.log(`Scroll edges verified at ${width}×${height} in ${material}`)
    }
  }
} finally { await browser.close() }
