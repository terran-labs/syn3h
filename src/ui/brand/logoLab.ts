/**
 * logo.html: the animated logo large, with controls for its look, for tuning on the
 * preview. Not part of the game bundle.
 */
import { DEFAULT_LOGO_OPTIONS, LogoMark, type LogoOptions, logoBox, logoBudget, logoSvg } from './LogoMark'
import { WORDMARK_HEIGHT, WORDMARK_PATH, WORDMARK_WIDTH } from './wordmarkPath'

const stage = document.getElementById('stage')!, controls = document.getElementById('controls')!, stats = document.getElementById('stats')!
const query = new URLSearchParams(location.search)
const level = query.has('level') ? Number(query.get('level')) : 2
// Nothing behind the logo by default, as in the lobby; ?space=1 shows the icon's sky.
const initial: Partial<LogoOptions> = { ...logoBudget(level), space: query.get('space') === '1', seed: Number(query.get('seed') ?? 1) }
if (query.has('particles')) initial.particles = Number(query.get('particles'))
// ?face=12133a: the face colour, as hex without the hash.
if (query.has('face')) initial.face = [0, 2, 4].map(i => parseInt(query.get('face')!.slice(i, i + 2), 16) / 255) as [number, number, number]
if (query.has('still')) initial.still = query.get('still') !== '0'
if (query.has('intro')) initial.intro = query.get('intro') !== '0'
const mark = new LogoMark(stage, initial)
mark.start()

const toHex = (c: readonly number[]) => '#' + c.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
const toRgb = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
function add(label: string, input: HTMLElement): void { const l = document.createElement('label'); l.append(label, input); controls.append(l) }
function range(label: string, key: 'particles' | 'glowWidth' | 'plasmaSize' | 'flowSpeed' | 'glowStrength' | 'timeScale' | 'seed', min: number, max: number, step: number): void {
  const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value: String(mark.options[key]) })
  const out = document.createElement('output'); out.value = String(mark.options[key])
  input.oninput = () => { out.value = input.value; mark.setOptions({ [key]: Number(input.value) }) }
  add(label, input); controls.lastElementChild!.append(out)
}
function colour(label: string, key: 'glow' | 'glowEdge' | 'face'): void {
  const input = Object.assign(document.createElement('input'), { type: 'color', value: toHex(mark.options[key]) })
  input.oninput = () => mark.setOptions({ [key]: toRgb(input.value) }); add(label, input)
}
function toggle(label: string, value: boolean, change: (on: boolean) => void): void {
  const input = Object.assign(document.createElement('input'), { type: 'checkbox', checked: value })
  input.onchange = () => change(input.checked); add(label, input)
}
function button(label: string, click: () => void): void { const b = document.createElement('button'); b.textContent = label; b.onclick = click; controls.append(b) }

range('Seed', 'seed', 1, 50, 1)
range('Reach', 'glowWidth', 0.04, 0.4, 0.005)
range('Particles', 'particles', 0, 1000, 10)
range('Size', 'plasmaSize', 0.03, 0.5, 0.005)
range('Flow', 'flowSpeed', 0, 3, 0.05)
range('Strength', 'glowStrength', 0, 3, 0.05)
range('Speed', 'timeScale', 0, 3, 0.05)
colour('Glow', 'glow'); colour('Edge', 'glowEdge'); colour('Face', 'face')
toggle('Space', mark.options.space, on => mark.setOptions({ space: on }))
toggle('Still', mark.options.still, on => { mark.setOptions({ still: on }); if (!on) mark.start() })
button('Replay fade', () => mark.replayIntro())
button('Reset', () => { mark.setOptions({ ...DEFAULT_LOGO_OPTIONS, ...logoBudget(level) }); location.reload() })

// The SVG wordmark outline drawn over the box, to check that the two line up.
const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
overlay.setAttribute('class', 'overlay'); overlay.setAttribute('viewBox', `0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`)
overlay.innerHTML = `<path fill-rule="evenodd" vector-effect="non-scaling-stroke" d="${WORDMARK_PATH}"/>`
overlay.style.display = 'none'; stage.append(overlay)
function placeOverlay(): void {
  const box = logoBox(stage.clientWidth, stage.clientHeight, 'fit')
  Object.assign(overlay.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` })
}
addEventListener('resize', placeOverlay); placeOverlay()
toggle('SVG outline', false, on => { overlay.style.display = on ? '' : 'none' })
button('Download SVG', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([logoSvg({ ...mark.options, layout: 'card' })], { type: 'image/svg+xml' })); a.download = 'syn3h-logo.svg'; a.click() })

const show = () => { const s = mark.stats; stats.textContent = `level ${level} · generated ${mark.generated} · particles ${s.particles} · triangles ${s.triangles} · draw calls ${s.drawCalls} · canvas ${mark.canvas.width}x${mark.canvas.height}` }
show(); setInterval(show, 1000)
Object.assign(window, { logoLab: { mark, show } })
