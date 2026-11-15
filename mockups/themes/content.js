// Shared mockup content for the three in-game panel themes. Every theme renders exactly this
// markup so the comparison is fair; only the stylesheet differs. Classic script (not a module)
// so it runs from a file:// URL. Mode comes from ?mode=desktop|dark|phone|phone-play.
(function () {
  const mode = new URLSearchParams(location.search).get('mode') || 'desktop'
  document.body.dataset.mode = mode

  // Small stroked icons, drawn on a 24 unit grid.
  const icon = d => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`
  const I = {
    leave: icon('M10 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19H10M14 8l4 4-4 4M18 12H9'),
    search: icon('M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l4.5 4.5'),
    close: icon('M6.5 6.5l11 11M17.5 6.5l-11 11'),
    chev: icon('M7 10l5 5 5-5'),
    down2: icon('M13 7l-5 5 5 5M18 7l-5 5 5 5'),
    up2: icon('M6 7l5 5-5 5M11 7l5 5-5 5'),
    caret: icon('M8 10l4 4 4-4'),
    orbit: icon('M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM4 12c0-2.2 3.6-4 8-4s8 1.8 8 4-3.6 4-8 4c-1.6 0-3.1-.2-4.3-.6M8.6 13.6 7.4 15.4l2 .9'),
    reload: icon('M18.5 12a6.5 6.5 0 1 1-2-4.7M17 3.8v3.8h-3.8'),
  }

  // Side-view vehicle silhouettes on a 72 by 36 grid. The tank carries a sensor dome, not a barrel.
  const glyph = parts => `<svg class="glyph" viewBox="0 0 72 36" aria-hidden="true">${parts}</svg>`
  const V = {
    Buggy: glyph('<path class="b" d="M7 23l5-8 13-2 7-6h12l6 7 11 2 3 7z"/><path class="l" d="M32 7l-2 7M44 7l3 7"/><circle class="w" cx="18" cy="25" r="6.5"/><circle class="w" cx="54" cy="25" r="6.5"/>'),
    Jet: glyph('<path class="b" d="M3 20l17-3 13-10h6l-4 10 23-1 11 3.5-11 3H35l4 9h-6L21 22 3 21z"/><path class="l" d="M50 17.5h8"/>'),
    Hovercraft: glyph('<path class="b" d="M12 19c2-6 9-8 16-8h14c9 0 16 3 18 8z"/><path class="w" d="M6 20h60c-1 5-5 7-10 7H16c-5 0-9-2-10-7z"/><path class="l" d="M14 31h44"/>'),
    Tank: glyph('<path class="b" d="M8 19l6-6h44l6 6z"/><path class="b" d="M26 13c1-5 5-7 10-7s9 2 10 7z"/><rect class="w" x="7" y="19" width="58" height="10" rx="5"/><path class="l" d="M15 24h42"/>'),
  }

  const card = (title, sum, mark, body) => `
    <section class="card${body ? ' open' : ''}">
      <button class="card-head" aria-expanded="${!!body}">
        <i class="mark" data-i="${mark}"></i><h3>${title}</h3>
        <span class="sum">${sum}</span>${I.chev}
      </button>
      ${body ? `<div class="card-body">${body}</div>` : ''}
    </section>`

  // Seeded frame-time trace, so every render shows the same line.
  let seed = 7
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const ms = Array.from({ length: 48 }, (_, i) => 7.4 + rand() * 1.4 + (i === 17 ? 5.2 : 0) + (i === 33 ? 2.6 : 0))
  const W = 300, H = 44, y = v => (H - (v / 24) * H).toFixed(1)
  const pts = ms.map((v, i) => [(i / (ms.length - 1)) * W, y(v)])
  const line = 'M' + pts.map(p => p.join(' ')).join('L')
  const spark = `
    <div class="spark">
      <div class="spark-head"><span class="lbl">Frame time</span><span class="val">7.9 ms<em>126 fps</em></span></div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="s0"/><stop offset="1" class="s1"/></linearGradient></defs>
        <path class="budget" d="M0 ${y(16.7)}H${W}"/>
        <path class="area" d="${line}L${W} ${H}L0 ${H}z" fill="url(#sparkfill)"/>
        <path class="trace" d="${line}"/>
        <circle class="now" cx="${pts.at(-1)[0] - 2}" cy="${pts.at(-1)[1]}" r="2.5"/>
      </svg>
      <span class="budget-lbl">16.7 ms budget</span>
    </div>`

  const slider = (v) => `<div class="slider" style="--v:${v}"><i class="track"></i><i class="fill"></i><i class="thumb"></i></div>`
  const perf = `
    <div class="quality">
      <button class="q-step" aria-label="Lower quality">${I.down2}</button>
      <button class="q-select" aria-haspopup="listbox">
        <span class="q-name">High</span>
        <span class="q-sub">Level 4 of 6</span>
        <span class="pips">${[1, 2, 3, 4, 5, 6].map(n => `<i class="${n <= 4 ? 'on' : ''}"></i>`).join('')}</span>
        <span class="q-caret">${I.caret}</span>
      </button>
      <button class="q-step" aria-label="Raise quality">${I.up2}</button>
    </div>
    <div class="row toggle-row"><span class="lbl">Post effects</span><button class="switch on" role="switch" aria-checked="true"><i></i></button></div>
    <div class="row slider-row"><span class="lbl">Render scale</span>${slider(0.7)}<button class="num">0.85</button></div>
    <div class="row slider-row editing"><span class="lbl">Draw distance</span>${slider(0.42)}<span class="num-edit"><span>2400</span><i class="caret"></i><em>m</em></span></div>
    <div class="row seg-row"><span class="lbl">Shadows</span><div class="seg"><button>Off</button><button class="on">Soft</button><button>Crisp</button></div></div>
    ${spark}`

  const vehicles = `
    <div class="veh">
      <div class="veh-grid">${Object.entries(V).map(([n, g], i) => `<button class="veh-tile${i === 0 ? ' on' : ''}">${g}<span>${n}</span></button>`).join('')}</div>
      <div class="tint">
        <div class="ring" style="--h:205"><i class="knob"></i><button class="chip" aria-label="Body colour, edit"></button></div>
        <div class="tint-targets">
          <button class="tt on"><i style="--c:hsl(205 72% 52%)"></i>Body</button>
          <button class="tt"><i style="--c:hsl(28 95% 60%)"></i>Accent</button>
        </div>
      </div>
    </div>`

  const rail = `
    <aside class="rail">
      <header class="rail-head">
        <button class="leave">${I.leave}<span>Leave world</span></button>
        <label class="search">${I.search}<span class="ph">Find a setting</span><kbd>/</kbd></label>
        <button class="icon close" aria-label="Close panel">${I.close}</button>
      </header>
      <div class="cards">
        ${card('World', 'Volcanic · Vagard III', '01')}
        ${card('Sky &amp; weather', '16:30 · light haze', '02')}
        ${card('Game', 'Tag · 4 bots', '03')}
        ${card('Vehicles', 'Buggy', '04', vehicles)}
        ${card('Performance', 'High · 126 fps', '05', perf)}
        ${card('You', 'Camera, sound, display', '06')}
      </div>
    </aside>`

  const kit = `
    <section class="kit">
      <h4 class="kit-title">In-game buttons</h4>
      <div class="kit-row">
        <button class="btn primary">Join the round</button>
        <button class="btn quiet">Spectate</button>
        <div class="tip-wrap">
          <div class="tooltip"><strong>Recentre camera</strong><span>Press <kbd>C</kbd></span></div>
          <button class="btn icon" aria-label="Recentre camera">${I.orbit}</button>
        </div>
        <button class="tgl on" aria-pressed="true"><i></i>Grapple</button>
        <button class="tgl" aria-pressed="false"><i></i>Plasma Tag</button>
        <div class="rounds"><button class="round"><span>Wings</span></button><button class="round"><span>Brake</span></button></div>
      </div>
    </section>
    <button class="toast"><i class="toast-mark"></i><span>New build available. Press to reload</span>${I.reload}</button>`

  const frame = document.createElement('div')
  frame.className = 'frame'
  frame.innerHTML = mode === 'phone-play' ? kit : rail + (mode === 'phone' ? '' : kit)
  document.body.append(frame)
})()
