// Shared building blocks for the three HUD layout mockups. Every graphic is generated here
// (SVG paths, seeded noise, CSS); the only bitmap is the clean game capture behind it, read from /tmp.
const Q = new URLSearchParams(location.search)
// Owner rule: panels open or closed is a function of cursor lock, nothing else.
//   desktop: locked (driving, HUD only) | free (Esc: panels open and usable) | paused (second Esc)
//   touch:   drive | menu (one control toggles the floating menu sheet)
export const STATE = Q.get('state') || 'locked'
export const DEVICE = Q.get('device') || 'desktop'     // desktop | portrait | landscape
export const TOUCH = DEVICE !== 'desktop'
export const PAUSED = STATE === 'paused'
export const LOCKED = !TOUCH && (STATE === 'locked' || PAUSED)
export const FREE = !TOUCH && STATE === 'free'
export const MENU = TOUCH && STATE === 'menu'

export const SCENE = Q.get('scene') || 'day'           // day | night

// Rack order chosen by the owner on 15 November 2026. Grapple is shown active in every frame
// so its state-aware hint and its thumb buttons can be judged.
export const GEAR = [
  { key: 'ptag', name: 'Plasma Tag', n: 1 }, { key: 'thunder', name: 'Plasma Thunder', n: 2 },
  { key: 'chaser', name: 'Chaser', n: 3 }, { key: 'grapple', name: 'Grapple', n: 4 }, { key: 'yoink', name: 'Yoink', n: 5 },
]
export const ACTIVE = 3

const P = (d, extra = '') => `<path d="${d}" ${extra}/>`
export const ICON = {
  // a source and widening wavefronts: a signal, not a projectile
  ptag: `<circle cx="6" cy="12" r="2.4" fill="currentColor" stroke="none"/>${P('M10.5 8.2a5.4 5.4 0 0 1 0 7.6')}${P('M14 5.2a9.6 9.6 0 0 1 0 13.6')}${P('M17.6 2.6a13.4 13.4 0 0 1 0 18.8', 'opacity=".55"')}`,
  thunder: `<circle cx="5.5" cy="12" r="2.2" fill="currentColor" stroke="none"/>${P('M9.5 12h2.5l1.8-4 2.4 8 1.8-4H21')}${P('M10 6.5a8 8 0 0 1 3-2M10 17.5a8 8 0 0 0 3 2', 'opacity=".55"')}`,
  chaser: `${P('M3.5 18c3-1 5-4 6.5-7.5S14 4.5 18 4.5')}<circle cx="19" cy="4.8" r="1.9" fill="currentColor" stroke="none"/>${P('M3.5 18h0M7 15.6h0', 'stroke-width="2.6" opacity=".55"')}`,
  grapple: `${P('M3 21 13.5 10.5')}${P('M13.5 10.5c1-3.5 4-5.5 7-5')}${P('M13.5 10.5c3.5-1 5.5-4 5-7')}${P('M13.5 10.5l5.5 5.5', 'opacity=".55"')}<circle cx="13.5" cy="10.5" r="1.6" fill="currentColor" stroke="none"/>`,
  yoink: `${P('M6.5 3.5v8a5.5 5.5 0 0 0 11 0v-8')}${P('M4.5 7h4M15.5 7h4', 'opacity=".6"')}${P('M12 21.5v-2', 'opacity=".55"')}`,
  pester: `<circle cx="6.5" cy="15.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="7.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="17.5" cy="14" r="1.7" fill="currentColor" stroke="none"/>${P('M3.5 12.5a4 4 0 0 1 3-2.5M9 5a4 4 0 0 1 3-1.5M14.5 11a4 4 0 0 1 3-1.2', 'opacity=".55"')}`,
  settings: `${P('M4 7h9M17 7h3M4 17h3M11 17h9')}<circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>`,
  leave: `${P('M13.5 4.5H8a3.5 3.5 0 0 0-3.5 3.5v8A3.5 3.5 0 0 0 8 19.5h5.5')}${P('M11 12h10M17.5 8.5 21 12l-3.5 3.5')}`,
  close: `${P('M6 6l12 12M18 6 6 18')}`,
  chevL: `${P('M14.5 6 8.5 12l6 6')}`, chevR: `${P('M9.5 6l6 6-6 6')}`, chevD: `${P('M6 9.5l6 6 6-6')}`,
  reload: `${P('M19.5 12a7.5 7.5 0 1 1-2.2-5.3')}${P('M19.8 4.2v4.6h-4.6')}`,
  swap: `${P('M5 8.5h13M14.5 5l3.5 3.5-3.5 3.5')}${P('M19 15.5H6M9.5 12 6 15.5 9.5 19')}`,
  search: `<circle cx="10.5" cy="10.5" r="5.5"/>${P('M15 15l5 5')}`,
  link: `${P('M10 14a4 4 0 0 0 5.7 0l3.3-3.3a4 4 0 0 0-5.7-5.7l-1 1')}${P('M14 10a4 4 0 0 0-5.7 0L5 13.3a4 4 0 0 0 5.7 5.7l1-1')}`,
  plus: `${P('M12 5v14M5 12h14')}`, minus: `${P('M5 12h14')}`,
  map: `${P('M4 6.5 9 4.5l6 2.5 5-2v12.5l-5 2-6-2.5-5 2z')}${P('M9 4.5V17M15 7v12.5', 'opacity=".55"')}`,
}
export const icon = (k, size = 24, cls = '') =>
  `<svg class="ico ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`

