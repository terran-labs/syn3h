/** Sample the landed rail and cards, including the second phase of a phone card closing. */
export async function waitForPanelMotion(page) {
  await page.locator('.syn3h-shell > .world-inspector').evaluate(async rail => {
    const frame = () => new Promise(requestAnimationFrame)
    for (;;) {
      await frame()
      const moving = rail.getAnimations({ subtree: true }).filter(a =>
        (a.pending || a.playState === 'running') && Number.isFinite(a.effect?.getComputedTiming().endTime))
      if (!moving.length) return
      await Promise.allSettled(moving.map(a => a.finished))
    }
  })
}
