// Shared by sidebar.mjs and lobby-settings.mjs: open the cards of a stack one after another and
// check, after each, that the card just opened is open and in view and that no open card is
// squeezed below a comfortable height (200 px, or all its content when shorter).
import assert from 'node:assert/strict'

const COMFORT = 200

/** Measure every open card: its height, and the height it would take with all its content. */
export const openCards = (panel) => panel.evaluate((p) => [...p.querySelectorAll('.wi-cards > .wi-card.is-open')].map((card) => {
  const body = card.querySelector(':scope > .wi-body'), height = card.getBoundingClientRect().height
  return { id: card.dataset.section, height, natural: height - body.clientHeight + body.scrollHeight }
}))

/**
 * Open each card in `ids` in turn (closing any that are open first), waiting for the motion to
 * settle, and assert the stack's invariants. Screenshots each step as `${prefix}-<n>-<id>.png`.
 */
export async function openInTurn(page, panel, ids, { tap = false, prefix, label }) {
  await panel.evaluate((p) => { for (const card of p.querySelectorAll('.wi-cards > .wi-card.is-open')) card.querySelector('.wi-head').click() })
  await settled(page, panel)
  const history = []
  for (const [n, id] of ids.entries()) {
    const head = panel.locator(`.wi-cards > .wi-card[data-section="${id}"] > .wi-head`)
    if (!(await head.count())) continue
    await head.scrollIntoViewIfNeeded()
    // A card still open from earlier is closed first, so opening it makes it the newest.
    if (await head.evaluate((h) => h.parentElement.classList.contains('is-open'))) { await (tap ? head.tap() : head.click()); await settled(page, panel); await head.scrollIntoViewIfNeeded() }
    await (tap ? head.tap() : head.click())
    await settled(page, panel)
    const open = await openCards(panel)
    history.push(open.map((c) => c.id))
    assert.ok(open.some((c) => c.id === id), `${label}: ${id} stays open after opening it (${JSON.stringify(open)})`)
    for (const c of open) assert.ok(c.height >= Math.min(c.natural, COMFORT) - 1.5, `${label}: ${c.id} squeezed to ${c.height}px after opening ${id} (${JSON.stringify(open)})`)
    const inView = await panel.evaluate((p, id) => {
      const stack = p.querySelector('.wi-cards').getBoundingClientRect(), r = p.querySelector(`.wi-cards > .wi-card[data-section="${id}"] > .wi-head`).getBoundingClientRect()
      return r.top >= stack.top - 1 && r.bottom <= stack.bottom + 1
    }, id)
    assert.ok(inView, `${label}: ${id}'s header is in view after opening it`)
    if (prefix) await page.screenshot({ path: `${prefix}-${n + 1}-${id}.png` })
  }
  return history
}

export async function settled(page, panel) {
  await panel.evaluate((p) => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.waitForFunction((p) => !p.getAnimations({ subtree: true }).some((a) => a.playState === 'running' && a.effect?.target?.classList?.contains('wi-card')), await panel.elementHandle())
  await page.waitForTimeout(150)
}
