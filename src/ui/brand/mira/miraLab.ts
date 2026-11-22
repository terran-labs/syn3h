/**
 * mira.html: every Mira candidate large with the lobby's warm glow, white on the galaxy, as
 * an app icon and at favicon sizes, with links to the real lobby drawing it (?mark=N, see
 * activeWordmark.ts). Not part of the game bundle. Everything is drawn from the candidates'
 * paths: no images, no fonts.
 */
import { allCandidates, type Candidate, type MarkPath } from './candidates'

const root = document.getElementById('sheet')!
const query = new URLSearchParams(location.search)
const only = query.get('only')?.split(',').map(Number)

/** A seeded sky like the lobby's: deep blue, a warm sun low in the middle, faint orbits, stars. */
function sky(width: number, height: number, seed: number, sun = true): string {
  let s = (seed * 7919) >>> 0 || 1, stars = ''
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = 0; i < Math.round(width * height / 2600); i++) stars += `<circle cx="${(rand() * width).toFixed(1)}" cy="${(rand() * height).toFixed(1)}" r="${(0.35 + rand() * rand() * 1.6).toFixed(2)}" fill="#d4e0ff" opacity="${(0.25 + rand() * 0.6).toFixed(2)}"/>`
  const id = `s${seed}`
  return `<defs><radialGradient id="${id}bg" cx="50%" cy="62%" r="80%"><stop offset="0" stop-color="#1a1d2e"/><stop offset="0.55" stop-color="#0a0e1c"/><stop offset="1" stop-color="#03050b"/></radialGradient>
<radialGradient id="${id}sun" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#ffe9c4" stop-opacity="0.85"/><stop offset="0.12" stop-color="#ffcf91" stop-opacity="0.35"/><stop offset="0.5" stop-color="#b07a48" stop-opacity="0.08"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
<rect width="${width}" height="${height}" fill="url(#${id}bg)"/>${stars}
${sun ? `<g fill="none" stroke="#9fb0d8" stroke-opacity="0.13"><ellipse cx="${width / 2}" cy="${height * 0.8}" rx="${width * 0.22}" ry="${height * 0.07}"/><ellipse cx="${width / 2}" cy="${height * 0.8}" rx="${width * 0.36}" ry="${height * 0.12}"/><ellipse cx="${width / 2}" cy="${height * 0.8}" rx="${width * 0.52}" ry="${height * 0.18}"/></g>
<ellipse cx="${width / 2}" cy="${height * 0.8}" rx="${width * 0.42}" ry="${height * 0.42}" fill="url(#${id}sun)"/>` : ''}`
}

/** The mark at `box` in a picture: dark face, pale edge and warm glow (as the lobby), or flat white. */
function mark(p: MarkPath, box: { x: number; y: number; w: number; h: number }, look: 'glow' | 'white', id: string): string {
  const k = Math.min(box.w / p.width, box.h / p.height), x = box.x + (box.w - p.width * k) / 2, y = box.y + (box.h - p.height * k) / 2
  if (look === 'white') return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(5)})"><path fill="#fff" fill-rule="evenodd" d="${p.d}"/></g>`
  // The glow measured in the mark's own units: Syn3h's logoSvg filter, scaled to a 178 cap.
  const u = 178 / 226, blur = 226 * 0.06 * u
  return `<defs><filter id="${id}" x="-30%" y="-80%" width="160%" height="260%" color-interpolation-filters="sRGB">
<feMorphology in="SourceAlpha" operator="dilate" radius="${(226 * 0.012 * u).toFixed(2)}" result="grown"/>
<feGaussianBlur in="grown" stdDeviation="${(blur / 3).toFixed(2)}" result="near"/><feGaussianBlur in="grown" stdDeviation="${blur.toFixed(2)}" result="far"/>
<feFlood flood-color="#ffe5c2"/><feComposite in2="near" operator="in" result="nearLit"/><feFlood flood-color="#ffc480"/><feComposite in2="far" operator="in" result="farLit"/>
<feMerge><feMergeNode in="farLit"/><feMergeNode in="farLit"/><feMergeNode in="nearLit"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<clipPath id="${id}c"><path clip-rule="evenodd" d="${p.d}"/></clipPath></defs>
<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(5)})"><g filter="url(#${id})"><path fill="#05070d" fill-rule="evenodd" d="${p.d}"/></g>
<path fill="none" stroke="#ffeed7" stroke-opacity="0.8" stroke-width="${(2.4 / k).toFixed(2)}" clip-path="url(#${id}c)" d="${p.d}"/></g>`
}

