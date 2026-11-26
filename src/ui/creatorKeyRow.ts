/**
 * The "Creator key" row: the creator's primary way to sign in, by pasting the key. A link
 * (core/creatorKey.ts) also works but stays in that browser's history and history sync, and an
 * iPhone Home Screen app keeps its own storage apart from Safari's, so no link reaches it. At the
 * bottom of the lobby's Settings and of the Me card in play, collapsed, and only for a device
 * holding a key or after the hidden gesture (creatorReveal.ts).
 *
 * Players read it as the "Dimensional portal" (PORTAL_TITLE): a password field ("Enter your
 * key"; never autofilled, autocapitalised, spellchecked or echoed back) and Open; with a key
 * stored, only "Close the portal on this device". The stored key is never shown, and the only
 * messages are neutral: whether something shaped like a key was saved. Whether it is the right
 * key only the room knows, at the next join, and it says nothing about a wrong one. The mark's
 * own label stays "Creator" (playerMarks.ts): that is what other players hear.
 */
import { CREATOR_KEY_EVENT, creatorKey, forgetCreatorKey, storeCreatorKey } from '../core/creatorKey'
import { creatorKeyRowVisible, revealCreatorKey } from './creatorReveal'

// Everything a player can read here calls it the "Dimensional portal" (the owner, 25 Nov 2026):
// no visible text says creator or key-for-what, and no message confirms anything about a key.
export const PORTAL_TITLE = 'Dimensional portal'
const SAVED = 'Saved on this device.'
const SIGNED_OUT = 'Closed on this device.'
const NOT_A_KEY = 'That does not look like a key.'

/**
 * A Creator key row. Every row on the page redraws when the key is stored or forgotten.
 * `folded`: the field sits in its own collapsed "Creator key" fold (the Me card); without it the
 * row relies on a collapsed card around it (the lobby's Settings).
 */
export function creatorKeyRow(signal: AbortSignal, { folded = true } = {}): HTMLElement {
  const row = document.createElement('div'); row.className = 'creator-key-row wi-actions'
  let note = ''
  const render = () => {
    // Nothing at all unless this device holds a key or the hidden gesture was made (creatorReveal.ts).
    if (!creatorKeyRowVisible()) { row.replaceChildren(); return }
    const status = document.createElement('p'); status.className = 'creator-key-note'; status.setAttribute('role', 'status'); status.textContent = note
    if (creatorKey()) {
      const out = document.createElement('button'); out.type = 'button'; out.className = 'creator-key-button'
      out.textContent = 'Close the portal on this device'
      // Revealed for the session, so the row stays to say it worked (and to sign in again).
      out.addEventListener('click', () => { note = SIGNED_OUT; revealCreatorKey(); forgetCreatorKey() }, { signal })
      row.replaceChildren(out, status)
      return
    }
    const fold = document.createElement('details'); fold.className = 'creator-key-fold'
    const summary = document.createElement('summary'); summary.textContent = PORTAL_TITLE
    const form = document.createElement('form'); form.className = 'creator-key-form wi-actions'
    const input = document.createElement('input')
    input.type = 'password'; input.name = 'portal'; input.className = 'creator-key-input'
    input.autocomplete = 'off'; input.spellcheck = false
    input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocorrect', 'off')
    // Password managers would offer to save it, and some ignore autocomplete=off for passwords.
    input.setAttribute('data-1p-ignore', ''); input.setAttribute('data-lpignore', 'true')
    input.setAttribute('aria-label', PORTAL_TITLE); input.placeholder = 'Enter your key'
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'creator-key-button'; submit.textContent = 'Open'
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      // Set first: a stored key redraws every row (CREATOR_KEY_EVENT), this one with the note.
      note = SAVED
      const ok = storeCreatorKey(input.value)
      // The field is emptied either way: the key is never left on screen or in the DOM.
      input.value = ''
      if (!ok) { note = NOT_A_KEY; status.textContent = note; if (folded) fold.open = true }
    }, { signal })
    form.append(input, submit)
    if (!folded) { row.replaceChildren(form, status); return }
    fold.append(summary, form)
    if (note === NOT_A_KEY) fold.open = true
    row.replaceChildren(fold, status)
  }
  window.addEventListener(CREATOR_KEY_EVENT, render, { signal })
  render()
  return row
}
