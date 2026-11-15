/**
 * Small DOM builders for the vehicle lab's sidebar: collapsible sections that remember whether
 * they are open, and real form controls (switches, segmented choices, sliders with a readout,
 * colour inputs) with labels tied to their inputs. Styles are in vehicle-lab.html.
 */

let serial = 0
const uid = (prefix: string) => `${prefix}-${++serial}`

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

export function button(label: string, onClick: () => void, className = 'btn'): HTMLButtonElement {
  const b = el('button', className, label)
  b.type = 'button'
  b.onclick = onClick
  return b
}

const OPEN_KEY = 'vehicleLab.open'
/** Open or closed state per section id, kept for the next visit. */
const remembered: Record<string, boolean> = (() => {
  try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean> } catch { return {} }
})()

/**
 * A collapsible section (`<details>`). `id` keys its remembered state; `open` is the default
 * the first time. Returns the section and the body to fill.
 */
export function section(id: string, title: string, open = true, className = 'sec'): { root: HTMLDetailsElement; body: HTMLDivElement; summary: HTMLElement } {
  const root = el('details', className)
  root.dataset.id = id
  root.open = remembered[id] ?? open
  const summary = el('summary', '', title)
  const body = el('div', 'sec-body')
  root.append(summary, body)
  root.addEventListener('toggle', () => {
    remembered[id] = root.open
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(remembered)) } catch { /* private mode: forget */ }
  })
  return { root, body, summary }
}

/** An on/off switch: a checkbox with the switch role, its label beside it. */
export function toggle(label: string, value: boolean, onChange: (value: boolean) => void) {
  const row = el('label', 'row toggle')
  const text = el('span', 'label', label)
  const input = el('input')
  input.type = 'checkbox'
  input.setAttribute('role', 'switch')
  input.checked = value
  input.onchange = () => onChange(input.checked)
  row.append(text, input)
  return { root: row, input, set(v: boolean) { input.checked = v } }
}

/** One of a few choices, as a row of segments (radio inputs, so arrow keys move between them). */
export function segmented(label: string, options: readonly string[], index: number, onChange: (index: number) => void) {
  const root = el('fieldset', 'row seg')
  const legend = el('legend', 'label', label)
  const track = el('div', 'seg-track')
  const name = uid('seg')
  const inputs = options.map((option, i) => {
    const id = uid('opt')
    const input = el('input')
    input.type = 'radio'; input.name = name; input.id = id; input.checked = i === index
    input.onchange = () => { if (input.checked) onChange(i) }
    const l = el('label', '', option)
    l.htmlFor = id
    track.append(input, l)
    return input
  })
  root.append(legend, track)
  return { root, set(i: number) { inputs.forEach((x, k) => { x.checked = k === i }) } }
}

/** A choice from a longer list, as a select. */
export function choice(label: string, options: readonly string[], index: number, onChange: (index: number) => void) {
  const row = el('label', 'row select')
  const select = el('select')
  options.forEach((o, i) => { const opt = el('option', '', o); opt.value = String(i); select.append(opt) })
  select.value = String(index)
  select.onchange = () => onChange(Number(select.value))
  row.append(el('span', 'label', label), select)
  return { root: row, set(i: number) { select.value = String(i) } }
}

/** Segments for a few short options, a select otherwise. */
export function pick(label: string, options: readonly string[], index: number, onChange: (index: number) => void) {
  const short = options.length <= 4 && options.join('').length <= 26
  return short ? segmented(label, options, index, onChange) : choice(label, options, index, onChange)
}

/** Decimal places that show a slider's step exactly. */
export const decimals = (step: number) => step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9))

/**
 * A slider with a numeric readout and an optional reset button. Bounds may arrive reversed
 * (some original Mars Explorer ranges run high to low), so they are ordered first.
 */
export function slider(label: string, o: { min: number; max: number; step: number; value: number; reset?: () => void }, onChange: (value: number) => void) {
  const root = el('div', 'row slider')
  const id = uid('rng')
  const text = el('label', 'label', label)
  text.htmlFor = id
  const input = el('input')
  input.type = 'range'; input.id = id
  input.min = String(Math.min(o.min, o.max)); input.max = String(Math.max(o.min, o.max)); input.step = String(o.step || 'any')
  const out = el('output')
  out.htmlFor.add(id)
  const places = decimals(o.step || .01)
  const show = (v: number) => { input.value = String(v); out.textContent = v.toFixed(places) }
  show(o.value)
  input.oninput = () => { const v = Number(input.value); out.textContent = v.toFixed(places); onChange(v) }
  const head = el('div', 'slider-head')
  head.append(text, out)
  if (o.reset) head.append(resetButton(label, o.reset))
  root.append(head, input)
  return { root, set: show }
}

export function resetButton(label: string, onClick: () => void): HTMLButtonElement {
  const b = button('↺', onClick, 'reset')
  b.title = `Reset ${label} to its default`
  b.setAttribute('aria-label', `Reset ${label}`)
  return b
}

/** A colour input with its label. */
export function colour(label: string, value: string, onChange: (hex: string) => void) {
  const row = el('label', 'row colour')
  const input = el('input')
  input.type = 'color'
  input.value = value
  input.oninput = () => onChange(input.value)
  row.append(el('span', 'label', label), input)
  return { root: row, set(hex: string) { input.value = hex } }
}
