/**
 * Each smoke page's Chrome log and crash dumps, for the next crash anywhere in the release path.
 *
 * Chrome's stderr only reaches us through Playwright's own debug channel (DEBUG=pw:browser; its
 * `logger` launch option carries API calls only), so this module turns that channel on before
 * playwright-core loads (import it first), takes those lines off our stderr, and files them per
 * page: `nameNextLaunch(name)` before each launch ties the next "<launched> pid=N" to a page.
 * Files go under a run directory outside the repo, ten newest runs kept, each page's log capped.
 * Diagnostics only: every file operation swallows its own failure.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

if (!/pw:browser/.test(process.env.DEBUG ?? '')) process.env.DEBUG = [process.env.DEBUG, 'pw:browser'].filter(Boolean).join(',')

const CAP = 2 * 1024 * 1024
let dir = null, launching = null, partial = ''
const names = new Map(), bytes = new Map(), tails = new Map()

/** Makes root/run/dumps, prunes all but the ten newest runs, and starts filing Chrome's lines. */
export function prepareChromeLogs(root, run) {
  dir = join(root, run)
  try {
    mkdirSync(join(dir, 'dumps'), { recursive: true })
    const runs = readdirSync(root).map((d) => ({ d, t: statSync(join(root, d)).mtimeMs })).sort((a, b) => b.t - a.t)
    for (const { d } of runs.slice(10)) rmSync(join(root, d), { recursive: true, force: true })
  } catch { /* diagnostics only */ }
  const write = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk, ...rest) => {
    const text = partial + String(chunk), lines = text.split('\n')
    partial = lines.pop() ?? ''
    const kept = lines.filter((line) => !file(line))
    return kept.length ? write(kept.join('\n') + '\n', ...rest) : true
  }
  return dir
}

/** The next Chrome that reports itself launched belongs to this page. */
export function nameNextLaunch(name) { launching = name }

/** The last lines this page's Chrome wrote. */
export function chromeTail(name) { return tails.get(name) ?? [] }

/** Files one pw:browser line under its page; false for any other line. */
function file(line) {
  if (!line.includes('pw:browser')) return false
  const launched = /<launched> pid=(\d+)/.exec(line)
  if (launched && launching) { names.set(launched[1], launching); launching = null }
  const pid = /\[pid=(\d+)\]/.exec(line)?.[1] ?? launched?.[1]
  const name = (pid && names.get(pid)) || 'chrome'
  const tail = tails.get(name) ?? []; tail.push(line.slice(0, 400)); if (tail.length > 40) tail.shift(); tails.set(name, tail)
  const used = bytes.get(name) ?? 0
  if (dir && used < CAP) {
    bytes.set(name, used + line.length + 1)
    try { appendFileSync(join(dir, `${name}.log`), line + '\n') } catch { /* diagnostics only */ }
  }
  return true
}
