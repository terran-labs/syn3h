import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.__copiedInvite = value } }, configurable: true }))
  const url = new URL(process.env.SYN3H_URL)
  url.searchParams.set('autoplay', '1'); url.searchParams.set('v', 'v26.11.1506'); url.searchParams.set('room', `invite-version-${Date.now()}`)
  await page.goto(url.href)
  await page.waitForFunction(() => window.syn3h?.game.tick > 30, null, { timeout: 120000 })
  await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
  await page.evaluate(() => syn3h.shell.openJoin())
  const shown = await page.locator('.join-view .invite-link').innerText()
  const invite = new URL(shown)
  assert.equal(invite.searchParams.get('v'), 'v26.11.1506')
  assert.equal(invite.searchParams.get('room'), url.searchParams.get('room'))
  assert.ok(invite.searchParams.get('world')); assert.equal(invite.searchParams.has('autoplay'), false)
  // Compare the actual QR geometry to the encoder for the displayed versioned link.
  assert.equal(await page.evaluate(async expected => {
    const { qrSvg } = await import('/src/ui/QrCode.ts')
    return document.querySelector('.join-view .invite-qr svg').outerHTML === qrSvg(expected).outerHTML
  }, shown), true)
  await page.locator('.join-copy').click()
  assert.equal(await page.evaluate(() => window.__copiedInvite), shown)
  await mkdir('tests/ui/artifacts/invite-version', { recursive: true })
  await page.screenshot({ path: 'tests/ui/artifacts/invite-version/versioned-qr.png' })
  const guest = await browser.newPage()
  const join = new URL(shown); join.searchParams.set('autoplay', '1')
  await guest.goto(join.href)
  await guest.waitForFunction(() => window.syn3h?.game.tick > 30 && syn3h.shell.playerCount >= 2, null, { timeout: 120000 })
  assert.equal(new URL(guest.url()).searchParams.get('v'), 'v26.11.1506')
  assert.equal(new URL(guest.url()).searchParams.get('room'), invite.searchParams.get('room'))
  await guest.close()
  console.log('Versioned invite, clipboard, QR payload and same-room join passed')
} finally { await browser.close() }
