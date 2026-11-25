// Usage: node tests/ui/lobby-twin-routing.mjs <origin> <output-dir>
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { waitForState } from './stateWait.mjs'

const [origin, out] = process.argv.slice(2)
assert.ok(origin && out, 'usage: node tests/ui/lobby-twin-routing.mjs <origin> <output-dir>')
const entry = new URL(origin)
const timeout = 120_000
await mkdir(out, { recursive: true })

function lobbyURL(level, from = entry) {
  const url = new URL(from)
  url.searchParams.delete('autoplay')
  url.searchParams.set('twins', '1')
  url.searchParams.set('gfx', String(level))
  return url.href
}

function observeWelcomes(page) {
  const welcomes = []
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    if (typeof payload !== 'string') return
    let message
    try { message = JSON.parse(payload) } catch { return }
    if (message.type === 'welcome') welcomes.push(message)
  }))
  return welcomes
}

async function joined(page, welcomes, index, step) {
  await waitForState(page, `${step}: the client accepted a welcome and entered play`,
    () => window.mira?.shell?.playing && window.miraChat?.net?.connected && window.miraChat.net.id > 0,
    undefined, 120)
  const arrivals = welcomes.slice(index)
  assert.equal(arrivals.length, 1, `${step}: exactly one server welcome`)
  const welcome = arrivals[0]
  assert.ok(Number.isSafeInteger(welcome.id) && welcome.id > 0, `${step}: positive server player id`)
  assert.equal(await page.evaluate(() => window.miraChat.net.id), welcome.id, `${step}: client uses the welcome id`)
  assert.ok(welcome.players.some(player => player.id === welcome.id && !player.bot), `${step}: welcome roster includes this player`)
  await waitForState(page, `${step}: descent complete`,
    () => !document.querySelector('.mira-shell')?.classList.contains('is-descending') &&
      document.documentElement.dataset.boot === 'done', undefined, 120)
  return welcome
}

async function openLobby(page, url) {
  await page.goto(url)
  await waitForState(page, 'the loading veil to lift for the Twin lobby', () =>
    document.documentElement.dataset.boot === 'done' && window.mira?.shell, undefined, 120)
  await page.keyboard.press('Shift')
  await waitForState(page, 'the Twin lobby to settle with visible caption controls', () =>
    document.querySelector('.mira-shell.galaxy-open') && !window.mira.shell.galaxy?.opening &&
      document.querySelector('.galaxy-private-caption:not([hidden])')?.getClientRects().length > 0,
  undefined, 60)
}

async function controls(page, recipe, onScreen = true) {
  const found = await waitForState(page, `accessible Twin controls for ${recipe ?? 'a visible planet'}`,
    ({ recipe, onScreen }) => {
      const usable = button => {
        if (!button || button.closest('[hidden], [inert]') || getComputedStyle(button).visibility !== 'visible') return false
        const box = button.getBoundingClientRect()
        return box.width > 0 && box.height > 0 && (!onScreen ||
          (box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight))
      }
      const captions = [...document.querySelectorAll('button.galaxy-private-caption[data-twin-for]')]
      for (const privateButton of captions) {
        const id = privateButton.dataset.twinFor
        if (recipe && id !== recipe) continue
        const name = document.getElementById(`twin-world-${id}`)
        const publicButton = name?.closest('button')
        const publicLabel = document.getElementById(`twin-public-${id}`)
        const privateLabel = document.getElementById(`twin-private-${id}`)
        if (usable(publicButton) && usable(privateButton) && publicLabel && privateLabel) {
          return {
            recipe: id,
            public: `${publicLabel.textContent.trim()} ${name.textContent.trim()}`,
            private: `${privateLabel.textContent.trim()} ${name.textContent.trim()}`,
          }
        }
      }
      return null
    }, { recipe, onScreen }, 30)
  const names = await found.jsonValue()
  assert.match(names.public, /^Public\b/, 'the public caption identifies its action')
  assert.match(names.private, /^Private\b/, 'the private caption identifies its action')
  return {
    recipe: names.recipe,
    public: page.getByRole('button', { name: names.public, exact: true }),
    private: page.getByRole('button', { name: names.private, exact: true }),
  }
}