/** Seeded value noise, for the minimap's generated terrain. */
export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909), (s >>>= 0) / 4294967296)) }

/** Closed organic blob as an SVG path: polar radius modulated by a few low harmonics. */
export function blob(cx, cy, r, wobble, seed, points = 48) {
  const rand = rng(seed); const h = [1, 2, 3, 5].map(k => ({ k, a: (rand() - .5) * wobble / k ** .6, p: rand() * 6.283 }))
  let d = ''
  for (let i = 0; i <= points; i++) {
    const t = i / points * 6.283, rr = r * (1 + h.reduce((s, x) => s + x.a * Math.sin(x.k * t + x.p), 0))
    d += `${i ? 'L' : 'M'}${(cx + rr * Math.cos(t)).toFixed(1)} ${(cy + rr * Math.sin(t)).toFixed(1)}`
  }
  return d + 'Z'
}

export const VW = innerWidth, VH = innerHeight
const f1 = n => n.toFixed(1)
const polar = (cx, cy, r, deg) => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)]
export const arcPath = (cx, cy, r, from, to) => { const [x0, y0] = polar(cx, cy, r, from), [x1, y1] = polar(cx, cy, r, to); return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 0 ${to > from ? 1 : 0} ${f1(x1)} ${f1(y1)}` }

/** Speed and height crescents either side of the view: hairline track, lit portion, marker, tiny numerals. */
export function crescents({ cx = VW / 2, cy = VH / 2, r = 230, span = 30, compact = TOUCH, ends = false } = {}) {
  const side = (left, frac, scale) => {
    const from = left ? 180 - span : span, to = left ? 180 + span : -span     // bottom end to top end
    const at = from + (to - from) * frac
    const [mx, my] = polar(cx, cy, r, at), [ox, oy] = polar(cx, cy, r + (left ? 9 : 9), at)
    const nums = scale.map((n, i) => { const [x, y] = polar(cx, cy, r - 13, from + (to - from) * i / (scale.length - 1)); return `<text x="${f1(x)}" y="${f1(y + 3)}" text-anchor="${left ? 'start' : 'end'}" class="cr-num">${n}</text>` }).join('')
    return `<path class="cr-track" d="${arcPath(cx, cy, r, from, to)}"/>
      <path class="cr-lit" d="${arcPath(cx, cy, r, from, at)}"/>
      <line class="cr-mark" x1="${f1(mx)}" y1="${f1(my)}" x2="${f1(ox)}" y2="${f1(oy)}"/><circle class="cr-dot" cx="${f1(mx)}" cy="${f1(my)}" r="2.6"/>${compact ? '' : nums}`
  }
  const [lx, ly] = polar(cx, cy, r, 180), [rx, ry] = polar(cx, cy, r, 0)
  const svg = `<svg class="crescents" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}" style="left:0;top:0">${side(true, 30 / 140, [0, 70, 140])}${side(false, .06, [0, 300, 600])}</svg>`
  if (ends) {
    const [bx, by] = polar(cx, cy, r, 180 - span), [cx2, cy2] = polar(cx, cy, r, span)
    return svg + `<div class="cr-read" style="left:${f1(bx)}px;top:${f1(by + 30)}px;transform:translate(-50%,-50%);align-items:center"><b>30</b><small>mph</small></div>
    <div class="cr-read" style="left:${f1(cx2)}px;top:${f1(cy2 + 36)}px;transform:translate(-50%,-50%);align-items:center"><small class="hdg">181° S</small><b>9</b><small>m up</small></div>`
  }
  return `${svg}
  <div class="cr-read left" style="right:${f1(VW - lx + (compact ? 12 : 22))}px;top:${f1(ly)}px"><b>30</b><small>mph</small></div>
  <div class="cr-read right" style="left:${f1(rx + (compact ? 12 : 22))}px;top:${f1(ry)}px"><small class="hdg">181° S</small><b>9</b><small>${compact ? 'm up' : 'm above ground'}</small></div>`
}

