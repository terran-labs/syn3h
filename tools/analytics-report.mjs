#!/usr/bin/env node
// Launch analytics report: what our own server wrote to Workers Analytics Engine (dataset
// mira_events, server/analytics.ts), and Cloudflare's own zone figures for mira.cc.
//
//   node tools/analytics-report.mjs [--since 24h|7d|2026-11-25] [--channel beta|production|all]
//
// Token: an API token with Account | Account Analytics | Read, one line, mode 600, in the file
// MIRA_ANALYTICS_TOKEN_FILE (default ~/.config/syn3h/cloudflare-analytics-token). Never on the command line
// and never printed. The account is MIRA_CF_ACCOUNT_ID, or read from the zone; the zone is
// MIRA_ZONE_ID, or looked up by name (that lookup needs Zone | Zone | Read).
//
// Analytics Engine samples under load: every count here is weighted by _sample_interval, so
// a row stored with an interval of 10 counts as ten.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DATASET = 'mira_events'
const API = 'https://api.cloudflare.com/client/v4'

/** "24h", "7d", "90m" or a date: the window's start as an SQL expression (UTC). */
export function sinceSql(since) {
  const rel = /^(\d{1,4})([mhd])$/.exec(since)
  if (rel) return `NOW() - INTERVAL '${Number(rel[1])}' ${{ m: 'MINUTE', h: 'HOUR', d: 'DAY' }[rel[2]]}`
  const date = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?$/.exec(since)
  if (date) return `toDateTime('${date[1]} ${date[2] ?? '00:00:00'}')`
  throw new Error(`--since: expected 24h, 7d, 90m or YYYY-MM-DD, got ${JSON.stringify(since)}`)
}

/** The rows of one event in the window, raw: aggregation happens in summarize(), weighted. */
export function eventSql(event, since, channel) {
  if (!/^[a-z_]+$/.test(event)) throw new Error('bad event')
  const ch = channel === 'all' ? '' : ` AND blob2 = '${channel === 'beta' ? 'beta' : 'production'}'`
  return `SELECT timestamp, _sample_interval AS si, blob3 AS build, blob4 AS recipe, blob5 AS roomKind, blob6 AS device, blob7 AS backend, ` +
    `blob8 AS country, blob9 AS continent, blob10 AS aid, blob11 AS kind, blob12 AS message, blob13 AS stack, blob16 AS ref, blob17 AS errorName, ` +
    `double1 AS seconds, double2 AS activeSeconds, double4 AS count, double5 AS players, double6 AS active, double7 AS rooms ` +
    `FROM ${DATASET} WHERE blob1 = '${event}' AND timestamp >= ${sinceSql(since)}${ch} LIMIT 200000 FORMAT JSON`
}

/** Device rows (server/analytics.ts DEVICE_COLUMNS) and perf rows (PERF_COLUMNS), raw. */
export function wideSql(event, since, channel) {
  if (event !== 'device' && event !== 'perf') throw new Error('bad event')
  const ch = channel === 'all' ? '' : ` AND blob2 = '${channel === 'beta' ? 'beta' : 'production'}'`
  const cols = event === 'device'
    ? 'blob11 AS gpuVendor, blob12 AS gpuModel, blob13 AS gpuSource, blob14 AS backendReason, blob15 AS adapterProbe, blob16 AS features, blob17 AS gamut, blob18 AS hdr, blob19 AS pointer, blob20 AS motion, double1 AS memoryGB, double2 AS cores, double3 AS startLevel, double4 AS maxTexture, double7 AS dpr'
    : 'blob11 AS gpuVendor, blob12 AS gpuModel, double1 AS startLevel, double2 AS settledLevel, double3 AS auto, double4 AS medianMs, double5 AS p95Ms, double6 AS windows, double7 AS shadowQuality, double8 AS liquidGlass, double10 AS longFrames, double11 AS fpsCeiling'
  return `SELECT timestamp, _sample_interval AS si, blob6 AS device, ${cols} FROM ${DATASET} WHERE blob1 = '${event}' AND timestamp >= ${sinceSql(since)}${ch} LIMIT 200000 FORMAT JSON`
}

