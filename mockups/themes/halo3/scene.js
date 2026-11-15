// Round 3: three refinements of Halo, drawn in the language of the game's crescent speed and
// altitude arcs (src/ui/inspector/FocusHud.ts, the "Arc" focus style): hairline strokes, small
// numerals, sweeping curves. The variation comes from <body data-v="hairline|crescent|orbit">.
// Desktop frames show the cursor-free state, when the rail is always open, so the rail has no
// close control there. Touch has no fixed joystick: the phone shows one drag in progress.
// Classic script so it runs from file://. Query: ?mode=desktop|phone-play|phone-sheet&bg=<url>
(function () {
  const q = new URLSearchParams(location.search)
  const mode = q.get('mode') || 'desktop'
  const v = document.body.dataset.v
  const phone = mode !== 'desktop'
  document.body.dataset.mode = mode
  const W = phone ? 390 : 1440, H = phone ? 844 : 1000
  const SVG = 'http://www.w3.org/2000/svg'
  const f1 = n => n.toFixed(1)
  const polar = (cx, cy, r, deg) => [cx + Math.cos(deg * Math.PI / 180) * r, cy + Math.sin(deg * Math.PI / 180) * r]
  const arcPath = (cx, cy, r, a, b) => { const [x0, y0] = polar(cx, cy, r, a), [x1, y1] = polar(cx, cy, r, b); return `M${f1(x0)} ${f1(y0)}A${r} ${r} 0 ${Math.abs(b - a) > 180 ? 1 : 0} ${b > a ? 1 : 0} ${f1(x1)} ${f1(y1)}` }

  const icon = d => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`
  const I = {
    leave: icon('M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10M14 8l4 4-4 4M18 12H9'),
    search: icon('M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l4.5 4.5'),
    close: icon('M6.5 6.5l11 11M17.5 6.5l-11 11'),
    chev: icon('M8 10l4 4 4-4'),
    down2: icon('M13 7l-5 5 5 5M18 7l-5 5 5 5'),
    up2: icon('M6 7l5 5-5 5M11 7l5 5-5 5'),
    reload: icon('M18.5 12a6.5 6.5 0 1 1-2-4.7M17 3.8v3.8h-3.8'),
    sliders: icon('M5 7h9M18 7h1M5 17h3M12 17h7M16 4.5v5M10 14.5v5'),
  }
  const glyph = parts => `<svg class="glyph" viewBox="0 0 72 36" aria-hidden="true">${parts}</svg>`
  // Side views. The tank carries a sensor dome, not a barrel.
  const V = {
    Buggy: glyph('<path d="M7 23l5-8 13-2 7-6h12l6 7 11 2 3 7z"/><path d="M32 7l-2 7M44 7l3 7"/><circle cx="18" cy="25" r="6.5"/><circle cx="54" cy="25" r="6.5"/>'),
    Jet: glyph('<path d="M3 20l17-3 13-10h6l-4 10 23-1 11 3.5-11 3H35l4 9h-6L21 22 3 21z"/>'),
    Hovercraft: glyph('<path d="M12 19c2-6 9-8 16-8h14c9 0 16 3 18 8z"/><path d="M6 20h60c-1 5-5 7-10 7H16c-5 0-9-2-10-7z"/><path class="soft" d="M14 31.5h44"/>'),
    Tank: glyph('<path d="M8 19l6-6h44l6 6z"/><path d="M26 13c1-5 5-7 10-7s9 2 10 7z"/><rect x="7" y="19" width="58" height="10" rx="5"/>'),
  }

  // ---------- Rail ----------
  const card = (title, sum, body) => `
    <section class="card${body ? ' open' : ''}">
      <button class="card-head cv" aria-expanded="${!!body}"><i class="node"></i><h3>${title}</h3><span class="sum">${sum}</span>${I.chev}</button>
      ${body ? `<div class="card-body">${body}</div>` : ''}
    </section>`
  let seed = 11
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const ms = Array.from({ length: 56 }, (_, i) => 7.3 + rand() * 1.3 + (i === 21 ? 5.4 : 0) + (i === 39 ? 2.4 : 0))
  const SW = 300, SH = 34, sy = m => f1(SH - (m / 24) * SH)
  const trace = 'M' + ms.map((m, i) => `${f1((i / (ms.length - 1)) * SW)} ${sy(m)}`).join('L')
  const spark = `
    <div class="spark cv">
      <div class="spark-head"><span class="micro">Frame time</span><span class="val">7.9 ms <em>126 fps</em></span></div>
      <svg viewBox="0 0 ${SW} ${SH}" preserveAspectRatio="none" aria-hidden="true"><path class="budget" d="M0 ${sy(16.7)}H${SW}"/><path class="trace" d="${trace}"/></svg>
    </div>`
  const slider = val => `<div class="slider" style="--v:${val}"><i class="track"></i><i class="fill"></i><i class="thumb"></i></div>`
  const quality = (v === 'hairline')
    ? `<div class="quality cv"><button class="step" aria-label="Lower quality">${I.down2}</button>
        <button class="q-select"><span class="q-name">High</span><span class="q-sub">Level 4 of 6</span></button>
        <button class="step" aria-label="Raise quality">${I.up2}</button></div>`
    : `<div class="quality gauge cv"><svg class="gauge-svg" aria-hidden="true"></svg>
        <button class="step down" aria-label="Lower quality">${I.down2}</button>
        <button class="q-select"><span class="q-name">High</span><span class="q-sub">Level 4 of 6</span></button>
        <button class="step up" aria-label="Raise quality">${I.up2}</button></div>`
  const perf = `${quality}
    <div class="row cv tip-row"><span class="lbl">Post effects</span><button class="switch on" role="switch" aria-checked="true"><i></i></button>
</div>
    <div class="row cv"><span class="lbl">Render scale</span>${slider(0.7)}<button class="num">0.85</button></div>
    <div class="row cv"><span class="lbl">Draw distance</span>${slider(0.42)}<span class="num editing">2400<i class="caret"></i><em>m</em></span></div>
    <div class="row cv"><span class="lbl">Shadows</span><div class="seg"><button>Off</button><button class="on">Soft</button><button>Crisp</button></div></div>
    ${spark}`
  const vehicles = `
    <div class="veh cv">
      <div class="veh-grid">${Object.entries(V).map(([n, g], i) => `<button class="tile${i === 0 ? ' on' : ''}">${g}<span>${n}</span></button>`).join('')}</div>
      <div class="tint">
        <div class="ring" style="--h:205"><i class="knob"></i><button class="chip" aria-label="Edit body colour"></button></div>
        <div class="targets"><button class="tt on"><i style="--c:hsl(205 75% 58%)"></i>Body</button><button class="tt"><i style="--c:hsl(28 95% 62%)"></i>Accent</button></div>
      </div>
    </div>`
  const rail = (withVehicles) => `
    <aside class="rail"><svg class="rail-svg" aria-hidden="true"></svg>
      <header class="rail-head cv">
        <button class="leave">${I.leave}<span>Leave world</span></button>
        <label class="search">${I.search}<span class="ph">Find a setting</span><kbd>/</kbd></label>
        ${mode === 'phone-sheet' ? `<button class="close" aria-label="Back to the game">${I.close}</button>` : ''}
      </header>
      ${card('World', 'Volcanic · Vagard III')}
      ${card('Sky &amp; weather', '16:30 · light haze')}
      ${card('Game', 'Tag · 4 bots')}
      ${card('Vehicles', 'Buggy · blue', withVehicles && vehicles)}
      ${card('Performance', 'High · 126 fps', perf)}
      ${card('You', 'Camera, sound, display')}
    </aside>`

  // ---------- HUD ----------
  const gears = ['Plasma Thunder', 'Chaser', 'Grapple', 'Yoink', 'Plasma Tag']
  const gear = `<nav class="gear">${gears.map((g, i) => `<button class="g" data-k="${i - 2}"><i></i><span>${g}</span></button>`).join('')}
    ${phone ? '' : `<div class="hint"><span><kbd>Hold click</kbd>Reel in</span><span><kbd>V</kbd>Let out</span><span><kbd>G</kbd>Let go</span></div>`}</nav>`
  const readouts = `
    <div class="fh speed"><b>30</b><small>mph</small></div>
    <div class="fh alt"><small class="hdg">181° S</small><b>9</b><small>m up</small></div>`
  const minimap = `
    <div class="minimap"><div class="terrain"></div>
      <svg class="mm" viewBox="0 0 100 100" aria-hidden="true">
        <path class="contour" d="M18 62c8-14 22-20 34-16s20 2 28-8M14 44c12-6 18-18 32-18s22 6 34 2M26 80c10-8 24-6 34-12s18-14 24-12"/>
        <path class="lava" d="M60 30c-3 4 1 7-1 11s2 6 0 9"/>
        <path class="me" d="M50 43l5 13-5-3-5 3z"/>
        <circle class="rim" cx="50" cy="50" r="49.3"/>
        <path class="heading" d="${arcPath(50, 50, 49.3, 252, 288)}"/>
      </svg><span class="north">N</span>
      ${phone ? '' : `<div class="tooltip"><i class="nib"></i><strong>Map</strong><span>Press M to open the full map</span></div>`}</div>`
  const banner = `<button class="banner"><i class="dot"></i><span>New build available. Press to reload</span>${I.reload}</button>`
  const touch = `
    <div class="stick"><i class="nub"></i></div><span class="drag-hint">Drag anywhere to drive</span>
    <div class="reel"><button class="rp">Reel in</button><button class="rp">Let out</button><button class="rp">Let go</button></div>
    <button class="tc wings"><span>Wings</span></button><button class="tc brake"><span>Brake</span></button><button class="tc tag"><span>Tag</span></button>
    <button class="open-settings" aria-label="Settings">${I.sliders}</button>`

  const frame = document.createElement('div')
  frame.className = 'frame'
  const bg = q.get('bg')
  if (bg) frame.style.backgroundImage = `url("${bg}")`
  const hudSvg = `<svg class="hud" viewBox="0 0 ${W} ${H}" aria-hidden="true"></svg>`
  frame.innerHTML = {
    desktop: hudSvg + readouts + gear + minimap + banner + rail(true),
    'phone-play': hudSvg + readouts + gear + minimap + banner + touch,
    'phone-sheet': rail(false),
  }[mode]
  document.body.append(frame)

  const el = (tag, attrs, parent) => { const n = document.createElementNS(SVG, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent.append(n); return n }
  const at = (node, x, y) => { node.style.left = f1(x) + 'px'; node.style.top = f1(y) + 'px' }

  function drawHud() {
    const svg = frame.querySelector('.hud'); if (!svg) return
    // Crescents: the game's geometry (radius 210 in a 1600 by 900 slice), scaled to the frame.
    const cx = W / 2, cy = phone ? 470 : H / 2, R = phone ? 118 : 233
    const defs = el('defs', {}, svg)
    const fade = el('linearGradient', { id: 'fadeY', x1: 0, y1: 0, x2: 0, y2: 1 }, defs)
    for (const [o, a] of [[0, 0], [.25, 1], [.75, 1], [1, 0]]) el('stop', { offset: o, 'stop-color': 'currentColor', 'stop-opacity': a }, fade)
    el('path', { class: 'faint', d: arcPath(cx, cy, R, 150, 210) }, svg)
    el('path', { class: 'faint', d: arcPath(cx, cy, R, 30, -30) }, svg)
    // Speed fills upward from the bottom of the left arc: 30 of 140 mph.
    const sEnd = 150 + 60 * (30 / 140), aEnd = 30 - 60 * Math.max(.04, 9 / 600)
    el('path', { class: 'lit', d: arcPath(cx, cy, R, 150, sEnd) }, svg)
    el('path', { class: 'lit', d: arcPath(cx, cy, R, 30, aEnd) }, svg)
    for (const a of [sEnd, aEnd]) { const [x, y] = polar(cx, cy, R, a); el('circle', { class: 'mark', cx: f1(x), cy: f1(y), r: 2.4 }, svg) }
    // Hairline ticks at the ends and middle of each arc, as on an instrument.
    for (const a of [150, 180, 210, 30, 0, -30]) { const [x0, y0] = polar(cx, cy, R - 5, a), [x1, y1] = polar(cx, cy, R + 5, a); el('path', { class: 'tick', d: `M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}` }, svg) }
    el('circle', { class: 'reticle', cx, cy: phone ? cy : cy, r: 2 }, svg)
    at(frame.querySelector('.fh.speed'), cx - R - 18, cy); at(frame.querySelector('.fh.alt'), cx + R + 18, cy)

    // Gear selector: a crescent concentric with the speed arc, items along it, active in the middle.
    const gR = phone ? 380 : 620, gcx = phone ? 420 : cx, gcy = phone ? 262 : cy, step = phone ? 9.5 : 8
    el('path', { class: 'gear-arc', d: arcPath(gcx, gcy, gR, 180 - step * 2.6, 180 + step * 2.6), stroke: 'url(#fadeY)' }, svg)
    el('path', { class: 'gear-lit', d: arcPath(gcx, gcy, gR, 180 - step * .3, 180 + step * .3) }, svg)
    for (const b of frame.querySelectorAll('.gear .g')) {
      const k = +b.dataset.k, [x, y] = polar(gcx, gcy, gR, 180 - k * step)
      at(b, x - 6, y)
      el('circle', { class: k ? 'g-dot' : 'g-dot on', cx: f1(x), cy: f1(y), r: k ? 1.8 : 3 }, svg)
    }
    const hint = frame.querySelector('.gear .hint'); if (hint) { const [x, y] = polar(gcx, gcy, gR, 180); at(hint, x + 18, y + 22) }
  }

  // Panel chrome per variation, drawn after layout so it fits the real boxes.
  function drawRail() {
    const rail = frame.querySelector('.rail'); if (!rail) return
    const svg = rail.querySelector('.rail-svg'), rr = rail.getBoundingClientRect()
    const w = rr.width, h = rr.height
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    const box = n => { const b = n.getBoundingClientRect(); return { x: b.left - rr.left, y: b.top - rr.top, w: b.width, h: b.height } }
    if (v === 'crescent') {
      // One continuous hairline: rounded right corners and a long, gently bowed left edge.
      const r = 18, bow = phone ? 10 : 18
      el('path', { class: 'outline', d: `M${r} .5H${w - r}A${r} ${r} 0 0 1 ${w - .5} ${r}V${h - r}A${r} ${r} 0 0 1 ${w - r} ${h - .5}H${r}A${r} ${r} 0 0 1 ${bow * .3} ${h - r}Q${-bow * 1.7} ${h / 2} ${bow * .3} ${r}A${r} ${r} 0 0 1 ${r} .5Z` }, svg)
      // Shallow arcs between cards, sagging toward the middle.
      for (const c of rail.querySelectorAll('.card')) { const b = box(c); el('path', { class: 'divider', d: `M${phone ? 22 : 30} ${f1(b.y)}Q${w / 2} ${f1(b.y + 7)} ${w - 22} ${f1(b.y)}`, stroke: 'url(#fadeX)' }, svg) }
    }
    if (v === 'orbit') {
      // Rows follow one sweeping curve that echoes the altitude arc: furthest right at mid-height.
      const top = rr.top, mid = phone ? 422 : 500, inset = phone ? 26 : 92, span = phone ? 430 : 500
      const Rc = (span * span + inset * inset) / (2 * inset)
      const curve = y => inset - (Rc - Math.sqrt(Math.max(0, Rc * Rc - (y - mid) ** 2)))
      for (const n of rail.querySelectorAll('.cv')) { const b = n.getBoundingClientRect(), m = f1(Math.max(0, curve(b.top + b.height / 2))); n.style.marginLeft = m + 'px'; n.style.width = `calc(100% - ${m}px)` }
      // The spine: a hairline along the curve, a node at each card.
      const pts = []; for (let y = 0; y <= h; y += 8) pts.push(`${f1(Math.max(0, curve(y + top)) + (phone ? 8 : 10))} ${y}`)
      el('path', { class: 'spine', d: 'M' + pts.join('L'), stroke: 'url(#fadeY2)' }, svg)
      for (const n of rail.querySelectorAll('.card-head .node')) n.remove()
      for (const c of rail.querySelectorAll('.card')) { const hd = c.querySelector('.card-head'), b = box(hd); const y = b.y + b.h / 2; el('circle', { class: c.classList.contains('open') ? 'node on' : 'node', cx: f1(Math.max(0, curve(y + top)) + (phone ? 8 : 10)), cy: f1(y), r: c.classList.contains('open') ? 3 : 2 }, svg) }
    }
    if (v === 'hairline') {
      el('rect', { class: 'outline', x: .5, y: .5, width: w - 1, height: h - 1, rx: 18 }, svg)
      for (const c of [...rail.querySelectorAll('.card')]) { const b = box(c); el('path', { class: 'divider', d: `M24 ${f1(b.y)}H${w - 24}`, stroke: 'url(#fadeX)' }, svg) }
    }
    const defs = el('defs', {}, svg); svg.prepend(defs)
    const gx = el('linearGradient', { id: 'fadeX', x1: 0, y1: 0, x2: 1, y2: 0 }, defs)
    for (const [o, a] of [[0, 0], [.3, 1], [.7, 1], [1, 0]]) el('stop', { offset: o, 'stop-color': 'currentColor', 'stop-opacity': a }, gx)
    const gy = el('linearGradient', { id: 'fadeY2', x1: 0, y1: 0, x2: 0, y2: 1 }, defs)
    for (const [o, a] of [[0, 0], [.12, 1], [.88, 1], [1, 0]]) el('stop', { offset: o, 'stop-color': 'currentColor', 'stop-opacity': a }, gy)
    // Quality as an arc gauge: six ticks, four lit, chevrons at the ends.
    const gauge = rail.querySelector('.gauge-svg')
    if (gauge) {
      const g = gauge.getBoundingClientRect(), gw = g.width, gh = g.height
      gauge.setAttribute('viewBox', `0 0 ${gw} ${gh}`)
      const R = gw * .62, ccx = gw / 2, ccy = R + 14, half = Math.asin((gw / 2 - 44) / R) * 180 / Math.PI
      el('path', { class: 'g-faint', d: arcPath(ccx, ccy, R, -90 - half, -90 + half) }, gauge)
      const ticks = 6, a = i => -90 - half * .82 + (i / (ticks - 1)) * half * 1.64
      el('path', { class: 'g-lit', d: arcPath(ccx, ccy, R, -90 - half * .82, a(3)) }, gauge)
      for (let i = 0; i < ticks; i++) { const [x0, y0] = polar(ccx, ccy, R - 4, a(i)), [x1, y1] = polar(ccx, ccy, R + 4, a(i)); el('path', { class: i <= 3 ? 'g-tick on' : 'g-tick', d: `M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}` }, gauge) }
      const [mx, my] = polar(ccx, ccy, R, a(3)); el('circle', { class: 'g-mark', cx: f1(mx), cy: f1(my), r: 3 }, gauge)
    }
  }

  document.fonts.ready.then(() => {
    drawHud(); drawRail()
    // Orbit shifts rows sideways, which can move nothing vertically; one pass is enough.
    document.body.dataset.ready = '1'
  })
})()
