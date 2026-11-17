/**
 * Waits in the page for the state a check's next assertion needs, and fails naming that state
 * if it never comes. Never swallow the timeout: a check that carries on after a silent wait
 * measures the wrong moment and blames the wrong thing (galaxy.mjs at load 41 reported a moon
 * off screen when the lobby had simply not settled). Limits are generous for a loaded machine.
 *
 *   await waitForState(page, 'the settled lobby', () => !syn3h.shell.galaxy.opening, undefined, 60)
 */
export async function waitForState(page, what, condition, arg, seconds) {
  try {
    return await page.waitForFunction(condition, arg, { timeout: seconds * 1000 })
  } catch (error) {
    throw new Error(`gave up after ${seconds} s waiting for ${what}`, { cause: error })
  }
}
