/**
 * The one "back to default" control (the owner, 25 November 2026: "ensure that any property
 * in any card has an easy way to reset it to defaults ... I don't even know what its default
 * is or how I am supposed to reset it").
 *
 * One glyph, the counter-clockwise arrow the World card's Reset already draws, in the row's
 * ink and with no shadow. Every reset in the panels uses it: a setting row, a group of rows,
 * a whole card, and a bot's personality traits. Two shapes:
 *
 *  - `resetButton`: one value. It always holds its place, so nothing moves when a value
 *    changes; at the default it is invisible and inert. Its tooltip and accessible name give
 *    the default ("Reset to 0.42", "Reset Sky reflection to 0.42"), and on touch, where nothing
 *    hovers, the default is written under the arrow.
 *  - `resetAllButton`: several values. It says how many differ, is disabled at none, and asks
 *    once in place before acting, never in a browser dialog.
 *
 * Styled by reset-control.css. Nothing here knows any setting.
 */
import './reset-control.css'

/** The arrow, a 16 px stroked path. */
export const RESET_PATH = 'M3 8a5 5 0 1 0 1.5-3.6M3 2.5V5h2.5'
export const RESET_GLYPH = `<svg class="reset-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${RESET_PATH}"/></svg>`

export interface ResetButton {
  readonly element: HTMLButtonElement
  /**
   * Show the control for a value: `changed` makes it live; `defaultText` is the default as
   * the row writes values ("0.42", "60%", "on"). `name` is the setting, for the accessible name.
   */
  set(state: { changed: boolean; defaultText: string; name: string }): void
  readonly changed: boolean
}

/** One value's reset. `run` restores the default; it is called only while the value differs. */
export function resetButton(run: () => void, className = ''): ResetButton {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = `reset-control${className ? ' ' + className : ''}`
  element.innerHTML = `${RESET_GLYPH}<span class="reset-default" aria-hidden="true"></span>`
  const text = element.querySelector<HTMLElement>('.reset-default')!
  let changed = false, last = ''
  element.addEventListener('click', event => {
    // A reset is not a press on the row: no row toggles, no tooltip opens.
    event.stopPropagation()
    if (changed && !element.disabled) run()
  })
  const control: ResetButton = {
    element,
    get changed() { return changed },
    set({ changed: now, defaultText, name }) {
      const key = `${now}|${defaultText}|${name}`
      if (key === last) return
      last = key; changed = now
      element.classList.toggle('is-live', now)
      // Inert at the default: still there (its place is held) but not focusable, hit or read.
      element.inert = !now
      element.tabIndex = now ? 0 : -1
      element.dataset.tip = `Reset to ${defaultText}`
      element.setAttribute('aria-label', `Reset ${name} to ${defaultText}`)
      text.textContent = defaultText
    },
  }
  return control
}

export interface ResetAllButton {
  readonly element: HTMLButtonElement
  /** How many values differ now. */
  count(n: number): void
  /** Forget a half-made confirmation (the card closed, a rebuild). */
  disarm(): void
}

/** How long a "Confirm" waits for the second press, ms. Matches the World card's Reset. */
export const CONFIRM_MS = 4000

/**
 * A reset of several values. `label(n)` words the button ("Reset 3 changes", "Reset all 5");
 * a press arms it (`confirm(n)`, "Confirm: reset 3") and a second press within four seconds
 * runs `run`. `tip` says what it does not touch, so "all" is never read as everything.
 */
export function resetAllButton(options: { label(n: number): string; confirm(n: number): string; run(): void; tip: string; className?: string }): ResetAllButton {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = `panel-action reset-all${options.className ? ' ' + options.className : ''}`
  element.innerHTML = `${RESET_GLYPH}<span></span>`
  element.dataset.tip = options.tip
  const words = element.querySelector('span')!
  let n = 0, armed: ReturnType<typeof setTimeout> | undefined
  const render = () => {
    words.textContent = !n ? 'No changes' : armed ? options.confirm(n) : options.label(n)
    element.setAttribute('aria-label', words.textContent)
    element.disabled = n === 0
    element.classList.toggle('is-warning', !!armed)
  }
  const disarm = () => { if (armed) { clearTimeout(armed); armed = undefined; render() } }
  element.addEventListener('click', event => {
    event.stopPropagation()
    if (!n) return
    if (!armed) { armed = setTimeout(() => { armed = undefined; render() }, CONFIRM_MS); render(); return }
    clearTimeout(armed); armed = undefined
    options.run(); render()
  })
  element.addEventListener('blur', () => disarm())
  render()
  return {
    element,
    count(next) { if (next === n) return; n = next; if (!n) disarm(); render() },
    disarm,
  }
}
