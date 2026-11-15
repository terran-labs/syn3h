/**
 * Traces the Syn3h wordmark out of the legacy logo bitmap into one SVG path, so the lobby
 * can draw the logo as a vector and colour, light and animate it in CSS. Run once; the
 * output is committed. The legacy bitmap bakes in a 2010 star and glow, so the letters are
 * found as "opaque and dark", then contoured with marching squares at sub-pixel precision
 * and simplified.
 *
 *   node tools/brand/trace-logo.mjs /path/to/original-syn3h.png src/ui/brand/wordmarkPath.ts
 *
 * Needs ffmpeg to decode the PNG. No other dependencies.
 */
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [input, output] = process.argv.slice(2)
const W = 1024, H = 512
const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', input, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: W * H * 4 + 1024 })

// Field: 1 inside a letter, 0 outside, with a soft ramp so the contour lands between pixels.
const ramp = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
const field = new Float32Array((W + 2) * (H + 2))
const at = (x, y) => field[(y + 1) * (W + 2) + x + 1]
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4, bright = Math.max(raw[i], raw[i + 1], raw[i + 2])
  field[(y + 1) * (W + 2) + x + 1] = ramp(raw[i + 3], 120, 230) * (1 - ramp(bright, 70, 130))
}

// Marching squares. Each segment joins two cell edges; loops are found by following edges.
const ISO = 0.5
const point = (kind, x, y) => {
  const a = at(x, y), b = kind === 'h' ? at(x + 1, y) : at(x, y + 1), t = Math.abs(b - a) < 1e-6 ? 0.5 : (ISO - a) / (b - a)
  return kind === 'h' ? [x + t, y] : [x, y + t]
}
const SEGMENTS = { 1: ['LB'], 2: ['BR'], 3: ['LR'], 4: ['TR'], 5: ['TL', 'BR'], 6: ['TB'], 7: ['TL'], 8: ['TL'], 9: ['TB'], 10: ['TR', 'LB'], 11: ['TR'], 12: ['LR'], 13: ['BR'], 14: ['LB'] }
const links = new Map()
const link = (a, b) => { for (const [p, q] of [[a, b], [b, a]]) { if (!links.has(p)) links.set(p, []); links.get(p).push(q) } }
for (let y = -1; y < H; y++) for (let x = -1; x < W; x++) {
  const index = (at(x, y) > ISO ? 8 : 0) | (at(x + 1, y) > ISO ? 4 : 0) | (at(x + 1, y + 1) > ISO ? 2 : 0) | (at(x, y + 1) > ISO ? 1 : 0)
  const edge = { T: `h,${x},${y}`, B: `h,${x},${y + 1}`, L: `v,${x},${y}`, R: `v,${x + 1},${y}` }
  for (const pair of SEGMENTS[index] ?? []) link(edge[pair[0]], edge[pair[1]])
}
const loops = [], seen = new Set()
for (const start of links.keys()) {
  if (seen.has(start)) continue
  const loop = []; let previous = null, current = start
  while (current && !seen.has(current)) {
    seen.add(current)
    const [kind, x, y] = current.split(','); loop.push(point(kind, Number(x), Number(y)))
    const next = links.get(current).find(k => k !== previous && !seen.has(k))
    previous = current; current = next
  }
  if (loop.length > 8) loops.push(loop)
}

// Douglas-Peucker on each closed loop, split at its two most distant points.
const simplify = (pts, eps) => {
  if (pts.length < 3) return pts
  const [a, b] = [pts[0], pts[pts.length - 1]], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1
  let worst = 0, index = 0
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i][0] - a[0]) * dy - (pts[i][1] - a[1]) * dx) / len; if (d > worst) { worst = d; index = i } }
  return worst <= eps ? [a, b] : [...simplify(pts.slice(0, index + 1), eps).slice(0, -1), ...simplify(pts.slice(index), eps)]
}
const area = pts => Math.abs(pts.reduce((sum, p, i) => { const q = pts[(i + 1) % pts.length]; return sum + p[0] * q[1] - q[0] * p[1] }, 0) / 2)
const EPS = 0.45
const kept = loops.filter(loop => area(loop) > 14).map(loop => {
  let far = 0, best = 0
  for (let i = 1; i < loop.length; i++) { const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]); if (d > best) { best = d; far = i } }
  return [...simplify(loop.slice(0, far + 1), EPS).slice(0, -1), ...simplify([...loop.slice(far), loop[0]], EPS).slice(0, -1)]
})
// Crop to the letters, with the origin at their top left.
const xs = kept.flat().map(p => p[0]), ys = kept.flat().map(p => p[1])
const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
const n = v => String(Math.round(v * 10) / 10)
const d = kept.map(loop => 'M' + loop.map(p => `${n(p[0] - x0)} ${n(p[1] - y0)}`).join('L') + 'Z').join('')
const width = Math.ceil(x1 - x0), height = Math.ceil(y1 - y0)
writeFileSync(output, `/**
 * The Syn3h wordmark as one vector path (fill-rule evenodd), traced from the legacy logo
 * bitmap by tools/brand/trace-logo.mjs. Generated: edit the tool, not this file.
 */
export const WORDMARK_WIDTH = ${width}
export const WORDMARK_HEIGHT = ${height}
export const WORDMARK_PATH = '${d}'
`)
console.log(JSON.stringify({ loops: kept.length, points: kept.reduce((s, l) => s + l.length, 0), width, height, bytes: d.length }))
