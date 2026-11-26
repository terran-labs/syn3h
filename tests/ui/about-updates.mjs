// A player on an older release is told a newer one is live, and can read its notes and reload.
// Bugs caught: the lobby banner or the in-play chip never appearing for a newer live version;
// What's new not opening the notes, the newest day not open or its newest release missing or not
// first, a closed day not opening to its releases, the link to every release on GitHub missing; the page
// reloading by itself; Dismiss not sticking; a pinned (?v=) page prompting; release notes
// rendering markup or unsafe links. Where the notice sits and how big it is is not pinned.
//
// The watcher runs only on a release build (feed.ts, watchForUpdates), so start the dev server
// as the release before the newest production one (the second-last production row of
// release-notes/history.tsv); this check then serves a /v/versions.json naming the newest:
//
//   MIRA_RELEASE_VERSION=<second-newest, e.g. 26.11.2200> npx vite --port 5187
//   MIRA_URL=http://127.0.0.1:5187/ tools/heavy.sh node tests/ui/about-updates.mjs
import '../../tools/lib/legacy-env.mjs' // legacy environment names, see docs/NAMES.md
import { chromium, webkit, devices } from 'playwright-core'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
/** The feed lists the real production history, newest first: its top entry grows with every release. */
const PRODUCTION = readFileSync('release-notes/history.tsv', 'utf8').split('\n').map((l) => l.split('\t'))
  .filter(([v, , , , channel]) => /^v\d/.test(v ?? '') && channel?.trim() === 'production').map(([v]) => v.slice(1))
const NEWEST = PRODUCTION.at(-1)
const RUNNING = process.env.MIRA_RELEASE_VERSION ?? PRODUCTION.at(-2), LIVE = NEWEST
const live = route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ versions: [PRODUCTION.at(-3), RUNNING, LIVE] }) })

