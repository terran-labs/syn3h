/**
 * The words of a bug report (the owner, 25 November 2026: "a bug reporting system next to the
 * screenshot button ... paste a message into Discord or open a GitHub issue"). Pure text: no
 * DOM, nothing sent. The player sees every character before it goes anywhere, and only they
 * send it, by pasting or by pressing Submit on GitHub.
 *
 * Privacy: the diagnostics report is cleaned before it is shown. URL query strings and
 * fragments go (they can hold a room or a world), as do the room's name, the player's name and
 * any chat text, wherever they appear.
 */
import { GITHUB_REPO } from './links'

/** Discord refuses a message over 2,000 characters. */
export const DISCORD_LIMIT = 2000
/**
 * A post in a community channel should read at a glance (Foreman, 25 November 2026: about 900):
 * the player's line, build, device, renderer, world, vehicle and connection. No startup timings;
 * the GitHub issue keeps the fuller report.
 */
export const DISCORD_BUDGET = 900
/**
 * GitHub documents no number, only "414 URI Too Long". A visitor who is not signed in is sent
 * to the login page with this whole address encoded again in return_to, so the cap is half the
 * commonly quoted 8 KB.
 */
export const GITHUB_URL_LIMIT = 4000
/** The player's one line, at most this long. */
export const SENTENCE_LIMIT = 280

