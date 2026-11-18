/**
 * Welcome: the guide a first-time visitor reads (it was About; players see it as Welcome). This module owns everything
 * inside the panel; the panel itself (its shell, title, close control and motion) belongs to
 * whoever hosts it: the lobby sheet (LobbySheet.ts) or the in-play guide (Shell.ts).
 *
 * The contract with the host, agreed with the lobby shell's builder on 17 November 2026:
 *   - mountWelcome(body, ...) fills `body` and adds the class `welcome-body`. It requests
 *     nothing. opened() starts the pictures; call it each time the player deliberately opens
 *     the panel. fillWelcome(body) does both, for a host that fills on its first open.
 *   - The rows (headings, paragraphs, figures, lists, a few grids) are direct children of the
 *     body, so a host may style or transform `.welcome-body > *`. No row transforms itself.
 *   - Headings start at h3, under the host's own h2. Colours come from the --s3-* tokens.
 *   - The host owns padding, height, scrolling, focus and closing.
 *
 * The pictures are the owner's one exception to "no images in ordinary play" (AGENTS.md):
 * curated About pictures, fetched only after the player opens this panel. Until opened() runs
 * no <img> here has a src, so the browser has nothing to fetch; tests/ui/welcome-images.mjs
 * counts the requests. Everything else (key caps, the gear marks, the touch layout) is drawn
 * here in HTML, CSS and SVG.
 */
import { aboutLinksHtml, licencesHtml } from '../data/credits'
import { frozenResourceURL } from '../../core/frozenResources'
import { GEAR_DESCRIPTIONS, GEAR_LABELS } from '../../weapons/Gear'
import { WELCOME_SHOTS, type WelcomeShot } from './shots.generated'
import './welcome.css'

export type WelcomeWhere = 'lobby' | 'play'
export interface WelcomeOptions { signal?: AbortSignal; where?: WelcomeWhere; labelledBy?: string }
export interface Welcome { opened(): void }

const shot = (id: string): WelcomeShot => {
  const found = WELCOME_SHOTS.find(s => s.id === id)
  if (!found) throw new Error(`no Welcome picture ${id}`)
  return found
}
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * A picture with no src yet. The 16:9 box and the picture's average colour hold its place,
 * so nothing moves when it arrives. `sizes` is the width it is drawn at.
 */
function figure(id: string, caption: string, sizes: string, className = ''): string {
  // The fallback src is the 1280 px file; any browser that reads srcset picks for itself.
  const s = shot(id), largest = s.files[s.files.length - 1]!, fallback = s.files.find(f => f.width === 1280) ?? largest
  const srcset = s.files.map(f => `${f.url} ${f.width}w`).join(', ')
  return `<figure class="welcome-shot${className ? ` ${className}` : ''}" style="--shot-colour:${s.colour}"><img alt="${escape(s.alt)}" width="${largest.width}" height="${Math.round(largest.width * s.height / s.width)}" decoding="async" loading="lazy" data-src="${fallback.url}" data-srcset="${srcset}" data-sizes="${sizes}"><figcaption>${caption}</figcaption></figure>`
}

/**
 * How wide each picture is drawn, so the browser fetches the right file (srcset in figure()).
 * The in-play guide is about 1150 CSS px wide on a large desktop, the lobby sheet up to 880.
 * Phones, upright or on their side (max-height 500px), are told a smaller width than they draw,
 * so every phone fetches the 960 px files: about 180 KB for the six, inside the Foreman's
 * 200 KB budget for a phone, at a little under two device pixels per CSS pixel on its side.
 */
const FULL = '(max-width: 699px) and (min-resolution: 2.5dppx) 66vw, (max-width: 699px) 100vw, (max-height: 500px) and (min-resolution: 2.5dppx) 320px, (max-height: 500px) 480px, (min-width: 1280px) 1150px, 90vw'
const PAIR = '(max-width: 519px) and (min-resolution: 2.5dppx) 66vw, (max-width: 519px) 100vw, (max-width: 699px) 50vw, (max-height: 500px) and (min-resolution: 2.5dppx) 160px, (max-height: 500px) 240px, (min-width: 1280px) 565px, 45vw'
const k = (key: string, label = key) => `<kbd aria-label="${escape(label)}">${escape(key)}</kbd>`