for (const mode of ['desktop', 'phone']) {
  const touch = mode !== 'desktop'
  const browser = await (touch ? webkit.launch() : chromium.launch({ channel: 'chrome', headless: true }))
  try {
    const context = await browser.newContext(touch ? devices['iPhone 14'] : { viewport: { width: 1440, height: 900 } })
    await context.route('**/v/versions.json', live)
    // The history in two files, as the release tool will write it: the newest releases in
    // /releases.json, naming /releases-older.json for the rest, which loads only on Show more.
    let oldest = null, olderRequests = 0
    await context.route('**/releases.json', async route => {
      const body = await (await route.fetch()).json(), cut = Math.min(40, body.releases.length - 5)
      oldest = body.releases.at(-1).version
      await context.route('**/releases-older.json', older => { olderRequests++; older.fulfill({ contentType: 'application/json', body: JSON.stringify({ releases: body.releases.slice(cut) }) }) })
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...body, releases: body.releases.slice(0, cut), older: '/releases-older.json' }) })
    })
    const page = await context.newPage()
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    let loads = 0; page.on('load', () => loads++)
    await page.goto(`${process.env.MIRA_URL}?room=updates-${mode}-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.shell, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    // Without a release version the watcher is off and nothing below can happen: say so.
    const build = await page.locator('.lobby-version').textContent()
    assert.ok(/\d+\.\d+\.\d+/.test(build ?? ''), `the dev server is not a release build (shows "${build}"): start it with MIRA_RELEASE_VERSION=${RUNNING}`)

    // The lobby banner: the newer version, Reload and What's new.
    const banner = page.locator('.update-banner')
    await banner.waitFor({ state: 'visible', timeout: 20000 })
    assert.equal(await banner.locator('strong').textContent(), `Update available · v${LIVE}`)
    assert.equal(await banner.getByRole('button', { name: 'Reload' }).count(), 1)
    assert.equal(await banner.getByRole('button', { name: 'What’s new' }).count(), 1)
    await page.waitForTimeout(3000)
    assert.equal(loads, 1, 'nothing reloads by itself')

    // The version in the lower left (which opens Updates) carries a quiet mark while a newer version is out.
    assert.equal(await page.locator('.lobby-version.has-update').count(), 1, `${mode}: the version is marked`)
    // What's new opens Updates: one entry per Pacific day (days.ts), the newest day open with its
    // newest release open and that release's notes. Waits on the sheet itself, not a fixed delay:
    // an opener may open it late (the version label waits out a five-tap gesture).
    await banner.getByRole('button', { name: 'What’s new' }).click()
    const about = page.locator('dialog.lobby-sheet-updates[open]')
    await about.waitFor({ state: 'visible', timeout: 15000 })
    // The days arrive with the feed. The dev server builds /releases.json on each request, reading
    // git for each release's changes (tools/release-feed.mjs), seconds on a loaded machine: the
    // wait is long so load alone cannot fail it (AGENTS.md, testing).
    const days = about.locator('.update-day')
    await days.first().waitFor({ state: 'visible', timeout: 60000 })
    assert.equal(await days.first().locator('.update-day-toggle').getAttribute('aria-expanded'), 'true', `${mode}: the newest day starts open`)
    const first = days.first().locator('.update-release').first()
    await first.waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(await first.getAttribute('data-version'), NEWEST)
    assert.ok(await first.locator('.update-notes li').count() >= 2, 'the player digest shows as bullets')
    // Open means seen: the newest release's notes are visible, not only present.
    await first.locator('.update-notes li').first().waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(await first.locator('.update-full').getAttribute('href'), `https://github.com/terran-labs/syn3h/releases/tag/v${NEWEST}`)
    assert.equal(await first.locator('.update-notes script, .update-notes [onerror]').count(), 0)
    const links = await first.locator('.update-notes a').evaluateAll(as => as.map(a => [a.target, a.rel, a.protocol]))
    for (const [target, rel, protocol] of links) { assert.equal(target, '_blank'); assert.match(rel, /noopener/); assert.match(protocol, /^https?:$/) }
    // A closed day opens to its own releases.
    if (await days.count() > 1) {
      const older = days.nth(1), toggle = older.locator('.update-day-toggle')
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false', `${mode}: older days start closed`)
      await toggle.click()
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
      await older.locator('.update-release').first().waitFor({ state: 'visible', timeout: 5000 })
    }
    // Every release on GitHub, one link, in a new tab.
    const github = about.locator('a.updates-github')
    assert.equal(await github.getAttribute('href'), 'https://github.com/terran-labs/syn3h/releases')
    assert.equal(await github.getAttribute('target'), '_blank')
    assert.match(await github.getAttribute('rel') ?? '', /noopener/)

    // The X stands on the header row (its centre within 2 px of the title's), inside the column,
    // clear of All releases, and stays there while the list scrolls: only the list moves.
    const header = () => page.locator('dialog.lobby-sheet-updates').evaluate(root => {
      const box = el => el.getBoundingClientRect(), x = box(root.querySelector('.lobby-sheet-close')), title = box(root.querySelector('.lobby-sheet-title'))
      const gh = box(root.querySelector('.updates-github')), body = root.querySelector('.lobby-sheet-body'), b = box(body), cs = getComputedStyle(body)
      return { dy: Math.abs((x.top + x.bottom) / 2 - (title.top + title.bottom) / 2), inside: x.left >= b.left + parseFloat(cs.paddingLeft) - 1 && x.right <= b.right - parseFloat(cs.paddingRight) + 1,
        // Measured from the panel's top: on a phone the whole panel follows the name while it rises.
        clear: gh.right <= x.left, x: Math.round(x.top - box(root.querySelector('.lobby-sheet-panel')).top), title: Math.round(title.top - box(root.querySelector('.lobby-sheet-panel')).top) }
    })
    const atRest = await header()
    assert.ok(atRest.dy <= 2, `${mode}: the X is ${atRest.dy.toFixed(1)} px off the header row`)
    assert.ok(atRest.inside, `${mode}: the X is inside the sheet's column`)
    assert.ok(atRest.clear, `${mode}: the X is clear of All releases`)
    await page.locator('dialog.lobby-sheet-updates .about-updates').evaluate(list => { list.scrollTop = 600 })
    await page.waitForTimeout(200)
    const scrolled = await header()
    assert.ok(scrolled.dy <= 2 && scrolled.x === atRest.x && scrolled.title === atRest.title, `${mode}: the header and its X stay put while the list scrolls`)
    await page.locator('dialog.lobby-sheet-updates .about-updates').evaluate(list => { list.scrollTop = 0 })
    // "A newer version is out" is an action in the still header, never half-scrolled under the title.
    const note = await page.locator('dialog.lobby-sheet-updates').evaluate(root => {
      const n = root.querySelector('.updates-pinned'), list = root.querySelector('.about-updates')
      return n && { inList: list.contains(n), inHeader: !!n.closest('.updates-notice') }
    })
    if (note) assert.deepEqual(note, { inList: false, inHeader: true }, `${mode}: the update note stands in the still header`)
    // Each release keeps its version, time and GitHub mark on one line; a pill may take a second
    // line under the version, never a third.
    const rows = await page.locator('dialog.lobby-sheet-updates .update-release').evaluateAll(lis => lis.filter(li => li.getClientRects().length && li.getBoundingClientRect().height).map(li => {
      const mid = el => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2 }
      const line = li.querySelector('.update-release-line'), v = li.querySelector('.update-version'), t = li.querySelector('.update-time'), m = li.querySelector(':scope > .update-full')
      // Lines: the children's centres, sorted, counting a new line at each gap over 8 px.
      const mids = [...line.children].filter(c => c.getClientRects().length).map(mid).sort((x, y) => x - y)
      const lines = mids.reduce((n, y, i) => n + (i && y - mids[i - 1] > 8 ? 1 : 0), mids.length ? 1 : 0)
      return { v: v.textContent, time: t ? Math.abs(mid(t) - mid(v)) : 0, mark: Math.abs(mid(m) - mid(v)), lines }
    }))
    for (const row of rows) assert.ok(row.time <= 3 && row.mark <= 3 && row.lines <= 2, `${mode}: ${row.v} keeps its time and mark on its line, in at most two lines (${JSON.stringify(row)})`)

    // The owner's polish (26 November 2026). No borders anywhere in the sheet: spacing and the
    // rail part the days, not boxes (focus rings are outlines, not borders).
    const sheet = page.locator('dialog.lobby-sheet-updates')
    const bordered = await sheet.evaluate(root => {
      const out = []
      for (const el of [root, ...root.querySelectorAll('*')]) for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo)
        if (pseudo && cs.content === 'none') continue
        if (!el.getClientRects().length) continue
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          const width = parseFloat(cs[`border${side}Width`]), color = cs[`border${side}Color`], style = cs[`border${side}Style`]
          if (width > 0 && style !== 'none' && style !== 'hidden' && !/rgba\(.*,\s*0\)$|transparent/.test(color)) { out.push(`${el.className || el.tagName}${pseudo ?? ''} ${side}`); break }
        }
      }
      return out
    })
    assert.deepEqual(bordered, [], `${mode}: nothing in the sheet has a border`)
    // GitHub is a mark with a name, never the word as link text.
    assert.deepEqual(await sheet.locator('a').evaluateAll(as => as.filter(a => /github/i.test(a.textContent ?? '')).map(a => a.textContent)), [], `${mode}: no link says GitHub`)
    // Each day's date is centred on its rail circle (its capitals' middle, within 1 px), open or closed,
    // and the circle stands on the rail.
    const centred = () => sheet.evaluate(root => [...root.querySelectorAll('.update-day-date')].filter(d => d.getClientRects().length).map(date => {
      const cs = getComputedStyle(date), dot = getComputedStyle(date, '::before'), box = date.getBoundingClientRect()
      const probe = document.createElement('span'); probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
      date.append(probe); const baseline = probe.getBoundingClientRect().top; probe.remove()
      const ctx = document.createElement('canvas').getContext('2d'); ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      const cap = ctx.measureText('H').actualBoundingBoxAscent
      const dotMid = box.top + parseFloat(dot.marginTop) + parseFloat(dot.height) / 2
      const list = date.closest('.updates-days'), listBox = list.getBoundingClientRect(), rail = getComputedStyle(list, '::before')
      const day = date.closest('.update-day').getBoundingClientRect()
      return { day: date.textContent, off: Math.abs(dotMid - (baseline - cap / 2)), x: Math.abs(day.left + parseFloat(dot.left) + parseFloat(dot.width) / 2 - (listBox.left + parseFloat(rail.left) + .5)) }
    }))
    for (const c of await centred()) { assert.ok(c.off <= 1, `${mode}: ${c.day} is ${c.off.toFixed(2)} px off its circle`); assert.ok(c.x <= 1, `${mode}: ${c.day}'s circle is ${c.x.toFixed(2)} px off the rail`) }
    // The rail at full strength beside every day, fading only below the last.
    const rail = () => sheet.evaluate(root => {
      const list = root.querySelector('.updates-days'), solid = parseFloat(getComputedStyle(list).getPropertyValue('--rail-solid')), top = list.getBoundingClientRect().top
      const days = [...list.querySelectorAll(':scope > .update-day')].map(d => d.getBoundingClientRect().bottom - top)
      return { solid, lastDay: Math.round(days.at(-1)), height: list.getBoundingClientRect().height }
    })
    // Days open and close in .2 s and the rail is re-measured as they move: compare once still.
    const settled = async () => { let r; for (let i = 0; i < 30; i++) { r = await rail(); if (Math.abs(r.solid - r.lastDay) <= 1) break; await page.waitForTimeout(100) } return r }
    let r = await settled()
    assert.ok(Math.abs(r.solid - r.lastDay) <= 1, `${mode}: the rail is solid to the last day's foot (${r.solid} vs ${r.lastDay})`)
    // Changes: plain text, each with exactly one GitHub mark linking its commit in a new tab.
    const changes = await sheet.locator('.update-changes > li').evaluateAll(lis => lis.map(li => ({
      wrapped: !!li.querySelector('.update-change-title')?.closest('a'), links: [...li.querySelectorAll('a')].map(a => [a.className.includes('github-link'), a.getAttribute('aria-label'), a.target, a.rel, /\/commit\/|\/pull\//.test(a.href)]),
    })))
    for (const c of changes) {
      assert.equal(c.wrapped, false, `${mode}: a change's text is not a link`)
      assert.equal(c.links.length, 1, `${mode}: one link per change`)
      assert.deepEqual(c.links[0], [true, 'View this change on GitHub', '_blank', 'noopener noreferrer', true])
    }
    if (!changes.length) console.log(`${mode}: the open release lists no changes, so the change rows were not checked`)
    // The release's own mark stands on its header row (centred on the version's line within 2 px),
    // its right edge on the changes' column, never alone under the list.
    const mark = await first.evaluate(li => {
      const box = el => el?.getBoundingClientRect(), m = box(li.querySelector(':scope > .update-full')), v = box(li.querySelector('.update-version')), c = box(li.querySelector('.update-change-link'))
      return { dy: Math.abs((m.top + m.bottom) / 2 - (v.top + v.bottom) / 2), dx: c ? Math.abs(m.right - c.right) : 0, inNotes: !!li.querySelector('.update-notes .update-full') }
    })
    assert.ok(mark.dy <= 2 && mark.dx <= 1 && !mark.inNotes, `${mode}: the release's GitHub mark is on its header row, in the changes' column (${JSON.stringify(mark)})`)
    // Show more: the last entry; the older file is not fetched before it is pressed; pressing it
    // reveals older days down to the very first release, and the rail stays solid to the last day.
    assert.equal(olderRequests, 0, `${mode}: nothing older is fetched before Show more`)
    const more = sheet.locator('.updates-more-button')
    assert.ok(await sheet.locator('.updates-days > li').last().locator('.updates-more-button').count() === 1, `${mode}: Show more is the last entry`)
    const before = await sheet.locator('.update-day').count()
    for (let i = 0; i < 40 && await more.count(); i++) { await more.click(); await page.waitForTimeout(150) }
    assert.equal(olderRequests, 1, `${mode}: the older file is fetched once`)
    assert.ok(await sheet.locator('.update-day').count() > before, `${mode}: Show more reveals older days`)
    await sheet.locator('.updates-end').waitFor({ state: 'visible', timeout: 10000 })
    const lastDay = sheet.locator('.update-day').last(), lastToggle = lastDay.locator('.update-day-toggle')
    await lastToggle.click()
    assert.equal(await lastDay.locator('.update-release').last().getAttribute('data-version'), oldest, `${mode}: the list reaches the first release`)
    r = await settled()
    assert.ok(Math.abs(r.solid - r.lastDay) <= 1, `${mode}: after Show more the rail is solid to the new last day`)
    for (const c of await centred()) assert.ok(c.off <= 1, `${mode}: after Show more, ${c.day} is ${c.off.toFixed(2)} px off its circle`)
    assert.equal(loads, 1, 'still the first load')

    // Closed, the banner is back; dismissed, it goes.
    await about.locator('.lobby-sheet-close').click()
    await about.waitFor({ state: 'hidden' })
    await banner.waitFor({ state: 'visible' })
    await banner.getByRole('button', { name: 'Dismiss for now' }).click()
    assert.ok(await banner.isHidden())
    assert.deepEqual(errors, [])
    await context.close()
    console.log(mode, 'lobby ok')
  } finally { await browser.close() }
}

