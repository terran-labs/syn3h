/**
 * Keyboard shortcuts drawn as keycaps: each key a tiny label inside a thin rounded outline
 * (keycap.css), wide keys the same cap made wider, never an icon. The owner, 25 November 2026:
 * "put keyboard shortcuts such as 1, 2, 3, space, etc., as tiny text inside of a rounded outer
 * rectangle to indicate they are keyboard shortcuts ... Do this throughout our interface."
 *
 * One element, <kbd class="keycap">, made only here. A shortcut is written as plain words
 * ("L or click", "W / S", "WASD or arrows", "1 to 5") and rendered by `shortcut()`: each key
 * becomes a cap and the joins between them, and the mouse and gamepad words, stay plain text
 * outside the caps. A cap's text is the key's own name, so a screen reader reads it once.
 */

import './keycap.css'

/** Keys with a name, as the interface writes them. Any other key is a single character. */
const NAMED = new Set(['Space', 'Shift', 'Esc', 'Enter', 'Tab', 'Ctrl', 'Alt', 'Backspace', 'Delete'])

/** One key as a cap. */
export function keycap(key: string): HTMLElement {
  const cap = document.createElement('kbd')
  cap.className = 'keycap'
  cap.textContent = key
  return cap
}

/** The same cap as markup, for pages built from strings (welcome.ts). */
export function keycapHtml(key: string): string {
  return `<kbd class="keycap">${escape(key)}</kbd>`
}

/**
 * True when a word of a shortcut is a key (a cap): a named key, or one character that is not a
 * join ("/") or a lower-case letter. Joins ("or", "to"), mouse words ("click", "wheel") and
 * gamepad buttons stay text.
 */
export function isKey(word: string): boolean {
  return NAMED.has(word) || (word.length === 1 && word !== '/' && !/[a-z\s]/.test(word))
}

/** The parts of a shortcut: keys to draw as caps, and plain words between them. */
export function shortcutParts(text: string): Array<{ key?: string; text?: string }> {
  const parts: Array<{ key?: string; text?: string }> = []
  text.split(' ').forEach((word, i) => {
    if (i) parts.push({ text: ' ' })
    // WASD is four keys, drawn as four caps side by side.
    if (word === 'WASD') { for (const letter of word) parts.push({ key: letter }); return }
    parts.push(isKey(word) ? { key: word } : { text: word })
  })
  // Neighbouring plain text joined: one text node per run.
  return parts.reduce<typeof parts>((out, part) => {
    const last = out[out.length - 1]
    if (part.text !== undefined && last?.text !== undefined) last.text += part.text
    else out.push({ ...part })
    return out
  }, [])
}

/** A shortcut as nodes: caps for its keys, plain text for the rest. */
export function shortcut(text: string): Node[] {
  return shortcutParts(text).map((part) => part.key !== undefined ? keycap(part.key) : document.createTextNode(part.text!))
}

/** The same as markup. */
export function shortcutHtml(text: string): string {
  return shortcutParts(text).map((part) => part.key !== undefined ? keycapHtml(part.key) : escape(part.text!)).join('')
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