/** The five pieces of gear, each with a mark drawn in SVG. Order as the gear rack shows them. */
const GEAR_MARKS: Record<keyof typeof GEAR_LABELS, string> = {
  beam: '<path d="M3 12h11"/><path d="M14 8l6 4-6 4"/><circle cx="3" cy="12" r="1.6"/>',
  bungee: '<circle cx="18" cy="6" r="2.4"/><path d="M16.3 7.7C12 12 9 9 6 14s1 7 3 4"/>',
  yoink: '<path d="M12 3v7"/><path d="M8 7l4 3 4-3"/><rect x="6" y="14" width="12" height="6" rx="2"/>',
  red: '<circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="12" r="6" opacity=".6"/><circle cx="12" cy="12" r="9.5" opacity=".3"/>',
  pester: '<circle cx="7" cy="9" r="1.8"/><circle cx="11" cy="6" r="1.3"/><circle cx="10" cy="12" r="1.5"/><path d="M13 12h4"/><path d="M15 9l4 3-4 3"/>',
}
const gearList = (Object.keys(GEAR_LABELS) as (keyof typeof GEAR_LABELS)[]).map(id => `<li><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${GEAR_MARKS[id]}</svg><div><strong>${escape(GEAR_LABELS[id])}</strong><span>${escape(GEAR_DESCRIPTIONS[id])}</span></div></li>`).join('')

/**
 * A phone on its side with the touch controls where the game puts them (TouchControls.ts and
 * touch-stick.css, as of v26.11.1712): the gear rack top left, the minimap lower left, the
 * stick wherever the left thumb lands, the four buttons lower right and the Panels tab on the
 * right edge. Drawn in SVG at the phone's own 844 x 390 points, the buttons a little larger.
 */
const touchDiagram = `<svg class="welcome-touch" viewBox="0 0 844 390" role="img" aria-labelledby="welcome-touch-title"><title id="welcome-touch-title">A phone on its side. Top left: the gear rack. Lower left: the minimap. Anywhere on the left half: put your thumb down to drive. Right half: drag to look round. Lower right: TAG and WINGS above ZORB and BRAKE. Right edge: the Panels tab.</title>
  <rect x="3" y="3" width="838" height="384" rx="48" class="wt-frame"/>
  <rect x="34" y="22" width="190" height="64" rx="14" class="wt-tab"/><text x="129" y="54" class="wt-name">GEAR RACK</text>
  <circle cx="82" cy="318" r="46" class="wt-tab"/><text x="82" y="318" class="wt-name">MAP</text>
  <circle cx="290" cy="250" r="66" class="wt-stick"/><circle cx="310" cy="232" r="28" class="wt-knob"/>
  <text x="250" y="160" class="wt-note">left half: drive</text>
  <text x="610" y="160" class="wt-note">right half: look</text>
  <g class="wt-buttons"><circle cx="672" cy="250" r="34" class="wt-tag"/><circle cx="752" cy="250" r="34"/><circle cx="672" cy="330" r="34"/><circle cx="752" cy="330" r="34"/></g>
  <g class="wt-labels"><text x="672" y="250">TAG</text><text x="752" y="250">WINGS</text><text x="672" y="330">ZORB</text><text x="752" y="330">BRAKE</text></g>
  <rect x="800" y="120" width="26" height="100" rx="13" class="wt-tab"/>
</svg>`

