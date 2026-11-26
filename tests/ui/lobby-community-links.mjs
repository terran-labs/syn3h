// Run from the checkout through the shared heavy-job wrapper.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'
import { buildFeed } from '../../tools/release-feed.mjs'

const out = resolve(process.argv[2] ?? 'tests/ui/artifacts/lobby-community-links')
const destinations = [
  ['Mira on GitHub', 'https://github.com/terran-labs/syn3h'],
  ['Join the Mira community on Discord', 'https://discord.gg/dxTFZRM'],
  ['Terran Labs', 'https://terranlabs.com'],
]
const profiles = [[320, 568], [390, 844], [844, 390], [1280, 800], [1440, 900]]
const versionSelector = '[data-lobby-version]'
const updatesSelector = '.lobby-sheet-updates[open]'
const dockSelector = '.lobby-version-dock'
const gearSelector = '.lobby-gear'
const welcomeSelector = '.lobby-sheet-about[open]'
const report = { layouts: [], creator: {}, failures: [] }
await mkdir(out, { recursive: true })
process.env.MIRA_NO_ROOM_SERVER = '1'

// Production serves prebuilt JSON. Prebuild it here so Vite's synchronous
// development feed generation cannot block the input driver during a tap.
const feed = JSON.stringify(buildFeed())
const server = await createServer({
  plugins: [{
    name: 'lobby-check-static-updates',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use('/releases.json', (_request, response) => {
        response.setHeader('content-type', 'application/json; charset=utf-8')
        response.end(feed)
      })
    },
  }],
  server: { host: '127.0.0.1', port: 0 },
})

async function waitForLobby(page, address) {
  await page.goto(address + '?webgl=1&tap=0&intro=0', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.locator('html[data-boot="done"]').waitFor({ state: 'attached', timeout: 90000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 45000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => {
    const galaxy = window.mira?.shell?.galaxy
    if (!galaxy?.live || galaxy.opening !== null || galaxy.returning !== null || !galaxy.settled
      || document.documentElement.hasAttribute('data-opening')) return false
    if (!document.querySelector('.galaxy-label:not([disabled])')) return false
    const targets = document.querySelectorAll(
      '.lobby-version-dock button, .lobby-community a, .lobby-gear-dock > button',
    )
    return targets.length === 6 && [...targets].every(target => {
      for (let element = target; element; element = element.parentElement) {
        const style = getComputedStyle(element)
        if (element.hidden || element.inert || style.visibility !== 'visible' || Number(style.opacity) !== 1) return false
      }
      const { x, y, width, height } = target.getBoundingClientRect()
      return width > 0 && height > 0
        && target.contains(document.elementFromPoint(x + width / 2, y + height / 2))
    })
  }, null, { timeout: 45000 })
}

async function foreground(page) {
  await page.bringToFront()
  await page.waitForFunction(() => document.visibilityState === 'visible' && document.hasFocus())
}

async function observeActivation(page) {
  await page.evaluate(() => {
    const log = window.dockCheck = { versionClicks: [], githubClicks: 0, updatesOpens: [], creatorEvents: 0, taps: [] }
    // The window sees the real input before the creator binder can stop
    // propagation on taps that land over the open modal.
    window.addEventListener('click', event => {
      if (!event.isTrusted) return
      const control = event.target.closest('a, button')
      if (control?.hasAttribute('data-lobby-version')) log.versionClicks.push({ at: performance.now(), detail: event.detail })
      if (control?.getAttribute('aria-label') === 'Mira on GitHub') log.githubClicks++
      if (event.detail > 0) log.taps.push({ at: performance.now(), x: event.clientX, y: event.clientY })
    }, true)
    const updates = document.querySelector('.lobby-sheet-updates')
    new MutationObserver(() => {
      if (updates.open) log.updatesOpens.push(performance.now())
    }).observe(updates, { attributes: true, attributeFilter: ['open'] })
    window.addEventListener('mira:creator-key', () => log.creatorEvents++)
  })
}

const activation = page => page.evaluate(() => window.dockCheck)
const pointerAt = (page, touch, [x, y]) => touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y)
const pointer = (control, touch) => touch ? control.tap() : control.click()

function center(control) {
  return control.evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect()
    const point = [Math.round(x + width / 2), Math.round(y + height / 2)]
    if (!element.contains(document.elementFromPoint(...point))) throw new Error('Control center is blocked')
    return point
  })
}

