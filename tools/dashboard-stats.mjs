#!/usr/bin/env node
/**
 * Writes dashboard/stats.json, the numbers behind the dashboard's statistics panel.
 * Node only, no dependencies. Rerun it whenever the numbers should move:
 *
 *   SYN3H_SESSION_STATE=<host state directory> node tools/dashboard-stats.mjs
 *
 * Repository numbers (commits, releases, code) come from git and the files here. Pull
 * requests come from `gh`, when it is installed and signed in.
 *
 * Token numbers come from agent session logs that live OUTSIDE the repository. Their
 * location is read from SYN3H_SESSION_STATE, the directory holding `claude-accounts/` and
 * `codex-accounts/`, and is never written anywhere. stats.json holds totals only: no path,
 * account id, user name or email. Without the variable, the previous token numbers are
 * kept and marked stale.
 *
 * Counting rules:
 * - Claude: every *.jsonl under claude-accounts/<account>/projects/<project>/ whose project
 *   directory name mentions syn3h or 2jg65r8u (the Syn3h workspace). message.usage is
 *   summed once per unique message id across all files, because resumed and forked
 *   sessions repeat earlier messages.
 * - Codex: every *.jsonl under codex-accounts/ whose first 6000 bytes mention syn3h or
 *   2jg65r8u and that was modified after PROJECT_WINDOW_START. The last total_token_usage
 *   in each file is that session's total. Codex counts cached input inside input_tokens,
 *   so uncached input is input minus cached reads and cache writes.
 */
import { execFileSync } from 'node:child_process'
import { createReadStream, existsSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dashboard', 'stats.json')
const MATCH = /syn3h|2jg65r8u/i

/**
 * List API prices in US dollars per million tokens, as of 3 November 2026. Cache writes
 * cost 1.25 times input for five-minute entries and 2 times input for one-hour entries;
 * the logs do not say which was used, so the estimate is a range between the two.
 * These sessions ran on subscriptions: the result is what the tokens would have cost at
 * list price, not what was paid. Codex tokens are not priced.
 */
const RATES_DATE = '2026-11-03'
const RATES = {
  'claude-fable-5-2': { label: 'Claude Fable 5.2', input: 8.0, output: 40.0, cacheRead: 0.2 },
  'claude-opus-5-5': { label: 'Claude Opus 5.5', input: 4.0, output: 20.0, cacheRead: 0.2 },
}
const CACHE_WRITE_LOW = 1.25
const CACHE_WRITE_HIGH = 2

/** Codex files last modified before this are not part of the project. A day before the first commit. */
const firstCommit = Number(sh('git', ['log', '--reverse', '--format=%ct', 'origin/main']).split('\n')[0] || 0) * 1000
const PROJECT_WINDOW_START = firstCommit - 24 * 3600 * 1000

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}
const count = (args) => Number(sh('git', args) || 0)

function* walk(dir, depth = 8) {
  let entries = []
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory() && depth > 0) yield* walk(p, depth - 1)
    else if (e.isFile() && e.name.endsWith('.jsonl')) yield p
  }
}

async function* lines(file) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) yield line
}

function head(file, bytes = 6000) {
  const fd = openSync(file, 'r')
  try { const b = Buffer.alloc(bytes); const n = readSync(fd, b, 0, bytes, 0); return b.toString('utf8', 0, n) } finally { closeSync(fd) }
}

let firstSession = Infinity
const noteTime = (t) => { const ms = Date.parse(t); if (ms && ms < firstSession) firstSession = ms }

async function claudeTokens(state) {
  const base = join(state, 'claude-accounts')
  const seen = new Set()
  const byModel = {}
  let sessions = 0
  for (const account of readdirSync(base)) {
    const projects = join(base, account, 'projects')
    if (!existsSync(projects)) continue
    for (const project of readdirSync(projects)) {
      if (!MATCH.test(project)) continue
      for (const file of walk(join(projects, project))) {
        sessions++
        let timed = false
        for await (const line of lines(file)) {
          if (!timed && line.includes('"timestamp"')) { try { noteTime(JSON.parse(line).timestamp); timed = true } catch {} }
          if (!line.includes('"usage"')) continue
          let d; try { d = JSON.parse(line) } catch { continue }
          const m = d.message ?? {}
          const u = m.usage
          if (!u || !m.id || seen.has(m.id)) continue
          seen.add(m.id)
          const t = (byModel[m.model ?? 'unknown'] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
          t.input += u.input_tokens ?? 0
          t.output += u.output_tokens ?? 0
          t.cacheRead += u.cache_read_input_tokens ?? 0
          t.cacheWrite += u.cache_creation_input_tokens ?? 0
        }
      }
    }
  }
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const t of Object.values(byModel)) for (const k in sum) sum[k] += t[k]
  return { ...sum, total: sum.input + sum.output + sum.cacheRead + sum.cacheWrite, sessions, messages: seen.size, byModel }
}

/** The total_token_usage object anywhere inside a parsed line. */
function findUsage(o) {
  if (!o || typeof o !== 'object') return null
  if (o.total_token_usage) return o.total_token_usage
  for (const v of Object.values(o)) { const r = findUsage(v); if (r) return r }
  return null
}

