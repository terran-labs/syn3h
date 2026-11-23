/**
 * The wordmark every brand module draws: the Syn3h path today (wordmarkPath.ts). During the
 * Mira logo rounds a development server takes ?mark=N to draw round 3 candidate N
 * (mira/round3.ts; ?mark=r2-N for round 2, ?mark=r1-N for round 1) everywhere instead, so a candidate can be seen in the real lobby with
 * its live plasma. Production builds never read the address here: import.meta.env.DEV is
 * false there and the candidates are not bundled.
 */
import { WORDMARK_HEIGHT as SYN3H_HEIGHT, WORDMARK_PATH as SYN3H_PATH, WORDMARK_WIDTH as SYN3H_WIDTH } from './wordmarkPath'
import { candidateById } from './mira/candidates'
import { ROUND2 } from './mira/round2'
import { ROUND3 } from './mira/round3'

function pick(): { d: string; width: number; height: number } {
  if (import.meta.env.DEV && typeof location !== 'undefined') {
    const id = new URLSearchParams(location.search).get('mark') ?? ''
    // ?mark=N is a round 3 candidate; ?mark=r2-N and ?mark=r1-N are the earlier rounds.
    const found = id.startsWith('r1-') ? candidateById(Number(id.slice(3)))?.word
      : id.startsWith('r2-') ? ROUND2.find(c => c.id === Number(id.slice(3)))?.word
      : ROUND3.find(c => c.id === Number(id))?.word
    if (found) return found
  }
  return { d: SYN3H_PATH, width: SYN3H_WIDTH, height: SYN3H_HEIGHT }
}
const active = pick()
export const WORDMARK_PATH = active.d
export const WORDMARK_WIDTH = active.width
export const WORDMARK_HEIGHT = active.height