// In play: the guide shows the same Updates, and the notice is a sidebar chip, not a banner.
{
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.route('**/v/versions.json', live)
    const page = await context.newPage()
    await page.goto(`${process.env.MIRA_URL}?autoplay=1&room=updates-play-${Date.now()}`)
    await page.waitForFunction(() => window.mira?.game.tick > 30, null, { timeout: 120000 })
    await page.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape')
    const chip = page.locator('.rail-update')
    await chip.waitFor({ state: 'visible', timeout: 20000 })
    assert.ok(await page.locator('.update-banner').isHidden(), 'no banner over the world')
    // The chip is a house glass button, not an outlined pill.
    assert.deepEqual(await chip.evaluate(el => [el.classList.contains('liquid-glass'), getComputedStyle(el).borderTopWidth]), [true, '0px'], 'the in-play chip is a house button')
    await chip.click()
    const guide = page.locator('.in-play-about')
    // A fresh page fetches the feed here, which the dev server builds from git (see the lobby above).
    await guide.locator('.update-day').first().locator('.update-release').first().waitFor({ state: 'visible', timeout: 60000 })
    assert.equal(await guide.getAttribute('aria-label'), 'Updates', 'the guide opens on Updates, named for it')
    assert.equal(await guide.getByRole('tab').count(), 0, 'no tabs')
    await page.keyboard.press('Escape')
    await guide.waitFor({ state: 'hidden' })
    console.log('in play ok')

    // A pinned page never prompts, and Updates says it is pinned and links to the latest.
    const pinned = await context.newPage()
    await pinned.goto(`${process.env.MIRA_URL}?v=${RUNNING}&room=updates-pinned-${Date.now()}`)
    await pinned.waitForFunction(() => window.mira?.shell, null, { timeout: 120000 })
    await pinned.waitForTimeout(6000)
    assert.ok(await pinned.locator('.update-banner').isHidden(), 'no banner on a pinned page')
    await pinned.evaluate(() => mira.shell.showUpdates())
    const note = pinned.locator('.lobby-sheet-updates .updates-pinned')
    await note.waitFor({ timeout: 15000 })
    assert.match(await note.innerText(), new RegExp(`pinned version v${RUNNING.replaceAll('.', '\\.')}`))
    assert.equal(await note.locator('a').getAttribute('href'), '/')
    console.log('pinned ok')

    // The dev server's rebuild notice: in the lobby the banner replaces its pill.
    const dev = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await dev.goto(`${process.env.MIRA_URL}?room=updates-dev-${Date.now()}`)
    await dev.waitForFunction(() => window.mira?.shell, null, { timeout: 120000 })
    await dev.locator('.boot-veil').waitFor({ state: 'hidden', timeout: 120000 })
    await dev.evaluate(() => window.dispatchEvent(new CustomEvent('mira:new-build')))
    await dev.locator('.update-banner').waitFor({ state: 'visible' })
    assert.equal(await dev.locator('.update-banner strong').innerText(), 'New build available')
    assert.ok(await dev.locator('#mira-build-notice').isHidden(), 'the old pill does not show in the lobby')
    console.log('dev rebuild ok')
  } finally { await browser.close() }
}