async function openUpdates(page, action) {
  let inputError
  action().catch(error => { inputError = error })
  try {
    await page.locator(updatesSelector).waitFor()
  } catch (error) {
    throw inputError ?? error
  }
}

async function dismissUpdates(page, version) {
  await page.keyboard.press('Escape')
  await page.locator(updatesSelector).waitFor({ state: 'hidden' })
  assert.ok(await version.evaluate(element => element === document.activeElement), 'Updates restores version focus')
}

async function openLink(page, action, url) {
  const [popup] = await Promise.all([page.waitForEvent('popup'), action()])
  await popup.waitForLoadState()
  assert.equal(popup.url(), new URL(url).href)
  assert.equal(await popup.evaluate(() => window.opener), null)
  await popup.close()
  await foreground(page)
}

async function session(browser, width, height, run) {
  const touch = width < 900
  const context = await browser.newContext({
    viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce',
  })
  const requested = []
  await context.route(url => destinations.some(([, destination]) => new URL(destination).hostname === url.hostname), route => {
    requested.push(route.request().url())
    return route.fulfill({ body: 'Intercepted community destination' })
  })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  try {
    await waitForLobby(page, server.resolvedUrls.local[0])
    await observeActivation(page)
    await foreground(page)
    await run(page, touch, requested)
  } finally {
    await context.close()
  }
}