/**
 * Gear selector as a crescent concentric with the speed arc: gear names ride a hairline rail
 * (dots on the rail, names on the screen side), the active gear in letterspaced capitals with its
 * state-aware hint capsule directly beneath. Matches the themes-3 language.
 */
export function gearCrescent({ cx = VW / 2, cy = VH / 2, r = 620, pitch = 8, labels = 'right', show = 2, hint = '' } = {}) {
  const n = GEAR.length
  const items = []
  for (let d = -show; d <= show; d++) {
    const g = GEAR[(ACTIVE + d + n) % n], [x, y] = polar(cx, cy, r, 180 + d * pitch), a = d === 0
    const op = a ? 1 : Math.max(.3, 1 - Math.abs(d) * .3)
    items.push(`<i class="gc-dot ${a ? 'is-active' : ''}" style="left:${f1(x)}px;top:${f1(y)}px;opacity:${op}"></i>`)
    if (labels !== 'none') items.push(`<button class="gc-item ${a ? 'is-active' : ''}" style="left:${f1(x + 12)}px;top:${f1(y)}px;opacity:${op}">${a ? g.name.toUpperCase() : g.name}</button>`)
    if (a && hint) items.push(`<div class="gc-hint" style="left:${f1(x + 18)}px;top:${f1(y + 26)}px">${hint}</div>`)
  }
  const rail = arcPath(cx, cy, r, 180 - pitch * (show + 1.2), 180 + pitch * (show + 1.2))
  return `<svg class="crescents" width="${VW}" height="${VH}" viewBox="0 0 ${VW} ${VH}" style="left:0;top:0"><defs><linearGradient id="gcfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".3" stop-color="#fff"/><stop offset=".7" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="gcm"><rect x="0" y="${f1(cy - r * Math.sin(pitch * (show + 1.2) * Math.PI / 180))}" width="${VW}" height="${f1(2 * r * Math.sin(pitch * (show + 1.2) * Math.PI / 180))}" fill="url(#gcfade)"/></mask></defs>
    <path class="cr-track" style="stroke:var(--hair)" d="${rail}" mask="url(#gcm)"/></svg>
  ${items.join('')}`
}

