/**
 * The Hidden interface (hud.mode 2): nothing on screen but the world. The Driving view
 * (hud.mode 1) needs nothing here: Shell treats it exactly as a captured cursor, through the
 * same decision, so the two cannot drift apart. This module only owns the key, the cycle and
 * the photo-mode veil with its one-line hint.
 */
import { interfaceMode } from './inspector/params'
import { params } from '../../shared/params'
import './interface-mode.css'

/** The key that cycles Full, Driving and Hidden. Free in Input.ts and every Shell shortcut. */
export const INTERFACE_KEY = 'KeyI'
export const HIDDEN_HINT_MS = 2000

/** Full, Driving, Hidden, Full. */
export function nextInterfaceMode(value: number): number { return (Math.round(value) + 1) % 3 }

/** Set the mode through the registry, so the Me panel's control and Shell both follow. */
export function setInterfaceMode(value: number): void {
  if (interfaceMode.value !== value) params.set(interfaceMode.def.id, value, 'local')
}

/**
 * Applies the Hidden mode to the page: the class that hides every overlay, and the hint shown
 * once on entry. `playing` is whether the driving view is on screen; the lobby, menus and
 * pause are never hidden, so a player can always find their way back.
 */
export class InterfaceVeil {
  private readonly hint = document.createElement('div')
  private timer: ReturnType<typeof setTimeout> | undefined
  private bare = false

  constructor(parent: HTMLElement = document.body) {
    this.hint.className = 'interface-hint'
    this.hint.setAttribute('role', 'status')
    this.hint.textContent = 'Interface hidden · press I to bring it back'
    this.hint.hidden = true
    parent.append(this.hint)
  }

  update(playing: boolean): void {
    const bare = playing && Math.round(interfaceMode.value) === 2
    if (bare === this.bare) return
    this.bare = bare
    document.body.classList.toggle('is-bare-interface', bare)
    clearTimeout(this.timer)
    this.hint.hidden = !bare
    if (bare) this.timer = setTimeout(() => { this.hint.hidden = true }, HIDDEN_HINT_MS)
  }

  dispose(): void { clearTimeout(this.timer); document.body.classList.remove('is-bare-interface'); this.hint.remove() }
}