async function checkLayout(page, touch, requested, result) {
  const version = page.locator(versionSelector)
  const dock = page.locator(dockSelector)
  const nav = dock.getByRole('navigation', { name: 'Mira community' })
  const targets = nav.locator('a, button')
  result.stage = 'settled layout and targets'
  assert.deepEqual(await targets.evaluateAll(elements => elements.map(el => el.tagName)), ['A', 'BUTTON', 'A', 'A'])
  assert.deepEqual(await nav.getByRole('link').evaluateAll(elements => elements.map(link => [
    link.getAttribute('aria-label'), link.getAttribute('href'), link.target, link.rel,
  ])), destinations.map(link => [...link, '_blank', 'noopener noreferrer']))
  assert.equal(await nav.getByRole('link', { name: 'Terran Labs' }).textContent(), 'terranlabs.com')
  assert.equal(await nav.locator('svg > path').count(), 2)
  Object.assign(result, await targets.evaluateAll(elements => {
    const rect = element => element.getBoundingClientRect().toJSON()
    return {
      dock: rect(document.querySelector('.lobby-version-dock')),
      controls: rect(document.querySelector('.lobby-gear-dock')),
      captions: [...document.querySelectorAll('.galaxy-label:not([disabled]) .galaxy-caption-text')]
        .map(caption => ({ name: caption.querySelector('strong').textContent, box: rect(caption) })),
      targets: elements.map(element => {
        const box = rect(element)
        const x = box.x + box.width / 2, y = box.y + box.height / 2
        const points = [[x, y], [box.left + 3, y], [box.right - 3, y], [x, box.top + 3], [x, box.bottom - 3]]
        return { ...box, hit: points.every(([x, y]) => element.contains(document.elementFromPoint(x, y))) }
      }),
      textStarts: [elements[1], elements[3]].map(element => {
        const range = document.createRange()
        range.selectNodeContents([...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE))
        return range.getBoundingClientRect().left
      }),
    }
  }))
  const { dock: box, controls, width, height } = result
  const [githubBox, versionBox, discordBox, studioBox] = result.targets
  assert.ok(box.left >= 0 && box.top >= 0 && box.right <= width && box.bottom <= height, 'dock fits the viewport')
  assert.ok(box.right <= controls.left || box.bottom <= controls.top || box.top >= controls.bottom, 'dock clears lobby controls')
  for (const { name, box: caption } of result.captions) {
    const overlap = Math.min(box.right, caption.right) - Math.max(box.left, caption.left)
    const overlapY = Math.min(box.bottom, caption.bottom) - Math.max(box.top, caption.top)
    assert.ok(overlap <= 1 || overlapY <= 1, `caption overlaps the community dock: ${name}`)
  }
  if (width < 500) assert.ok(Math.abs((controls.left + controls.right) / 2 - width / 2) <= 1)
  assert.ok(result.targets.every(target => target.hit && target.width >= 44 && target.height >= 44))
  assert.equal(githubBox.left, discordBox.left)
  assert.equal(versionBox.left, studioBox.left)
  assert.equal(githubBox.top, versionBox.top)
  assert.equal(discordBox.top, studioBox.top)
  assert.ok(githubBox.right < versionBox.left && discordBox.right < studioBox.left && githubBox.bottom < discordBox.top)
  assert.equal(result.textStarts[0], result.textStarts[1])
  assert.deepEqual(requested, [], 'external destinations receive no request before activation')
  await page.screenshot({ path: resolve(out, result.id + '.png') })

  result.stage = 'opening Updates by pointer and keyboard'
  const versionPoint = await center(version)
  await openUpdates(page, () => pointerAt(page, touch, versionPoint))
  await page.waitForFunction(() => window.dockCheck.updatesOpens.length === 1)
  let log = await activation(page)
  assert.equal(log.versionClicks.length, 1)
  assert.ok(log.versionClicks[0].detail > 0)
  result.firstTapMs = log.updatesOpens[0] - log.versionClicks[0].at
  await dock.waitFor({ state: 'hidden' })
  await dismissUpdates(page, version)
  await openUpdates(page, () => page.keyboard.press('Enter'))
  log = await activation(page)
  assert.equal(log.versionClicks.length, 2)
  assert.equal(log.versionClicks[1].detail, 0)
  assert.equal(log.creatorEvents, 0)
  await dismissUpdates(page, version)

  result.stage = 'opening Welcome and Settings'
  await pointer(page.locator('.lobby-about'), touch)
  await page.locator(welcomeSelector).waitFor()
  await dock.waitFor({ state: 'hidden' })
  if (width === 390) {
    await page.waitForFunction(() => {
      const panel = document.querySelector('.lobby-sheet-about[open] .lobby-sheet-panel')
      const galaxy = window.mira?.shell?.galaxy
      const image = panel?.querySelector('[data-slot="front"] img')
      return panel && galaxy && galaxy.liftShown === (galaxy.markLift > 0 ? 1 : 0)
        && Number(getComputedStyle(panel).opacity) === 1
        && image?.complete && image.naturalWidth > 0
        && !panel.getAnimations({ subtree: true }).some(animation =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime)
          && (animation.pending || animation.playState === 'running'))
    }, null, { timeout: 45000 })
    await page.screenshot({ path: resolve(out, result.id + '-welcome.png') })
  }
  await page.keyboard.press('Escape')
  await dock.waitFor()
  await pointer(page.locator(gearSelector), touch)
  const settings = page.locator('.lobby-settings')
  await settings.waitFor()
  await dock.waitFor({ state: 'hidden' })
  assert.equal(await settings.locator('[data-section="creator"]').count(), 0)
  await page.keyboard.press('Escape')
  await dock.waitFor()

  result.stage = 'checking link popups and focus'
  const [github, updates, discord, studio] = await targets.all()
  await github.focus()
  for (const control of [updates, discord, studio]) {
    await page.keyboard.press('Tab')
    assert.ok(await control.evaluate(element => element === document.activeElement), 'Tab follows visual order')
  }
  await openLink(page, () => page.keyboard.press('Enter'), destinations[2][1])
  for (const [link, [, url]] of [[github, destinations[0]], [discord, destinations[1]], [studio, destinations[2]]]) {
    await openLink(page, () => pointer(link, touch), url)
  }
  log = await activation(page)
  assert.equal(log.githubClicks, 1)
  assert.equal(log.versionClicks.length, 2)
  assert.equal(log.creatorEvents, 0)
  assert.equal(await page.locator(updatesSelector).count(), 0)
  assert.equal(requested.length, 4)
  const restoredPoint = await center(version)
  await openUpdates(page, () => pointerAt(page, touch, restoredPoint))
  assert.equal((await activation(page)).versionClicks.length, 3)
  assert.equal(requested.length, 4, 'Version opens no external destination')
  await dismissUpdates(page, version)
}