/** Hint for the active gear (Grapple): a capsule of key actions, then a quiet switching line. */
export function gearHint() {
  if (TOUCH) return ''
  const cap = LOCKED
    ? `<div class="gh-cap lit pill"><kbd>Hold click</kbd> Reel in <i>·</i> <kbd>V</kbd> Let out <i>·</i> <kbd>G</kbd> Let go</div>`
    : `<div class="gh-cap lit pill"><kbd>Click</kbd> Launch <i>·</i> <kbd>Hold</kbd> Reel in</div>`
  const line = LOCKED ? `<div class="gh-line"><kbd>T</kbd> next gear <i>·</i> <kbd>1</kbd>–<kbd>5</kbd> pick</div>` : `<div class="gh-line">Scroll or drag to switch</div>`
  return cap + line
}
/** Heading-up minimap ring. The world faces 181 degrees, so north sits at the bottom. */
export function minimap(size, style) {
  const r = size / 2, id = 'mm' + size
  const contours = [
    blob(r * .62, r * 1.18, r * .34, .5, 11), blob(r * .62, r * 1.18, r * .22, .45, 12), blob(r * .62, r * 1.18, r * .1, .3, 13),
    blob(r * 1.3, r * .55, r * .28, .7, 21), blob(r * 1.3, r * .55, r * .15, .6, 22),
    blob(r * .45, r * .48, r * .2, .8, 31), blob(r * 1.45, r * 1.42, r * .18, .7, 41),
  ]
  return `<div class="minimap" style="width:${size}px;height:${size}px;${style}"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-label="Minimap" style="overflow:visible">
    <defs><radialGradient id="${id}g"><stop offset="0" stop-color="rgb(4 12 22)" stop-opacity=".84"/><stop offset=".7" stop-color="rgb(4 12 22)" stop-opacity=".8"/><stop offset="1" stop-color="rgb(4 12 22)" stop-opacity=".5"/></radialGradient>
    <clipPath id="${id}c"><circle cx="${r}" cy="${r}" r="${r - 1}"/></clipPath></defs>
    <circle cx="${r}" cy="${r}" r="${r - 1}" fill="url(#${id}g)"/>
    <g clip-path="url(#${id}c)" fill="none" stroke="rgb(180 236 255)" stroke-width=".9">${contours.map((d, i) => `<path d="${d}" stroke-opacity="${[.28, .4, .66, .26, .42, .22, .22][i]}"/>`).join('')}</g>
    <circle cx="${r}" cy="${r}" r="${r - .5}" fill="none" class="ring"/>
    <circle cx="${r * 1.32}" cy="${r * .62}" r="3" fill="#fff"/><circle cx="${r * .5}" cy="${r * .72}" r="3" fill="#fff"/>
    <path d="M${r} ${r - 9} L${r + 6} ${r + 7} L${r} ${r + 3.5} L${r - 6} ${r + 7} Z" fill="#f4fdff"/>
    <text x="${r}" y="${size - 10}" text-anchor="middle" class="mm-n">N</text>
  </svg></div>`
}

export function banner(style = '') {
  const inner = LOCKED
    ? `<span class="bb-dot"></span><span>New build available. Press <kbd>F5</kbd> to reload</span>`
    : `<span class="bb-dot"></span><span><span class="long">New build available. Press to reload</span><span class="short">New build. Tap to reload</span></span>${icon('reload', 16)}`
  return `<div class="build-banner lit pill" style="${style}">${inner}</div>`
}
export const toast = (style = '') => `<div class="toast lit pill" style="${style}"><span class="t-dot"></span>${TOUCH ? 'Paropon joined' : 'Paropon joined the world'}</div>`
export const tagStatus = (style = '') => `<div class="tag-status" style="${style}"><span class="ts-it">You are it</span><span class="ts-time">0:42</span><span class="ts-score"><b>3</b> tags</span></div>`
export const escHint = (style = '') => `<div class="esc" style="${style}"><kbd>Esc</kbd> settings</div>`
export const reticle = () => `<svg class="reticle" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><circle cx="20" cy="20" r="2.4" fill="#fff"/><circle cx="20" cy="20" r="13" fill="none" stroke="rgb(226 238 255 / .7)" stroke-width="1"/></svg>`
export const freeHint = (style = '') => `<div class="free-hint" style="${style}">Click the world to drive</div>`