const LEVEL_NAMES = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Cinematic']
/** A GPU model family coarse enough to group: its first two or three words ("GeForce RTX", "Apple M2"). */
export function modelFamily(model) {
  const m = String(model || '').trim()
  if (!m) return '(not given)'
  const w = m.split(' ')
  return (/^(GeForce|Radeon|Intel|Apple|Adreno|Mali|PowerVR|Iris)$/i.test(w[0]) ? w.slice(0, 2) : w.slice(0, 1)).join(' ')
}

/**
 * "Devices and rendering": shares of sessions by GPU, memory, backend, settled quality and
 * feature, and median frame time by GPU family and settled level. Each share is of the
 * sessions that reported that field; the unknown count is shown beside it.
 */
export function summarizeDevices(devices = [], perfs = []) {
  const share = (rows, key) => {
    const m = new Map(); let total = 0
    for (const r of rows) { const k = key(r); total += w(r); m.set(k, (m.get(k) ?? 0) + w(r)) }
    return { total, rows: [...m].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => [k, v, total ? v / total : 0]) }
  }
  const features = new Map(); let featureTotal = 0
  for (const r of devices) {
    if (r.gpuSource !== 'webgpu') continue
    featureTotal += w(r)
    for (const f of String(r.features || '').split(',').filter(Boolean)) features.set(f, (features.get(f) ?? 0) + w(r))
  }
  const medians = (key) => {
    const groups = new Map()
    for (const r of perfs) { const k = key(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push([Number(r.medianMs), w(r)]) }
    return [...groups].map(([k, pairs]) => [k, weightedMedian(pairs), pairs.reduce((a, [, x]) => a + x, 0)]).sort((a, b) => b[2] - a[2]).slice(0, 15)
  }
  return {
    vendor: share(devices, (r) => r.gpuVendor || 'unknown'),
    family: share(devices, (r) => `${r.gpuVendor || 'unknown'}: ${modelFamily(r.gpuModel)}`),
    memory: share(devices, (r) => (Number(r.memoryGB) ? `${r.memoryGB} GB` : 'not reported (Safari, Firefox)')),
    backend: share(devices, (r) => r.gpuSource === 'webgpu' ? 'WebGPU' : r.gpuSource === 'webgl' ? `WebGL 2 (${r.backendReason || 'reason unknown'})` : 'none'),
    settled: share(perfs, (r) => LEVEL_NAMES[Number(r.settledLevel)] ?? '?'),
    highOrAbove: perfs.length ? perfs.filter((r) => Number(r.settledLevel) >= 3).reduce((a, r) => a + w(r), 0) / perfs.reduce((a, r) => a + w(r), 0) : 0,
    features: [...features].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, featureTotal ? v / featureTotal : 0]), featureTotal,
    frameByFamily: medians((r) => `${r.gpuVendor || 'unknown'}: ${modelFamily(r.gpuModel)}`),
    frameByLevel: medians((r) => LEVEL_NAMES[Number(r.settledLevel)] ?? '?'),
  }
}

export function formatDevices(d) {
  const pct = (x) => `${Math.round(x * 100)}%`
  const shares = (title, s) => [`${title} (of ${n(s.total)} sessions):`, ...(s.rows.length ? s.rows.map(([k, v, f]) => `  ${String(k).padEnd(40)} ${pct(f).padStart(4)}  (${n(v)})`) : ['  (none)'])]
  return [
    'Devices and rendering',
    ...shares('GPU vendor', d.vendor), ...shares('GPU model family', d.family), ...shares('Device memory', d.memory),
    ...shares('Graphics backend', d.backend), ...shares('Settled quality level', d.settled),
    `Sessions settling at High or above: ${pct(d.highOrAbove)}.`,
    `WebGPU features (of ${n(d.featureTotal)} WebGPU sessions):`, ...(d.features.length ? d.features.map(([k, v, f]) => `  ${k.padEnd(40)} ${pct(f).padStart(4)}  (${n(v)})`) : ['  (none)']),
    'Median frame time by GPU family:', ...(d.frameByFamily.length ? d.frameByFamily.map(([k, ms, c]) => `  ${String(k).padEnd(40)} ${ms} ms  (${n(c)} sessions)`) : ['  (none)']),
    'Median frame time by settled level:', ...(d.frameByLevel.length ? d.frameByLevel.map(([k, ms, c]) => `  ${String(k).padEnd(40)} ${ms} ms  (${n(c)} sessions)`) : ['  (none)']),
    'Frame times come from the game\'s own per-second windows at the settled level; frame-rate ceilings are observed, not measured.',
  ].join('\n')
}

