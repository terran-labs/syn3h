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
 * only in play, centred a third of the way down: clear of the gear list on the left, the speed and
 * altitude on either side and the thumb controls below (checked at 390 by 844 both ways up). Read four times a
 * second from the recorder's counters; nothing is read from the page per frame.
 */
import type { BlankFrameRecorder } from '../core/blankFrames'

export function startFlashCounter(recorder: () => BlankFrameRecorder | null, inPlay: () => boolean): () => void {
  const box = document.createElement('div')
  box.className = 'flash-counter'
  box.style.cssText = [
    'position:fixed', 'z-index:9000', 'top:max(calc(env(safe-area-inset-top) + 8px), 36vh)', 'left:50%', 'transform:translateX(-50%)',
    'padding:6px 8px', 'background:rgb(0 0 0 / .72)', 'color:#fff', 'border-radius:6px',
    'font:600 13px/1.35 ui-monospace,Menlo,monospace', 'pointer-events:auto', 'max-width:60vw',
  ].join(';')
  const text = document.createElement('div')
  text.setAttribute('role', 'status')
  const test = document.createElement('button')
  test.type = 'button'
  test.textContent = 'Test flash'
  test.style.cssText = 'margin-top:6px;min-height:44px;min-width:96px;padding:0 10px;border:1px solid #fff;border-radius:6px;background:#000;color:#fff;font:inherit'
  // A tap must not also steer or fire: the touch controls listen on the document.
  for (const type of ['pointerdown', 'touchstart'] as const) test.addEventListener(type, event => event.stopPropagation())
  test.addEventListener('click', event => { event.stopPropagation(); recorder()?.clearNextFrame(true); update() })
  box.append(text, test)
  box.hidden = true
  document.body.append(box)
  let shown = ''
  const update = () => {
    const r = recorder(), play = inPlay()
    if (box.hidden === play) box.hidden = !play
    if (!r || !play) return
    const line = `Blank ${r.blank}  Partly ${r.partly}  (${r.lastMinute()}/min)\nLast: ${r.lastWords || '-'}\nTest seen ${r.testsSeen} of ${r.testsAsked}`
    if (line !== shown) { text.textContent = shown = line; text.style.whiteSpace = 'pre' }
  }
  const timer = setInterval(update, 250)
  update()
  return () => { clearInterval(timer); box.remove() }
}