const TAGS = {
  desktop: [{ x: 520, y: 236, name: 'Bemitek', dist: '640 m' }, { x: 900, y: 250, name: 'Paropon', dist: '1.2 km' }],
  portrait: [{ x: 280, y: 250, name: 'Bemitek', dist: '640 m' }],
  landscape: [{ x: 560, y: 70, name: 'Bemitek', dist: '640 m' }],
}
export const nameTags = (skip = []) => (TAGS[DEVICE] || []).filter((_, i) => !skip.includes(i)).map(t =>
  `<div class="name-tag" style="left:${t.x}px;top:${t.y - 8}px"><span>${t.name}</span><small>${t.dist}</small></div><i class="name-dot" style="left:${t.x}px;top:${t.y}px"></i>`).join('')

export const vehicleSwitch = (style = '', free = !LOCKED) => free
  ? `<div class="vehicle" style="${style}"><button class="btn icon" aria-label="Previous vehicle">${icon('chevL', 18)}</button><span class="v-text"><small>Vehicle</small><b>Syn3h Buggy</b></span><button class="btn icon" aria-label="Next vehicle">${icon('chevR', 18)}</button></div>`
  : `<div class="vehicle" style="${style}"><span class="v-text"><small>Vehicle</small><b>Syn3h Buggy</b></span></div>`

export const SETTINGS = [['World', 'Volcanic · Vagard III'], ['Sky & weather', '16:30 · clear'], ['Game', 'Tag · 4 bots'], ['Vehicles', 'Syn3h Buggy'], ['Performance', 'High · 60 fps'], ['You', 'Zinitor']]
export const settingRows = (list = SETTINGS) => list.map(([t, s]) => `<button class="set-row"><span class="sr-t">${t}</span><span class="sr-s">${s}</span>${icon('chevD', 16)}</button>`).join('')
export const searchRow = () => `<label class="search pill">${icon('search', 16)}<span>Find a setting</span></label>`
export const footRow = (short = false) => `<div class="foot"><button class="btn">${icon('link', 16)} ${short ? 'Copy link' : 'Copy world link'}</button><button class="btn">${icon('leave', 16)} Leave world</button></div>`

/**
 * Light-drawn outline: a rounded rectangle whose chosen sides are one long gentle curve.
 * bow: { left, right, top, bottom } in px (positive bulges outward).
 */
export function outline(w, h, r, bow = {}) {
  const L = bow.left || 0, R = bow.right || 0, T = bow.top || 0, B = bow.bottom || 0
  const d = `M${r} 0 Q${w / 2} ${-T * 2} ${w - r} 0 A${r} ${r} 0 0 1 ${w} ${r} Q${w + R * 2} ${h / 2} ${w} ${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} Q${w / 2} ${h + B * 2} ${r} ${h} A${r} ${r} 0 0 1 0 ${h - r} Q${-L * 2} ${h / 2} 0 ${r} A${r} ${r} 0 0 1 ${r} 0Z`
  return `<svg class="outline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="og${w}${h}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".4" stop-color="#a8ecff" stop-opacity=".35"/><stop offset=".75" stop-color="#a8ecff" stop-opacity=".18"/><stop offset="1" stop-color="#d8f6ff" stop-opacity=".6"/></linearGradient></defs><path d="${d}" stroke="url(#og${w}${h})"/></svg>`
}

export function touchControls(style) {
  return `<div class="touch-buttons" style="${style}">
    <button class="tb tag">${icon('grapple', 20)}<span>TAG</span></button>
    <button class="tb wings">WINGS</button><button class="tb brake">BRAKE</button>
    <button class="tb gx g1">REEL<br>IN</button><button class="tb gx g2">LET<br>OUT</button><button class="tb gx g3">LET<br>GO</button></div>`
}
export function floatingStick(x, y, r = 52) {
  return `<div class="touch-stick" style="left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px"><span class="ts-knob" style="transform:translate(14px,-18px)"></span></div>`
}
export const driveHint = style => `<div class="drive-hint" style="${style}">Drag anywhere to drive</div>`
export const menuButton = style => MENU
  ? `<button class="btn menu-toggle is-on" style="${style}">${icon('close', 18)}<span>Drive</span></button>`
  : `<button class="btn menu-toggle" style="${style}">${icon('settings', 18)}<span>Menu</span></button>`
