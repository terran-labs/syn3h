/**
 * The thumb grid rule, run in the page (page.evaluate(thumbGrid)): every visible thumb button,
 * the shell's and the gear's, is one size, their centres lie on at most two rows, and the
 * columns are evenly spaced. Returns what is wrong, or an empty list. See src/ui/touch-stick.css.
 */
export function thumbGrid() {
  const buttons = [...document.querySelectorAll('.touch-controls:not([hidden]) .touch-actions button, .gear-actions:not([hidden]) button')]
    .filter((el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' })
  if (!buttons.length) return []
  const problems = []
  const rects = buttons.map((el) => ({ name: el.dataset.action ?? el.textContent, r: el.getBoundingClientRect() }))
  const w = rects[0].r.width, h = rects[0].r.height
  for (const { name, r } of rects) if (Math.abs(r.width - w) > 1 || Math.abs(r.height - h) > 1) problems.push(`${name} is ${Math.round(r.width)}x${Math.round(r.height)}, not ${Math.round(w)}x${Math.round(h)}`)
  const distinct = (values) => values.sort((a, b) => a - b).filter((v, i, all) => i === 0 || v - all[i - 1] > 1)
  const rows = distinct(rects.map(({ r }) => r.top + r.height / 2))
  if (rows.length > 2) problems.push(`centres on ${rows.length} rows: ${rows.map(Math.round).join(', ')}`)
  const columns = distinct(rects.map(({ r }) => r.left + r.width / 2))
  const steps = columns.slice(1).map((c, i) => c - columns[i])
  // A column may be empty (the hovercraft has no WINGS), so spacing is checked against the smallest step.
  const pitch = Math.min(...steps)
  for (const step of steps) { const k = Math.round(step / pitch); if (Math.abs(step - k * pitch) > 1.5) problems.push(`columns unevenly spaced: ${steps.map(Math.round).join(', ')}`) }
  for (const { name, r } of rects) if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) problems.push(`${name} off screen`)
  return [...new Set(problems)]
}