/** Every anonymous id's first session, over the whole retention (three months). */
export function firstSeenSql(channel) {
  const ch = channel === 'all' ? '' : ` AND blob2 = '${channel === 'beta' ? 'beta' : 'production'}'`
  return `SELECT blob10 AS aid, min(timestamp) AS first FROM ${DATASET} WHERE blob1 = 'session_start' AND blob10 != ''${ch} GROUP BY aid LIMIT 1000000 FORMAT JSON`
}

const w = (r) => Number(r.si) || 1
const add = (m, k, v) => m.set(k || '(none)', (m.get(k || '(none)') ?? 0) + v)
const top = (m, n = 10) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n)
const day = (t) => String(t).slice(0, 10)

/** Weighted median of (value, weight) pairs. */
export function weightedMedian(pairs) {
  const s = pairs.filter(([v]) => Number.isFinite(v)).sort((a, b) => a[0] - b[0])
  const total = s.reduce((a, [, k]) => a + k, 0)
  let acc = 0
  for (const [v, k] of s) { acc += k; if (acc >= total / 2) return v }
  return 0
}

/**
 * The report from raw rows. `rows` holds each event's rows as returned by eventSql;
 * `firstSeen` maps an anonymous id to its first session's timestamp.
 */
export function summarize(rows, firstSeen = new Map()) {
  const starts = rows.session_start ?? [], ends = rows.session_end ?? []
  const sessions = starts.reduce((a, r) => a + w(r), 0)
  const ids = new Set(starts.map((r) => r.aid).filter(Boolean))
  const anonymousSessions = starts.filter((r) => !r.aid).reduce((a, r) => a + w(r), 0)
  // Concurrency: the registry's per-planet rows for each minute, summed per minute.
  const minutes = new Map(), activeMinutes = new Map()
  for (const r of rows.presence ?? []) {
    const m = String(r.timestamp).slice(0, 16)
    minutes.set(m, (minutes.get(m) ?? 0) + Number(r.players) * w(r))
    activeMinutes.set(m, (activeMinutes.get(m) ?? 0) + Number(r.active) * w(r))
  }
  const latest = [...minutes.keys()].sort().at(-1)
  const worlds = new Map(), worldSessions = new Map(), vehicles = new Map(), continents = new Map(), countries = new Map()
  const devices = new Map(), backends = new Map(), kinds = new Map(), refs = new Map(), crashes = new Map(), health = new Map()
  for (const r of ends) { add(worlds, r.recipe, Number(r.seconds) * w(r)); add(worldSessions, r.recipe, w(r)) }
  for (const r of rows.vehicle ?? []) add(vehicles, r.kind, Number(r.seconds) * w(r))
  for (const r of starts) {
    add(continents, r.continent, w(r)); add(countries, r.country, w(r)); add(devices, r.device, w(r))
    add(backends, r.backend, w(r)); add(kinds, r.roomKind, w(r)); add(refs, r.ref, w(r))
  }
  for (const r of rows.crash ?? []) add(crashes, `${r.kind} ${r.errorName || 'Error'} @ ${r.build || '(frozen)'}`, w(r))
  for (const r of rows.client ?? []) add(health, r.kind, w(r))
  add(health, 'room_full (handoff to a universe)', (rows.room_full ?? []).reduce((a, r) => a + w(r), 0))
  add(health, 'rejoins', ends.reduce((a, r) => a + Number(r.count) * w(r), 0))
  // Returning players: per day, unique ids, and how many of them were first seen on an earlier day.
  const daily = new Map()
  for (const r of starts) {
    if (!r.aid) continue
    const d = day(r.timestamp)
    if (!daily.has(d)) daily.set(d, new Set())
    daily.get(d).add(r.aid)
  }
  const days = [...daily].sort((a, b) => a[0].localeCompare(b[0])).map(([d, set]) => ({
    day: d, uniques: set.size, returning: [...set].filter((id) => firstSeen.has(id) && day(firstSeen.get(id)) < d).length,
  }))
  return {
    sessions, uniques: ids.size, anonymousSessions,
    concurrentNow: latest ? minutes.get(latest) : 0, activeNow: latest ? activeMinutes.get(latest) : 0, peak: Math.max(0, ...minutes.values()),
    playSeconds: ends.reduce((a, r) => a + Number(r.seconds) * w(r), 0),
    activeSeconds: ends.reduce((a, r) => a + Number(r.activeSeconds) * w(r), 0),
    medianSeconds: weightedMedian(ends.map((r) => [Number(r.seconds), w(r)])),
    worlds: top(worlds).map(([k, s]) => [k, s, worldSessions.get(k) ?? 0]), vehicles: top(vehicles),
    continents: top(continents), countries: top(countries, 20), devices: top(devices), backends: top(backends),
    roomKinds: top(kinds), refs: top(refs), crashes: top(crashes, 20), health: top(health), days,
  }
}