export const pauseCard = () => `<div class="pause-dim"></div><div class="pause lit pill"><b>Paused.</b> Click to resume</div>`

export function mount(layout, build) {
  const b = document.body
  b.className = `layout-${layout} s-${STATE} d-${DEVICE} scene-${SCENE} ${LOCKED ? 'is-locked' : 'is-free'} ${TOUCH ? 'is-touch' : ''}`
  const src = `file:///tmp/syn3h-mockups/clean-${SCENE}-${{ desktop: 'desktop', portrait: 'phone', landscape: 'landscape' }[DEVICE]}.png`
  b.style.backgroundImage = `url("${src}")`
  b.insertAdjacentHTML('beforeend', `<div class="hud">${build()}</div>`)
  const img = new Image(); img.src = src
  Promise.all([img.decode(), document.fonts.ready]).then(() => { b.dataset.ready = '1' })
}

/** The parts every desktop frame shares: crescents, gear crescent, minimap, reticle, pause. */
export function desktopBase({ freeHintAt = 'centre' } = {}) {
  return `${crescents()}
  ${gearCrescent({ hint: gearHint() })}
  ${minimap(176, 'left:20px;bottom:20px')}
  ${LOCKED ? reticle() : freeHintAt === 'centre' ? freeHint('left:50%;top:50%;transform:translate(-50%,-50%)') : ''}`
}

/**
 * Phone frames. Driving shows the floating stick mid-drag; one Menu control switches to the menu,
 * which arrives the way the layout dictates: sheet = 'right' | 'bottom' | 'centre'.
 */
export function phone({ status, toastAt, sheet = 'right', extra = '', bannerAt } = {}) {
  const port = DEVICE === 'portrait'
  const W = VW, H = VH
  const side = port ? 12 : 44, top = port ? 52 : 12, bot = port ? 24 : 12
  let html = ''
  if (port) {
    const cx = 195, cy = 360
    html += crescents({ cx, cy, r: 118, ends: true })
    html += gearCrescent({ cx, cy, r: 172, pitch: 22, labels: 'none', show: 1 })
    html += `<div class="gc-cap" style="left:31px;top:${cy + 18}px">Grapple</div>`
    html += minimap(112, `left:${side}px;bottom:${bot}px`)
  } else {
    const cx = 422, cy = 190
    html += crescents({ cx, cy, r: 112 })
    html += gearCrescent({ cx, cy, r: 340, pitch: 13, show: 1 })
    html += minimap(92, `left:${side}px;bottom:${bot}px`)
  }
  html += menuButton(`right:${side}px;top:${top}px`)
  html += status
  if (!MENU) html += toast(toastAt)
  html += banner(bannerAt || (port ? 'left:50%;top:478px;transform:translateX(-50%)' : 'left:466px;bottom:12px;transform:translateX(-50%)'))
  html += extra
  if (MENU) html += phoneSheet(sheet)
  else html += (port ? floatingStick(98, 622, 50) + driveHint(`left:${side + 4}px;top:546px`) : floatingStick(282, 322, 42) + driveHint('left:236px;top:258px'))
    + touchControls(`right:${side}px;bottom:${bot}px`)
  return html
}

export function phoneSheet(kind) {
  const port = DEVICE === 'portrait'
  const rows = `<div class="sheet-inner">
    ${vehicleSwitch('justify-content:space-between', true)}
    ${searchRow()}
    <div>${settingRows(SETTINGS.filter(([t]) => t !== 'Vehicles'))}</div>
    ${footRow(true)}</div>`
  const geo = kind === 'right' ? { x: 84, y: 108, w: 294, h: 600, bow: { left: 16 } }
    : kind === 'bottom' ? { x: 12, y: 236, w: 366, h: 584, bow: { top: 16 } }
    : { x: 24, y: 112, w: 342, h: 600, bow: { left: 10, right: 10 } }
  return `<div class="sheet" style="left:${geo.x}px;top:${geo.y}px;width:${geo.w}px;height:${geo.h}px">${outline(geo.w, geo.h, 20, geo.bow)}${rows}</div>`
}
