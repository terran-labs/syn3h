// Round 2: one holographic-glass family, three variations. Every frame is a full game screen
// with the interface where it really lives; only the variation stylesheet differs.
// Desktop frames show the cursor-free state, when the rail is always open, so the rail has no
// close control there. Touch has no fixed joystick: the phone shows one drag in progress.
// Classic script so it runs from file://. Query: ?mode=desktop|phone-play|phone-sheet&bg=<file url>
(function () {
  const q = new URLSearchParams(location.search)
  const mode = q.get('mode') || 'desktop'
  document.body.dataset.mode = mode
  document.body.dataset.time = q.get('time') || 'day'

  const icon = d => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`
  const I = {
    leave: icon('M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10M14 8l4 4-4 4M18 12H9'),
    search: icon('M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l4.5 4.5'),
    close: icon('M6.5 6.5l11 11M17.5 6.5l-11 11'),
    chev: icon('M7 10l5 5 5-5'),
    down2: icon('M13 7l-5 5 5 5M18 7l-5 5 5 5'),
    up2: icon('M6 7l5 5-5 5M11 7l5 5-5 5'),
    caret: icon('M8 10l4 4 4-4'),
    reload: icon('M18.5 12a6.5 6.5 0 1 1-2-4.7M17 3.8v3.8h-3.8'),
    sliders: icon('M5 7h9M18 7h1M5 17h3M12 17h7M16 4.5v5M10 14.5v5'),
  }
  const glyph = parts => `<svg class="glyph" viewBox="0 0 72 36" aria-hidden="true">${parts}</svg>`
  // Side views. The tank carries a sensor dome, not a barrel.
  const V = {
    Buggy: glyph('<path d="M7 23l5-8 13-2 7-6h12l6 7 11 2 3 7z"/><path d="M32 7l-2 7M44 7l3 7"/><circle cx="18" cy="25" r="6.5"/><circle cx="54" cy="25" r="6.5"/>'),
    Jet: glyph('<path d="M3 20l17-3 13-10h6l-4 10 23-1 11 3.5-11 3H35l4 9h-6L21 22 3 21z"/>'),
    Hovercraft: glyph('<path d="M12 19c2-6 9-8 16-8h14c9 0 16 3 18 8z"/><path d="M6 20h60c-1 5-5 7-10 7H16c-5 0-9-2-10-7z"/><path class="soft" d="M14 31.5h44"/>'),
    Tank: glyph('<path d="M8 19l6-6h44l6 6z"/><path d="M26 13c1-5 5-7 10-7s9 2 10 7z"/><rect x="7" y="19" width="58" height="10" rx="5"/><circle cx="16" cy="24" r="2"/><circle cx="56" cy="24" r="2"/>'),
  }

  const card = (title, sum, body) => `
    <section class="glass card${body ? ' open' : ''}">
      <button class="card-head" aria-expanded="${!!body}"><h3>${title}</h3><span class="sum">${sum}</span>${I.chev}</button>
      ${body ? `<div class="card-body">${body}</div>` : ''}
    </section>`

  // Seeded frame-time trace.
  let seed = 11
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const ms = Array.from({ length: 56 }, (_, i) => 7.3 + rand() * 1.3 + (i === 21 ? 5.4 : 0) + (i === 39 ? 2.4 : 0))
  const W = 300, H = 40, y = v => (H - (v / 24) * H).toFixed(1)
  const pts = ms.map((v, i) => [((i / (ms.length - 1)) * W).toFixed(1), y(v)])
  const line = 'M' + pts.map(p => p.join(' ')).join('L')
  const spark = `
    <div class="spark">
      <div class="spark-head"><span>Frame time</span><span class="val">7.9 ms <em>126 fps</em></span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="sf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s0"/><stop offset="1" class="s1"/></linearGradient></defs>
        <path class="budget" d="M0 ${y(16.7)}H${W}"/>
        <path class="area" d="${line}L${W} ${H}L0 ${H}z" fill="url(#sf)"/>
        <path class="trace" d="${line}"/>
      </svg>
      <span class="budget-lbl">60 fps budget</span>
    </div>`

  const slider = v => `<div class="slider" style="--v:${v}"><i class="track"></i><i class="fill"></i><i class="thumb"></i></div>`
  const perf = `
    <div class="quality">
      <button class="step" aria-label="Lower quality">${I.down2}</button>
      <button class="q-select" aria-haspopup="listbox"><span class="q-name">High</span><span class="q-sub">Level 4 of 6</span><span class="q-caret">${I.caret}</span></button>
      <button class="step" aria-label="Raise quality">${I.up2}</button>
    </div>
    <div class="row tip-anchor"><span class="lbl">Post effects</span><button class="switch on" role="switch" aria-checked="true"><i></i></button>
      <div class="glass tooltip"><i class="nib"></i><strong>Post effects</strong><span>Bloom, colour grading and god rays</span></div></div>
    <div class="row"><span class="lbl">Render scale</span>${slider(0.7)}<button class="num">0.85</button></div>
    <div class="row"><span class="lbl">Draw distance</span>${slider(0.42)}<span class="num editing">2400<i class="caret"></i><em>m</em></span></div>
    <div class="row"><span class="lbl">Shadows</span><div class="seg"><button>Off</button><button class="on">Soft</button><button>Crisp</button></div></div>
    ${spark}`
  const vehicles = `
    <div class="veh">
      <div class="veh-grid">${Object.entries(V).map(([n, g], i) => `<button class="tile${i === 0 ? ' on' : ''}">${g}<span>${n}</span></button>`).join('')}</div>
      <div class="tint">
        <div class="ring" style="--h:205"><i class="knob"></i><button class="chip" aria-label="Edit body colour"></button></div>
        <div class="targets"><button class="tt on"><i style="--c:hsl(205 75% 55%)"></i>Body</button><button class="tt"><i style="--c:hsl(28 95% 60%)"></i>Accent</button></div>
      </div>
    </div>`

  const rail = (open) => `
    <aside class="rail">
      <header class="glass rail-head">
        <button class="pill leave">${I.leave}<span>Leave world</span></button>
        <label class="search">${I.search}<span class="ph">Find a setting</span><kbd>/</kbd></label>
        ${mode === 'phone-sheet' ? `<button class="round-ico" aria-label="Back to the game">${I.close}</button>` : ''}
      </header>
      ${card('World', 'Volcanic · Vagard III')}
      ${card('Sky &amp; weather', '16:30 · light haze')}
      ${card('Game', 'Tag · 4 bots')}
      ${card('Vehicles', 'Buggy · blue', open.includes('veh') && vehicles)}
      ${card('Performance', 'High · 126 fps', perf)}
      ${card('You', 'Camera, sound, display')}
    </aside>`

  // Gear drum: the list wraps, so the active gear sits in the middle.
  const gears = ['Plasma Thunder', 'Chaser', 'Grapple', 'Yoink', 'Plasma Tag']
  const drum = `
    <nav class="gear">
      <div class="glass drum">${gears.map((g, i) => `<button class="g g${i - 2}">${g}</button>`).join('')}</div>
      <div class="glass hint"><span><kbd>Hold click</kbd>Reel in</span><span><kbd>V</kbd>Let out</span><span><kbd>G</kbd>Let go</span></div>
    </nav>`

  // Minimap: generated terrain (contours and lava), the player arrow at its centre.
  const minimap = `
    <div class="glass minimap"><div class="terrain"></div>
      <svg class="mm-over" viewBox="0 0 100 100" aria-hidden="true">
        <path class="contour" d="M18 62c8-14 22-20 34-16s20 2 28-8M14 44c12-6 18-18 32-18s22 6 34 2M26 80c10-8 24-6 34-12s18-14 24-12M40 88c8-4 18-2 26-8"/>
        <path class="lava" d="M60 30c-3 4 1 7-1 11s2 6 0 9"/>
        <path class="me" d="M50 43l5 13-5-3-5 3z"/>
      </svg>
      <span class="north">N</span>
    </div>`

  const readout = `
    <div class="glass readout">
      <div class="speed"><b>30</b><span>mph</span></div>
      <div class="tape"><div class="ticks"></div><span style="--x:-2">SW</span><span style="--x:-1">195</span><span style="--x:0" class="on">S 181°</span><span style="--x:1">165</span><span style="--x:2">SE</span></div>
      <div class="speed alt"><b>9</b><span>m up</span></div>
    </div>`

  const banner = `<button class="glass banner"><i class="dot"></i><span>New build available. Press to reload</span>${I.reload}</button>`

  const touch = `
    <div class="stick"><i class="nub"></i></div><span class="drag-hint">Drag anywhere to drive</span>
    <button class="glass tc tag"><span>Tag</span></button>
    <button class="glass tc wings"><span>Wings</span></button>
    <button class="glass tc brake"><span>Brake</span></button>
    <div class="reel"><button class="glass rp">Reel in</button><button class="glass rp">Let out</button><button class="glass rp">Let go</button></div>
    <button class="glass round-ico open-settings" aria-label="Settings">${I.sliders}</button>`

  const frame = document.createElement('div')
  frame.className = 'frame'
  const bg = q.get('bg')
  if (bg) frame.style.backgroundImage = `url("${bg}")`
  frame.innerHTML = {
    desktop: readout + drum + minimap + banner + rail(['veh']),
    'phone-play': readout + drum + minimap + banner + touch,
    'phone-sheet': rail([]),
  }[mode]
  document.body.append(frame)
})()
