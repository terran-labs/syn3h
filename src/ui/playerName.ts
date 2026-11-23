/**
 * The player's own name, kept in the browser (localStorage) so it survives reloads, new
 * sessions and version updates, and is used in every room.
 *
 * A first visit gets a generated name at once and keeps it: it is saved the moment it is made.
 * A name the player typed is marked as typed and is never replaced by a generated one; only
 * the player changes it (typing, or the dice). The rejoin secret stays per tab in session
 * storage (src/net); the name does not depend on it.
 */
import { MAX_NAME_LENGTH } from '../../shared/protocol'
import { generateName, rollPlayerName } from './data/names'

const NAME_KEY = 'mira.playerName'
/** 'typed' or 'generated'. A name saved before this key existed counts as typed. */
const SOURCE_KEY = 'mira.playerNameSource'
const SEED_KEY = 'mira.nameSeed'

export type NameSource = 'typed' | 'generated'
type Store = Pick<Storage, 'getItem' | 'setItem'>
const storage = (): Store | null => { try { return localStorage } catch { return null } }

/**
 * A name as the room would show it: no control or formatting characters, no angle brackets,
 * single spaces, trimmed, at most MAX_NAME_LENGTH characters. Empty when nothing is left.
 */
export function cleanPlayerName(raw: string): string {
  const s = raw.normalize('NFC')
    // Control characters and the invisible direction overrides that can scramble a label.
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿<>]/g, '')
    .replace(/\s+/g, ' ').trim()
  return [...s].slice(0, MAX_NAME_LENGTH).join('').trim()
}

/** The saved name, or a new generated one saved now. */
export function loadPlayerName(store: Store | null = storage()): { name: string; source: NameSource } {
  let saved = '', source: string | null = null
  try { saved = cleanPlayerName(store?.getItem(NAME_KEY) ?? ''); source = store?.getItem(SOURCE_KEY) ?? null } catch { /* Storage is optional. */ }
  if (saved) return { name: saved, source: source === 'generated' ? 'generated' : 'typed' }
  // An older version kept only the seed of the generated name; reuse it so the name stays put.
  let seed = ''
  try { seed = store?.getItem(SEED_KEY) ?? '' } catch { /* Storage is optional. */ }
  const name = seed ? generateName(seed, 'player') : rollPlayerName().name
  savePlayerName(name, 'generated', store)
  return { name, source: 'generated' }
}

/**
 * Save a name. A generated name never replaces a typed one. Whatever the player sets in the
 * Me card, the dice included, is their choice and saved as typed.
 */
export function savePlayerName(name: string, source: NameSource, store: Store | null = storage()): boolean {
  const clean = cleanPlayerName(name)
  if (!clean || !store) return false
  try {
    if (source === 'generated' && store.getItem(NAME_KEY) && store.getItem(SOURCE_KEY) !== 'generated') return false
    store.setItem(NAME_KEY, clean); store.setItem(SOURCE_KEY, source)
    return true
  } catch { return false }
}