/** The page. Every top-level element is one row (see the contract above). */
function html(where: WelcomeWhere): string {
  const enter = where === 'play' ? 'You are already on one. Back in the galaxy, each planet is its own world' : 'Tap a planet in the galaxy and you drop straight in'
  return `
<p class="welcome-lede">Syn3h is a sci-fi playground of small worlds. Drive them, fly over them and wander them with friends, right here in the browser.</p>
${figure('wings-glide', 'Off a Badlands ridge on the buggy’s force-field wings.', FULL, 'welcome-hero')}
<h3>Start in three moves</h3>
<ol class="welcome-steps">
  <li><strong>Pick a planet.</strong> ${enter}: volcanoes, lagoons, badlands, a mire and more.</li>
  <li><strong>Drive.</strong> ${k('W')}${k('A')}${k('S')}${k('D')} or the arrow keys on a computer, your left thumb on a phone. Everything else can wait.</li>
  <li><strong>Bring a friend.</strong> ${where === 'play' ? 'Press' : 'In a world, press'} ${k('J')} or <em>Invite players</em> for a link and a QR code. Whoever opens it lands in your world. No accounts.</li>
</ol>
<h3>Three machines</h3>
<ul class="welcome-cards">
  <li><strong>Buggy</strong><span>Grips rough ground and climbs anything sensible. At a crest, ${k('Space')} unfolds force-field wings and the drop becomes a glide.</span></li>
  <li><strong>Jet</strong><span>Lifts off on its own thrust, hovers or flies, and climbs until the whole planet curls up beneath you.</span></li>
  <li><strong>Hovercraft</strong><span>Rides a cushion of air over sand, water and lava alike. The shortest way across a lagoon.</span></li>
</ul>
<p>Switch machines from the panels whenever you like. On any of them, ${k('X')} closes a Zorb ball around you: roll it, bounce it, shove your friends with it.</p>
<div class="welcome-pair">${figure('jet-tiny-world', 'High enough in the jet, the world is a ball.', PAIR)}${figure('lagoon-hovercraft', 'Across the lagoon and up the beach: the hovercraft doesn’t mind which.', PAIR)}</div>
<h3>Gear</h3>
<p>Five tools ride in the rack on the left. Pick one with the number keys, or click or tap it in the rack. ${k('L')} or a click in the world uses it; on a phone, <strong>TAG</strong> does. In Explore they are toys. In a match they are tactics.</p>
<ul class="welcome-gear">${gearList}</ul>
<h3>Ways to play</h3>
<dl class="welcome-modes">
  <div><dt>Explore</dt><dd>The default. No score, no hill, nobody is it. Find a route, try the absurd jump, park on a ridge and watch the weather.</dd></div>
  <div><dt>Tag</dt><dd>Tag whoever is it to take the role. While you are it, every tag scores; a ram passes it on. Use the land to get away.</dd></div>
  <div><dt>King of the Hill</dt><dd>Hold the marked zone alone to score. Share it and the clock stops until someone wins it back.</dd></div>
</dl>
<p class="welcome-note">Choose the mode in the Game panel. The whole room plays the same one.</p>
${figure('canyon-convoy', 'Tag is better with company.', FULL)}
<h3>Controls</h3>
<div class="welcome-controls">
  <section aria-labelledby="welcome-keyboard">
    <h4 class="welcome-kicker" id="welcome-keyboard">Keyboard and mouse</h4>
    <div class="welcome-drive"><div class="welcome-wasd"><span></span>${k('W', 'W, forward')}<span></span>${k('A', 'A, left')}${k('S', 'S, back')}${k('D', 'D, right')}</div><p>Drive and steer. The arrow keys work too.</p></div>
    <ul class="welcome-keys">
      <li><span>${k('Shift')}</span>brake</li>
      <li><span>${k('Space')}</span>wings, or hover and flight in the jet</li>
      <li><span>${k('E')}${k('Q')}</span>jet: climb, descend</li>
      <li><span>${k('L')}<i>or</i>${k('click', 'Mouse click')}</span>use gear</li>
      <li><span>${k('1')}<i>to</i>${k('5')}</span>choose gear</li>
      <li><span>${k('X')}</span>Zorb ball</li>
      <li><span>${k('click', 'Mouse click')}</span>capture the mouse to look round</li>
      <li><span>${k('C')}</span>camera views</li>
      <li><span>${k('H')}</span>this vehicle’s controls</li>
      <li><span>${k('J')}</span>invite</li>
      <li><span>${k('Y')}</span>chat</li>
      <li><span>${k('I')}</span>interface: full, driving, hidden</li>
      <li><span>${k('Esc')}</span>free the mouse, open the panels</li>
    </ul>
  </section>
  <section aria-labelledby="welcome-touch-heading">
    <h4 class="welcome-kicker" id="welcome-touch-heading">Touch</h4>
    ${touchDiagram}
    <ul class="welcome-keys">
      <li><span>Left half</span>drive: put your thumb down anywhere and push</li>
      <li><span>Right half</span>drag to look round</li>
      <li><span>Gear rack</span>tap a gear to choose it</li>
      <li><span><b class="welcome-pill">TAG</b></span>use it: hold, and drag to aim</li>
      <li><span><b class="welcome-pill">Panels</b></span>vehicle, game mode, world and chat</li>
    </ul>
  </section>
</div>
${figure('lava-night', 'Night on the volcanic world: the sea is lava.', FULL)}
<h3>Share a room</h3>
<p>Every room has its own link. ${k('J')} or <em>Invite players</em> shows it with a QR code a phone can scan from across the sofa. Everyone in a room shares one world: the same terrain, the same weather, the same waves.</p>
<h3>Settings worth knowing</h3>
<ul class="welcome-settings">
  <li><strong>Units.</strong> Metric or imperial, for speed, height and distance. Settings, then Controls.</li>
  <li><strong>Sound on silent.</strong> Syn3h asks an iPhone to play its sound even with the silent switch on. To make it obey the switch: Settings, then Sound, then Advanced.</li>
  <li><strong>Quality.</strong> The game picks a level for your device and adjusts as you play. Set it yourself in Settings, then Graphics.</li>
  <li><strong>Left-handed touch.</strong> Swaps the driving thumb to the right. Settings, then Controls.</li>
</ul>
${figure('swamp-river', 'A river through the Mire.', FULL)}
<h3>Made, not shipped</h3>
<p>Almost nothing you see or hear is a file. The terrain grows from a seed and wraps around a small planet. The sky is computed from how light scatters. The vehicles are built in code, the engines are synthesised, and the music is composed while you play. The pictures on this page are the exception: they load only when you open it.</p>
<p class="welcome-close">Land somewhere unfamiliar, learn what your machine can do, and find your own reasons to stay.</p>
${aboutLinksHtml}
${licencesHtml}
`
}

