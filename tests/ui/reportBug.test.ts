// Invariants of Report a bug (src/ui/report). Each names the bug a player would hit.
import { describe, expect, it } from 'vitest'
import { DISCORD_LIMIT, GITHUB_URL_LIMIT, discordMessage, githubIssueUrl, sanitizeReport } from '../../src/ui/report/reportText'
import { reportSheetHtml } from '../../src/ui/report/sheetHtml'

const ROOM = 'Secret-Garage', NAME = 'Quillfeather', CHAT = 'meet me behind the volcano at nine'
/** A worst case: a real report's shape, 400 long lines, with the room, name and chat planted in it. */
const report = [
  'Mira diagnostics v2', 'Version: v26.11.2405', 'Browser: Chrome 142', 'OS: macOS (as reported by the browser)', 'Device class: Desktop',
  'Screen: 1960 × 1300 CSS px; DPR 2', 'Renderer: WebGPU; reason: default', 'World: Zansaeth, biome Badlands', 'Play: buggy, 12 bots (buggy 6, jet 6)',
  `Room connection: connected to wss://mira.cc/room?room=${ROOM}&name=${NAME}#x, drops 0`,
  `Address https://mira.cc/?room=${ROOM}&world=abc123 last chat "${CHAT}" from ${NAME}`,
  '```', ...Array.from({ length: 400 }, (_, i) => `Long frame ${i}: ` + 'x'.repeat(180)),
].join('\n')
const clean = sanitizeReport(report, { room: ROOM, names: [NAME, "Ada"], chat: [CHAT] })
const longest = 'z'.repeat(1000)

describe('report a bug', () => {
  it('keeps the Discord message under the limit, or Discord refuses the paste', () => {
    for (const sentence of ['', 'my buggy fell through the ground', longest]) {
      const message = discordMessage({ sentence, report: clean })
      expect(message.length).toBeLessThan(DISCORD_LIMIT)
      expect(message).toContain('Version: v26.11.2405')
      // An unbalanced fence would swallow the rest of the channel's formatting.
      expect(message.split('```').length % 2).toBe(1)
    }
  })
  it('never leaks a query string, the room, the player name or chat into either output', () => {
    for (const out of [discordMessage({ sentence: 'it broke', report: clean }), decodeURIComponent(githubIssueUrl({ sentence: 'it broke', report: clean }))]) {
      expect(out).not.toMatch(/\?room=|&world=|&name=/)
      expect(out.toLowerCase()).not.toContain(ROOM.toLowerCase())
      expect(out).not.toContain(NAME)
      expect(out).not.toContain(CHAT)
    }
  })
  it('keeps the GitHub address within the limit, or GitHub answers 414 instead of an issue', () => {
    for (const sentence of ['', 'the jet spins', longest]) {
      const url = githubIssueUrl({ sentence, report: clean })
      expect(url.length).toBeLessThanOrEqual(GITHUB_URL_LIMIT)
      const params = new URL(url).searchParams
      expect(url.startsWith('https://github.com/terran-labs/syn3h/issues/new?')).toBe(true)
      expect(params.get('title')).toMatch(/^Bug/)
      expect(params.get('body')).toContain('Version: v26.11.2405')
    }
  })
  it('puts every sheet action in the tab order, or a keyboard player cannot report', () => {
    const host = reportSheetHtml()
    const controls = [...host.matchAll(/<(button|input|a)\b[^>]*>/g)].map(m => m[0])
    for (const action of ['report-save', 'report-discord', 'report-github', 'report-close', 'report-what'])
      expect(controls.some(c => c.includes(action))).toBe(true)
    for (const control of controls) {
      expect(control).not.toMatch(/tabindex="-1"|\sdisabled|\shidden|aria-hidden="true"/)
      if (control.startsWith('<a')) expect(control).toMatch(/href=/)
    }
  })
})
