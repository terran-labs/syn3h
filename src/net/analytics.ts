/**
 * Launch analytics, the client's part (the server's is server/analytics.ts). The owner approved
 * an anonymous id explicitly. Everything here goes only to our own server: the hello's fields,
 * and small crash and health reports posted to /e. No third-party script or request.
 *
 * - Anonymous id: 32 random hex characters kept in localStorage. With storage blocked there is
 *   no id; the session still counts. It is never shown and tied to nothing.
 * - Entry campaign tag (?ref=): read once at first load, cleaned (lower-case letters, digits,
 *   dash, at most 24 characters, else dropped), kept for the tab, and sent with each hello.
 *   It never selects a room or a world; src/ui/LobbyAddress.ts removes it from the bar.
 * - Reports to /e: at most CRASHES_PER_PAGE crash reports (one per distinct stack) and
 *   EVENTS_PER_PAGE health events per page load, sent with sendBeacon (fetch with keepalive
 *   as a fallback), never awaited, never retried. A crash loop costs a handful of requests.
 */
import { levelNumber, qualityLevel } from '../core/quality'

declare const __MIRA_BUILD__: string | undefined

export const CRASHES_PER_PAGE = 5
export const EVENTS_PER_PAGE = 10
const AID_KEY = 'mira.aid'
const REF_KEY = 'mira.ref'

const hex = (bytes: number): string => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')

/** This page load's own random key: the rate-limit key on /e when there is no anonymous id. */
export const PAGE_KEY = hex(8)

let aid: string | null | undefined
/** The anonymous id, made on first use; '' when storage is blocked. */
export function anonymousId(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocal()): string {
  if (aid !== undefined && storage === safeLocal()) return aid ?? ''
  let id = ''
  try {
    if (storage) {
      id = storage.getItem(AID_KEY) ?? ''
      if (!/^[0-9a-f]{32}$/.test(id)) { id = hex(16); storage.setItem(AID_KEY, id) }
      if (storage.getItem(AID_KEY) !== id) id = '' // storage that does not keep what it is given
    }
  } catch { id = '' }
  if (storage === safeLocal()) aid = id || null
  return id
}