/** The square app icon: deep space, the monogram in white with a little warm light under it. */
function appIcon(c: Candidate, size: number, id: string): string {
  const pad = size * 0.2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><radialGradient id="${id}g" cx="50%" cy="58%" r="75%"><stop offset="0" stop-color="#26283c"/><stop offset="0.6" stop-color="#0b0f1e"/><stop offset="1" stop-color="#03050b"/></radialGradient>
<filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceAlpha" stdDeviation="${size * 0.03}"/><feComponentTransfer><feFuncA type="linear" slope="0.8"/></feComponentTransfer><feFlood flood-color="#ffc98a"/><feComposite operator="in" in2="SourceAlpha"/><feGaussianBlur stdDeviation="${size * 0.035}" result="halo"/><feMerge><feMergeNode in="halo"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect width="${size}" height="${size}" fill="url(#${id}g)"/><g filter="url(#${id}f)">${mark(c.mono, { x: pad, y: pad, w: size - 2 * pad, h: size - 2 * pad }, 'white', id)}</g></svg>`
}

/** The favicon: the monogram in white on a dark rounded tile, drawn at exactly `size` pixels. */
function faviconSvg(c: Candidate, size: number): string {
  const pad = size * 0.1
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#0b1020"/>${mark(c.mono, { x: pad, y: pad, w: size - 2 * pad, h: size - 2 * pad }, 'white', 'f')}</svg>`
}
async function pixels(svg: string, size: number, zoom: number): Promise<HTMLCanvasElement> {
  const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  const small = document.createElement('canvas'); small.width = small.height = size
  small.getContext('2d')!.drawImage(image, 0, 0, size, size)
  const big = document.createElement('canvas'); big.width = big.height = size * zoom
  const ctx = big.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.drawImage(small, 0, 0, size * zoom, size * zoom)
  big.className = 'fav'; big.title = `${size} px, enlarged ${zoom} times`
  return big
}

function card(c: Candidate): HTMLElement {
  const el = document.createElement('section'); el.className = 'card'; el.id = `c${c.id}`
  const W = 1200, H = 520
  el.innerHTML = `<h2><span class="n">${c.id}</span>${c.name}</h2><p>${c.note}</p>
<svg class="hero" viewBox="0 0 ${W} ${H}" role="img" aria-label="Candidate ${c.id}, ${c.name}, in the lobby's glow">${sky(W, H, c.id)}${mark(c.word, { x: W * 0.14, y: H * 0.14, w: W * 0.72, h: H * 0.4 }, 'glow', `g${c.id}`)}</svg>
<div class="row">
  <figure><svg class="white" viewBox="0 0 600 300">${sky(600, 300, c.id + 50, false)}${mark(c.word, { x: 70, y: 80, w: 460, h: 140 }, 'white', `w${c.id}`)}</svg><figcaption>White on the galaxy</figcaption></figure>
  <figure class="icon">${appIcon(c, 180, `a${c.id}`).replace('<svg ', '<svg class="app" ')}<figcaption>App icon</figcaption></figure>
  <figure class="favs"><div class="actual"></div><div class="zoom"></div><figcaption>Favicon at 32 and 16 px, actual and enlarged</figcaption></figure>
</div>
<p class="links"><a href="/?mark=${c.id}">See it in the lobby</a><a href="/logo.html?mark=${c.id}">Plasma lab</a></p>`
  const actual = el.querySelector('.actual')!, zoom = el.querySelector('.zoom')!
  for (const size of [32, 16]) {
    const svg = faviconSvg(c, size)
    actual.insertAdjacentHTML('beforeend', svg.replace('<svg ', `<svg class="real" `))
    void pixels(svg, size, size === 16 ? 6 : 3).then(canvas => zoom.append(canvas))
  }
  return el
}

const list = allCandidates().filter(c => !only || only.includes(c.id))
for (const c of list) root.append(card(c))
const bad = list.filter(c => c.problems.length)
if (bad.length) console.warn('Contours cross:', bad.map(c => `${c.id}: ${c.problems.join(' ')}`))
document.body.dataset.ready = '1'
