/**
 * The wordmark every brand module draws: the Syn3h path today (wordmarkPath.ts). During the
 * Mira logo rounds a development server takes ?mark=N to draw Mira candidate N
 * (mira/candidates.ts) everywhere instead, so a candidate can be seen in the real lobby with
 * its live plasma. Production builds never read the address here: import.meta.env.DEV is
 * false there and the candidates are not bundled.
 */
import { WORDMARK_HEIGHT as SYN3H_HEIGHT, WORDMARK_PATH as SYN3H_PATH, WORDMARK_WIDTH as SYN3H_WIDTH } from './wordmarkPath'
import { candidateById } from './mira/candidates'

function pick(): { d: string; width: number; height: number } {
  if (import.meta.env?.DEV && typeof location !== 'undefined') {
    const id = new URLSearchParams(location.search).get('mark'), found = id ? candidateById(Number(id)) : undefined
    if (found) return found.word
  }
  return { d: SYN3H_PATH, width: SYN3H_WIDTH, height: SYN3H_HEIGHT }
}
const active = pick()
export const WORDMARK_PATH = active.d
export const WORDMARK_WIDTH = active.width
export const WORDMARK_HEIGHT = active.height