async function assertIdle(page, level, reduced, label) {
  const state = () => page.evaluate(() => ({
    frames: window.mira.shell.galaxy?.frames ?? 0,
    live: window.mira.shell.galaxy?.live === true,
    quality: window.mira.params.get('gfx.quality').value,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    visible: !document.hidden,
  }))
  const start = await state()
  assert.equal(start.quality, level, `${label}: expected graphics quality`)
  assert.equal(start.reduced, reduced, `${label}: expected motion preference`)
  if (reduced) assert.ok(start.live && start.frames > 0, `${label}: rendered galaxy exists before it rests`)
  for (let i = 0; i < 20; i++) {
    const before = await state()
    assert.ok(before.visible, `${label}: foreground lobby during idle sampling`)
    await page.waitForTimeout(1200)
    if ((await state()).frames !== before.frames) continue
    await page.waitForTimeout(2200)
    const after = await state()
    assert.ok(after.visible, `${label}: lobby stayed foreground during idle sampling`)
    assert.equal(after.frames, before.frames, `${label}: zero new galaxy draws over the settled interval`)
    return { draws: 0, sampleMilliseconds: 2200, rendered: after.live }
  }
  assert.fail(`${label}: the lobby never settled to zero draws`)
}

async function capture(page, name) {
  await page.screenshot({ path: join(out, `${name}.png`) })
}

async function checkLobbyFetches(page, url, secret, countBefore) {
  const requests = []
  const responses = []
  const isFetch = request => ['xhr', 'fetch'].includes(request.resourceType())
  const requestListener = request => { if (isFetch(request)) requests.push(request) }
  const responseListener = response => { if (isFetch(response.request())) responses.push(response) }
  page.on('request', requestListener)
  page.on('response', responseListener)
  try {
    const [presence] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/presence', { timeout }),
      openLobby(page, url),
    ])
    assert.ok(presence.ok(), 'lobby privacy: real presence request succeeded')
    const totals = await presence.json()
    assert.ok(Array.isArray(totals.byRecipe), 'lobby privacy: presence returned recipe aggregates')
    assert.equal(countBefore(), 1, 'lobby privacy: opening the lobby made no new room welcome')
    for (const request of requests) {
      const headers = await request.allHeaders()
      assert.ok(!JSON.stringify([request.url(), request.postData(), headers.referer]).includes(secret),
        'lobby privacy: a fetch exposed the private room in its address, body, or referrer')
    }
    for (const response of responses) {
      if (!response.ok()) continue
      const type = response.headers()['content-type'] ?? ''
      if (/json|^text\//i.test(type)) {
        const body = await response.text()
        assert.ok(!body.includes(secret), 'lobby privacy: a fetch response exposed the private room')
      }
    }
    return { requests: requests.length, responses: responses.length, presenceStatus: presence.status() }
  } finally {
    page.off('request', requestListener)
    page.off('response', responseListener)
  }
}