function safeLocal(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
function safeSession(): Storage | null {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

/** A campaign tag from an entry query, cleaned; '' when absent or not of the allowed shape. */
export function cleanRef(raw: string | null | undefined): string {
  const v = (raw ?? '').trim().toLowerCase()
  return /^[a-z0-9-]{1,24}$/.test(v) ? v : ''
}

/** The tab's campaign tag: the entry address's ?ref= the first time, kept for the tab. */
export function entryRef(search: string = typeof location === 'undefined' ? '' : location.search, store: Storage | null = safeSession()): string {
  try {
    const kept = store?.getItem(REF_KEY)
    if (kept !== null && kept !== undefined) return cleanRef(kept)
    const ref = cleanRef(new URLSearchParams(search).get('ref'))
    store?.setItem(REF_KEY, ref)
    return ref
  } catch { return cleanRef(new URLSearchParams(search).get('ref')) }
}
// Read at module load, before the lobby cleans the bar.
const REF = entryRef()

/** Phone, tablet or desktop, from the user agent and the pointer. */
export function deviceClass(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent, coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches, maxTouch = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints): 'phone' | 'tablet' | 'desktop' {
  if (/iPhone|iPod|Windows Phone|Android.+Mobile|Mobile.+Firefox/.test(ua)) return 'phone'
  if (/iPad|Android|Tablet|Silk/.test(ua) || (/Macintosh/.test(ua) && maxTouch > 1)) return 'tablet'
  return coarse && maxTouch > 1 ? 'tablet' : 'desktop'
}

export const buildVersion = (): string => {
  const b = typeof __MIRA_BUILD__ === 'string' ? __MIRA_BUILD__ : ''
  return /^[0-9A-Za-z.+_-]{1,40}$/.test(b) ? b : ''
}

/** Facts about this client, sent with the hello and with every report. */
export function clientFacts(backend: 'webgpu' | 'webgl' | string | undefined): { aid?: string; build?: string; device: string; backend?: string; quality: number; ref?: string } {
  const out: { aid?: string; build?: string; device: string; backend?: string; quality: number; ref?: string } = { device: deviceClass(), quality: levelNumber(qualityLevel.value) }
  const id = anonymousId(), build = buildVersion()
  if (id) out.aid = id
  if (build) out.build = build
  if (backend === 'webgpu') out.backend = 'webgpu'
  else if (backend === 'webgl') out.backend = 'webgl2'
  if (REF) out.ref = REF
  return out
}

// ---------------------------------------------------------------------------------------------
// Reports to /e

export type ClientEvent = 'physics_retry' | 'physics_fail' | 'ws_fail'
export type CrashKind = 'device_lost' | 'error' | 'rejection' | 'physics_wasm' | 'ws_connect'

/** What the game can say about where it is, read when a report is made. Never throws out. */
export interface ReportContext { backend?: string; recipe?: string; vehicle?: string }
let context: () => ReportContext = () => ({})
export function setReportContext(read: () => ReportContext): void { context = read }

let crashes = 0, events = 0
const stacksSent = new Set<string>()
type Send = (body: string) => void
let send: Send = (body) => {
  try {
    const blob = new Blob([body], { type: 'application/json' })
    if (typeof navigator !== 'undefined' && navigator.sendBeacon?.('/e', blob)) return
    void fetch('/e', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {})
  } catch { /* never affects play */ }
}
/** Tests: replace the transport and reset the per-page counts. */
export function setReportTransport(fn: Send): void { send = fn; crashes = 0; events = 0; stacksSent.clear() }

function base(): Record<string, unknown> {
  let c: ReportContext = {}
  try { c = context() } catch { c = {} }
  const facts = clientFacts(c.backend)
  return { key: facts.aid || PAGE_KEY, ...facts, ...(c.recipe ? { recipe: c.recipe } : {}) }
}

/** A health event (bounded per page). */
export function reportEvent(kind: ClientEvent, attempt = 0): void {
  try {
    if (events >= EVENTS_PER_PAGE) return
    events++
    send(JSON.stringify({ ...base(), type: 'event', kind, attempt }))
  } catch { /* never affects play */ }
}

/** 32-bit FNV-1a of `text`, 8 hex characters. */
export function stackHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

/** The top three frames as file:line:column, with no query strings or origins. */
export function topFrames(stack: string): string {
  const frames: string[] = []
  for (const line of stack.split('\n')) {
    const m = /([^\s(/@]+\.(?:js|ts|mjs|wasm))(?:\?[^:\s)]*)?:(\d+)(?::(\d+))?/.exec(line)
    if (m) frames.push(`${m[1]}:${m[2]}${m[3] ? ':' + m[3] : ''}`)
    if (frames.length === 3) break
  }
  return frames.join(' < ').slice(0, 300)
}

/** A crash (bounded per page, one per distinct stack). */
export function reportCrash(kind: CrashKind, error: unknown): void {
  try {
    if (crashes >= CRASHES_PER_PAGE) return
    const e = error as { message?: unknown; stack?: unknown } | null
    const message = (typeof e?.message === 'string' ? e.message : typeof error === 'string' ? error : '').slice(0, 400)
    const stack = typeof e?.stack === 'string' ? e.stack : ''
    const hash = stackHash(`${kind}\n${stack || message}`)
    if (stacksSent.has(hash)) return
    stacksSent.add(hash)
    crashes++
    let vehicle = ''
    try { vehicle = context().vehicle ?? '' } catch { vehicle = '' }
    send(JSON.stringify({ ...base(), type: 'crash', kind, message: message.replace(/https?:\/\/[^\s)]+/g, (u) => u.split(/[?#]/)[0]).slice(0, 160), stack: hash, frames: topFrames(stack), vehicle }))
  } catch { /* never affects play */ }
}

let installed = false
/** Uncaught errors and unhandled rejections, reported as crashes. Once per page. */
export function installCrashReporting(target: Pick<Window, 'addEventListener'> = window): void {
  if (installed) return
  installed = true
  target.addEventListener('error', (e) => { const ev = e as ErrorEvent; if (ev.error || ev.message) reportCrash('error', ev.error ?? ev.message) })
  target.addEventListener('unhandledrejection', (e) => reportCrash('rejection', (e as PromiseRejectionEvent).reason))
}
