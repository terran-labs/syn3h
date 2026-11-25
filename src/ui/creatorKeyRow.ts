/**
 * The "Creator key" row: the second way to sign in as the creator, for a device where the
 * private link cannot reach the page (an iPhone Home Screen app keeps its own storage, apart
 * from Safari's) or where pasting is easier. Shown at the bottom of the lobby's Settings and of
 * the Me card in play, collapsed by default.
 *
 * Without a key stored: a password field (never autofilled, autocapitalised, spellchecked or
 * echoed back) and Sign in. With one: only "Sign out of creator on this device". The stored key
 * is never shown. The only feedback is whether something shaped like a key was saved; whether it
 * is the right key the room decides at the next join, and says nothing about a wrong one.
 */
import { CREATOR_KEY_EVENT, creatorKey, forgetCreatorKey, storeCreatorKey } from '../core/creatorKey'

const SAVED = 'Saved on this device; the mark appears when you join a world.'
const SIGNED_OUT = 'Signed out on this device; the mark leaves your name when you next join a world.'
const NOT_A_KEY = 'That is not shaped like a creator key.'

/**
 * A Creator key row. Every row on the page redraws when the key is stored or forgotten.
 * `folded`: the field sits in its own collapsed "Creator key" fold (the Me card); without it the
 * row relies on a collapsed card around it (the lobby's Settings).
 */
export function creatorKeyRow(signal: AbortSignal, { folded = true } = {}): HTMLElement {
  const row = document.createElement('div'); row.className = 'creator-key-row wi-actions'
  let note = ''
  const render = () => {
    const status = document.createElement('p'); status.className = 'creator-key-note'; status.setAttribute('role', 'status'); status.textContent = note
    if (creatorKey()) {
      const out = document.createElement('button'); out.type = 'button'; out.className = 'creator-key-button'
      out.textContent = 'Sign out of creator on this device'
      out.addEventListener('click', () => { note = SIGNED_OUT; forgetCreatorKey() }, { signal })
      row.replaceChildren(out, status)
      return
    }
    const fold = document.createElement('details'); fold.className = 'creator-key-fold'
    const summary = document.createElement('summary'); summary.textContent = 'Creator key'
    const form = document.createElement('form'); form.className = 'creator-key-form wi-actions'
    const input = document.createElement('input')
    input.type = 'password'; input.name = 'creator-key'; input.className = 'creator-key-input'
    input.autocomplete = 'off'; input.spellcheck = false
    input.setAttribute('autocapitalize', 'off'); input.setAttribute('autocorrect', 'off')
    // Password managers would offer to save it, and some ignore autocomplete=off for passwords.
    input.setAttribute('data-1p-ignore', ''); input.setAttribute('data-lpignore', 'true')
    input.setAttribute('aria-label', 'Creator key')
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'creator-key-button'; submit.textContent = 'Sign in'
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
