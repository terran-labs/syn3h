/**
 * Waits in the page for the state a check's next assertion needs, and fails naming that state
 * if it never comes. Never swallow the timeout: a check that carries on after a silent wait
 * measures the wrong moment and blames the wrong thing (galaxy.mjs at load 41 reported a moon
 * off screen when the lobby had simply not settled). Limits are generous for a loaded machine.
 *
 *   await waitForState(page, 'the settled lobby', () => !mira.shell.galaxy.opening, undefined, 60)
 */
export async function waitForState(page, what, condition, arg, seconds) {
  try {
    return await page.waitForFunction(condition, arg, { timeout: seconds * 1000 })
  } catch (error) {
    throw new Error(`gave up after ${seconds} s waiting for ${what}`, { cause: error })
  }
}

/**
 * The settled lobby a player meets after the opening: the veil gone, the opening (about nine
 * seconds, src/ui/galaxy/opening.ts) skipped with a key as a player may, and the current world's
 * label shown and ready for a tap or Enter, with no flight under way. During the opening the
 * labels are hidden and a key only skips it, so a check that taps a label before this taps nothing.
 */
export async function settledLobby(page, seconds = 120) {
  await waitForState(page, 'the loading veil to lift', () => document.documentElement.dataset.boot === 'done' && window.mira?.shell?.galaxy, undefined, seconds)
  await page.keyboard.press('Shift')
  await waitForState(page, 'the settled lobby (opening over, the current world labelled)', () => {
    const label = document.querySelector('.galaxy-label.is-current')
    const g = window.mira.shell.galaxy
    // Not mid-flight either (the exit from a world, or the eased return home): a tap or Enter
    // during a flight is ignored by design.
    return !g.opening && !document.documentElement.dataset.opening && !window.mira.shell.dropping && !g.flight && !g.returningHome && label && !label.hidden && label.getBoundingClientRect().width > 0
  }, undefined, 60)
}
