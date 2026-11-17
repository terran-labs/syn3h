/**
 * The one on/off switch used everywhere a setting is on or off: in the sidebar's rows, the
 * Performance card's Auto quality, the lobby's settings panel, the host's lock and the rail.
 *
 * A native checkbox with role="switch", drawn by `.s3-switch` in switch.css: knob left on a dim
 * track when off, knob right on a filled cyan track with a glow when on. Position and
 * brightness both change, so the state reads without colour. aria-checked is kept in step
 * with `checked` (role switch requires it), Space toggles natively and Enter is added here.
 *
 * Choices of one among several are not switches: they use the segmented control (.wi-seg).
 */
import './switch.css'

/** Keys that flip a switch. Space is the checkbox's own; Enter is added to match a button. */
export const SWITCH_KEYS: readonly string[] = [' ', 'Enter']
export const isSwitchKey = (key: string): boolean => SWITCH_KEYS.includes(key)
/** The word shown beside a switch. */
export const switchWord = (on: boolean): string => on ? 'on' : 'off'

/** The parts of a switch input this module touches; an HTMLInputElement satisfies it. */
export interface SwitchInput {
  type: string; checked: boolean; disabled: boolean; className: string
  setAttribute(name: string, value: string): void
  addEventListener(type: 'keydown' | 'change', listener: (event: { key?: string; preventDefault(): void; repeat?: boolean }) => void, options?: AddEventListenerOptions): void
  click(): void
}

/**
 * Make a checkbox a switch: role, class, aria-checked in step with checked, and Enter toggles.
 * Returns `set`, which updates the checked state and aria-checked together without firing change.
 */
export function bindSwitch<T extends SwitchInput>(input: T, options: { signal?: AbortSignal } = {}): (on: boolean) => void {
  input.type = 'checkbox'
  input.setAttribute('role', 'switch')
  if (!/\bs3-switch\b/.test(input.className)) input.className = `${input.className} s3-switch`.trim()
  const reflect = () => input.setAttribute('aria-checked', String(input.checked))
  input.addEventListener('change', reflect, { signal: options.signal })
  input.addEventListener('keydown', event => {
    // Space is handled by the checkbox itself; Enter becomes a click, which fires change.
    if (event.key === 'Enter' && !event.repeat && !input.disabled) { event.preventDefault(); input.click() }
  }, { signal: options.signal })
  reflect()
  return on => { if (input.checked !== on) input.checked = on; reflect() }
}

export interface Switch {
  /** The whole clickable control: label text, track and the on/off word. */
  readonly element: HTMLLabelElement
  readonly input: HTMLInputElement
  readonly checked: boolean
  /** Show a state without firing change. */
  set(on: boolean): void
  /**
   * Locked: the switch keeps showing its true state, dimmed, with a lock and a reason
   * ("host") so it never reads as simply off.
   */
  lock(locked: boolean, reason?: string): void
}

/**
 * A labelled switch: `<label class="s3-switch-field">Text [track] on</label>`. The whole label is
 * the target (44 px tall on touch); the word beside the track says on or off.
 */
export function createSwitch(text: string, options: { checked?: boolean; onChange?(on: boolean): void; word?: boolean; className?: string; signal?: AbortSignal } = {}): Switch {
  const element = document.createElement('label')
  element.className = `s3-switch-field${options.className ? ` ${options.className}` : ''}`
  const name = document.createElement('span'); name.className = 's3-switch-text'; name.textContent = text
  const input = document.createElement('input')
  const word = document.createElement('span'); word.className = 's3-switch-word'; word.setAttribute('aria-hidden', 'true')
  const lockNote = document.createElement('span'); lockNote.className = 's3-switch-lock'; lockNote.hidden = true
  const set = bindSwitch(input, { signal: options.signal })
  const show = () => { word.textContent = switchWord(input.checked); element.classList.toggle('is-checked', input.checked) }
  input.addEventListener('change', () => { show(); options.onChange?.(input.checked) }, { signal: options.signal })
  element.append(name, input)
  if (options.word !== false) element.append(word)
  element.append(lockNote)
  set(!!options.checked); show()
  return {
    element, input,
    get checked() { return input.checked },
    set(on) { set(on); show() },
    lock(locked, reason = 'host') {
      input.disabled = locked; element.classList.toggle('is-locked', locked)
      lockNote.hidden = !locked; lockNote.textContent = reason
      if (locked) input.setAttribute('aria-description', `locked by ${reason}`); else input.removeAttribute('aria-description')
    },
  }
}