const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist'],
})
let step = 'creating the desktop context'
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const host = await desktop.newPage()
  host.setDefaultTimeout(timeout)
  const hostWelcomes = observeWelcomes(host)

  step = 'desktop rendered lobby and reduced-motion rest'
  await openLobby(host, lobbyURL(3))
  const reducedMotion = await assertIdle(host, 3, true, 'desktop reduced motion')
  const first = await controls(host)
  await capture(host, 'desktop-twins')
  assert.equal(hostWelcomes.length, 0, 'desktop lobby did not join before a deliberate tap')

  step = 'desktop Public tap'
  await first.public.click()
  const publicWelcome = await joined(host, hostWelcomes, 0, step)
  assert.equal(publicWelcome.room, 'lobby', 'Public tap welcomed into the default public room')
  await capture(host, 'desktop-public')

  step = 'desktop first Private tap'
  await openLobby(host, lobbyURL(3))
  await (await controls(host, first.recipe)).private.click()
  const privateWelcome = await joined(host, hostWelcomes, 1, step)
  assert.match(privateWelcome.room, /^p-[a-z0-9]{22}$/, 'Private tap welcomed into a parallel room')
  // Use the entry address produced by the Private tap, including its normal autoplay flag.
  const invite = new URL(host.url())
  assert.equal(invite.searchParams.get('room'), privateWelcome.room, 'the invite room matches the welcome')
  const world = invite.searchParams.get('world')
  assert.ok(world?.startsWith(`${first.recipe}.`), 'the invite preserves the selected world')
  await capture(host, 'desktop-private')

  step = 'same browser reopens its own private twin'
  const differentPreview = new URL(lobbyURL(3))
  differentPreview.searchParams.set('world', `${first.recipe}.${world === `${first.recipe}.12345` ? 12346 : 12345}`)
  await openLobby(host, differentPreview.href)
  await (await controls(host, first.recipe)).private.click()
  const reused = await joined(host, hostWelcomes, 2, step)
  assert.equal(reused.room, privateWelcome.room, 'same browser gets a welcome in the original room')
  assert.equal(new URL(host.url()).searchParams.get('world'), world, 'same browser keeps the original world code')

  step = 'phone rendered Twin frame'
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  })
  const guest = await phone.newPage()
  guest.setDefaultTimeout(timeout)
  const guestWelcomes = observeWelcomes(guest)
  await openLobby(guest, lobbyURL(3))
  await waitForState(guest, 'the phone galaxy to render',
    () => window.mira.shell.galaxy?.live && window.mira.shell.galaxy.frames > 0, undefined, 60)
  await controls(guest)
  await capture(guest, 'phone-twins')
  assert.equal(guestWelcomes.length, 0, 'phone lobby did not join before opening the invite')

  step = 'phone joins the private invite'
  await guest.goto(invite.href)
  const visitor = await joined(guest, guestWelcomes, 0, step)
  assert.equal(visitor.room, reused.room, 'guest welcome names the host room')
  assert.notEqual(visitor.id, reused.id, 'guest and host have distinct server player ids')
  assert.ok(visitor.players.some(player => player.id === reused.id && !player.bot),
    'the guest welcome roster includes the host')
  await waitForState(host, 'the guest in the host client roster',
    guestId => {
      const player = window.miraChat?.net?.players.get(guestId)
      return Boolean(player && !player.bot)
    },
    visitor.id, 30)
  await capture(guest, 'phone-invite-joined')

  step = 'phone lobby privacy and Minimal rest after visiting the invite'
  // Keep the inbound room and world in the entry URL, but remove autoplay to visit only the lobby.
  const lobbyFetches = await checkLobbyFetches(guest, lobbyURL(0, invite), reused.room, () => guestWelcomes.length)
  const minimal = await assertIdle(guest, 0, false, 'phone Minimal')
  await capture(guest, 'phone-minimal-twins')

  step = 'phone deliberately makes its own private twin'
  await (await controls(guest, first.recipe, false)).private.tap()
  const independent = await joined(guest, guestWelcomes, 1, step)
  assert.match(independent.room, /^p-[a-z0-9]{22}$/, 'guest Private tap welcomed into a parallel room')
  assert.notEqual(independent.room, reused.room, 'guest Private tap creates a room independent of the inbound invite')
  await capture(guest, 'phone-private')

  await writeFile(join(out, 'lobby-twin-routing.json'), JSON.stringify({
    publicWelcome: true, privateWelcome: true, sameBrowserReuse: true,
    guestWelcomeAndRoster: true, independentPrivateWelcome: true,
    lobbyFetches, reducedMotion, minimal,
  }, null, 2) + '\n')
  console.log('Twin routing, lobby privacy, and idle draw checks passed')
} catch (error) {
  throw new Error(`Twin browser proof failed during ${step}`, { cause: error })
} finally {
  await browser.close()
}