export interface ReportSecrets {
  /** The room's name. The public room's internal name is never a secret. */
  room?: string
  /** The player's own name and every name seen in chat. */
  names?: readonly string[]
  /** Chat text seen this session, any of which may have reached a line of the report. */
  chat?: readonly string[]
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Every whole-word occurrence, ignoring case. */
const word = (text: string) => new RegExp(`(?<![\\p{L}\\p{N}_-])${escape(text)}(?![\\p{L}\\p{N}_-])`, 'giu')

/** The report with query strings, fragments, the room, the player's name and chat removed. */
export function sanitizeReport(report: string, secrets: ReportSecrets = {}): string {
  let text = report
    // Any address keeps its origin and path only.
    .replace(/\b((?:https?|wss?):\/\/[^\s?#]*)[?#]\S*/gi, '$1')
    // A room named in a bare query fragment, wherever it appears.
    .replace(/([?&]room=)[^\s&#]*/gi, '$1[room]')
  for (const line of secrets.chat ?? []) {
    const said = line.trim()
    if (said.length >= 2) text = text.split(said).join('[chat]')
  }
  const room = secrets.room?.trim()
  if (room && room.toLowerCase() !== 'lobby') text = text.replace(word(room), '[room]')
  // Longest first, so "Ada Lovelace" goes before "Ada" can split it.
  for (const name of [...(secrets.names ?? [])].map(n => n.trim()).filter(Boolean).sort((a, b) => b.length - a.length)) text = text.replace(word(name), '[player]')
  return text
}

/** One line of the player's own words, at most SENTENCE_LIMIT characters. */
export function oneLine(sentence: string): string {
  const line = sentence.replace(/\s+/g, ' ').trim()
  return line.length > SENTENCE_LIMIT ? line.slice(0, SENTENCE_LIMIT - 1).trimEnd() + '…' : line
}

/** The value of a "Name: value" line of the report, or ''. */
export function reportField(report: string, name: string): string {
  const line = report.split('\n').find(l => l.startsWith(name + ': '))
  const value = line?.slice(name.length + 2).trim() ?? ''
  return value === 'Unavailable' ? '' : value
}

/** The lines that answer "which build, which device, where", first whenever space is short. */
const FIRST = ['Version:', 'Browser:', 'OS:', 'Device class:', 'Screen:', 'Renderer:', 'World:', 'Play:', 'Room connection:']
export const TRIMMED = '(trimmed; the full report is in Performance, Diagnostics, Copy diagnostics)'

/**
 * The report's lines in order of use, blank lines dropped: the FIRST lines, then the rest as
 * the report has them. A fence of three backticks would close the code block, so none survives.
 */
function orderedLines(report: string): string[] {
  const lines = report.replace(/```/g, "'''").split('\n').map(l => l.trimEnd()).filter(Boolean)
  const first = FIRST.flatMap(prefix => lines.filter(l => l.startsWith(prefix)))
  return [...first, ...lines.filter(l => !first.includes(l))]
}

/** The report cut by whole lines to `fits`, with TRIMMED at the end when anything was left out. */
export function compactReport(report: string, fits: (text: string) => boolean): string {
  const lines = orderedLines(report)
  if (fits(lines.join('\n'))) return lines.join('\n')
  let low = 0, high = lines.length
  // The most whole lines that fit with the trimmed note.
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (fits([...lines.slice(0, mid), TRIMMED].join('\n'))) low = mid; else high = mid - 1
  }
  // A single line longer than the whole budget: cut it.
  if (low === 0 && lines.length) {
    let line = lines[0]
    while (line.length > 1 && !fits([line + '…', TRIMMED].join('\n'))) line = line.slice(0, Math.floor(line.length * 0.8))
    return fits([line + '…', TRIMMED].join('\n')) ? [line + '…', TRIMMED].join('\n') : ''
  }
  return [...lines.slice(0, low), TRIMMED].join('\n')
}

export interface ReportInput {
  /** What the player typed, raw. */
  sentence: string
  /** The cleaned diagnostics report (sanitizeReport, then displayVehicles). */
  report: string
  /** The page's hostname, for the channel: a beta host adds "(beta)" after the version. */
  host?: string
}

/**
 * The same rule as shared/channel.ts channelOf on feat/beta-channel (beta.mira.cc and any
 * workers.dev deployment are beta). Replace with an import of channelOf once that is on main.
 */
export function isBetaHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')
  return host.startsWith('beta.') || host.endsWith('.workers.dev')
}

/**
 * The Play line with display names, not internal kinds: "Play: buggy-syn3h, 3 bots (buggy-syn3h
 * 2, jet 1)" becomes "Play: Buggy, 3 bots (Buggy 2, Jet 1)". Kinds with one name are merged.
 * A kind missing from `names` keeps its id; 'buggy-syn3h' also carries the product's old name,
 * so the buggy family always reads "Buggy".
 */
export function displayVehicles(report: string, names: Readonly<Record<string, string>>): string {
  const name = (kind: string) => names[kind] ?? (/^buggy(-|$)/.test(kind) ? 'Buggy' : kind)
  return report.split('\n').map(line => {
    const play = /^Play: ([^,]+), (\d+) bots(?: \((.*)\))?$/.exec(line)
    if (!play) return line
    const counts = new Map<string, number>()
    for (const part of (play[3] ?? '').split(', ').filter(Boolean)) {
      const at = part.lastIndexOf(' '), kind = name(part.slice(0, at)), n = Number(part.slice(at + 1)) || 0
      counts.set(kind, (counts.get(kind) ?? 0) + n)
    }
    const fleet = [...counts].map(([kind, n]) => `${kind} ${n}`).join(', ')
    return `Play: ${name(play[1].trim())}, ${play[2]} bots${fleet ? ` (${fleet})` : ''}`
  }).join('\n')
}

/** "Mira v26.11.2405 (beta) · Zansaeth (Badlands) · Buggy · Chrome 142 on macOS". */
function contextLine(report: string, host = ''): string {
  const world = reportField(report, 'World').replace(/, biome /, ' (').replace(/^(.*\(.*)$/, '$1)')
  const vehicle = reportField(report, 'Play').split(',')[0]
  const browser = reportField(report, 'Browser'), os = reportField(report, 'OS').replace(/ \(as reported by the browser\)$/, '')
  const device = [browser, os].filter(Boolean).join(' on ')
  const beta = host && isBetaHost(host) ? ' (beta)' : ''
  return [`Mira ${reportField(report, 'Version') || '(version unknown)'}${beta}`, world, vehicle, device].filter(Boolean).join(' · ')
}

/** The message for Discord, under DISCORD_BUDGET characters whatever the report holds. */
export function discordMessage({ sentence, report, host }: ReportInput): string {
  const said = oneLine(sentence)
  const head = `**Bug report:** ${said || '(no description)'}\n${contextLine(report, host)}\n`
  const wrap = (body: string) => body ? head + '```text\n' + body + '\n```' : head.trimEnd()
  // Only the lines that say which build, device and place: the timings stay for GitHub.
  const essentials = report.split('\n').filter(line => FIRST.some(prefix => line.startsWith(prefix))).join('\n')
  return wrap(compactReport(essentials, body => wrap(body).length <= DISCORD_BUDGET).replace('\n' + TRIMMED, ''))
}

/** A new issue on GitHub with title and body filled in, the whole address within GITHUB_URL_LIMIT. */
export function githubIssueUrl({ sentence, report, host }: ReportInput, repo: string = GITHUB_REPO): string {
  const said = oneLine(sentence)
  const title = said ? `Bug: ${said.length > 90 ? said.slice(0, 89).trimEnd() + '…' : said}` : `Bug report from Mira ${reportField(report, 'Version') || ''}`.trim()
  const body = (diagnostics: string) => [
    '**What happened**', said || '(no description)', '',
    contextLine(report, host), '',
    '**Screenshot**', '<!-- Drag the downloaded screenshot here. -->', '',
    ...(diagnostics ? ['<details><summary>Diagnostics</summary>', '', '```text', diagnostics, '```', '</details>'] : []),
  ].join('\n')
  const url = (diagnostics: string) => `${repo}/issues/new?${new URLSearchParams({ title, body: body(diagnostics) }).toString().replace(/\+/g, '%20')}`
  return url(compactReport(report, diagnostics => url(diagnostics).length <= GITHUB_URL_LIMIT))
}
