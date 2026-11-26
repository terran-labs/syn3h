/**
 * Device and rendering analytics (shared/gpu.ts, src/net/deviceFacts.ts, server/analytics.ts
 * cleanDevice and cleanPerf, the room's device row, /e perf). Each test names its bug.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { featureCodes, cleanFeatureCodes, gpuFamily, gpuVendor } from '../../shared/gpu'
import { type AnalyticsSink, cleanDevice, cleanPerf, MAX_ROWS_PER_SESSION, ROOM_ROWS_PER_MINUTE, RowBudget } from '../../server/analytics'
import { type Peer, Room } from '../../server/room'
import worker from '../../server/worker'
import { PROTOCOL_VERSION } from '../../shared/protocol'
import { frameSummary } from '../../src/net/deviceFacts'
import { installPerfReporting, reportPerf, resetPerfReport, setReportTransport } from '../../src/net/analytics'

afterEach(() => { vi.restoreAllMocks(); resetPerfReport() })

const DEV = { vendor: 'apple', model: 'Apple M2 Max', source: 'webgpu', reason: 'webgpu', probe: 'available', features: 'f32f,ts', gamut: 'p3', hdr: 'high', pointer: 'fine', motion: 'no-preference', mem: 8, cores: 12, start: 3, maxTex: 16384, w: 15, h: 9, dpr: 2 }

describe('GPU names fit for grouping', () => {
  // Bug: raw driver strings (versions, device ids) splitting one GPU into many rows, or
  // identifying a machine.
  it('reduces renderer strings to a model family', () => {
    expect(gpuFamily('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max, Unspecified Version)')).toBe('Apple M2 Max')
    expect(gpuFamily('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('GeForce RTX 4070')
    expect(gpuFamily('ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('Intel UHD Graphics 620')
    expect(gpuFamily('Adreno (TM) 740')).toBe('Adreno 740')
    expect(gpuFamily('Apple GPU')).toBe('Apple GPU')
    expect(gpuFamily('Mali-G78')).toBe('Mali-G78')
    expect(gpuFamily('')).toBe('')
    expect(gpuFamily('quentin@example.com https://x.y/?a=b')).not.toMatch(/[@/?:=]/)
  })

  it('names vendors from any string the browser gives', () => {
    expect(gpuVendor('apple')).toBe('apple')
    expect(gpuVendor('', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070)')).toBe('nvidia')
    expect(gpuVendor('Google Inc.', 'SwiftShader')).toBe('google')
    expect(gpuVendor('', 'Adreno (TM) 740')).toBe('qualcomm')
    expect(gpuVendor('', '')).toBe('unknown')
  })

  // Bug: an arbitrary feature dump (a fingerprint) instead of the features rendering decisions need.
  it('records only the listed WebGPU features, as short sorted codes', () => {
    expect(featureCodes(['timestamp-query', 'float32-filterable', 'depth-clip-control', 'subgroups'])).toBe('f32f,ts')
    expect(cleanFeatureCodes('ts,f32f')).toBe('f32f,ts')
    expect(cleanFeatureCodes('ts,secret')).toBeNull()
  })
})

describe('the server keeps only well-formed device and perf fields', () => {
  // Bug: free text, odd numbers or exact screen sizes stored in a device row.
  it('cleans the device facts to enums, patterns and buckets', () => {
    expect(cleanDevice(DEV)).toEqual({ b: ['apple', 'Apple M2 Max', 'webgpu', 'webgpu', 'available', 'f32f,ts', 'p3', 'high', 'fine', 'no-preference'], d: [8, 12, 3, 16384, 15, 9, 2, 0] })
    const hostile = cleanDevice({ ...DEV, vendor: 'Quentin', model: 'Quentin <script>', source: 'x', features: 'ts,fingerprint', gamut: 'oled', mem: 7.3, cores: 1e9, w: 1512, dpr: 2.13, extra: 'ignored' })!
    expect(hostile.b.slice(0, 3)).toEqual(['unknown', '', ''])
    expect(hostile.b[5]).toBe('')
    expect(hostile.d.slice(0, 2)).toEqual([0, 0])
    expect([hostile.d[4], hostile.d[6]]).toEqual([0, 0])
    expect(cleanDevice(null)).toBeNull()
  })

  it('cleans a perf post, and refuses one with no measured windows', () => {
    const p = { vendor: 'nvidia', model: 'GeForce RTX 4070', start: 3, settled: 4, auto: 1, medianMs: 8.5, p95Ms: 14, windows: 120, shadow: 2, glass: 1, post: 3, longFrames: 4, fps: 120, seconds: 900 }
    expect(cleanPerf(p)).toEqual({ b: ['nvidia', 'GeForce RTX 4070'], d: [3, 4, 1, 8.5, 14, 120, 2, 1, 3, 4, 120, 900] })
    expect(cleanPerf({ ...p, windows: 0 })).toBeNull()
    expect(cleanPerf({ ...p, medianMs: 8.3, fps: 75 })!.d[3]).toBe(0)
  })
})

describe('one device row per session, one perf row per page', () => {
  const peer = (): Peer => ({ send() {}, close() {} })
  const hello = (extra: object = {}) => JSON.stringify({ type: 'hello', v: PROTOCOL_VERSION, modes: 2, name: 'A', params: {}, ...extra })

  // Bug: the device row missing, repeated, or breaking the per-session bound.
  it('the room writes one device row at a session\'s start, none for a client that sends none', () => {
    let now = 1_000_000
    const rows: { blobs: string[] }[] = []
    const sink: AnalyticsSink = { writeDataPoint: (p) => { rows.push({ blobs: p.blobs! }) } }
    const budget = new RowBudget(ROOM_ROWS_PER_MINUTE, () => now, sink)
    const room = new Room('lobby', { now: () => now, analytics: (e, c, x) => { budget.write(e, c, x) } })
    const a = peer(), b = peer()
    room.connect(a); room.receive(a, hello({ dev: DEV }))
    room.connect(b); room.receive(b, hello())
    const devices = rows.filter((r) => r.blobs[0] === 'device')
    expect(devices).toHaveLength(1)
    expect(devices[0].blobs.slice(10, 12)).toEqual(['apple', 'Apple M2 Max'])
    now += 60_000; room.disconnect(a)
    expect(rows.filter((r) => r.blobs[9] === '' && r.blobs[0] !== 'session_start').length).toBeLessThanOrEqual(MAX_ROWS_PER_SESSION)
  })

  // Bug: a perf post written as anything but one cleaned perf row.
  it('POST /e writes a perf row', async () => {
    const rows: { blobs: string[]; doubles: number[] }[] = []
    const sink: AnalyticsSink = { writeDataPoint: (p) => { rows.push({ blobs: p.blobs!, doubles: p.doubles! }) } }
    const perf = { vendor: 'apple', model: 'Apple GPU', start: 3, settled: 2, auto: 1, medianMs: 16.5, p95Ms: 33, windows: 60, shadow: 0, glass: 1, post: 2, longFrames: 9, fps: 60, seconds: 300 }
    const res = await worker.fetch(new Request('https://beta.mira.cc/e?k=abcdef0123456799', { method: 'POST', body: JSON.stringify({ type: 'perf', device: 'phone', perf }) }), { ANALYTICS: sink } as never)
    expect(res.status).toBe(204)
    expect(rows).toHaveLength(1)
    expect([rows[0].blobs[0], rows[0].blobs[1], rows[0].blobs[5], rows[0].blobs[10]]).toEqual(['perf', 'beta', 'phone', 'apple'])
    expect(rows[0].doubles.slice(0, 5)).toEqual([3, 2, 1, 16.5, 33])
  })

  // Bug: a frame summary that is not the governor's own numbers, or a ceiling claimed as measured.
  it('summarises the governor\'s windows: median of p50, 95th percentile of p95, observed ceiling', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ p50Ms: 8 + (i % 10) * 0.1, p95Ms: 12 + (i % 20) }))
    expect(frameSummary(points)).toEqual({ medianMs: 8.5, p95Ms: 31, windows: 100, fps: 120 })
    expect(frameSummary([])).toEqual({ medianMs: 0, p95Ms: 0, windows: 0, fps: 0 })
    expect(frameSummary([{ p50Ms: 16.7, p95Ms: 20 }]).fps).toBe(60)
  })

  // Bug: a perf post on every hide (a tab switch loop), or before there is anything to say.
  it('posts perf at most once per page: at the first hide after a minute, or at pagehide', () => {
    const sent: string[] = []
    setReportTransport((b) => { sent.push(b) })
    resetPerfReport()
    const listeners: Record<string, () => void> = {}
    const doc = { visibilityState: 'hidden' as DocumentVisibilityState, addEventListener: (t: string, f: () => void) => { listeners['doc:' + t] = f } }
    const win = { addEventListener: (t: string, f: () => void) => { listeners['win:' + t] = f } }
    let played = 30
    installPerfReporting(() => ({ windows: 1 }), () => played, doc as never, win as never)
    listeners['doc:visibilitychange']()
    expect(sent).toHaveLength(0) // half a minute: too early
    played = 90
    for (let i = 0; i < 50; i++) listeners['doc:visibilitychange']()
    listeners['win:pagehide']()
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]).type).toBe('perf')
    reportPerf({ windows: 1 })
    expect(sent).toHaveLength(1)
  })
})