async function codexTokens(state) {
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  let sessions = 0
  for (const file of walk(join(state, 'codex-accounts'))) {
    try {
      if (statSync(file).mtimeMs < PROJECT_WINDOW_START) continue
      const top = head(file)
      if (!MATCH.test(top)) continue
      const stamp = /"timestamp":"([^"]+)"/.exec(top)
      let last = null
      for await (const line of lines(file)) {
        if (!line.includes('total_token_usage')) continue
        try { last = findUsage(JSON.parse(line)) ?? last } catch {}
      }
      if (!last) continue
      sessions++
      if (stamp) noteTime(stamp[1])
      const cached = last.cached_input_tokens ?? 0
      const written = last.cache_write_input_tokens ?? 0
      sum.cacheRead += cached
      sum.cacheWrite += written
      sum.input += Math.max(0, (last.input_tokens ?? 0) - cached - written)
      sum.output += last.output_tokens ?? 0
      sum.reasoning += last.reasoning_output_tokens ?? 0
    } catch {}
  }
  return { ...sum, total: sum.input + sum.output + sum.cacheRead + sum.cacheWrite, sessions }
}

/** Dollar range for Claude tokens at list prices. Models without a listed rate are counted, not priced. */
function price(byModel) {
  let low = 0, high = 0, unpricedTokens = 0
  const models = []
  for (const [id, t] of Object.entries(byModel)) {
    const r = RATES[id]
    const total = t.input + t.output + t.cacheRead + t.cacheWrite
    if (!r) { unpricedTokens += total; continue }
    const base = (t.input * r.input + t.output * r.output + t.cacheRead * r.cacheRead) / 1e6
    const lo = base + (t.cacheWrite * r.input * CACHE_WRITE_LOW) / 1e6
    const hi = base + (t.cacheWrite * r.input * CACHE_WRITE_HIGH) / 1e6
    low += lo; high += hi
    models.push({ model: r.label, tokens: total, low: Math.round(lo), high: Math.round(hi) })
  }
  return {
    low: Math.round(low), high: Math.round(high), currency: 'USD', models, unpricedTokens,
    ratesDate: RATES_DATE,
    rates: Object.values(RATES).map((r) => ({ model: r.label, input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWriteLow: r.input * CACHE_WRITE_LOW, cacheWriteHigh: r.input * CACHE_WRITE_HIGH })),
    note: `Estimate only: what the Claude tokens would cost at list API prices of ${RATES_DATE}. Not what was paid; these sessions ran on subscriptions. Codex tokens are not priced.`,
  }
}

function releases() {
  const rows = readFileSync(join(root, 'release-notes', 'history.tsv'), 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#')).map((l) => { const [version, tag, commit, time, channel] = l.split('\t'); return { version, tag, commit, time, channel } })
  const production = rows.filter((r) => r.channel === 'production')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  const newest = production.at(-1)
  return { production: production.length, today: production.filter((r) => r.time.startsWith(today)).length, withdrawn: rows.filter((r) => r.channel === 'withdrawn').length, newest: newest?.version ?? null, newestAt: newest?.time ?? null }
}

function code() {
  const files = sh('git', ['ls-files', '-z', '--', 'src', 'shared', 'server']).split('\0').filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  let lineCount = 0
  for (const f of files) { try { lineCount += readFileSync(join(root, f), 'utf8').split('\n').length } catch {} }
  const tests = sh('git', ['ls-files', '-z']).split('\0').filter((f) => /\.test\.(ts|tsx|mjs|js)$/.test(f)).length
  let params = 0
  for (const f of sh('git', ['ls-files', '-z', '--', 'src', 'shared']).split('\0').filter((f) => /\.tsx?$/.test(f))) {
    try { for (const line of readFileSync(join(root, f), 'utf8').split('\n')) if (line.includes('defineParam(') && !/function\s+defineParam/.test(line)) params += (line.match(/defineParam\(/g) ?? []).length } catch {}
  }
  return { sourceFiles: files.length, lines: lineCount, testFiles: tests, params }
}

function pullRequests(merges) {
  const raw = sh('gh', ['pr', 'list', '--repo', 'terran-labs/syn3h', '--state', 'all', '--limit', '500', '--json', 'number,state'])
  let list = null
  try { list = JSON.parse(raw) } catch {}
  if (!Array.isArray(list)) return { count: null, note: 'GitHub was not reachable; pull requests not counted.', mergedDirectly: merges }
  const merged = list.filter((p) => p.state === 'MERGED').length
  // Lanes merge branches into main directly, so a pull request count alone would mislead.
  return { count: list.length, merged, mergedDirectly: merges, note: list.length < 10 ? 'Lanes merge branches directly; few changes went through pull requests.' : '' }
}

const now = new Date()
const previous = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {}
const merges = count(['rev-list', '--count', '--merges', 'origin/main'])
const stats = {
  generatedAt: now.toISOString(),
  commits: { total: count(['rev-list', '--count', 'origin/main']), last48h: count(['rev-list', '--count', '--since=48 hours ago', 'origin/main']), merges },
  pullRequests: pullRequests(merges),
  releases: releases(),
  code: code(),
}

const state = process.env.SYN3H_SESSION_STATE
if (state && existsSync(join(state, 'claude-accounts'))) {
  const claude = await claudeTokens(state)
  const codex = await codexTokens(state)
  const hours = Number.isFinite(firstSession) ? (now.getTime() - firstSession) / 3600000 : null
  const total = claude.total + codex.total
  const { byModel, ...claudeTotals } = claude
  stats.tokens = {
    stale: false, countedAt: now.toISOString(),
    claude: claudeTotals, codex,
    total, firstSessionAt: Number.isFinite(firstSession) ? new Date(firstSession).toISOString() : null,
    hours: hours && Math.round(hours * 10) / 10, perHour: hours ? Math.round(total / hours) : null,
  }
  stats.price = price(byModel)
} else {
  if (previous.tokens) stats.tokens = { ...previous.tokens, stale: true }
  if (previous.price) stats.price = previous.price
}

writeFileSync(out, JSON.stringify(stats, null, 2) + '\n')
console.log(JSON.stringify(stats, null, 2))