const hms = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${m} min` : m ? `${m} min ${s % 60} s` : `${s} s` }
const n = (v) => Math.round(v).toLocaleString('en-US')
const table = (title, pairs, fmt = n) => [`${title}:`, ...(pairs.length ? pairs.map(([k, v]) => `  ${k.padEnd(28)} ${fmt(v)}`) : ['  (none)'])]

export function format(r, window) {
  return [
    `Mira analytics, ${window}`,
    `Players now: ${n(r.concurrentNow)} connected, ${n(r.activeNow)} active. Peak: ${n(r.peak)} connected.`,
    `Sessions: ${n(r.sessions)}. Unique players: ${n(r.uniques)} (plus ${n(r.anonymousSessions)} sessions with no id).`,
    `Play time: ${hms(r.playSeconds)} in total, ${hms(r.activeSeconds)} active; median session ${hms(r.medianSeconds)}.`,
    ...table('Worlds by time played', r.worlds.map(([k, s, c]) => [`${k} (${n(c)} sessions)`, s]), hms),
    ...table('Vehicles by time', r.vehicles, hms),
    ...table('Continents (sessions)', r.continents), ...table('Countries (sessions)', r.countries),
    ...table('Devices (sessions)', r.devices), ...table('Graphics backend (sessions)', r.backends),
    ...table('Room kinds (sessions)', r.roomKinds), ...table('Came from (?ref=, sessions)', r.refs),
    'Unique and returning players by day:', ...(r.days.length ? r.days.map((d) => `  ${d.day}  ${n(d.uniques)} unique, ${n(d.returning)} seen on an earlier day`) : ['  (none)']),
    ...table('Health', r.health), ...table('Crashes by type and version', r.crashes),
    'Crash and health rows are reported by clients to an open endpoint and are not authenticated: read them as indications.',
    'Each row carries its channel; this report shows one channel at a time (--channel).',
  ].join('\n')
}

// ---------------------------------------------------------------------------------------------
// Cloudflare access. The token is read from its file and only ever placed in a header.

export function readToken(file = process.env.MIRA_ANALYTICS_TOKEN_FILE || join(homedir(), '.config/syn3h/cloudflare-analytics-token')) {
  try { return readFileSync(file, 'utf8').replace(/[\r\n]/g, '') } catch { return '' }
}

async function api(fetcher, token, path, init = {}) {
  const res = await fetcher(`${API}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } })
  const text = await res.text()
  return { ok: res.ok, status: res.status, text }
}

async function sql(fetcher, token, account, query) {
  const r = await api(fetcher, token, `/accounts/${account}/analytics_engine/sql`, { method: 'POST', body: query })
  if (!r.ok) throw new Error(`Analytics Engine SQL refused (HTTP ${r.status}): ${r.text.slice(0, 300)}${r.status === 403 || r.status === 401 ? '\nThe token needs Account | Account Analytics | Read for the Mira account.' : ''}`)
  return JSON.parse(r.text).data ?? []
}

