/**
 * The ?blank=1 counter (core/flashSwitches.ts): the blank-frame recorder's counts on screen, so
 * the owner can watch them on his phone without pasting a report, and a Test flash control.
 *
 * Test flash clears exactly one drawn frame, as the browser check does (BlankFrameRecorder
 * clearNextFrame). If the counter's "test seen" does not rise when he taps it, the probe cannot
 * see a cleared frame on his Safari and every zero it reports is worthless; if it rises, zeros can
 * be trusted. Test flashes are counted apart from real ones.
 *
 * Plain DOM on purpose: no glass, no backdrop-filter, no transition (those are suspects). Shown
 * only in play, and never over the open panels: on a phone the box (above them, taking taps) sat
 * over the World, Performance and Chat headers, so Field switches and Copy diagnostics could not
 * be reached (v26.11.2308). It hides the moment the panels open over it, as their `inert` flips,
 * before the next tap can land, and returns when they close. On a wide screen the rail stands
 * to the right, clear of the box, and the box stays. Otherwise it
 * stands centred a third of the way down: clear of the gear list on the left, the speed and
 * altitude on either side and the thumb controls below (checked at 390 by 844 both ways up).
 * Read four times a second from the counters; nothing is read from the page per frame.
 */
import type { BlankFrameRecorder } from '../core/blankFrames'
import type { FrameCanary } from '../core/frameCanary'
import type { FrameProbe } from '../core/frameProbe'

/**
 * `canary`, with ?frameCanary=1: command buffers the browser dropped, which the blank-frame probe
 * cannot see on Safari, in the same box. The Test flash control shows only with the recorder.
 * `probe`, with ?frameProbe=1: frames our own passes drew black or not a number (frameProbe.ts).
 * Each counter has its own test control, so a zero can be trusted on the phone itself: Test drop
 * withholds one command buffer (the canary must count 1), Test black clears one frame (the probe
 * must count it).
 */
export function startFlashCounter(recorder: () => BlankFrameRecorder | null, inPlay: () => boolean, canary: () => FrameCanary | null = () => null, withRecorder = true, probe: () => FrameProbe | null = () => null, panels: () => Element | null = () => null): () => void {
  const box = document.createElement('div')
  box.className = 'flash-counter'
  box.style.cssText = [
    'position:fixed', 'z-index:9000', 'top:32vh', 'left:50%', 'transform:translateX(-50%)',
    'padding:4px 8px', 'background:rgb(0 0 0 / .72)', 'color:#fff', 'border-radius:6px',
    // Every line is at most 22 characters, so the box fits whole in the gap between the speed and
    // altitude readouts on a 320 px phone; a line can still wrap at a space, never off the edge.
    // 13 px from 390 px wide, 12 px (still bold, plain to read) on a 320 px phone.
    'font:600 clamp(12px, 3.4vw, 13px)/1.2 ui-monospace,Menlo,monospace', 'pointer-events:auto', 'width:max-content', 'max-width:min(calc(100vw - 40px), 360px)',
    'white-space:pre-wrap', 'overflow-wrap:anywhere',
  ].join(';')
  const text = document.createElement('div')
  text.setAttribute('role', 'status')
  // The test controls in one row, no wider than the 22-character text so the box fits between the
  // readouts on a 320 px phone: Flash, Drop, Black, each named in full for assistive technology.
  const button = (label: string, name: string, act: () => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    b.setAttribute('aria-label', name)
    b.style.cssText = 'margin:4px 4px 0 0;min-height:44px;padding:0 5px;border:1px solid #fff;border-radius:6px;background:#000;color:#fff;font:inherit;white-space:nowrap'
    // A tap must not also steer or fire: the touch controls listen on the document.
    for (const type of ['pointerdown', 'touchstart'] as const) b.addEventListener(type, event => event.stopPropagation())
    b.addEventListener('click', event => { event.stopPropagation(); act(); update() })
    return b
  }
  const tests = document.createElement('div')
  tests.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap'
  if (withRecorder) tests.append(button('Flash', 'Test flash', () => recorder()?.clearNextFrame(true)))
  if (canary()) tests.append(button('Drop', 'Test drop', () => canary()?.withholdNext(1)))
  if (probe()) tests.append(button('Black', 'Test black', () => probe()?.blackNext()))
  box.append(text, tests)
  box.hidden = true
  document.body.append(box)
  let shown = ''
  // Where the box stood when last shown: hidden, it has no box of its own to measure.
  let lastRect: DOMRect | null = null
  const overPanels = () => {
    const rail = panels()
    if (!box.hidden) lastRect = box.getBoundingClientRect()
    if (!rail || !lastRect) return false
    const a = lastRect, b = rail.getBoundingClientRect()
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  }
  const update = () => {
    const r = withRecorder ? recorder() : null, c = canary(), p = probe(), play = inPlay() && !overPanels()
    if (box.hidden === play) box.hidden = !play
    if ((!r && !c && !p) || !play) return
    const lines: string[] = []
    // Once a test flash has gone unseen, a zero would be a false all-clear.
    // At most 22 characters a line, as the canary's and the probe's (see place()).
    if (r) lines.push(`${r.testsAsked > 0 && r.testsSeen === 0 ? 'Recorder blind here:\nit cannot see frames' : `Blank ${r.blank}  partly ${r.partly}`}\nTest seen ${r.testsSeen} of ${r.testsAsked}`)
    if (c) lines.push(c.counterLines())
    if (p) lines.push(p.counterLines())
    const line = lines.join('\n')
    if (line !== shown) text.textContent = shown = line
    place()
  }
  // Just below whatever stands above the box's own column: the gear list, or on a narrow phone the
  // speed and altitude readouts only if the box is wider than the gap between them. Measured each
  // tick, so it follows rotation and the readouts coming and going.
  const place = () => {
    const b = box.getBoundingClientRect()
    let top = 8
    for (const el of document.querySelectorAll('.gear-selector, .fh-read')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || r.top > innerHeight / 2) continue
      if (r.left < b.right && r.right > b.left) top = Math.max(top, r.bottom + 6)
    }
    const px = `${Math.round(top)}px`
    if (box.style.top !== px) box.style.top = px
  }
  const timer = setInterval(update, 250)
  // The panels opening or closing flips `inert` on the rail at once: follow it now, not at the next tick.
  const railWatch = new MutationObserver(update)
  railWatch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['inert'] })
  update()
  return () => { clearInterval(timer); railWatch.disconnect(); box.remove() }
}