async function checkCreator(page, touch, requested) {
  const version = page.locator(versionSelector)
  const github = page.getByRole('link', { name: destinations[0][0] })
  report.creator.stage = 'five GitHub taps'
  for (let i = 0; i < 5; i++) await openLink(page, () => pointer(github, touch), destinations[0][1])
  let log = await activation(page)
  assert.equal(log.githubClicks, 5)
  assert.equal(requested.length, 5)
  assert.deepEqual(log.versionClicks, [])
  assert.deepEqual(log.updatesOpens, [])
  assert.equal(log.creatorEvents, 0)
  report.creator.github = { clicks: log.githubClicks, versionClicks: 0, updatesOpens: 0, creatorEvents: 0 }
  const offset = log.taps.length

  report.creator.stage = 'five version taps'
  const point = await center(version)
  await openUpdates(page, () => pointerAt(page, touch, point))
  assert.equal((await activation(page)).versionClicks.length, 1)
  for (let i = 0; i < 3; i++) await pointerAt(page, touch, point)
  log = await activation(page)
  assert.equal(log.taps.length - offset, 4)
  assert.equal(log.creatorEvents, 0)
  assert.equal(await page.locator(updatesSelector).count(), 1)
  await pointerAt(page, touch, point)
  await page.waitForFunction(() => window.dockCheck.creatorEvents === 1)
  await page.locator(updatesSelector).waitFor({ state: 'hidden' })
  log = await activation(page)
  const taps = log.taps.slice(offset)
  assert.equal(taps.length, 5)
  assert.ok(taps.every(tap => tap.x === point[0] && tap.y === point[1]), 'all five trusted taps use the same coordinate')
  assert.equal(log.updatesOpens.length, 1)
  assert.equal(requested.length, 5, 'version taps open no external destination')
  report.creator.version = { point, taps, elapsedMs: taps.at(-1).at - taps[0].at,
    firstTapMs: log.updatesOpens[0] - log.versionClicks[0].at, creatorEvents: log.creatorEvents }
  await pointer(page.locator(gearSelector), touch)
  const card = page.locator('.lobby-settings [data-section="creator"]')
  await card.waitFor()
  report.creator.settingsTitle = (await card.innerText()).trim()
  assert.match(report.creator.settingsTitle, /Dimensional portal/i)
}

let browser
try {
  await server.listen()
  browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
  for (const [width, height] of profiles) {
    const result = { id: width + 'x' + height, width, height, stage: 'settling lobby' }
    report.layouts.push(result)
    try {
      await session(browser, width, height, (page, touch, requested) => checkLayout(page, touch, requested, result))
      result.stage = 'passed'
      console.log(result.id, result.stage, 'first tap ms', result.firstTapMs)
    } catch (error) {
      report.failures.push(result.id + ' [' + result.stage + ']: ' + error.message)
    }
  }
  try {
    await session(browser, 390, 844, checkCreator)
    report.creator.stage = 'passed'
    console.log('creator', JSON.stringify(report.creator))
  } catch (error) {
    report.failures.push('creator [' + report.creator.stage + ']: ' + error.message)
  }
} finally {
  await browser?.close()
  await server.close()
  await writeFile(resolve(out, 'measurements.json'), JSON.stringify(report, null, 2))
}
assert.deepEqual(report.failures, [])