/** Cloudflare's zone figures (unique visitors, requests, countries) for the window, or why not. */
async function zoneFigures(fetcher, token, zone, sinceDate) {
  const query = `query { viewer { zones(filter: { zoneTag: "${zone}" }) { httpRequests1dGroups(limit: 100, filter: { date_geq: "${sinceDate}" }) { dimensions { date } sum { requests countryMap { clientCountryName requests } } uniq { uniques } } } } }`
  const r = await api(fetcher, token, '/graphql', { method: 'POST', body: JSON.stringify({ query }), headers: { 'content-type': 'application/json' } })
  const body = r.ok ? JSON.parse(r.text) : null
  if (!body || body.errors?.length) {
    const why = body?.errors?.map((e) => e.message).join('; ') ?? `HTTP ${r.status}`
    return `Zone figures for mira.cc: not readable with this token (${why.slice(0, 200)}). Add Zone | Analytics | Read for mira.cc to the token.`
  }
  const groups = body.data?.viewer?.zones?.[0]?.httpRequests1dGroups ?? []
  const countries = new Map()
  let requests = 0, uniques = 0
  for (const g of groups) {
    requests += g.sum.requests; uniques += g.uniq.uniques
    for (const c of g.sum.countryMap ?? []) countries.set(c.clientCountryName, (countries.get(c.clientCountryName) ?? 0) + c.requests)
  }
  return [`Zone figures for mira.cc since ${sinceDate} (Cloudflare, daily):`, `  unique visitors (sum of daily uniques) ${n(uniques)}, requests ${n(requests)}`,
    ...top(countries, 10).map(([k, v]) => `  ${k.padEnd(28)} ${n(v)} requests`)].join('\n')
}

export async function main(argv = process.argv.slice(2), fetcher = fetch, out = console.log, token = readToken()) {
  const arg = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt }
  const since = arg('--since', '24h'), channel = arg('--channel', 'production')
  sinceSql(since)
  if (!token) { out('No token: put an Account Analytics Read token in ~/.config/syn3h/cloudflare-analytics-token (or MIRA_ANALYTICS_TOKEN_FILE).'); return 1 }
  let account = process.env.MIRA_CF_ACCOUNT_ID ?? '', zone = process.env.MIRA_ZONE_ID ?? ''
  if (!account || !zone) {
    const z = await api(fetcher, token, '/zones?name=mira.cc')
    const found = z.ok ? JSON.parse(z.text).result?.[0] : null
    account ||= found?.account?.id ?? ''; zone ||= found?.id ?? ''
    if (!account) { out(`Cannot find the account: set MIRA_CF_ACCOUNT_ID, or add Zone | Zone | Read for mira.cc to the token (HTTP ${z.status}).`); return 1 }
  }
  const events = ['session_start', 'session_end', 'vehicle', 'presence', 'crash', 'client', 'room_full']
  const rows = {}
  for (const e of events) rows[e] = await sql(fetcher, token, account, eventSql(e, since, channel))
  const firstSeen = new Map((await sql(fetcher, token, account, firstSeenSql(channel))).map((r) => [r.aid, r.first]))
  out(format(summarize(rows, firstSeen), `since ${since}, ${channel}`))
  const devices = await sql(fetcher, token, account, wideSql('device', since, channel))
  const perfs = await sql(fetcher, token, account, wideSql('perf', since, channel))
  out(formatDevices(summarizeDevices(devices, perfs)))
  const sinceDate = /^\d{4}-\d{2}-\d{2}/.test(since) ? since.slice(0, 10) : new Date(Date.now() - (/d$/.test(since) ? parseInt(since) * 86400e3 : 86400e3)).toISOString().slice(0, 10)
  out(zone ? await zoneFigures(fetcher, token, zone, sinceDate) : 'Zone figures for mira.cc: zone unknown; set MIRA_ZONE_ID or add Zone | Zone | Read.')
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => { process.exitCode = code }, (error) => { console.error(String(error.message ?? error)); process.exitCode = 1 })
}