/** Set every picture's source: the browser fetches them from here on, never before. */
function loadShots(root: HTMLElement): void {
  for (const img of root.querySelectorAll<HTMLImageElement>('.welcome-shot img[data-src]')) {
    const figure = img.closest('figure')!
    img.addEventListener('load', () => figure.classList.add('is-loaded'), { once: true })
    img.addEventListener('error', () => figure.classList.add('is-failed'), { once: true })
    // A pinned build (?v= or /v/<version>/) shows its own release's pictures.
    img.sizes = img.dataset.sizes ?? '100vw'
    img.srcset = (img.dataset.srcset ?? '').split(', ').map(entry => { const [url, w] = entry.split(' '); return `${frozenResourceURL(url!)} ${w}` }).join(', ')
    img.src = frozenResourceURL(img.dataset.src!)
    delete img.dataset.src
  }
}

/** Fill `body` with the guide. Requests nothing; call opened() when the player opens it. */
export function mountWelcome(body: HTMLElement, options: WelcomeOptions = {}): Welcome {
  body.classList.add('welcome-body')
  if (options.labelledBy) body.setAttribute('aria-labelledby', options.labelledBy)
  body.insertAdjacentHTML('beforeend', html(options.where ?? 'lobby'))
  // The licence files are frozen resources: a pinned build links its own release's copies.
  for (const anchor of body.querySelectorAll<HTMLAnchorElement>('a[href^="/brand/licenses/"]')) anchor.setAttribute('href', frozenResourceURL(anchor.getAttribute('href')!))
  return { opened: () => loadShots(body) }
}

/** For a host that fills its body on the first deliberate open: mount and load at once. */
export function fillWelcome(body: HTMLElement, options: WelcomeOptions = {}): Welcome {
  const welcome = mountWelcome(body, options)
  welcome.opened()
  return welcome
}
