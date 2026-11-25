import { clipSearchResults } from './panelGlass'
import { liquidSelected } from './glassMaterial'
import { longFrames } from '../core/longFrames'
import { cancelStartupPlayRequest, recordStartupPlayRequest, recordStartupReveal } from '../core/diagnostics'
import { markShaderReveal } from '../core/diagnosticShaders'
import { frozenResourceURL } from '../core/frozenResources'
import type { LobbyAddress } from './LobbyAddress'
import { DEFAULT_ROOM, isDefaultRoom, roomFromQuery } from '../core/roomAddress'
import { modeChoices, modeName } from './modeAvailability'
import { GEAR_LABELS, type GearRack, type GearId } from '../weapons/Gear'
import { GearSelector, type GearSource } from './gear/GearSelector'
import { tagModeFor } from './tagStick'
import { postTier } from '../fx/post/gate'
import { PerformancePanel } from './PerformancePanel'
import type { PauseControl } from './pauseControl'
import { HeightAboveGround } from './heightAboveGround'
import { altitudeAboveSea } from './altitude'
import { speedUnit, speedValue } from './units'
import type { PerformanceSource } from '../core/performance'
import { SavedWorldStore, SAVED_WORLDS_KEY, savedName, savedWorldPlan, worldIdentity, type SavedWorld } from './galaxy/savedWorlds'
import { SavedMoons } from './galaxy/SavedMoons'
import type { Game, System } from '../core/Game'
import { vehicleDetail, type Vehicle } from '../vehicles/Vehicle'
import type { Terrain } from '../world/Terrain'
import { params, worldNameSeed, worldSeed } from '../../shared/params'
import { GameAudio } from '../audio'
// Registers the audio settings the lobby's Sound card shows.
import '../audio/params'
import { applySkyPreset, SKY_PRESET_NAMES, type SkyPresetName } from '../world/sky/presets'
import { TouchControls } from './TouchControls'
import { readVehicleChoice, saveVehicleChoice, PLAY_VEHICLES, type VehicleChoice } from './VehicleChoice'
import { SlidingPanels } from './SlidingPanels'
import { populationLabel } from './galaxy/presence'
import { wordmarkSvg } from './brand/logo'
import { Galaxy, GALAXY_MAX, type GalaxyWorld } from './galaxy/Galaxy'
import { captionBlocked, captionHidden, captionMask, type ScreenBox } from './galaxy/labels'
import { captionScale } from './galaxy/captionScale'
import { glowColour } from './galaxy/hoverGlow'
import { lobbyLook } from '../world/lobbyLook'
import { LobbySettings } from './LobbySettings'
import { CARD_CLOSE, trackFocusModality } from './cardClose'
import { installTooltips } from './tooltip'
import { Inspector } from './inspector/Inspector'
import { FocusHud } from './inspector/FocusHud'
import { bindSwitch, switchWord } from './inspector/switch'
import { RaceHud, type RaceRole } from './RaceHud'
import { MAX_NAME_LENGTH, type RaceState } from '../../shared/protocol'
import { diagnostics, interfaceMode, mapNorthUp } from './inspector/params'
import { InterfaceVeil, INTERFACE_KEY, nextInterfaceMode, setInterfaceMode } from './interfaceMode'
import { RESUME_KEY } from '../core/resume'
import { qualityLevel } from './quality/ladder'
import { Vector3 } from 'three/webgpu'
import { PLANETS } from '../world/planets'
import { graphicsLevel, levelNumber, qualityBudget, LEVELS, type QualityLevel } from '../core/quality'
import { camDistance, camFov, camHeight, camOffset } from '../core/ChaseCamera'
import { arrivalPath } from '../core/arrival'
import { applyPlanet, biomeLine, currentPlanet, currentWorldName, encodeWorld, planetById, randomSeed } from '../world/planets'
import { nameSeedKeptAcross, randomNameSeed, worldName } from '../world/worldName'
import { currentHour, formatDayLength, planetDayLength } from '../world/sky/dayCycle'
import { InviteView, inviteUrl } from './InviteView'
import { Scoreboard, parseScoreRow, type PlayerRoster } from './Scoreboard'
import { markedText } from './playerMarks'
import { canEditWorld, hostControls, resetWorld } from './worldPermissions'
import type { ParamPanel } from './ParamPanel'
import { MatchHud, type MatchState } from './MatchHud'
import { aboutHtml, fillUpdates, showAboutTab, updatesSheetHtml, wireAbout, type AboutTab } from './updates/about'
import { mountWelcome, WELCOME_WIDTH, type Welcome } from './welcome/welcome'
import { LobbySheet } from './LobbySheet'
import { UpdateNotice } from './updates/UpdateNotice'
import { rollPlayerName } from './data/names'
import { cleanPlayerName, loadPlayerName, savePlayerName, type NameSource } from './playerName'
import { TintTransition, randomTintPair } from '../vehicles/tints'
import { Minimap, cameraHeading, type MapEntity } from './Minimap'
import { AccessoryControls } from './AccessoryControls'
import { ChatRow } from './ChatRow'
import type { AccessoryVehicle } from '../vehicles/accessories'
import { bootLoading } from './LoadingScreen'
import { tapToBegin } from './TapToBegin'
import { fillHelpLine, renderHelp, touchHelp } from './VehicleHelp'
import { PlayHints, type Hint } from './PlayHints'
import type { VehicleKind } from '../vehicles'
import './label-plate.css'
import { isVehicleAvailable } from '../vehicles/available'
import { zorbSpeed } from '../vehicles/zorb'
import './shell.css'
import './exploration.css'
import './theme-halo.css'
import './hud-column.css'
import './glass.css'
import './phone-panels.css'
import './pause-screen.css'
import './card-chrome.css'
import './bottom-stack.css'
import { DRIVE_KEYS, deliverShot, encodeShot, pausedKeyAction, shareShot, shotFileName } from './screenshot'

/**
 * Whether the lobby offers the "Shape your own" Custom planet. Off at the owner's direction,
 * 15 November 2026: "hide the 'Shape Your Own' option for now. I want the lobby simple,
 * elegant, and visually stunning." Everything it needs is still in place here and in the
 * galaxy, so turning this on brings it back. Worlds are shaped in play, in the World card.
 */
const OFFER_CUSTOM_PLANET: boolean = false
/** How bright the galaxy stays behind a lobby sheet: faintly there, and held still. */
const SHEET_BACKDROP = 0.7
/** Point the licence disclosures in `root` at the captured entry version's copies. Only those links, never invite or networking links. */
function pinLicenses(root: ParentNode): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>('a[href^="/brand/licenses/"]')) anchor.setAttribute('href', frozenResourceURL(anchor.getAttribute('href')!))
}
/** Keys that mean "I want to drive": they resume a pause and capture the cursor. */
/**
 * The lobby's bottom buttons: none today. Multiplayer was removed (the invite lives in the
 * sidebar and on J), and About and Updates are icons above the settings gear in the lower
 * right corner (LobbySettings and LobbySheet). Worlds returns here with OFFER_CUSTOM_PLANET;
 * while the row is empty it is hidden.
 */
/**
 * The two lines of a planet label: the planet's name, then its biome in lower case ("Velmora"
 * over "alpine"). The name is the world's own setting (world.nameSeed, see worldName.ts), and
 * the biome is its recipe's label, so a renamed biome changes here with it.
 */
export function planetLabelText(world: { id?: string; recipe?: string; label: string; seed: number; nameSeed?: number; forming?: boolean }): { name: string; biome: string } {
  if (world.forming) return { name: world.label, biome: 'shape your own' }
  const recipe = planetById(world.recipe ?? world.id?.split('~')[0])
  return { name: worldName(world.nameSeed ?? 0, world.seed), biome: recipe ? biomeLine(recipe) : world.label.toLowerCase() }
}
/**
 * A planet label's tint: the colour its world shows from space, lava's glow for a lava world,
 * lifted toward white until it reads on the dark plate. CSS colour string.
 */
export function plateTint(recipeId: string): string {
  const look = lobbyLook(recipeId)
  return readableHex([16, 8, 0].map(k => ((look.night === 1 ? 0xff7a1a : look.land) >> k & 255) / 255) as [number, number, number])
}
/** A colour (0 to 1 channels) lifted toward white until its relative luminance is at least 0.42, so it reads over dark space. */
function readableHex([r, g, b]: [number, number, number]): string {
  for (let i = 0; i < 12 && 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.42; i++) { r += (1 - r) * 0.15; g += (1 - g) * 0.15; b += (1 - b) * 0.15 }
  const hex = (v: number) => Math.round(Math.min(1, v) * 255).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}
/**
 * A planet caption's colour while its planet is pointed at, focused or chosen: the planet's own
 * corona, the colour of the glow the galaxy draws round it then (glowColour), lifted only as far
 * as it needs to read (readableHex).
 */
export function captionAccent(world: { land: number; sea: number; glow?: boolean; forming?: boolean }): string {
  return readableHex(glowColour(world.land, world.sea, world))
}
/** Pixels from a planet's limb to the top of its caption, at the captions' smallest size (it grows with them). */
const CAPTION_GAP = 5
/** The sidebar's phone layout, upright or on its side (inspector/motion.css uses the same). */
const PHONE_SIDEBAR = '(max-width: 700px), (max-height: 500px)'
/**
 * Phones' Show panels and Close panels glyphs (phone-panels.css): two chevrons drawn as one
 * vector path, nothing to fetch. Up opens, down closes.
 */
const PANELS_CHEVRONS_UP = '<svg class="nav-chevrons" viewBox="0 0 20 16" aria-hidden="true" focusable="false"><path d="M4 8.5l6-5 6 5M4 13.5l6-5 6 5"/></svg>'
const PANELS_CHEVRONS_DOWN = '<svg class="nav-chevrons" viewBox="0 0 20 16" aria-hidden="true" focusable="false"><path d="M4 2.5l6 5 6-5M4 7.5l6 5 6-5"/></svg>'
/** Must match the short landscape block in shell.css. */
const SHORT_LANDSCAPE = '(orientation: landscape) and (max-height: 480px)'
const LOBBY_LINKS = OFFER_CUSTOM_PLANET ? '<button data-goto="worlds">Worlds</button>' : ''
const back = '<button type="button" class="panel-back link-button" data-goto="index"><span aria-hidden="true">←</span><span>Back</span></button>'
/** `__MIRA_BUILD__` is an optional build-time constant (a date or tag) from the bundler. */
declare const __MIRA_BUILD__: string | undefined
const build = typeof __MIRA_BUILD__ === 'string' && __MIRA_BUILD__ ? __MIRA_BUILD__ : undefined
/** Controls the shell wires, shown in the lobby settings panel (LobbySettings). */
// On/off settings are the standard switch (inspector/switch.ts); bindSwitch gives them role and state.
/**
 * The top row's icons, drawn as strokes on a 24 unit grid like the lobby's gear, About and
 * Updates icons (no image files). Leave world is a gravitational slingshot (the owner,
 * 22 November 2026: "a planet with an arrow away from it or some kind of gravitational
 * slingshot"): a small planet and a path that swings round it and flies off. A plain arrow
 * leaving a planet's rim read as the male symbol at button size.
 */
export const PAUSE_ICON = 'M9.2 6.8v10.4M14.8 6.8v10.4'
export const PLAY_ICON = 'M9 6.4v11.2l8.6-5.6Z'
/**
 * The planet sits towards the path's open side, a little smaller, and the path swings wider
 * round it, so the two do not crowd (the owner, 22 November 2026: "the outer curve a bit
 * further from the inner circle"): about 4 units clear at the sides, 5 over the top.
 */
export const LEAVE_WORLD_ICON = 'M8.4 13.4a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0M18.6 20.9C10.2 22.2 2.6 17.2 3.6 11.2C4.6 5.4 12.2 3.7 20.2 4.6M16.9 2.4l3.3 2.2-2.9 2.7'
/** The search field's magnifier, drawn at the start of the field. */
const SEARCH_ICON = 'M10.5 16.5a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM15 15l4.8 4.8'
/** The search field's clear cross: the magnifier's size and stroke, mirrored at the field's end. */
const CLEAR_ICON = 'M7 7l10 10M17 7 7 17'
/** How long PAUSED and its resume line stay before fading, with nothing moving (ms). */
const PAUSE_WHISPER_MS = 2500
/** The pause screen's three buttons, drawn in the rail icons' line (24 px box, stroked). */
const WELCOME_ICON = 'M12 20.2a8.2 8.2 0 1 0 0-16.4 8.2 8.2 0 0 0 0 16.4ZM12 11v5.2M12 7.9v.1'
const SHOT_ICON = 'M4.5 8.6A1.6 1.6 0 0 1 6.1 7h2.1l1.4-2h4.8l1.4 2h2.1a1.6 1.6 0 0 1 1.6 1.6v8.8a1.6 1.6 0 0 1-1.6 1.6H6.1a1.6 1.6 0 0 1-1.6-1.6ZM12 16.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z'
const SAVED_ICON = 'M6 12.5l4 4 8-9'
const pauseIcon = (path: string) => `<svg class="pause-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`
const railIcon = (path: string) => `<svg class="rail-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`
const switchHtml = (className: string, text: string, inputAttributes = '') => `<label class="s3-switch-field ${className}"><span class="s3-switch-text">${text}</span><input type="checkbox"${inputAttributes}><span class="s3-switch-word" aria-hidden="true">off</span></label>`
const presentationHtml = switchHtml('presentation-toggle', 'Presentation mode · P')
const hostHtml = `<fieldset class="host-controls"><legend>Host</legend>${switchHtml('host-lock', 'Lock shared sliders', ' id="host-lock"')}<p class="host-note"></p><button class="world-reset" type="button">Reset world to defaults</button></fieldset>`
const heading = (text: string) => `<h2 tabindex="-1">${text}</h2>`

/** A camera that can be posed from outside, used by the descent from the galaxy. */
export interface CinematicCamera {
  setCinematicPose(position: Vector3, target: Vector3): void
  clearCinematicPose(): void
}
export class Shell implements System {
  readonly element = document.createElement('div')
  onPlay?: () => void
  private readonly abort = new AbortController()
  private readonly nameInput: HTMLInputElement
  private readonly roomInput: HTMLInputElement
  private readonly overlay: HTMLElement
  private readonly speed: HTMLElement
  private readonly choice: VehicleChoice = readVehicleChoice()
  private lastActivity = performance.now()
  private readonly invite: InviteView
  private inviteOpen = false
  private inviteFromGame = false
  private playerCount = 0
  /** What had focus when the invite view opened, to return to when it closes. */
  private joinOpener?: HTMLElement
  private readonly matchHud: MatchHud
  private minimap?: Minimap
  /** The camera's heading across the ground, kept for when it looks straight down. */
  private viewHeading = 0
  private readonly panels: SlidingPanels
  private readonly board: Scoreboard
  private readonly hudBoard: Scoreboard
  private paramPanel?: ParamPanel
  /** Slider groups the advanced panel is limited to, when it was opened from the custom planet. */
  private advancedGroups?: readonly string[]
  private worldDirty = true
  private readonly inspector: Inspector
  private readonly focusHud: FocusHud
  private readonly raceHud: RaceHud
  onRaceLeave?: () => void
  onRaceCancel?: () => void
  private telemetry: { speed: number; altitude: number; thrust?: number; seaAltitude: number } = { speed: 0, altitude: 0, seaAltitude: 0 }
  /** The 3D galaxy: the lobby. Absent only where WebGL 2 is, and then the game cannot draw either. */
  private galaxy?: Galaxy
  /** Arrived by an invite link that names a world: that world is the one to enter. */
  private readonly invited = new URLSearchParams(location.search).has('world')
  private started = false
  private menuVisible = true
  private lobbyAddress?: LobbyAddress
  /** Installed after main's startup URL readers, including this constructor. */
  setLobbyAddress(address: LobbyAddress): void {
    this.lobbyAddress = address
    if (this.menuVisible) address.showLobby(); else address.showPlay(this.room)
    this.updateInvite()
  }
  private readonly previousSuspended: boolean
  private helpTimer?: ReturnType<typeof setTimeout>
  /** Listeners that dismiss the short controls card on the player's first input. */
  private helpInput?: AbortController
  private activeVehicleKind: VehicleKind = this.choice.vehicleKind
  private toastTimer?: ReturnType<typeof setTimeout>
  readonly touch: TouchControls
  private readonly lobbySettings: LobbySettings
  /** The presentation-mode switch field; its input is the switch. */
  private readonly presentationToggle: HTMLLabelElement
  private readonly switches = new Map<string, (on: boolean) => void>()
  private readonly hostControls: HTMLFieldSetElement

  constructor(private readonly game: Game, readonly audio: GameAudio, entryName?: string | null) {
    game.onCoveredClimb = (level, job) => this.showCoveredClimb(level, job)
    this.previousSuspended = game.input.suspended; game.input.suspended = true
    this.element.className = 'mira-shell exploration-ui'
    this.element.innerHTML = `<section class="shell-overlay" role="dialog" aria-modal="true" aria-label="Mira lobby">
      <div class="lobby-stage">
      <header class="lobby-brand">${wordmarkSvg('shell-logo')}</header>
      <p class="lobby-unsupported" hidden>Mira needs WebGL 2. A current Safari, Chrome, Firefox or Edge will run it.</p>
      <div class="lobby-panels" hidden>
        <section data-panel="explore">${heading('Prepare to Explore')}
          <form class="shell-form"><label for="shell-name">Player name</label><input id="shell-name" name="playerName" maxlength="24" autocomplete="nickname" placeholder="Explorer">
          <label for="shell-room">Room</label><div class="input-action"><input id="shell-room" name="room" maxlength="64" autocomplete="off" placeholder="Public room"><button class="shell-invite" type="button">Copy invite</button></div>
          <div class="shell-controls"><span><b>WASD / arrows</b> Drive</span><span><b>Space</b> Wings</span><span><b>Shift</b> Brake</span><span><b>L / click</b> Plasma Tag</span></div><p class="shell-touch-hint">Left thumb to drive. Right thumb for wings, brake and tag.</p>
          <button class="shell-play is-primary" type="submit">Enter World ›</button></form>${back}
        </section>
        <section data-panel="worlds">${heading('Worlds to Explore')}
          <p class="planet-current"></p><fieldset class="world-controls"><legend>World</legend><label for="world-seed">Seed</label><div class="input-action"><input id="world-seed" type="number" min="1" max="999999" step="1"><button id="new-world" type="button">New world</button></div><label class="bots-control" hidden>Bots <output></output><input id="bots-count" type="range" step="1"></label><label class="bots-keep" hidden><input id="bots-keep" type="checkbox"> Keep this many bots whatever the frame rate<small>Off, bots leave a slow device to keep play smooth.</small></label></fieldset>
          <fieldset class="world-controls"><legend>Sky</legend><div class="sky-presets">${SKY_PRESET_NAMES.map(name => `<button type="button" data-sky="${name}">${name}</button>`).join('')}</div><label for="sky-time">Time of day <output id="sky-time-value"></output></label><input id="sky-time" type="range" min="0" max="24" step="0.05"></fieldset>
          <p class="world-lock-note" hidden>Sliders locked by host.</p><button data-goto="explore">Explore this world ›</button>${back}
        </section>
        <section data-panel="advanced">${heading('Advanced Settings')}<p class="world-lock-note" hidden>Sliders locked by host.</p><div class="advanced-host"></div>${back}</section>
      </div>
      <footer class="lobby-footer"><span class="shell-message" role="status" aria-live="polite"></span></footer>
      </div>
      <div class="galaxy-ui" hidden><div class="galaxy-labels" role="group" aria-label="Worlds. Drag to look around; choose a world to go there."></div><nav class="lobby-links galaxy-links" aria-label="Lobby"${LOBBY_LINKS ? '' : ' hidden'}>${LOBBY_LINKS}</nav></div>
    </section>
    <dialog class="in-play-about" aria-labelledby="in-play-about-title"><header><h2 id="in-play-about-title" tabindex="-1">Welcome</h2><button type="button" class="about-back card-close" aria-label="Close" data-tip="Close">${CARD_CLOSE}</button></header><div class="in-play-about-body">${aboutHtml()}</div></dialog>
    <aside class="shell-hud" hidden><div class="shell-speed"><strong>0</strong><span>MPH</span></div><div class="hud-scoreboard"></div></aside>
    <nav class="hud-navigation" aria-label="Game menu" hidden><button class="shell-menu-button inspector-toggle" type="button" aria-label="Open the panels" aria-pressed="false"><span class="nav-glyph" aria-hidden="true">≡</span>${PANELS_CHEVRONS_UP}<span class="nav-label"> Panels</span></button></nav>
    <div class="exit-confirm" role="alertdialog" aria-modal="true" aria-labelledby="exit-confirm-title" aria-describedby="exit-confirm-text" hidden><div class="exit-confirm-card"><strong id="exit-confirm-title">Leave this world?</strong><p id="exit-confirm-text">You will return to the galaxy.</p><div class="exit-confirm-actions"><button type="button" class="panel-action exit-stay">Stay</button><button type="button" class="panel-action exit-leave">Leave world</button></div></div></div>
    <div class="pause-actions" role="group" aria-label="Paused" hidden><button type="button" class="pause-exit liquid-glass" aria-haspopup="dialog" aria-label="Leave world">${pauseIcon(LEAVE_WORLD_ICON)}<span class="pause-word"><span class="pause-long">Exit world</span><span class="pause-short">Exit</span></span></button><button type="button" class="pause-about liquid-glass" aria-haspopup="dialog" aria-label="Welcome and how to play">${pauseIcon(WELCOME_ICON)}<span class="pause-word">Welcome</span></button><button type="button" class="pause-shot liquid-glass" aria-label="Save a screenshot" aria-describedby="pause-shot-keys">${pauseIcon(SHOT_ICON)}<span class="pause-word"><span class="pause-long">Screenshot <kbd>S</kbd></span><span class="pause-short">Photo</span></span></button><span class="pause-shot-hint" role="status" aria-live="polite" hidden></span><span class="pause-shot-keys" id="pause-shot-keys" aria-hidden="true">S saves a screenshot. W, A, D or the arrows resume.</span></div>
    <button type="button" class="pause-veil" hidden><strong>Paused</strong><span class="pause-how">Click to resume</span><small hidden>The world carries on without you.</small></button>
    <aside class="spawn-help" role="status" hidden><strong>Controls</strong><div></div><small></small></aside>
    <div class="shell-toast" role="status" aria-live="polite" hidden></div>`
    // Rewrite only the two guide disclosures, never invite or networking links.
    pinLicenses(this.element.querySelector('.in-play-about')!)
    document.body.append(this.element); document.body.classList.add('has-game-shell')
    this.invite = new InviteView(this.element, () => this.closeJoin(), () => { void this.copyInvite() })
    this.matchHud = new MatchHud(this.element, () => audio.cue('tick'))
    this.overlay = this.element.querySelector('.shell-overlay')!
    this.nameInput = this.element.querySelector('#shell-name')!; this.roomInput = this.element.querySelector('#shell-room')!
    // The room caps UTF-16 length. Keep link names within that limit without cutting a character.
    const linkedName = cleanPlayerName(entryName ?? '').slice(0, MAX_NAME_LENGTH).replace(/[\ud800-\udbff]$/, '').trimEnd()
    const identity = linkedName ? { name: linkedName, source: 'link' as const } : loadPlayerName()
    this.nameInput.value = identity.name
    this.nameSource = identity.source
    this.speed = this.element.querySelector('.shell-speed strong')!
    this.panels = new SlidingPanels(this.element.querySelector('.lobby-panels')!)
    // The lobby's Multiplayer panel, which drew this board, is gone (the in-play board is the
    // Players & session card's). The board stays, detached, for its join and leave messages.
    this.board = new Scoreboard(document.createElement('div'), text => {this.toast(text);if(/joined/i.test(text))audio.cue('join');else if(/left/i.test(text))audio.cue('leave');else if(/tagged| is it/i.test(text))audio.cue('tag')})
    this.hudBoard = new Scoreboard(this.element.querySelector('.hud-scoreboard')!, () => {})
    this.touch = new TouchControls(game.input); this.element.classList.toggle('has-touch', this.touch.available)
    // TAG reads the gear in hand: Plasma Tag streams while held, other gear sends on the lift,
    // and Cancel drops a charge or carry the way the in-play guide does (src/ui/tagStick.ts).
    this.touch.tag = {
      mode: () => {
        const rack = (window as unknown as { miraNet?: { gear?: GearRack } }).miraNet?.gear
        if (!rack) return 'stream'
        const controls = rack.controls()
        return tagModeFor(controls.gear, controls.actions[0])
      },
      tap: () => {
        const rack = (window as unknown as { miraNet?: { gear?: GearRack } }).miraNet?.gear
        if (rack) rack.tap(); else game.input.external.fire = true
      },
      cancel: () => { this.cancelActions?.(); game.input.external.fire = false },
    }
    // The gear drum at the centre-left edge, in both cursor states: the gear in hand, its
    // neighbours, and the controls that apply right now. On touch it adds buttons for the
    // gear's extra actions (the Grapple's Let out and Let go).
    this.gearSelector = new GearSelector(this.element, () => this.gearSource(), { touch: this.touch.available, onSelect: () => this.audio.cue('click') })
    // Under the drum, the driven vehicle's accessories (Zorb, wings, jet mode...), each with its
    // key and its state (src/vehicles/accessories.ts). Part of the left column, hud-column.css.
    this.accessories = new AccessoryControls(this.element, game.input, () => this.audio.cue('click'), this.abort.signal)
    // Under them, the column's Chat row: opens chat and shows its unread count through chatLink.
    new ChatRow(this.element, this.abort.signal)
    const signal = this.abort.signal
    this.followPointer(signal)
    this.menuVisible = true; this.overlay.hidden = false; this.overlay.inert = false; if (this.galaxy) this.galaxy.enabled = true
    this.releaseCursor()
    // The world inspector and the display for when the cursor is captured (inspector/).
    this.inspector = new Inspector(this.element, {
      summary: id => this.inspectorSummary(id),
      // Vehicles are chosen in play only (the lobby offers planets). One design each.
      vehicles: () => ({ options: PLAY_VEHICLES, current: this.activeVehicleKind === 'buggy' ? 'buggy-syn3h' : this.activeVehicleKind, pending: this.pendingVehicle }),
      onVehicle: id => this.switchVehicle(id as VehicleKind),
      playerName: () => this.playerName,
      onRename: name => this.setPlayerName(name),
      rollName: () => rollPlayerName().name,
      colors: () => this.tintTransition.current,
      onColor: (key, value) => this.setTint(key, value),
      onRandomizeColors: () => this.randomizeTint(),
      onSaveWorld: () => this.saveWorld(),
      // Phones keep one card open at a time; the query matches the sidebar's phone layout
      // (inspector/motion.css). Which cards are open survives a reload.
      oneOpen: () => matchMedia(PHONE_SIDEBAR).matches,
      // Phone-sized touch screens: one panel at a time, alone (phone-panels.css). Tablets and
      // desktops keep the stack as it was.
      closePanels: () => this.returnToDriving(),
      phonePanels: () => this.touch.available && matchMedia(PHONE_SIDEBAR).matches,
      rememberOpen: 'mira.sidebar.open',
    })
    // The owner's rule, 15 November 2026: "Panels being open or closed should be a simple
    // function of cursor locking." With the cursor captured you are driving and only the
    // display shows; with it free the panels are open. There is no stored open or closed
    // state: `syncPanels` derives it from the real lock, every frame and on every lock event.
    this.inspector.open = false
    clipSearchResults(this.inspector.element, signal)
    const railTop = this.inspector.element.querySelector('.wi-top')!
    // Players & session is a card like the others: same header, chevron, easing and memory.
    const players = document.createElement('div')
    players.innerHTML = `<div class="rail-player-body" data-search="players session room invite welcome about how to play help connection diagnostics mute"><div class="card-actions rail-actions"><button type="button" class="panel-action rail-invite">Invite players</button><button type="button" class="panel-action rail-about" aria-haspopup="dialog">Welcome &amp; how to play</button></div>${switchHtml('rail-diagnostics', 'Connection diagnostics')}</div>`
    players.querySelector('.rail-player-body')!.prepend(this.element.querySelector('.hud-scoreboard')!)
    // The summary is read every frame while the panels show: a live collection, not a query.
    const scoreRows = players.querySelector('.hud-scoreboard')!.getElementsByClassName('score-row')
    this.inspector.addCard('players', 'Players & session', players, () => {
      const count = scoreRows.length
      return count > 1 ? `${count} players` : count ? 'Just you' : ''
    }, { after: 'game' })
    // Performance follows World; its controls remain part of the searchable card stack.
    if (game.quality) game.quality.manualChange = (level, apply) => {
      if (!this.playing || this.transitioning) { apply(); return }
      if (!this.qualityVeil && game.manualQualityReady(level)) { apply(); return }
      this.queuedQuality = { level, apply }
      if (!this.qualityVeil) void this.applyQualityBehindVeil()
    }
    // The bottom-centre strip has one owner (bottom-stack.css): a column that lays out everything
    // that wants that place, so two can never overlap. The pause bar, the driving notices (the
    // slow-frames offer, race status), the entry's "Preparing world" line and the dev server's
    // "New build available" button all live in it, in a fixed order.
    const noticeStack = this.bottomStack
    noticeStack.className = 'bottom-stack drive-notices'
    this.element.append(noticeStack)
    noticeStack.append(this.element.querySelector('.pause-actions')!)
    // tools/manual-reload.mjs appends its button to <body> on mira:new-build: adopt it here.
    const adoptBuildNotice = () => { const notice = document.getElementById('mira-build-notice'); if (notice && notice.parentElement !== noticeStack) noticeStack.prepend(notice) }
    adoptBuildNotice()
    window.addEventListener('mira:new-build', () => setTimeout(adoptBuildNotice), { signal })
    this.performancePanel = new PerformancePanel(this.element, () => this.showPanels(), this.game.quality, this.inspector, noticeStack)
    // The lobby's settings: Settings above Welcome and Updates in the lower right of the galaxy,
    // the running version in the lower left, and a right-hand card of what acts in the lobby
    // (LobbySettings). The presentation toggle and host controls are built here and wired below.
    const holder = document.createElement('div'); holder.innerHTML = presentationHtml + hostHtml
    this.presentationToggle = holder.querySelector('.presentation-toggle')!; this.hostControls = holder.querySelector('.host-controls')!
    this.lobbySettings = new LobbySettings(this.element, {
      quality: this.game.quality, host: this.hostControls, build,
      // The card and a sheet never show together: the card takes over from an open sheet.
      opening: () => { for (const sheet of this.lobbySheets) sheet.close(false) },
      hostSummary: () => this.hostControls.querySelector('.host-note')!.textContent ?? '', inRoom: () => { const net = hostControls(); return !!net && (net.isHost || canEditWorld()) }, cue: () => this.audio.cue('click'),
    })
    this.element.querySelector('.galaxy-ui')!.append(this.lobbySettings.dock, this.lobbySettings.versionDock)
    // The version beside the lobby's settings gear opens What's new.
    this.lobbySettings.version.addEventListener('click', () => { this.audio.cue('click'); this.showUpdates() }, { signal })
    // About and Updates, each its own sheet from its icon above the gear. Their content is
    // built on first open, so nothing in them is requested before the player asks.
    const edges = () => this.galaxy?.wordmarkEdges() ?? null
    // Behind a sheet the galaxy dims a little and holds still, as behind a panel; it comes back once both are closed.
    // ...and the name moves back down from over it (Galaxy.markLift).
    const closed = () => {
      if (this.lobbySheets.some(s => s.isOpen)) return
      // The buttons go back to their corner of the lobby.
      const dock = this.lobbySettings.dock
      this.element.querySelector('.galaxy-ui')!.append(dock); dock.classList.remove('is-beside-sheet')
      this.lobbySettings.about.classList.remove('is-current'); this.lobbySettings.about.removeAttribute('aria-current')
      if (this.galaxy) { this.galaxy.markLift = 0; this.galaxy.worlds = 1 }
      if (this.galaxy && this.panels.active === 'index' && !this.playing) this.galaxy.backdrop = 1
    }
    // While the name rises to stand over an open sheet, the sheet follows it (LobbySheet).
    // (While the view eases to bring the name into view, Galaxy.frameName, the edges are where
    // it will land, so the sheet holds still.)
    const following = () => !!this.galaxy && this.galaxy.liftShown !== (this.galaxy.markLift > 0 ? 1 : 0)
    // The Welcome guide's content (src/ui/welcome): mounted on first open, its images loading on each.
    this.aboutSheet = new LobbySheet(this.element, { name: 'about', title: 'Welcome', width: WELCOME_WIDTH, bleed: true, edges, following, home: () => this.lobbySettings.about, closed, cue: () => this.audio.cue('click'), fill: body => { this.lobbyWelcome = mountWelcome(body, { where: 'lobby' }) }, opened: () => this.lobbyWelcome?.opened() })
    this.updatesSheet = new LobbySheet(this.element, {
      name: 'updates', title: 'Updates', edges, following, home: () => this.lobbySettings.version, closed, cue: () => this.audio.cue('click'),
      fill: body => body.insertAdjacentHTML('beforeend', updatesSheetHtml()), opened: body => { void fillUpdates(body.querySelector<HTMLElement>('.about-updates')!) },
    })
    this.lobbySettings.about.addEventListener('click', () => this.openLobbySheet(this.aboutSheet), { signal })
    // Settings opens its own right-hand card (LobbySettings handles its button).
    // The top row (the owner, 17 November 2026): exactly three controls, side by side with no
    // plate around them, sized like a card's title row so the row reads as the first of the
    // stack. Search takes the free width. The world's name is in the World card's summary.
    const command = document.createElement('div'); command.className = 'rail-command'
    command.innerHTML = `<button type="button" class="rail-pause wi-glass" aria-label="Pause" data-tip="Pause">${railIcon(PAUSE_ICON)}</button><button type="button" class="exit-world wi-glass" aria-label="Leave world" data-tip="Leave world">${railIcon(LEAVE_WORLD_ICON)}</button>`
    const search = railTop.querySelector<HTMLInputElement>('.wi-search')!; search.classList.add('wi-glass'); command.prepend(search)
    // The magnifier stands over the start of the field; the text starts after it (card-chrome.css).
    search.insertAdjacentHTML('afterend', `<svg class="rail-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${SEARCH_ICON}"/></svg>`)
    // Our own clear button replaces the browser's (a blue cross in the system accent, different in
    // every engine; card-chrome.css hides it). It shows only while the field has text (CSS reads
    // :placeholder-shown, so a clear from code or Escape hides it too). The wrapper keeps the
    // button out of the rail's `.rail-command > button` styles and glass. A click clears, tells
    // the inspector (an input event, as typing does) and leaves focus in the field.
    search.nextElementSibling!.insertAdjacentHTML('afterend', `<span class="rail-search-end"><button type="button" class="rail-search-clear" aria-label="Clear search"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${CLEAR_ICON}"/></svg></button></span>`)
    const clear = command.querySelector<HTMLButtonElement>('.rail-search-clear')!
    clear.addEventListener('pointerdown', event => event.preventDefault(), { signal })
    clear.addEventListener('click', () => { search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); search.focus() }, { signal })
    // Under the stack, only what docks there now and then: the update chip and a slow-frames
    // recommendation (PerformancePanel). Empty, it takes no space.
    const foot = document.createElement('div'); foot.className = 'rail-foot'
    railTop.remove()
    const cards = this.inspector.element.querySelector('.wi-cards')!
    cards.before(command); cards.after(foot)
    // Phones: Close panels, at the foot of the panels under the thumb, back to driving. A tap in
    // the empty space below the last card does the same, but only 12 px or more below it, so a
    // near miss on a header never throws the player back into the drive.
    const closeAll = document.createElement('button'); closeAll.type = 'button'; closeAll.className = 'panels-close liquid-glass'
    closeAll.innerHTML = `${PANELS_CHEVRONS_DOWN}<span>Close panels</span>`
    this.inspector.element.append(closeAll)
    closeAll.addEventListener('click', () => this.returnToDriving(), { signal })
    cards.addEventListener('click', event => {
      if (event.target !== cards || !this.touch.available || !matchMedia(PHONE_SIDEBAR).matches || this.inspector.element.classList.contains('is-single')) return
      const shown = [...cards.children].filter(card => card instanceof HTMLElement && !card.hidden)
      const last = shown.at(-1)?.getBoundingClientRect().bottom ?? cards.getBoundingClientRect().top
      if ((event as MouseEvent).clientY >= last + 12) this.returnToDriving()
    }, { signal })
    // Exit world asks first (the owner, 15 November 2026): one stray click on the panels must
    // not throw the player back to the galaxy. Code that calls openMenu() itself is not asked.
    command.querySelector('.exit-world')!.addEventListener('click', () => this.askExit(), { signal })
    const exitConfirm = this.element.querySelector<HTMLElement>('.exit-confirm')!
    exitConfirm.addEventListener('click', event => { if (event.target === exitConfirm) this.answerExit(false) }, { signal })
    exitConfirm.querySelector('.exit-stay')!.addEventListener('click', () => this.answerExit(false), { signal })
    exitConfirm.querySelector('.exit-leave')!.addEventListener('click', () => this.answerExit(true), { signal })
    players.querySelector('.rail-invite')!.addEventListener('click', () => this.openJoin(), { signal })
    players.querySelector('.rail-about')!.addEventListener('click', () => this.openAbout(), { signal })
    // About and Updates as two tabs in the in-play guide; the lobby gives each its own sheet.
    wireAbout(this.element.querySelector<HTMLElement>('.in-play-about')!, signal)
    // The Welcome guide fills the About pane now; its pictures wait until the player shows it.
    const aboutPane = this.element.querySelector<HTMLElement>('.in-play-about [data-about-pane="about"]')!
    this.playWelcome = mountWelcome(aboutPane, { where: 'play' })
    this.element.querySelector('.in-play-about [data-about-tab="about"]')!.addEventListener('click', () => this.playWelcome.opened(), { signal })
    // A newer live version: a banner in the lobby, a chip in the sidebar in play. What's new
    // opens Updates wherever the player is, and the lobby's Updates icon carries a quiet mark.
    this.updateNotice = new UpdateNotice(() => this.showUpdates(), signal, () => { this.updateBand(); this.lobbySettings.markUpdate(this.updateNotice.version) })
    // With the galaxy, so it goes when a panel opens, play starts or the descent begins. It
    // sits just under the wordmark, and the galaxy leaves it that band (updateBand).
    this.element.querySelector('.galaxy-ui')!.prepend(this.updateNotice.banner)
    foot.append(this.updateNotice.chip)
    this.element.querySelector('.pause-about')!.addEventListener('click', () => this.openAbout(), { signal })
    // The pause screen's other two buttons. They sit beside the veil, not on it, so a click on
    // one never also resumes.
    this.element.querySelector('.pause-exit')!.addEventListener('click', () => this.askExit(), { signal })
    this.element.querySelector('.pause-shot')!.addEventListener('click', () => { void this.takeShot() }, { signal })
    const guide = this.element.querySelector<HTMLDialogElement>('.in-play-about')!
    guide.querySelector('.about-back')!.addEventListener('click', () => this.closeAbout(), { signal })
    // The dialog's own Escape (cancel) and any other close route through closeAbout.
    guide.addEventListener('cancel', event => { event.preventDefault(); this.closeAbout() }, { signal })
    guide.addEventListener('close', () => this.closeAbout(), { signal })
    this.switches.set('diagnostics', this.bindField(players.querySelector('.rail-diagnostics')!, signal))
    players.querySelector('.rail-diagnostics input')!.addEventListener('change', event => params.set(diagnostics.def.id, (event.target as HTMLInputElement).checked), { signal })
    // Mute audio is a personal setting: the Me card's Audio group has it (audio.muted, the first
    // row there), not this card (the owner, 22 November 2026).
    this.focusHud = new FocusHud(this.element)
    this.raceHud = new RaceHud(this.element, { leave: () => this.onRaceLeave?.(), cancel: () => this.onRaceCancel?.() })
    noticeStack.prepend(this.raceHud.element)
    // Touch has no cursor to capture, so one control switches between driving and the panels.
    const toggle = this.element.querySelector<HTMLButtonElement>('.inspector-toggle')!
    toggle.addEventListener('click', () => { this.touchPanels = !this.touchPanels; this.syncPanels() }, { signal })
    command.querySelector('.rail-pause')!.addEventListener('click', () => { if (this.userPaused) this.requestResume(); else this.requestPause() }, { signal })
    this.element.querySelector('.pause-veil')!.addEventListener('click', () => this.requestResume(), { signal })
    // Follow the lock itself, not what was asked for: the browser can drop it on its own
    // (Escape, a switch of window, a system dialog) and can refuse a request.
    // Losing the lock (Escape) also returns the interface to Full, so nobody is left without panels.
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) setInterfaceMode(0); this.syncPanels() }, { signal })
    document.addEventListener('pointerlockerror', () => this.syncPanels(), { signal })
    const unsubscribeInterface = params.onChange(id => { if (id === interfaceMode.def.id) this.syncPanels() })
    signal.addEventListener('abort', () => { unsubscribeInterface(); this.interfaceVeil.dispose() })
    this.glass(signal)
    installTooltips(signal)
    trackFocusModality(signal)
    for (const slider of this.element.querySelectorAll<HTMLInputElement>('[data-param]')) slider.addEventListener('input', () => params.set(slider.dataset.param!, Number(slider.value)), { signal })
    this.startGalaxy()
    this.mountSavedWorlds()
    window.addEventListener('storage', event => { if (event.key === SAVED_WORLDS_KEY || event.key === null) this.refreshSavedWorlds() }, { signal })
    const unsubscribeWorld = params.onChange(id => { if (params.get(id)?.def.scope === 'world') { this.worldDirty = true; this.refreshCustomPlanet() } })
    signal.addEventListener('abort', unsubscribeWorld)
    this.nameInput.addEventListener('input', () => { this.nameSource = 'typed' }, { signal })
    // The public room is an empty field (placeholder "Public room"), never its internal name.
    const entryRoom = roomFromQuery(new URL(location.href).searchParams)
    this.roomInput.value = isDefaultRoom(entryRoom) ? '' : entryRoom
    this.roomInput.addEventListener('input', () => this.updateRoomLabels(), { signal }); this.updateRoomLabels()
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-goto]')) button.addEventListener('click', () => this.showPanel(button.dataset.goto!), { signal })
    this.overlay.addEventListener('click', event => {
      const target = event.target as Element
      if (this.panels.active !== 'index' && !target.closest('.lobby-panels, .galaxy-links, .update-banner') && !this.inviteOpen) this.showPanel('index')
    }, { signal })
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-open]')) button.addEventListener('click', () => this.openMenu(button.dataset.open!), { signal })
    this.element.querySelector('form')!.addEventListener('submit', event => { event.preventDefault(); this.play(true) }, { signal })
    for (const button of this.element.querySelectorAll('.shell-invite')) button.addEventListener('click', () => { void this.copyInvite() }, { signal })
    const presentationInput = this.presentationToggle.querySelector('input')!
    this.switches.set('presentation', this.bindField(this.presentationToggle, signal))
    presentationInput.addEventListener('change', () => this.setPresentation(presentationInput.checked), { signal })
    for (const slider of this.element.querySelectorAll<HTMLInputElement>('[data-param]')) if (document.activeElement !== slider) slider.value = String(params.get(slider.dataset.param!)?.value ?? 0)
    this.element.querySelector('#world-seed')!.setAttribute('value', String(worldSeed.value))
    this.element.querySelector('#world-seed')!.addEventListener('input', event => { (event.target as HTMLInputElement).dataset.dirty = 'true' }, { signal })
    this.element.querySelector('#new-world')!.addEventListener('click', () => {
      if (!canEditWorld()) return
      const input = this.element.querySelector<HTMLInputElement>('#world-seed')!
      const seed = Number(input.value)
      if (!Number.isInteger(seed) || seed < 1 || seed > 999999) { this.toast('Choose a seed from 1 to 999999.'); return }
      // A new seed reshapes the world; its name stays (see world.nameSeed).
      params.set(worldNameSeed.def.id, nameSeedKeptAcross(worldNameSeed.value, worldSeed.value))
      params.set(worldSeed.def.id, seed); delete input.dataset.dirty
    }, { signal })
    for (const button of this.element.querySelectorAll<HTMLButtonElement>('[data-sky]')) button.addEventListener('click', () => { if (canEditWorld()) applySkyPreset(button.dataset.sky as SkyPresetName) }, { signal })
    this.element.querySelector('#sky-time')!.addEventListener('input', event => { if (canEditWorld()) params.set('sun.timeOfDay', (event.target as HTMLInputElement).value) }, { signal })
    this.element.querySelector('#bots-count')!.addEventListener('input', event => { if (canEditWorld()) params.set('bots.count', (event.target as HTMLInputElement).value) }, { signal })
    this.element.querySelector('#bots-keep')!.addEventListener('change', event => { if (canEditWorld()) params.set('bots.keepCount', (event.target as HTMLInputElement).checked) }, { signal })
    // Two presses: the first asks, the second (within four seconds) does it. No modal dialog.
    const reset = this.hostControls.querySelector<HTMLButtonElement>('.world-reset')!
    let resetArmed: ReturnType<typeof setTimeout> | undefined
    const disarm = () => { clearTimeout(resetArmed); resetArmed = undefined; reset.textContent = 'Reset world to defaults'; reset.classList.remove('is-confirming') }
    reset.addEventListener('click', () => {
      if (!canEditWorld()) return
      if (!resetArmed) {
        reset.textContent = hostControls() ? 'Press again to reset for everyone' : 'Press again to reset this world'
        reset.classList.add('is-confirming'); resetArmed = setTimeout(disarm, 4000); return
      }
      disarm(); this.toast(resetWorld() ? 'World reset to defaults.' : 'Sliders locked by host.')
    }, { signal })
    signal.addEventListener('abort', () => clearTimeout(resetArmed))
    this.switches.set('host-lock', this.bindField(this.hostControls.querySelector('.host-lock')!, signal))
    this.hostControls.querySelector('#host-lock')!.addEventListener('change', event => { const net = hostControls(); if (net?.isHost) net.setLocked((event.target as HTMLInputElement).checked) }, { signal })
    const activity = (event: Event) => {
      this.lastActivity = performance.now()
    }
    for (const type of ['keydown', 'pointerdown', 'wheel', 'pointermove']) window.addEventListener(type, activity, { capture: true, signal, passive: false })
    window.addEventListener('keydown', event => this.keydown(event), { capture: true, signal })
    // Native controls keep their defaults and local handlers, but must not drive or fire.
    // Let keyup reach Input even when focus moved while a driving key was held.
    // A focused button or summary only owns its activation keys (Space and Enter). Every other
    // key still drives: focus rests on a button after an automatic start and after any click
    // on the rail, and the drive keys must not go dead until the player clicks elsewhere.
    this.element.addEventListener('keydown', event => {
      if (!(event.target instanceof Element)) return
      if (event.target.closest('input, select, textarea, [contenteditable=true]')) event.stopPropagation()
      else if (event.target.closest('button, summary') && (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter')) event.stopPropagation()
    }, { signal })
    game.canvas.addEventListener('pointerdown', event => {
      if (!this.started || this.menuVisible || game.input.suspended || event.pointerType === 'touch' || event.button !== 0) return
      // The first click in play captures the cursor: from then on moving the mouse swings the
      // camera round the vehicle (ChaseCamera reads the locked pointer), and Escape lets the
      // cursor go again, which the browser does itself. That first click only captures.
      // (Networking also listens for clicks here, after this listener; stop it hearing this one.)
      if (this.userPaused) return
      if (this.capturesCursor && document.pointerLockElement !== game.canvas) { void this.captureCursor(); event.stopImmediatePropagation(); return }
      game.input.mouseFire = true
      if (document.pointerLockElement !== game.canvas) game.canvas.setPointerCapture(event.pointerId)
    }, { signal })
    // Losing the capture (Escape, a switch of window) must not leave a beam held down.
    document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== game.canvas) game.input.mouseFire = false }, { signal })
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) game.canvas.addEventListener(name, () => { game.input.mouseFire = false }, { signal })
    window.addEventListener('blur', () => { game.input.mouseFire = false }, { signal })
    // Where sound is blocked, the veil waits for the tap that begins (TapToBegin.ts).
    this.updateHelp(); bootLoading?.finish(tapToBegin(this.audio))
    void this.panels.show('index', true); this.update()
  }
  private updateRoomLabels(): void {
    this.updateInvite()
  }
  private updateInvite(): void {
    const url = this.lobbyAddress?.inviteURL(this.room, encodeWorld()) ?? inviteUrl(location.origin, this.room, encodeWorld())
    this.invite.update(url, this.room, this.playerCount)
  }
  openJoin(): void {
    this.stopAttract()
    if (this.inviteOpen || this.aboutOpen) return
    this.inviteFromGame = this.started && !this.menuVisible
    this.joinOpener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : undefined
    if (this.inviteFromGame) { this.releaseCursor(); this.game.input.suspended = true; this.game.input.mouseFire = false; this.touch.enabled = false }
    this.inviteOpen = true; this.overlay.inert = true; this.invite.show(); this.updateInvite()
  }
  private aboutOpen = false
  private aboutOpener?: HTMLElement
  private cancelActions?: () => void
  /** Main binds this before play: it drops charged or held gear without firing it. */
  setActionCancellation(cancel: () => void): void { this.cancelActions = cancel }
  /**
   * The lobby's About guide, over the running world. The room, the URL and the pause state
   * stay as they are. Gear in hand is cancelled first, so the input going quiet is not read
   * as a release (a Big Red send or a Yoink fling); then input is suspended, which also drops
   * held keys, so a key still down when the guide closes does nothing until pressed again.
   */
  readonly updateNotice: UpdateNotice
  private bandTop = ''
  /**
   * Place the update banner at the top centre of the screen and return the height the galaxy
   * keeps clear for it, so no world, label or the wordmark (which now stands in the scene,
   * src/ui/brand/wordmarkScene.ts) sits under it. 0 when the banner is not on screen.
   */
  private updateBand(): number {
    const banner = this.updateNotice?.banner
    if (!banner || banner.hidden || !this.menuVisible && this.started || banner.offsetParent === null) return 0
    const top = 'max(12px, env(safe-area-inset-top))'
    if (top !== this.bandTop) { this.bandTop = top; banner.style.top = top }
    return banner.offsetTop + banner.offsetHeight + 12
  }
  /** Updates: the in-play guide at its Updates tab while playing, else the lobby's Updates sheet. */
  showUpdates(): void {
    if (this.playing) { this.openAbout('updates'); return }
    this.openLobbySheet(this.updatesSheet)
  }
  /** The lobby's About sheet, as its icon opens it. */
  showLobbyAbout(): void { this.openLobbySheet(this.aboutSheet) }
  private readonly aboutSheet: LobbySheet
  private lobbyWelcome?: Welcome
  private readonly playWelcome: Welcome
  private readonly updatesSheet: LobbySheet
  private get lobbySheets(): LobbySheet[] { return [this.aboutSheet, this.updatesSheet] }
  /** One lobby sheet at a time, over the galaxy; the settings card closes first. */
  private openLobbySheet(sheet: LobbySheet): void {
    if (this.playing) return
    // Its own button again: close it, as the gear always has.
    if (sheet.isOpen) { sheet.close(); return }
    const home = sheet === this.aboutSheet ? this.lobbySettings.about : this.lobbySettings.version
    this.lobbySettings.close(false)
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !document.activeElement.closest('dialog.lobby-sheet') ? document.activeElement : home
    // Another sheet already up: it hands over and this one takes its place, so the panel stays
    // and only its contents change (a morph, not a close and reopen).
    const current = this.lobbySheets.find(s => s.isOpen)
    if (current) current.handOff()
    // The worlds fade out, the sky dims a little and the name rises over the contents (LobbySheet).
    // Wherever the player had swiped, the view eases to where the name reads well, so it stands
    // over the sheet and is already in place when the sheet closes (Galaxy.frameName).
    if (this.galaxy) { this.galaxy.backdrop = SHEET_BACKDROP; this.galaxy.markLift = 1; this.galaxy.worlds = 0; this.galaxy.frameName() }
    // The three buttons stay beside the open sheet, above its backdrop, to switch between them;
    // the open one is marked.
    const dock = this.lobbySettings.dock
    sheet.element.append(dock); dock.classList.add('is-beside-sheet')
    const about = this.lobbySettings.about, isAbout = sheet === this.aboutSheet
    about.classList.toggle('is-current', isAbout); if (isAbout) about.setAttribute('aria-current', 'true'); else about.removeAttribute('aria-current')
    sheet.open(opener, !!current)
  }
  openAbout(tab?: AboutTab): void {
    if (!this.playing || this.aboutOpen || this.inviteOpen || this.exitAsking || this.dropping) return
    this.cancelActions?.()
    this.aboutOpener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    this.aboutOpen = true
    this.releaseCursor()
    this.game.input.suspended = true; this.game.input.poll(); this.touch.enabled = false
    const guide = this.element.querySelector<HTMLDialogElement>('.in-play-about')!
    if (tab) showAboutTab(guide, tab)
    if (!guide.querySelector<HTMLElement>('[data-about-pane="about"]')!.hidden) this.playWelcome.opened()
    guide.showModal()
    guide.scrollTop = 0
    guide.querySelector<HTMLElement>('h2')!.focus({ preventScroll: true })
    this.syncPanels()
  }
  closeAbout(): void {
    if (!this.aboutOpen) return
    this.aboutOpen = false
    const guide = this.element.querySelector<HTMLDialogElement>('.in-play-about')!
    if (guide.open) guide.close()
    this.game.input.suspended = this.userPaused || this.menuVisible || this.inviteOpen || this.exitAsking
    this.touch.enabled = !this.game.input.suspended
    this.syncPanels()
    // Back to where the player opened it. The cursor is not captured on this click or key:
    // the next click on the world resumes driving, as after any panel.
    const opener = this.aboutOpener
    this.aboutOpener = undefined
    const focus = opener?.isConnected && !opener.closest('[hidden], [inert]') ? opener : this.element.querySelector<HTMLElement>(this.userPaused ? '.pause-veil' : '.rail-about')
    focus?.focus({ preventScroll: true })
  }
  closeJoin(): void {
    if (!this.inviteOpen) return
    this.inviteOpen = false; this.invite.hide(); this.overlay.inert = false
    if (this.inviteFromGame) this.closeMenu()
    else {
      // Back to what had focus; opened by J from nowhere in particular, focus goes nowhere, so J
      // (ignored while a button has focus) toggles the view again.
      const opener = this.joinOpener
      if (opener?.isConnected && !opener.closest('[hidden], [inert]')) opener.focus({ preventScroll: true })
      else (document.activeElement as HTMLElement | null)?.blur()
    }
    this.joinOpener = undefined
  }
  get vehicleKind(): VehicleChoice['vehicleKind'] { return this.choice.vehicleKind }
  get bodyColor(): string { return this.choice.bodyColor }
  get accentColor(): string { return this.choice.accentColor }
  get playerName(): string { return cleanPlayerName(this.nameInput.value) || 'Explorer' }
  /** A link supplies the name for this session until the player chooses one. */
  private nameSource: NameSource | 'link'
  /** Set by initGameShell: the name changed in play, so the vehicle and the room follow. */
  onRename?: (name: string) => void
  /** The player renamed themselves in the Me card: saved at once, and the room told. */
  private setPlayerName(raw: string): void {
    const name = cleanPlayerName(raw)
    if (!name || name === this.playerName) return
    this.nameInput.value = name; this.nameSource = 'typed'
    savePlayerName(name, 'typed')
    this.onRename?.(name)
  }
  get room(): string { return this.roomInput.value.trim().slice(0, 64) || DEFAULT_ROOM }
  get playing(): boolean { return this.started && !this.menuVisible }
  /** Keep world labels beside the inspector, but never over a modal or paused game. */
  get vehicleLabelsVisible(): boolean { return this.playing && !this.userPaused && !this.inviteOpen && !this.exitAsking }
  get menuOpen(): boolean { return this.menuVisible }
  /** Idle driving must not take control while the player uses panels or enters text. */
  get daydreamBlocked(): boolean {
    const focused = document.activeElement
    const editing = focused instanceof HTMLElement && (focused.matches('input, textarea, select') || focused.isContentEditable)
    return !this.playing || this.panelsWanted || this.userPaused || this.inviteOpen || this.exitAsking || this.aboutOpen || editing
  }
  get activePanel(): string { return this.panels.active }
  get presentation(): boolean { return this.element.classList.contains('is-presentation') }
  setPresentation(enabled: boolean): void { this.element.classList.toggle('is-presentation', enabled); this.switches.get('presentation')?.(enabled) }
  /** Make a switchHtml field live: the switch role and state, and the on/off word beside it. */
  private bindField(field: HTMLElement, signal: AbortSignal): (on: boolean) => void {
    const input = field.querySelector('input')!, word = field.querySelector('.s3-switch-word')!
    const set = bindSwitch(input, { signal })
    const show = () => { word.textContent = switchWord(input.checked); field.classList.toggle('is-checked', input.checked) }
    input.addEventListener('change', show, { signal })
    return on => { if (input.checked === on && word.textContent === switchWord(on)) return; set(on); show() }
  }
  setPlayerCount(count: number): void { this.playerCount = Math.max(0, Math.floor(count)); this.updateInvite() }
  private lastMatch: MatchState | null = null
  setRace(snapshot: Readonly<RaceState> | null, roomNow: () => number, role: Readonly<RaceRole>): void {
    this.raceHud.setState(snapshot, roomNow, role)
  }
  setMatchState(state: MatchState | null): void {
    const prev=this.lastMatch
    if(state?.mode==='koth'){
      if(state.winner && state.winner!==prev?.winner)this.audio.cue('win')
      else if(state.contested&&!prev?.contested)this.audio.cue('contested')
      else if(state.holderIsYou&&!state.contested&&(!prev?.holderIsYou||prev.contested))this.audio.cue('capture')
      else if(prev?.holderIsYou&&!state.holderIsYou)this.audio.cue('lost')
      else if(state.holderName&&state.holderName!==prev?.holderName&&!state.contested)this.audio.cue('capture')
    }
    // The adaptive score follows the match: your share of the target, and whether you hold the hill.
    const mine=state?.scores.find(score=>score.you)
    this.audio.setMatch(state&&!state.winner?{holding:state.holderIsYou&&!state.contested,contested:state.contested&&state.holderIsYou,progress:mine&&state.target>0?mine.score/state.target:0}:null)
    this.lastMatch=state?{...state}:null
    this.matchHud.setState(state)
  }
  setTerrain(terrain: Terrain): void { this.ground = terrain; this.minimap?.dispose(); this.minimap = new Minimap(terrain, this.element); }
  /** The camera the descent from the galaxy drives. */
  setCinematicCamera(camera: CinematicCamera): void { this.cinematic = camera }
  /**
   * The idle volcano tour is gone (owner, 15 November 2026: it must never show). These two
   * remain only because browser test scripts still call them; remove both with those calls.
   */
  stopAttract(): void { this.lastActivity = performance.now() }
  get attracting(): boolean { return false }
  setMapEntities(entities: readonly MapEntity[]): void { this.minimap?.setEntities(entities) }
  setMapSelf(entity: MapEntity): void { this.self = entity; this.minimap?.setSelf(entity) }
  /**
   * The player's speed (m/s), height above the ground (m, for the arrival camera) and height
   * above sea level (m, which the focus display's ALT readout shows).
   */
  setTelemetry(speed: number, altitude: number, thrust?: number, seaAltitude = altitude): void { this.telemetry.speed = speed; this.telemetry.altitude = altitude; this.telemetry.thrust = thrust; this.telemetry.seaAltitude = seaAltitude }
  private inspectorSummary(id: string): string {
    if (id === 'world') {
      const hour = currentHour()
      const time = `${String(Math.floor(hour) % 24).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`
      return `${currentWorldName()} · ${currentPlanet().label} · ${time}`
    }
    if (id === 'game') { const bots = Number(params.get('bots.count')?.value ?? 0); const playing = Number(params.get('game.mode')?.value ?? 2); return `${modeName(playing)}${bots ? ` · ${bots} ${bots === 1 ? 'bot' : 'bots'}` : ''}` }
    if (id === 'you') { const current = this.activeVehicleKind === 'buggy' ? 'buggy-syn3h' : this.activeVehicleKind; return `${this.playerName} · ${PLAY_VEHICLES.find(vehicle => vehicle.id === current)?.label ?? ''}` }
    return id === 'vehicles' ? 'Handling and tuning' : ''
  }
  /**
   * Change vehicle in play. The game builds its vehicle once at start, so this saves the
   * choice and reloads straight back into the same room, as the lobby does. The player
   * starts again from a spawn pad.
   */
  private switchVehicle(kind: VehicleKind): void {
    if (kind === this.activeVehicleKind || (kind === 'buggy-syn3h' && this.activeVehicleKind === 'buggy')) return
    saveVehicleChoice({ ...this.choice, vehicleKind: kind })
    // Swap in place when the game offers it: same spot, heading and speed, no reload. The swap
    // returns the vehicle now being driven, or null when it cannot run (bots or networking
    // cannot follow yet). On null, or if it throws, fall through to the reload below, which
    // always works. main.ts re-points hints, audio and the readouts through setPlayer.
    // Every buggy name is the buggy (the rule of canonicalVehicleKind in src/vehicles).
    const family = (name: string): string => name === 'jet' || name === 'hovercraft' || (name === 'tank' && isVehicleAvailable(name)) ? name : 'buggy'
    if (this.vehicleSwap) {
      try {
        const next = this.vehicleSwap(kind)
        if (next && family(next.kind) === family(kind)) { this.choice.vehicleKind = kind; this.audio.cue('click'); return }
      } catch (error) { console.warn('Vehicle swap failed; reloading instead', error) }
    }
    try { sessionStorage.removeItem(RESUME_KEY) } catch { /* Storage is optional. */ }
    // The resume session saves the old vehicle again while the page unloads (pagehide, then
    // visibilitychange), which would undo this choice. These listeners are registered after
    // its own, so each runs after that save and clears it. The URL stays free of ?vehicle=,
    // which would otherwise override later lobby choices.
    const forget = () => { try { sessionStorage.removeItem(RESUME_KEY) } catch { /* Storage is optional. */ } }
    window.addEventListener('pagehide', forget); document.addEventListener('visibilitychange', forget)
    const url = this.lobbyAddress?.playURL() ?? new URL(location.href); url.searchParams.delete('vehicle'); url.searchParams.set('autoplay', '1')
    // The picker shows the choice as under way until the page goes.
    this.pendingVehicle = kind
    location.replace(url)
  }
  /** A vehicle being switched to by a reload, shown as pending in the picker. */
  private pendingVehicle?: VehicleKind
  private vehicleSwap?: (kind: VehicleKind) => Vehicle | null
  /** main.ts hands over the in-place vehicle swap. Without it the selector reloads the page. */
  setVehicleSwap(swap: (kind: VehicleKind) => Vehicle | null): void { this.vehicleSwap = swap }
  setLoadingMessages(messages: string[]): void { bootLoading?.setMessages(messages) }
  setParamPanel(panel: ParamPanel): void { this.paramPanel = panel }
  showPanel(id: string): void {
    if(id!==this.panels.active)this.audio.cue('click')
    this.lastActivity = performance.now()
    if (id !== 'index') this.galaxyFor(id)
    if (id !== 'advanced') this.advancedGroups = undefined
    if (id === 'advanced') {
      const panel = this.paramPanel ?? (window as unknown as { mira?: { panel?: ParamPanel } }).mira?.panel
      panel?.show(this.element.querySelector('.advanced-host')!); panel?.setGroups(this.advancedGroups); this.paramPanel = panel
    } else this.paramPanel?.hide()
    void this.panels.show(id).then(() => {
      if (this.panels.active === id && id === 'index') {
        this.galaxyFor(id)
        ;(this.element.querySelector<HTMLElement>('.galaxy-links button') ?? this.lobbySettings.about).focus({ preventScroll: true })
      }
    })
  }
  /**
   * Enter the world. From the lobby's own button (`descend`), with the galaxy up, the entry is
   * a descent: the view falls toward the chosen world until its air fills the screen, then
   * the game's camera comes down out of that brightness from high above the spawn point to
   * its place behind the vehicle, and the blur clears. The room is joined at the start, so
   * the wait is spent falling. Called from code (tests, autoplay, Return to Game) it is
   * shown without a flight, as it is for reduced motion. Entry still waits for graphics.
   */
  /**
   * `automatic`: a start nobody asked for in this page (?autoplay=1, the reload after a vehicle
   * switch). It never asks for the cursor. Chrome can still report the page's user activation as
   * active then, with no tap, click or key in it (seen in headless Chrome, 24 November 2026), and
   * the cursor taken then left the Test flash control unclickable.
   */
  play(descend = false, automatic = false): void {
    if (!this.started) recordStartupPlayRequest()
    this.stopAttract()
    if (this.started) { this.closeMenu(); return }
    if (!automatic) this.requestEntryCursor()
    this.unlockAudio(); this.begin()
    if (descend && this.galaxy?.live && this.menuVisible && !matchMedia('(prefers-reduced-motion: reduce)').matches) { this.onPlay?.(); void this.descent(currentPlanet().id); return }
    this.onPlay?.(); void this.enterWithoutFlight()
  }
  /** Audio may only start inside a tap or a key press: call this from one. */
  private unlockAudio(): void {
    void this.audio.unlock().then(async () => { await this.audio.ready(); this.audio.play('materialize') }).catch(() => this.toast('Audio is unavailable. You can still play.'))
  }
  /** The session starts: the name is kept and the choices that cannot change in play are fixed. */
  private begin(): void {
    longFrames.event('Join world')
    // Play has begun: from here the cursor request made at the entering gesture (if any) is
    // judged like any other.
    this.enteringByGesture = false
    if (this.nameSource !== 'link') savePlayerName(this.playerName, this.nameSource)
    this.started = true; this.worldDirty = true; this.nameInput.disabled = true; this.roomInput.disabled = true
    this.element.querySelector<HTMLButtonElement>('.shell-play')!.textContent = 'Return to Game ›'
  }
  /**
   * A world tapped in the galaxy. Any world but Custom is a drop, straight from the tap: no
   * form, no pause. Returns true when the tap is dealt with here (a drop, or a refusal).
   */
  private tapWorld(galaxyId: string): boolean {
    const id = galaxyId.split('~')[0], current = currentPlanet().id
    if (this.dropping) return true
    if (id === 'custom') return false
    if (this.invited && !this.started && id !== current) { this.say('You were invited to another world. You can change it once you are in, if the host allows.'); return true }
    if (!canEditWorld() && id !== current) { this.say('The host has locked this world.'); return true }
    if (!this.started) recordStartupPlayRequest()
    this.stopAttract()
    // No galaxy to fly through (or no motion wanted): straight in.
    if (!this.galaxy?.live || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      if (id !== current) this.applyGalaxyWorld(galaxyId)
      if (this.started) this.closeMenu(); else this.play()
      return true
    }
    if (!this.started) { this.requestEntryCursor(); this.unlockAudio() }
    void this.descent(galaxyId, () => {
      // Under the light, where a hitch cannot be seen: the world is built and the room joined.
      if (id !== currentPlanet().id) this.applyGalaxyWorld(galaxyId)
      if (!this.started) { this.begin(); this.onPlay?.() }
    })
    return true
  }
  /** True from a drop's tap until the player is on the ground. */
  private dropping = false
  /** True while a descent into a world or an ascent out of one is running. */
  get transitioning(): boolean { return this.dropping || this.savedEntering }
  openMenu(panel = 'index'): void {
    if (!this.started) return
    this.closeAbout()
    this.lobbyAddress?.showLobby()
    if (this.exitAsking) { this.exitAsking = false; this.element.querySelector<HTMLElement>('.exit-confirm')!.hidden = true }
    this.menuVisible = true; this.overlay.hidden = false; this.overlay.inert = false; if (this.galaxy) this.galaxy.enabled = true
    this.releaseCursor()
    this.game.input.suspended = true; this.game.input.mouseFire = false; this.game.input.poll(); this.touch.enabled = false
    this.audio.enabled = false; this.audio.setLobbyVisible(true); this.element.classList.remove('is-playing'); this.showPanel(panel)
    this.hidePlayControls()
  }
  /**
   * The in-play controls go with play: left attached, the Panels control rose over the lobby
   * whenever the lobby's settings card (a .world-inspector too) opened on a touch screen, and it
   * stayed on screen, tappable, through the whole climb out of a world as the galaxy faded in
   * (the owner, 23 November 2026, on an iPhone). The touch thumb controls go with touch.enabled.
   */
  private hidePlayControls(): void {
    for (const selector of ['.shell-hud', '.hud-navigation']) this.element.querySelector<HTMLElement>(selector)!.hidden = true
  }
  /** A room welcome may replace the selected planet. Compile against the settled world. */
  private async waitForEntryWorld() {
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const joinBy = performance.now() + 5000
    const net = () => (window as { miraNet?: { connected?: boolean } }).miraNet
    while (net() && !net()!.connected && performance.now() < joinBy) await frame()
    await frame()
    while (this.ground?.ready === false) await this.ground.whenReady?.()
  }

  private async warmEntryGraphics() {
    const progress = document.createElement('div')
    progress.className = 'entry-warm-progress'
    progress.setAttribute('role', 'status')
    progress.textContent = 'Preparing world'
    // The lobby controls are inert during entry. Keep the status accessible outside them, in the
    // bottom-centre stack (bottom-stack.css).
    ;(this.bottomStack?.isConnected ? this.bottomStack : this.element).append(progress)
    try {
      await this.game.precompile(label => {
        if (progress.textContent !== label) progress.textContent = label
      })
    } finally { progress.remove() }
  }

  /** Reduced motion, direct play and autoplay use the same covered production draws. */
  private async enterWithoutFlight() {
    if (this.dropping) return
    this.dropping = true
    this.game.holdDraws = true
    this.overlay.inert = true
    try {
      await this.waitForEntryWorld()
      await this.warmEntryGraphics()
    } catch (error) {
      console.warn('World preparation failed; entering anyway.', error)
    } finally {
      this.game.holdDraws = false
      this.dropping = false
      this.closeMenu()
      this.showHelp(false)
    }
  }

  /**
   * The drop, one unbroken motion. The galaxy flies across the system to the world and down
   * into its air, with motion blur (Galaxy.descend). Under the light at the bottom of the
   * dive `underLight` builds the world and joins the room, and the drop holds there only as
   * long as the room takes to answer (a slow join can rebuild the world and move the spawn
   * point). Then the game shows through, blurred, its camera falling from 520 m and easing
   * into the follow camera's own place behind the vehicle, which takes over from there. A
   * player who has seen it before gets a quicker drop; a tap, click or key lands at once.
   */
  private async descent(galaxyId: string, underLight?: () => void): Promise<void> {
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const game = document.getElementById('game'), root = this.element, camera = this.cinematic
    this.dropping = true; root.classList.add('is-descending'); this.overlay.inert = true
    const skipping = new AbortController()
    let landed = false
    let stopFollowingWorld: (() => void) | undefined
    try {
      let seen = 0
      try { seen = Number(localStorage.getItem('mira.descents')) || 0; localStorage.setItem('mira.descents', String(seen + 1)) } catch { /* Storage is optional. */ }
      let skip = false
      // Listen from the next frame, so the tap that started the drop does not also end it.
      requestAnimationFrame(() => { for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, () => { skip = true }, { signal: skipping.signal, capture: true }) })
      // While the lobby still covers it, hold the game's camera high over the player, every
      // frame of the wait. The world can be rebuilt at any moment of it (the tapped planet,
      // or the room's own world arriving), which moves the spawn point by up to a kilometre,
      // and the galaxy's light has faded before the wait ends: a camera left over the old
      // spawn point shows the new world from wherever that happens to be, then jumps.
      const view = (this.game as unknown as { camera?: { position: Vector3 } }).camera
      const lift = () => { pose = this.descentPose(); pose(0); if (view && this.descentTop) view.position.copy(this.descentTop) }
      const until = async (done: () => boolean, ms: number, holding = false) => { const end = performance.now() + ms; while (!done() && !skip && performance.now() < end) { if (holding) lift(); await frame() } }
      let pose = this.descentPose(); lift()
      // The main world listener has already moved the vehicle. Update in that same
      // turn, before the renderer can expose a frame over the previous spawn.
      stopFollowingWorld = this.ground?.onRegenerate?.(lift)
      // The world is prepared behind the dive, not under its light: from the tap it is rebuilt
      // in slices (heights from a worker) and the room is joined. The expensive draws wait
      // for the opaque hold; one cold driver pipeline can take hundreds of milliseconds.
      const ground = this.ground
      if (ground) ground.staged = true
      this.game.holdDraws = true
      let dived = false
      void this.galaxy!.descend(galaxyId, seen > 0).then(() => { dived = true })
      underLight?.(); lift()
      const prepareStart = performance.now()
      await this.waitForEntryWorld()
      // Keep the overlay opaque through the last draw, even on cold phone drivers.
      // A tap can skip the flight itself, but never interrupts a covered shader build.
      const graphics = this.warmEntryGraphics()
      const diveBy = performance.now() + 4000
      await Promise.all([graphics, (async () => {
        while (!dived && performance.now() < diveBy) { lift(); await frame() }
      })()])
      try { performance.measure('mira:descent preparation', { start: prepareStart, end: performance.now() }) } catch { /* Older engines. */ }
      if (ground) ground.staged = false
      this.game.holdDraws = false
      lift(); stopFollowingWorld?.(); stopFollowingWorld = undefined
      // Through the air: the lobby fades off the top of the game, which arrives blurred and clears.
      const length = skip ? 0 : seen > 0 ? 1700 : 2400
      if (game) { game.style.transition = 'none'; game.style.filter = skip ? 'none' : 'blur(12px) brightness(1.3)' }
      this.overlay.style.transition = `opacity ${skip ? 0.2 : 0.6}s ease-out`
      if (this.started && recordStartupReveal()) markShaderReveal()
      this.overlay.style.opacity = '0'
      await frame()
      if (game && !skip) { game.style.transition = `filter ${(length * 0.7 / 1000).toFixed(2)}s cubic-bezier(.1,.6,.3,1)`; game.style.filter = 'none' }
      const started = performance.now()
      await new Promise<void>((resolve, reject) => { const step = () => { try { const t = skip || length === 0 ? 1 : Math.min(1, (performance.now() - started) / length); (pose = this.descentPose())(t); if (t < 1) requestAnimationFrame(step); else resolve() } catch (error) { reject(error) } }; step() })
      // The camera eases along the path a little behind it: let it settle into the follow
      // camera's place, then hand over with a blend (an instant cut where that is not offered).
      const end = this.descentEnd
      if (view && end && !skip) await until(() => view.position.distanceTo(end) < 0.15, 1200)
      if (camera) (camera.clearCinematicPose as (blendSeconds?: number) => void).call(camera, skip ? 0 : 0.8)
      landed = true
    } catch (error) {
      console.warn('World descent failed', error)
      this.say('The flight was interrupted. You can continue playing or choose a world again.')
    } finally {
      // Whatever happened on the way (a world that failed to build, say), never leave the
      // lobby inert, blurred or half faded: put everything back and let the player in.
      stopFollowingWorld?.(); skipping.abort()
      if (this.ground) this.ground.staged = false
      this.game.holdDraws = false
      if (!landed) camera?.clearCinematicPose()
      this.overlay.style.removeProperty('transition'); this.overlay.style.removeProperty('opacity'); root.classList.remove('is-descending')
      if (game) { game.style.removeProperty('transition'); game.style.removeProperty('filter'); game.style.removeProperty('visibility') }
      this.game.holdDraws = false
      this.dropping = false; this.enteringByGesture = false
      if (this.started) { this.closeMenu(); this.showHelp(false) }
      else { cancelStartupPlayRequest(); this.releaseCursor(); this.overlay.inert = false; this.galaxy?.home() }
    }
  }
  /**
   * Leaving a world: the drop played backwards, as one motion. The camera rises from its place
   * behind the vehicle along the descent's own path, slowly at first, then fast into the air
   * 520 m up, while the view blurs and brightens; the galaxy fades in over it at the world's
   * air, with the dive's light full; then it climbs out of the air, back across the system,
   * and settles on the whole view, where the lobby appears. The world and the room carry on
   * behind, as they always have: nothing is torn down, so nothing has to be sliced.
   */
  private async ascent(): Promise<void> {
    const galaxy = this.galaxy
    if (!this.started || this.menuVisible) return
    // Every way out of a world ends at the fresh-load lobby view (Galaxy.returnHome).
    if (!galaxy || this.dropping || matchMedia('(prefers-reduced-motion: reduce)').matches) { this.openMenu(); galaxy?.returnHome(); return }
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    const game = document.getElementById('game'), root = this.element, camera = this.cinematic
    this.dropping = true
    let quick = false
    try { quick = (Number(localStorage.getItem('mira.descents')) || 0) > 1 } catch { /* Storage is optional. */ }
    const length = quick ? 1700 : 2400
    try {
      // Controls let go at once, as when the menu opens; the HUD fades with the lobby's rules.
      this.closeAbout(); this.lobbyAddress?.showLobby()
      this.releaseCursor()
      this.game.input.suspended = true; this.game.input.mouseFire = false; this.game.input.poll(); this.touch.enabled = false
      this.hidePlayControls()
      this.audio.enabled = false; this.audio.setLobbyVisible(true)
      this.menuVisible = true
      root.classList.add('is-descending'); root.classList.remove('is-playing')
      // The galaxy wakes behind the game, transparent, in the world's air: its first frames
      // are drawn before anyone can see them.
      this.overlay.style.transition = 'none'; this.overlay.style.opacity = '0'
      this.overlay.hidden = false; this.overlay.inert = true
      galaxy.backdrop = 1; galaxy.worlds = 1; galaxy.markLift = 0
      galaxy.enabled = true
      // Every vehicle keeps its close look on the way up (see vehicleDetail).
      vehicleDetail.holdNear = true
      const flight = galaxy.ascend(currentPlanet().id, quick)
      // Up through the air: the descent's path from its end back to its top.
      const path = this.descentPose()
      if (game) { game.style.transition = `filter ${(length * 0.7 / 1000).toFixed(2)}s cubic-bezier(.7,0,.9,.4) ${(length * 0.3 / 1000).toFixed(2)}s`; game.style.filter = 'blur(12px) brightness(1.3)' }
      let faded = false
      const started = performance.now()
      await new Promise<void>((resolve, reject) => {
        const step = () => {
          try {
            const raw = Math.min(1, (performance.now() - started) / length)
            path(1 - raw)
            // The galaxy comes in over the last stretch of the climb, as the lobby left on the way down.
            if (!faded && raw >= 1 - 600 / length) { faded = true; this.overlay.style.transition = 'opacity .6s ease-in'; this.overlay.style.opacity = '1' }
            if (raw < 1) requestAnimationFrame(step); else resolve()
          } catch (error) { reject(error) }
        }
        step()
      })
      // Covered now: the game goes back to its few frames a second behind the galaxy.
      await frame()
      // The galaxy covers the game now: stop compositing it and stop drawing it. A full-screen
      // WebGPU canvas under a blur filter, composited behind an opaque WebGL galaxy, stalled
      // the GPU for 0.6 to 1.8 s at High once the galaxy's flight began; hidden but still drawn
      // (the covered lobby's two frames a second, the first of them back at the vehicle after
      // the climb), it still stalled 0.6 to 1.2 s. Both resume when the lobby takes over.
      if (game) { game.style.removeProperty('transition'); game.style.removeProperty('filter'); game.style.visibility = 'hidden' }
      this.game.holdDraws = true
      // From the world's air the galaxy eases home on its own (the lobby's drift), rather than
      // flying its close-up of the world back out: that fly-out, the first close-up a freshly
      // made galaxy context drew, stalled the GPU for up to 2 s in some exits at High. Without
      // it no exit frame passed 100 ms, and leaving is shorter. The name kindles once, here.
      galaxy.returnHome()
      root.classList.remove('is-descending')
      camera?.clearCinematicPose()
      await flight.done
    } catch (error) {
      console.warn('World ascent failed', error)
      galaxy.returnHome()
    } finally {
      this.overlay.style.removeProperty('transition'); this.overlay.style.removeProperty('opacity')
      root.classList.remove('is-descending')
      if (game) { game.style.removeProperty('transition'); game.style.removeProperty('filter'); game.style.removeProperty('visibility') }
      this.game.holdDraws = false
      // However leaving ends, vehicles go back to choosing their look by distance: the lobby's
      // Return to game, a world entered without a descent, or an ascent that failed.
      vehicleDetail.holdNear = false
      this.dropping = false
      // The lobby as Leave world has always left it, from the view the flight settled on.
      this.menuVisible = false
      this.openMenu()
    }
  }
  /** The first and last points of the descent's camera path, for waiting on the camera. */
  arrivalVehicle?: () => { x: number; z: number; heading: number; altitude: number }
  private descentTop?: Vector3
  private descentEnd?: Vector3
  /**
   * The descent's camera path over where the player is now: t from 0 (520 m up, looking down
   * at the spawn point) to 1 (where the follow camera sits: behind the vehicle by its arm,
   * raised by its height ratio, looking level along the vehicle's heading). It falls fast at
   * first, carrying on the dive's speed, and slows into place.
   */
  private descentPose(): (t: number) => void {
    const live = this.arrivalVehicle?.(), ground = this.ground, camera = this.cinematic
    const self = live ?? this.self
    if (!self || !camera) { this.descentTop = this.descentEnd = undefined; return () => {} }
    // The path itself is src/core/arrival.ts, built from where the vehicle is now.
    const path = arrivalPath({ x: self.x, z: self.z, heading: self.heading, floor: ground?.heightAt(self.x, self.z) ?? 0, altitude: live?.altitude ?? this.telemetry.altitude,
      arm: camOffset.value + camDistance.value, heightRatio: camHeight.value, fov: camFov.value })
    this.descentTop = path.top; this.descentEnd = path.end
    const position = new Vector3(), look = new Vector3()
    return t => {
      // The field of view goes from about the galaxy's (64 degrees) to the follow camera's own.
      const fov = path.pose(t, position, look)
      ;(camera.setCinematicPose as (position: Vector3, target: Vector3, fov?: number) => void).call(camera, position.clone(), look.clone(), fov)
    }
  }
  private ground?: Terrain
  private cinematic?: CinematicCamera
  private self?: MapEntity
  closeMenu(): void {
    // Not while a descent or an ascent is running: Escape mid-descent used to start play with
    // the world's draws still held (driving a frozen picture for up to 15 s), and mid-ascent
    // flipped to playing just before the ascent hid the game and reopened the lobby. Each
    // transition ends by putting the menu where it belongs.
    if (!this.started || this.dropping) return
    this.lobbyAddress?.showPlay(this.room)
    if (this.menuVisible && recordStartupReveal()) markShaderReveal()
    this.menuVisible = false; this.overlay.hidden = true; this.overlay.inert = true; if (this.galaxy) this.galaxy.enabled = false
    this.lobbySettings.close(); for (const sheet of this.lobbySheets) sheet.close()
    this.game.input.suspended = false; this.touch.enabled = true; this.audio.enabled = true; this.audio.setLobbyVisible(false); this.paramPanel?.hide()
    this.element.classList.add('is-playing')
    this.element.querySelector<HTMLElement>('.shell-hud')!.hidden = false
    this.element.querySelector<HTMLElement>('.hud-navigation')!.hidden = false
    this.touchPanels = false; this.syncPanels()
  }
  get lobbyGlassContextLost() { return this.galaxy?.glassContextLost === true }
  refreshLobbyGlass() { this.galaxy?.refreshGlass() }

  private queuedGlass?: () => Promise<void>
  applyGlassMaterial(load: () => Promise<void>) {
    this.queuedGlass = load
    if (!this.qualityVeil) void this.applyQualityBehindVeil()
  }

  private qualityVeil: HTMLDivElement | null = null
  private queuedQuality?: { level: QualityLevel; apply: () => void }
  /** A level climb the game takes behind this veil (Game.takeCoveredClimb): shown until it is done. */
  private queuedClimb?: { level: QualityLevel; job: Promise<void> }
  private showCoveredClimb(level: QualityLevel, job: Promise<void>): void {
    this.queuedClimb = { level, job }
    if (!this.qualityVeil) void this.applyQualityBehindVeil()
  }
  qualityCheckSignal?: AbortSignal
  private async applyQualityBehindVeil(): Promise<void> {
    const veil = document.createElement('div')
    veil.className = 'quality-change-veil'
    const title = document.createElement('strong')
    const status = document.createElement('span')
    status.setAttribute('role', 'status')
    const meter = document.createElement('div')
    meter.className = 'quality-progress'
    meter.setAttribute('role', 'progressbar')
    meter.append(document.createElement('span'))
    meter.setAttribute('aria-label', 'Graphics preparation')
    veil.append(title, status, meter)
    this.qualityVeil = veil
    this.element.append(veil)
    try {
      while ((this.queuedQuality || this.queuedGlass || this.queuedClimb) && !this.abort.signal.aborted) {
        if (this.queuedClimb) {
          const { level, job } = this.queuedClimb
          this.queuedClimb = undefined
          title.textContent = 'Applying ' + LEVELS[level].name
          status.textContent = 'Updating graphics settings'
          this.game.climbStatus = phase => { status.textContent = phase }
          try { await job } finally { this.game.climbStatus = undefined }
          continue
        }
        if (!this.queuedQuality && this.queuedGlass) {
          const load = this.queuedGlass
          this.queuedGlass = undefined
          title.textContent = 'Applying Liquid glass'
          status.textContent = 'Preparing glass surfaces'
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
          try {
            await load()
            if (this.playing && liquidSelected()) await this.game.prepareManualQuality(() => {}, this.abort.signal,
              phase => { status.textContent = phase }, true)
          } catch (error) { console.warn('Glass preparation failed', error) }
          continue
        }
        if (!this.queuedQuality) break
        const { level, apply } = this.queuedQuality
        this.queuedQuality = undefined
        title.textContent = 'Applying ' + LEVELS[level].name
        status.textContent = 'Updating graphics settings'
        await this.game.prepareManualQuality(apply, this.qualityCheckSignal ?? this.abort.signal,
          phase => { status.textContent = phase })
      }
    } finally {
      veil.remove()
      this.qualityVeil = null
    }
  }

  private performancePanel!: PerformancePanel
  /** The one owner of the bottom-centre strip (bottom-stack.css). */
  private readonly bottomStack = document.createElement('div')
  configurePerformance(source: PerformanceSource): void { this.performancePanel.configure(source) }
  /** True from the click or key press that enters a world until play begins or the entry is abandoned. */
  private enteringByGesture = false
  /**
   * Entering a world is the start of driving. The cursor is asked for here, inside the click
   * or key press itself, and held through the descent. Play begins seconds later, under the
   * descent, and by then a browser may no longer count the gesture: asking at that point made
   * the result depend on how long the descent took. An automatic start (?autoplay=1, the
   * reload after a vehicle switch) has no gesture and is not asked for, so it always arrives
   * with the cursor free and the panels open, in every browser.
   */
  private requestEntryCursor(): void {
    if (this.started || !this.capturesCursor) return
    const gesture = (navigator as { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true
    if (!gesture) return
    this.enteringByGesture = true
    void this.captureCursor(true)
  }
  private exitAsking = false
  /** Show "Leave this world?". Stay has the focus, so Enter, Escape and a click outside all stay. */
  private askExit(): void {
    // From the pause screen too: the question then stands above the veil (pause-screen.css).
    if (!this.started || this.menuVisible || this.exitAsking || this.aboutOpen) return
    this.exitAsking = true
    const dialog = this.element.querySelector<HTMLElement>('.exit-confirm')!
    dialog.hidden = false
    this.game.input.suspended = true; this.game.input.mouseFire = false
    dialog.querySelector<HTMLButtonElement>('.exit-stay')!.focus({ preventScroll: true })
  }
  private answerExit(leave: boolean): void {
    if (!this.exitAsking) return
    this.exitAsking = false
    this.element.querySelector<HTMLElement>('.exit-confirm')!.hidden = true
    this.game.input.suspended = this.userPaused || this.menuVisible || this.inviteOpen
    // Leaving from the pause screen ends the pause first, without taking the cursor: the
    // ascent needs the world running, and the lobby must not open under the veil.
    if (leave && this.userPaused) { if (this.pauseControl) this.pauseControl.resume('user'); else this.applyPause(false, null) }
    if (leave) void this.ascent()
    else this.element.querySelector<HTMLButtonElement>(this.userPaused ? '.pause-exit' : '.exit-world')?.focus({ preventScroll: true })
  }
  /**
   * Vehicle colours are chosen in play, beside the vehicle selector (the lobby offers only
   * planets). The vehicle repaints on every movement of the picker; the choice is saved and
   * announced to the room once the picker has been still for a moment, not on every step.
   * Set by initGameShell: `commit` is true for that settled call.
   */
  onTint?: (body: string, accent: string, commit: boolean) => void
  /** The colours showing now, easing towards the chosen ones (src/vehicles/tints.ts). */
  private readonly tintTransition = new TintTransition({ body: this.choice.bodyColor, accent: this.choice.accentColor })
  private tintTimer?: ReturnType<typeof setTimeout>
  private setTint(key: 'body' | 'accent', value: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return
    if (key === 'body') this.choice.bodyColor = value; else this.choice.accentColor = value
    // A dragged picker paints at once; only Randomize eases.
    this.tintTransition.jump({ body: this.choice.bodyColor, accent: this.choice.accentColor })
    this.onTint?.(this.choice.bodyColor, this.choice.accentColor, false)
    clearTimeout(this.tintTimer)
    this.tintTimer = setTimeout(() => { saveVehicleChoice(this.choice); this.onTint?.(this.choice.bodyColor, this.choice.accentColor, true) }, 200)
  }
  /**
   * A new pleasing pair (src/vehicles/tints.ts). The vehicle, swatches and header dots ease to
   * it over about a second; a press mid-change turns from the colours showing now. The room
   * is told the target once, at once, and every client eases to it on its own.
   */
  private randomizeTint(): void {
    const pair = randomTintPair(crypto.getRandomValues(new Uint32Array(1))[0])
    this.choice.bodyColor = pair.body; this.choice.accentColor = pair.accent
    this.tintTransition.set({ body: pair.body, accent: pair.accent })
    clearTimeout(this.tintTimer)
    saveVehicleChoice(this.choice)
    this.onTint?.(pair.body, pair.accent, true)
    this.audio.cue('click')
  }
  /** Touch only: the panels are showing rather than the driving view. Never stored. */
  private touchPanels = false
  /**
   * The driving view: the cursor is captured, or a desktop player chose the Driving or Hidden
   * interface (hud.mode). The one decision behind the panels and the focus display, so the
   * chosen view is exactly the captured one.
   */
  private get drivingView(): boolean {
    return document.pointerLockElement === this.game.canvas || (this.capturesCursor && interfaceMode.value >= 1)
  }
  private readonly interfaceVeil = new InterfaceVeil()
  /** Panels are wanted exactly when not in the driving view (or, on touch, when the menu state is on). */
  private get panelsWanted(): boolean {
    if (!this.started || this.menuVisible) return false
    return this.capturesCursor ? !this.drivingView : this.touchPanels
  }
  private syncPanels(): void {
    const wanted = this.panelsWanted
    if (this.inspector.open !== wanted) {
      this.inspector.hideTooltip(); this.inspector.open = wanted
      // Phones fade Show panels out as the panels grow from it (phone-panels.css).
      this.element.classList.toggle('is-panels', wanted)
      this.element.querySelector('.inspector-toggle')!.setAttribute('aria-pressed', String(wanted))
    }
    const locked = this.started && !this.menuVisible && !this.game.input.suspended && this.drivingView
    this.interfaceVeil.update(this.started && !this.menuVisible && !this.game.input.suspended)
    if (this.element.classList.contains('is-focus') !== locked) {
      this.element.classList.toggle('is-focus', locked)
      // A gear picked with the cursor leaves focus on the drum, where the arrow keys step
      // through gear. Once driving, they must drive.
      const focused = document.activeElement
      if (locked && focused instanceof HTMLElement && this.gearSelector.element.contains(focused)) focused.blur()
    }
  }
  /** Add a card to the end of the sidebar's stack (Chat, src/ui/chat/ChatCard.ts). */
  addCard(id: string, title: string, body: HTMLElement, summary: () => string): HTMLElement { return this.inspector.addCard(id, title, body, summary) }
  /**
   * Show the panels with this card open (Y and the left column's Chat row). Freeing the cursor
   * returns the interface to Full; the mode the player had comes back with returnToDriving.
   */
  showCard(id: string): void {
    if (!this.playing) return
    if (!this.inspector.open) this.modeBeforeCard = Math.round(interfaceMode.value)
    // Full now, not when the cursor is let go: the card's field must be focusable at once.
    if (Math.round(interfaceMode.value) !== 0) setInterfaceMode(0)
    this.showPanels(); this.inspector.revealCard(id)
  }
  private modeBeforeCard: number | null = null
  /** True while the sidebar is showing. */
  get panelsOpen(): boolean { return this.inspector.open }
  /** Hide the panels and go back to driving: on a desktop, capture the cursor. */
  returnToDriving(): void {
    this.drive()
    if (this.modeBeforeCard !== null) { setInterfaceMode(this.modeBeforeCard); this.modeBeforeCard = null }
  }
  /** Show the panels: on a desktop that is letting the cursor go. */
  private showPanels(): void { if (this.capturesCursor) this.releaseCursor(); else this.touchPanels = true; this.syncPanels() }
  /** Return to driving: on a desktop that is capturing the cursor, which needs a gesture. */
  private drive(): void { if (this.capturesCursor) void this.captureCursor(); else this.touchPanels = false; this.syncPanels() }

  // Pause. One state shared with the page lifecycle (src/core/pause.ts, the integrator's):
  // 'user' is a second Escape or the Pause button, 'hidden' is a background tab. Audio fades
  // and stops for both; the message shows for the player's own pause only. The game loop is
  // stopped while paused, so nothing here relies on frames.
  private pauseControl?: PauseControl
  private pauseUnsubscribe?: () => void
  private userPaused = false
  setPauseControl(control: PauseControl): void {
    this.pauseUnsubscribe?.(); this.pauseControl = control
    this.pauseUnsubscribe = control.subscribe((paused, reason) => this.applyPause(paused, reason))
    if (control.paused) this.applyPause(true, control.reason)
  }
  private requestPause(): void {
    if (!this.started || this.menuVisible || this.inviteOpen || this.aboutOpen) return
    this.releaseCursor()
    if (this.pauseControl) this.pauseControl.pause('user'); else this.applyPause(true, 'user')
  }
  private requestResume(): void {
    if (!this.userPaused || this.aboutOpen) return
    if (this.pauseControl) this.pauseControl.resume('user'); else this.applyPause(false, null)
    // The click, tap or key that resumes is a gesture: go straight back to driving.
    if (this.capturesCursor) void this.captureCursor(); else { this.touchPanels = false; this.syncPanels() }
  }
  private applyPause(paused: boolean, reason: 'user' | 'hidden' | null): void {
    if (paused) this.audio.pause(0.5); else this.audio.resume(0.3)
    const user = paused && reason === 'user'
    if (user === this.userPaused) return
    this.userPaused = user
    const veil = this.element.querySelector<HTMLButtonElement>('.pause-veil')!
    veil.hidden = !user; this.element.classList.toggle('is-paused', user)
    // The sidebar's Pause shows play while paused, and resumes.
    const pause = this.element.querySelector<HTMLButtonElement>('.rail-pause')
    if (pause) { const word = user ? 'Resume' : 'Pause'; pause.setAttribute('aria-label', word); pause.dataset.tip = word; pause.querySelector('path')!.setAttribute('d', user ? PLAY_ICON : PAUSE_ICON) }
    this.element.querySelector<HTMLElement>('.pause-actions')!.hidden = !user
    if (!user) { this.shotReady = null; const hint = this.element.querySelector<HTMLElement>('.pause-shot-hint'); if (hint) hint.hidden = true }
    this.whisper(user)
    this.game.input.suspended = user || this.menuVisible || this.inviteOpen || this.exitAsking || this.aboutOpen
    if (user) {
      this.game.input.mouseFire = false
      veil.querySelector('.pause-how')!.textContent = this.touch.available ? 'Tap to resume' : 'Click to resume'
      veil.querySelector('small')!.hidden = this.playerCount < 2
      if (!this.aboutOpen) veil.focus({ preventScroll: true })
    }
    this.syncPanels()
  }
  /**
   * The pause screen goes quiet: PAUSED and how to resume show for a moment, then fade to
   * nothing until the pointer moves, a key goes down or the screen is touched, so the view is
   * clean to look at. The three buttons and the minimap stay.
   */
  private whisper(on: boolean): void {
    this.whisperWatch?.abort(); this.whisperWatch = undefined; clearTimeout(this.whisperTimer)
    this.element.classList.remove('is-whisper')
    if (!on) return
    const watch = this.whisperWatch = new AbortController()
    const wake = () => {
      clearTimeout(this.whisperTimer)
      this.element.classList.remove('is-whisper')
      this.whisperTimer = setTimeout(() => this.element.classList.add('is-whisper'), PAUSE_WHISPER_MS)
    }
    for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(type, wake, { signal: watch.signal, passive: true, capture: true })
    wake()
  }
  private whisperWatch?: AbortController
  private whisperTimer?: ReturnType<typeof setTimeout>
  private shooting = false
  /**
   * Save what the player is looking at (src/ui/screenshot.ts). Only on the pause screen: the
   * loop is stopped there, so the extra frame and the encode cost nothing in play. The picture
   * is the canvas alone, with the paused camera, so no interface and no pause shade are in it.
   * The Screenshot button says how it went, quietly, in place.
   */
  private async takeShot(): Promise<void> {
    if (!this.userPaused || this.shooting) return
    this.shooting = true
    const button = this.element.querySelector<HTMLButtonElement>('.pause-shot')!, hint = this.element.querySelector<HTMLElement>('.pause-shot-hint')!
    const say = (text: string, done: boolean) => {
      hint.textContent = text; hint.hidden = !text
      button.classList.toggle('is-saved', done); button.querySelector('path')!.setAttribute('d', done ? SAVED_ICON : SHOT_ICON)
    }
    let waiting = false
    try {
      // A picture already made, waiting for the tap Safari asked for: share it now, in this tap.
      const ready = this.shotReady; this.shotReady = null
      const result = ready ? { outcome: await shareShot(ready), file: ready } : await (async () => {
        // The device's full resolution, whatever Auto resolution chose for play (Game.snapshot).
      const frame = this.game.snapshot({ full: true })
        const blob = frame ? await encodeShot(frame) : null
        return blob ? deliverShot(blob, shotFileName(currentWorldName(), currentPlanet().label, new Date()), this.touch.available) : null
      })()
      if (!result) { say('The view could not be captured', false); return }
      if (result.outcome === 'blocked' && result.file) { this.shotReady = result.file; waiting = true; say('Ready. Tap again to share', false); return }
      if (result.outcome !== 'cancelled') say(result.outcome === 'shared' ? 'Shared' : 'Saved', true)
    } finally {
      this.shooting = false
      clearTimeout(this.shotTimer)
      if (!waiting) this.shotTimer = setTimeout(() => say('', false), 2200)
    }
  }
  /** A picture made but refused by the share sheet for want of a fresh tap: the next tap shares it. Dropped on resume. */
  private shotReady: File | null = null
  private shotTimer?: ReturnType<typeof setTimeout>
  private keydown(event: KeyboardEvent): void {
    // Waiting for the tap that begins (TapToBegin.ts): that press only begins.
    if (document.documentElement.dataset.boot === 'ready') return
    // A lobby sheet is open: it owns the keyboard (LobbySheet), and no shortcut fires behind it.
    if (this.lobbySheets.some(sheet => sheet?.isOpen)) return
    if (this.aboutOpen) {
      // The guide owns the keyboard: Tab, links and disclosures work natively inside it, and
      // no shortcut or driving key reaches the game. Escape closes it and does nothing else.
      event.stopImmediatePropagation()
      if (event.code === 'Escape') { event.preventDefault(); this.closeAbout() }
      return
    }
    const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY)$/.test(event.target.tagName))
    if (!editing && !event.repeat && event.code === 'KeyP') { event.preventDefault(); event.stopImmediatePropagation(); this.setPresentation(!this.presentation); return }
    // The invite view holds only buttons, and its Back says "J": J closes it from any of them
    // (Copy keeps focus after a click). Space and Enter still press the focused button, and J
    // typed into a text field elsewhere is never taken.
    const inField = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))
    if (this.inviteOpen && !inField && !event.repeat && event.code === 'KeyJ' && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); event.stopImmediatePropagation(); this.closeJoin(); return }
    if (!editing && !event.repeat && event.code === 'KeyJ') { event.preventDefault(); event.stopImmediatePropagation(); this.inviteOpen ? this.closeJoin() : this.openJoin(); return }
    if (this.exitAsking) {
      // The question owns the keyboard: Escape means stay, Tab moves between its two buttons,
      // Enter or Space presses the focused one, and nothing reaches driving, pause or shortcuts.
      if (event.code === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); this.answerExit(false) }
      else if (event.key === 'Tab') { event.preventDefault(); const buttons = [...this.element.querySelectorAll<HTMLButtonElement>('.exit-confirm button')]; buttons[document.activeElement === buttons[0] ? 1 : 0].focus() }
      return
    }
    if (this.inviteOpen) {
      if (event.code === 'Escape') { event.preventDefault(); this.closeJoin() }
      if (event.key === 'Tab') { event.preventDefault(); const buttons = [...this.invite.element.querySelectorAll<HTMLButtonElement>('button')]; buttons[document.activeElement === buttons[0] ? 1 : 0].focus() }
      return
    }
    if (this.started && !this.menuVisible && this.inspector.open && !event.repeat && (event.ctrlKey || event.metaKey) && event.code === 'KeyF') {
      event.preventDefault(); event.stopImmediatePropagation()
      this.inspector.element.querySelector<HTMLInputElement>('.wi-search')!.focus()
      return
    }
    if (!editing && this.started && !this.menuVisible && !event.repeat && (event.code === 'KeyH' || event.key === '?')) { event.preventDefault(); this.toggleHelp(); return }
    if (!editing && this.started && !this.menuVisible && !this.userPaused && !event.repeat && event.code === INTERFACE_KEY && this.capturesCursor) { event.preventDefault(); setInterfaceMode(nextInterfaceMode(interfaceMode.value)); return }
    // A drive key outside any field means the player wants to drive: resume if paused, and
    // capture the cursor (a key press is a gesture). This is also the keyboard-only way back.
    // While paused, focus rests on the pause message, which is a button, so a drive key
    // counts wherever focus is: it resumes. That press does not also drive.
    // S is the one exception: on the pause screen it saves a screenshot (the Screenshot button's
    // hint says so). pausedKeyAction is null whenever the player's own pause does not hold, so
    // S never does this in play, where it reverses and brakes as always.
    const typingHere = event.target instanceof HTMLElement && (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))
    const paused = pausedKeyAction(event.code, { paused: this.userPaused, repeat: event.repeat, typing: typingHere })
    if (paused === 'shot') { event.preventDefault(); void this.takeShot(); return }
    if (paused === 'resume') { event.preventDefault(); this.requestResume(); return }
    if (this.userPaused && event.code === 'KeyS') { event.preventDefault(); return }
    // A drive key means the player wants to drive, unless it is being typed into a field or
    // moving a slider or select. A focused button or summary does not count: it only owns
    // Space and Enter, and focus rests on one after any click on the panels.
    const field = (element: unknown) => element instanceof HTMLElement && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.closest('[role=listbox]') !== null)
    // The vehicle picker owns the arrow keys while it has focus (a radiogroup), as a list does.
    const typing = field(event.target) || field(document.activeElement) || (event.target instanceof Element && event.target.closest('[role=radiogroup]') !== null)
    if (!typing && !event.repeat && this.started && !this.menuVisible && DRIVE_KEYS.has(event.code) && this.capturesCursor && document.pointerLockElement !== this.game.canvas) void this.captureCursor()
    if (event.code === 'Escape') {
      if (event.target instanceof HTMLSelectElement) return
      // Escape in a text field only leaves the field (chat closes itself): it takes another to
      // pause, and the interface mode stays as it was.
      const target = event.target
      if (this.started && !this.menuVisible && !this.userPaused && target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLTextAreaElement || (target instanceof HTMLInputElement && !/^(range|checkbox|radio|button|color)$/.test(target.type)))) { target.blur(); return }
      setInterfaceMode(0)
      event.preventDefault(); event.stopImmediatePropagation()
      // Escape with the cursor captured frees it, which shows the panels. Escape again pauses.
      // Escape while paused resumes. There is no panel-closing step in between.
      if (this.userPaused) { this.requestResume(); return }
      if (document.pointerLockElement === this.game.canvas) { this.releaseCursor(); return }
      if (this.menuVisible && this.panels.active !== 'index') this.showPanel('index')
      else if (this.started) {
        if (this.menuVisible) this.closeMenu()
        else this.requestPause()
      }
    } else if (this.menuVisible && event.key === 'Tab') {
      const targets = [...this.overlay.querySelectorAll<HTMLElement>('button, input, select, summary, a[href], [tabindex="0"]')].filter(el => !el.closest('[hidden], [inert]') && !(el as HTMLInputElement).disabled)
      const first = targets[0], last = targets[targets.length - 1]
      if (event.shiftKey && (document.activeElement === first || !targets.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !targets.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first?.focus() }
    }
  }
  private toast(text: string): void {
    const element = this.element.querySelector<HTMLElement>('.shell-toast')!
    // A bot named in the toast carries its mark, as everywhere else (playerMarks.ts).
    element.replaceChildren(...markedText(text, this.roster())); element.hidden = false; clearTimeout(this.toastTimer)
    this.element.querySelector('.shell-message')!.textContent = text
    this.toastTimer = setTimeout(() => { element.hidden = true; this.element.querySelector('.shell-message')!.textContent = '' }, 4500)
  }
  private async copyInvite(): Promise<void> {
    const url = new URL(this.lobbyAddress?.inviteURL(this.room, encodeWorld()) ?? inviteUrl(location.origin, this.room, encodeWorld()))
    try { await navigator.clipboard.writeText(url.href); this.toast('Invite link copied.'); this.invite.element.querySelector('.join-copy')!.textContent = 'Copied' }
    catch { this.element.querySelector('.shell-message')!.textContent = `Invite link: ${url.href}` }
  }
  /**
   * The 2017 lobby hung in 3D and leaned toward the cursor. Here the pointer sets two CSS
   * variables that tilt the stage a degree or two and slides the star depths against each
   * other. Mouse only, and not at all for people who ask for reduced motion.
   */
  private followPointer(signal: AbortSignal): void {
    const stage = this.element.querySelector<HTMLElement>('.lobby-stage')!
    let frame = 0, x = 0, y = 0
    this.overlay.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
      x = event.clientX / innerWidth * 2 - 1; y = event.clientY / innerHeight * 2 - 1
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        stage.style.setProperty('--tilt-y', `${(x * 1.6).toFixed(2)}deg`); stage.style.setProperty('--tilt-x', `${(-y * 1.2).toFixed(2)}deg`)
      })
    }, { signal, passive: true })
  }
  /**
   * Choosing a planet. A different kind becomes the world for everyone in the room, with a
   * fresh seed, through the shared sliders; the kind already in play is left as it is. From
   * the index either choice leads on to the name and room form.
   */
  /** True after Custom is first opened; later world edits keep its preview current. */
  private shapingCustom = false
  private suspendCustomRefresh = false
  private customMapTimer?: ReturnType<typeof setTimeout>
  private refreshCustomPlanet(): void {
    if (!this.shapingCustom || this.suspendCustomRefresh) return
    clearTimeout(this.customMapTimer)
    this.customMapTimer = setTimeout(() => this.galaxy?.updateCustom(currentPlanet().id, worldSeed.value, params.snapshot('world')), 120)
  }
  /** Terraform mode: only the sliders that shape a world, opened. */
  private openCustomPlanet(): void {
    this.suspendCustomRefresh = false
    this.shapingCustom = true
    this.refreshCustomPlanet()
    this.advancedGroups = ['Terrain', 'World', 'Sky', 'Sun', 'Weather', 'Lava']
    this.showPanel('advanced')
  }
  /** A short notice that shows in the lobby and, while playing, as a toast. */
  private say(text: string): void { this.toast(text) }
  /**
   * The galaxy lobby: in place of the index panel, the worlds orbit a
   * sun in 3D. Drag to look around, tap a world to fly to it, and the name form follows. The
   * other panels open over it as before. Needs WebGL 2. At the lowest graphics level the system
   * is held still and redrawn only while it moves, so weak devices keep it at almost no cost.
   */
  private readonly savedWorlds = new SavedWorldStore(() => params.all().map(p => p.def))
  private savedMoons?: SavedMoons
  private savedList?: HTMLElement
  private saveWorld(): void {
    try {
      const result = this.savedWorlds.save(params.snapshot('world'))
      this.refreshSavedWorlds()
      this.inspector.setStatus(result.duplicate ? 'This world is already saved on this device.' : 'World saved on this device.')
    } catch (error) { this.inspector.setStatus(`World was not saved. ${error instanceof Error ? error.message : 'Storage is unavailable.'}`) }
  }
  private mountSavedWorlds(): void {
    const section = document.createElement('section'); section.className = 'saved-worlds'
    const title = document.createElement('h3'); title.textContent = 'Saved on this device'
    this.savedList = document.createElement('div'); this.savedList.setAttribute('aria-label', 'Saved worlds')
    section.append(title, this.savedList)
    this.element.querySelector('[data-panel="worlds"]')!.append(section)
    this.savedMoons = new SavedMoons(this.element.querySelector('.galaxy-ui')!, entry => { void this.enterSavedWorld(entry) })
    this.refreshSavedWorlds()
  }
  private refreshSavedWorlds(): void {
    if (!this.savedList) return
    this.savedList.replaceChildren()
    try {
      const library = this.savedWorlds.read()
      this.savedMoons?.set(library.entries)
      if (!library.entries.length || library.notice) {
        const note = document.createElement('p'); note.textContent = library.notice ?? 'Use Save current world in the World card.'
        this.savedList.append(note)
      }
      for (const entry of library.entries) {
        const row = document.createElement('div'); row.className = 'input-action'
        const enter = document.createElement('button'); enter.type = 'button'; enter.dataset.savedWorld = entry.id
        enter.textContent = `${savedName(entry)} · ${planetById(entry.recipeId)?.label ?? entry.recipeId}`
        enter.addEventListener('click', () => { void this.enterSavedWorld(entry) })
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete'
        remove.setAttribute('aria-label', `Delete saved ${savedName(entry)}`)
        remove.addEventListener('click', () => {
          try { this.savedWorlds.remove(entry.id); this.refreshSavedWorlds(); this.say('Saved world deleted from this device.') }
          catch { this.say('The saved world could not be deleted. Storage is unavailable.') }
        })
        row.append(enter, remove); this.savedList.append(row)
      }
    } catch {
      this.savedMoons?.set([])
      this.savedList.textContent = 'Saved worlds could not be read. Existing storage has been left unchanged.'
    }
    if (this.galaxy && !this.dropping && !this.savedEntering) this.galaxy.home()
  }
  private savedEntering = false
  private async enterSavedWorld(entry: SavedWorld): Promise<void> {
    if (this.dropping || this.savedEntering) return
    this.savedEntering = true
    this.savedOutcomeStop?.()
    let applied = false, release: (() => void) | undefined
    try {
      // Read again: another tab may have deleted or changed the record after rendering it.
      const latest = this.savedWorlds.read().entries.find(saved => saved.id === entry.id)
      if (!latest) { this.say('That saved world is no longer available.'); this.refreshSavedWorlds(); return }
      const plan = savedWorldPlan(latest, params.all().map(p => p.def))
      const allowed = () => worldIdentity(plan) === worldIdentity(params.snapshot('world')) || (canEditWorld() && !(this.invited && !this.started))
      if (!allowed()) { this.say('This room controls its world settings. The saved world was not applied.'); return }
      if (!this.started) recordStartupPlayRequest()
      this.stopAttract()
      this.suspendCustomRefresh = true; clearTimeout(this.customMapTimer)
      const apply = () => {
        if (!allowed()) throw new Error('The room no longer allows changing this world.')
        params.applySnapshot(plan, 'local'); applied = true
        if (!this.started) { this.begin(); this.onPlay?.() }
      }
      this.requestEntryCursor()
      if (!this.galaxy?.live || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        apply(); await this.enterWithoutFlight()
      } else {
        if (!this.started) this.unlockAudio()
        release = this.galaxy.savedWorldTarget(latest.recipeId, latest.seed, plan, latest.id)
        await this.panels.show('index', true); this.galaxyFor('index')
        await this.descent(latest.recipeId, apply)
      }
      if (applied) this.reportSavedOutcome(plan)
    } catch (error) { this.say(`Saved world was not entered. ${error instanceof Error ? error.message : 'Please try again.'}`) }
    finally {
      if (!this.started) cancelStartupPlayRequest()
      release?.(); this.savedEntering = false
    }
  }
  /** A room welcome can replace a local plan. Never claim a restore until authority settles. */
  private savedOutcomeStop?: () => void
  private reportSavedOutcome(plan: Record<string, import('../../shared/params').ParamValue>): void {
    const report = () => {
      const net = (window as { miraNet?: { connected?: boolean } }).miraNet
      if (!net?.connected) return false
      this.say(worldIdentity(params.snapshot('world')) === worldIdentity(plan)
        ? 'Saved world settings applied.' : 'The current room’s settings replaced the saved world settings.')
      return true
    }
    if (report()) return
    this.say('Saved settings applied locally. Waiting for the room’s settings.')
    const stop = () => { clearInterval(timer); this.abort.signal.removeEventListener('abort', stop); this.savedOutcomeStop = undefined }
    const timer = setInterval(() => { if (report()) stop() }, 500)
    this.savedOutcomeStop = stop
    this.abort.signal.addEventListener('abort', stop, { once: true })
  }
  private startGalaxy(): void {
    // No WebGL 2: the game cannot draw here either, so the index says so plainly.
    if (!Galaxy.supported()) { this.element.querySelector<HTMLElement>('.lobby-unsupported')!.hidden = false; return }
    const current = currentPlanet().id, labels = this.element.querySelector<HTMLElement>('.galaxy-labels')!
    // Every planet recipe, up to the galaxy's limit with room for Custom. In development,
    // ?worlds=N repeats the recipes to rehearse a crowded system before new ones land.
    const rehearse = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('worlds')) || 0 : 0
    const recipes = Array.from({ length: Math.max(PLANETS.length, rehearse - 1) }, (_, i) => ({ recipe: PLANETS[i % PLANETS.length], copy: Math.floor(i / PLANETS.length) })).slice(0, GALAXY_MAX - 1)
    const worlds: GalaxyWorld[] = recipes.map(({ recipe, copy }, i) => ({ id: copy ? `${recipe.id}~${copy}` : recipe.id, recipe: recipe.id, label: copy ? `${recipe.label} ${copy + 1}` : recipe.label, land: recipe.swatch[0], sea: recipe.swatch[1], glow: recipe.values['world.seaKind'] === 0, seed: recipe.id === current && !copy ? worldSeed.value : randomSeed(), nameSeed: recipe.id === current && !copy ? worldNameSeed.value : randomNameSeed() }))
    // The custom planet is a world still forming: tap it to shape it with the sliders.
    // Hidden for now (see OFFER_CUSTOM_PLANET): the lobby offers planets only.
    if (OFFER_CUSTOM_PLANET) worlds.push({ id: 'custom', label: 'Custom', land: 0x31507a, sea: 0x0a1630, glow: false, seed: 7, forming: true })
    const chips = this.galaxyChips
    this.galaxyWorlds = worlds
    for (const world of worlds) {
      // A caption on the scene, not a plate (the owner, 16 November 2026: the lobby is a quiet
      // picture): the world's name, its biome in small lower case under it, then how many are
      // online. Set under its planet; the planet takes the taps, the caption takes focus.
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'galaxy-label'; chip.dataset.world = world.id
      this.chipSizes.observe(chip)
      chip.innerHTML = '<strong></strong><small class="galaxy-biome"></small>'
      const text = planetLabelText(world)
      chip.querySelector('strong')!.textContent = text.name; chip.querySelector('small')!.textContent = text.biome
      // A whisper of the planet's own colour in the near-white type.
      if (!world.forming) chip.style.setProperty('--caption-tint', plateTint(world.recipe ?? world.id.split('~')[0]))
      chip.style.setProperty('--caption-accent', captionAccent(world))
      if (world.id !== 'custom') { const count = document.createElement('small'); count.className = 'galaxy-population'; count.textContent = ''; chip.append(count) }
      if (!world.forming) chip.title = `A day lasts ${formatDayLength(planetDayLength(world.recipe ?? world.id))}.`
      chip.addEventListener('click', () => { if (!this.tapWorld(world.id)) this.galaxy?.choose(world.id) })
      labels.append(chip); chips.set(world.id, chip)
    }
    this.galaxy = new Galaxy(this.overlay, {
      worlds,
      logo: () => {
        const mark = this.element.querySelector<SVGElement>('.shell-logo')!, box = mark.getBoundingClientRect(), host = this.overlay.getBoundingClientRect()
        return { box: { x: box.x - host.x, y: box.y - host.y, width: box.width, height: box.height }, level: levelNumber(graphicsLevel.value) }
      },
      presenceVisible: () => this.menuVisible && !this.attracting && !this.inviteOpen && !this.dropping,
      onPresence: values => {
        for (const world of worlds) {
          if (world.id === 'custom') continue
          const chip = chips.get(world.id)!, value = values.get(world.recipe ?? world.id) ?? null
          const text = value && value.players > 0 ? `${value.players} online` : ''
          const count = chip.querySelector('.galaxy-population')!
          if (count.textContent !== text) count.textContent = text
          // The day length goes in the tooltip, not the label: the label stays two short lines.
          chip.title = `${populationLabel(value)}. A day lasts ${formatDayLength(planetDayLength(world.recipe ?? world.id))}. Counts span separate rooms; choosing this planet uses your current room.`
          const plate = planetLabelText(world)
          chip.setAttribute('aria-label', `${plate.name}, ${plate.biome}: ${chip.title}`)
        }
      },
      onLogo: drawn => this.element.classList.toggle('has-animated-logo', drawn),
      topInset: () => this.updateBand(),
      still: () => levelNumber(graphicsLevel.value) === 0,
      onTap: chosen => this.tapWorld(chosen),
      onFocus: id => chips.get(id)?.focus({ preventScroll: true }),
      // A planet pointed at (hovered, or a finger on it) shows its label, faded or not.
      onPoint: id => { for (const [key, chip] of chips) chip.classList.toggle('is-pointed', key === id) },
      // The lobby at rest: a planet breathing its glow lifts its caption the same way a hover does,
      // by the same amount at its peak share (shell.css --caption-pulse).
      onRest: pulses => worlds.forEach((world, i) => {
        const chip = chips.get(world.id), value = (Math.round((pulses[i] ?? 0) * 50) / 50).toFixed(2)
        if (chip && chip.style.getPropertyValue('--caption-pulse') !== value) chip.style.setProperty('--caption-pulse', value)
      }),
      onArrive: chosen => {
        const id = chosen.split('~')[0]
        if (id === 'custom') {
          if (!canEditWorld() || (this.invited && !this.started)) { this.say('This world is not yours to reshape yet.'); this.galaxy?.home(); return }
          this.openCustomPlanet(); return
        }
        if (this.invited && !this.started && id !== currentPlanet().id) { this.say('You were invited to another world. You can change it once you are in, if the host allows.'); this.galaxy?.home(); return }
        if (!canEditWorld() && id !== currentPlanet().id) { this.say('The host has locked this world.'); this.galaxy?.home(); return }
        // Arriving at a world never opens a form (the owner, 15 November 2026): it goes
        // straight in. Taps are already drops (tapWorld); this covers the paths that are not.
        if (id !== currentPlanet().id) this.applyGalaxyWorld(chosen)
        if (this.started) this.closeMenu(); else this.play()
      },
      // Short landscape supplies its own frame; while the update banner shows, it makes room for
      // the banner's band the way the galaxy's own framing does elsewhere (Galaxy, topInset):
      // down by half the band and smaller by its share of the height, so the name clears it.
      frame: () => {
        const frame = this.galaxyFrame
        if (!frame) return undefined
        const inset = Math.min(0.3, this.updateBand() / Math.max(1, innerHeight))
        return inset > 0 ? [frame[0], frame[1] - inset / 2, frame[2] * (1 - inset)] as const : frame
      },
      onLayout: (places, chosen) => {
        this.savedMoons?.layout(places, { width: innerWidth, top: this.brandBottom ?? 220, bottom: this.linksTop ?? innerHeight - 128 }, !!chosen || this.dropping || this.panels.active !== 'index')
        // Nothing to lay out or measure until the lobby's own controls are on screen: the galaxy
        // draws from the loading veil on (the opening's point of light), and sizes and places
        // measured while they are hidden read every box as zero, and are kept.
        if (!this.brandBottom && !this.element.querySelector('.galaxy-ui')?.getBoundingClientRect().width) return
        // Clear of the wordmark too. While flying to a world, only its label stays.
        if (!this.brandBottom) {
          this.brandBottom = this.element.querySelector('.lobby-brand')?.getBoundingClientRect().bottom ?? 0
          const nav = this.element.querySelector('.galaxy-links')?.getBoundingClientRect() ?? { top: 0, left: innerWidth }
          if (matchMedia(SHORT_LANDSCAPE).matches) {
            // The buttons are a column on the right (shell.css) and the galaxy gets the height
            // below the wordmark. The sun stays in the middle of the screen's width, as in
            // portrait (the owner's call): the outer worlds may pass behind the button column.
            this.linksTop = innerHeight - 8
            const top = this.brandBottom + 4
            // The system is wider than tall, so it can grow past the free height a little;
            // the spread gives the inner worlds' labels room.
            this.galaxyFrame = [0.5, 1 - (top + this.linksTop) / 2 / innerHeight, 1.5 * (this.linksTop - top) / innerHeight]
          } else {
            this.galaxyFrame = undefined
            this.linksTop = nav.top > innerHeight / 2 ? nav.top - 24 : innerHeight - 152
          }
          this.element.style.setProperty('--lobby-footer-space', `${innerHeight - this.linksTop}px`)
        }
        // Each caption sits centred under its planet, a fixed gap below the limb: a pure function
        // of where the planet is this frame, so it never moves against it. Captions may overlap
        // each other and other planets; that is accepted. Only their strength changes: with the
        // opening, with depth (behind the sun or a nearer planet they fade, a far one is a little
        // fainter), and brighter while pointed at or focused, or for the world in play.
        for (const [id, chip] of chips) if (chip.classList.contains('is-chosen') !== (id === chosen)) chip.classList.toggle('is-chosen', id === chosen)
        const current = currentPlanet().id, near = Math.min(...places.filter(p => p.visible).map(p => p.depth)), far = Math.max(...places.filter(p => p.visible).map(p => p.depth))
        // Nearer, larger planets get larger captions (captionScale.ts); the gap below the limb grows with them.
        const short = Math.min(innerWidth, innerHeight)
        // The lobby's own controls, read once before this frame's writes: a caption that would
        // touch one fades out (captionBlocked). Captions are placed in the label layer's space.
        const layer = chips.values().next().value?.parentElement?.getBoundingClientRect()
        const blockers: ScreenBox[] = [this.lobbySettings.dock, this.lobbySettings.version, document.getElementById('lobby-settings')]
          .map(el => el?.getBoundingClientRect()).filter((r): r is DOMRect => !!r && r.width > 0 && r.height > 0)
          .map(r => ({ left: r.left - (layer?.left ?? 0), right: r.right - (layer?.left ?? 0), top: r.top - (layer?.top ?? 0), bottom: r.bottom - (layer?.top ?? 0) }))
        for (const place of places) {
          const chip = chips.get(place.id)!
          chip.hidden = !place.visible
          if (!place.visible) continue
          const scale = captionScale(place.radius, short), gap = CAPTION_GAP * scale
          const scaleText = scale.toFixed(2)
          if (chip.style.getPropertyValue('--caption-scale') !== scaleText) chip.style.setProperty('--caption-scale', scaleText)
          this.placeChip(chip, place.x, place.y + place.radius + gap)
          // The caption's box: centred under its planet, its size as last laid out (chipSizes).
          const size = this.chipSize.get(chip), top = place.y + place.radius + gap
          const blocked = !!size && captionBlocked({ left: place.x - size.width / 2, right: place.x + size.width / 2, top, bottom: top + size.height }, blockers)
          if (chip.classList.contains('is-blocked') !== blocked) { chip.classList.toggle('is-blocked', blocked); chip.tabIndex = blocked ? -1 : 0 }
          const away = blocked || (!!chosen && place.id !== chosen) || place.labelled === false || captionHidden(place, places, this.galaxy?.sunScreen)
          const depth = far > near ? (place.depth - near) / (far - near) : 0
          // Pointing and focus lift it in the stylesheet (.is-pointed, :focus), at once, even
          // while the galaxy is holding still and not drawing.
          const strength = away ? '0' : (1 - 0.25 * depth + (place.id === current ? 0.2 : 0)).toFixed(2)
          if (chip.style.getPropertyValue('--caption-strength') !== strength) chip.style.setProperty('--caption-strength', strength)
          // In the scene's depth: nearer captions over farther ones, and every nearer body (a
          // planet, the sun) cuts the text where its disc covers it, as if the caption stood at
          // its own planet's depth.
          const z = String(1000 - Math.round(place.depth * 10))
          if (chip.style.zIndex !== z) chip.style.zIndex = z
          const mask = captionMask(place, places, this.galaxy?.sunScreen, place.y + place.radius + gap, scale)
          if (this.chipMask.get(chip) !== mask) { this.chipMask.set(chip, mask); chip.style.setProperty('mask-image', mask); chip.style.setProperty('-webkit-mask-image', mask) }
        }
      },
    })
    addEventListener('resize', () => { this.brandBottom = undefined }, { signal: this.abort.signal })
    this.element.classList.add('is-galaxy'); this.galaxy.enabled = true
    // WebGL 2 exists but the galaxy would not start (a shader the driver refuses): the world
    // names stay, as a row of buttons, so a visitor can still choose one and play.
    this.element.classList.toggle('galaxy-flat', !this.galaxy.live)
    this.galaxyFor(this.panels.active || 'index')
  }
  /**
   * Move a planet label. Called every frame, so it writes only what moved by
   * more than half a pixel and reads nothing from the page. x is the label's centre, y its top.
   */
  private placeChip(chip: HTMLButtonElement, x: number, y: number): void {
    const last = this.chipDrawn.get(chip) ?? { x: NaN, y: NaN }
    this.chipDrawn.set(chip, last)
    if (!(Math.abs(x - last.x) <= .5 && Math.abs(y - last.y) <= .5)) { last.x = x; last.y = y; chip.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px` }
  }
  /** Each caption's laid-out size, kept by a ResizeObserver so the per-frame pass never measures. */
  private readonly chipSize = new WeakMap<Element, { width: number; height: number }>()
  private readonly chipSizes = new ResizeObserver(entries => {
    for (const entry of entries) { const box = entry.borderBoxSize?.[0]; this.chipSize.set(entry.target, box ? { width: box.inlineSize, height: box.blockSize } : { width: entry.contentRect.width, height: entry.contentRect.height }) }
  })
  /** Each caption's last mask, so it is written only when it changes. */
  private readonly chipMask = new WeakMap<HTMLButtonElement, string>()
  private readonly chipDrawn = new WeakMap<HTMLButtonElement, { x: number; y: number }>()
  /** The galaxy's world captions, by world id. */
  private readonly galaxyChips = new Map<string, HTMLButtonElement>()
  /** Short landscape: the galaxy's framing (see SHORT_LANDSCAPE). */
  private galaxyFrame?: readonly [number, number, number]
  /** Where the wordmark ends, measured once per window size. */
  private brandBottom?: number
  private linksTop = 0
  /** The worlds the galaxy shows, each with the seed and name picking it leads to. */
  private galaxyWorlds: GalaxyWorld[] = []
  /**
   * Make a galaxy world the world: its recipe, and the seed and name its sphere and label
   * showed, so what the player saw is where they land.
   */
  private applyGalaxyWorld(galaxyId: string): void {
    const world = this.galaxyWorlds.find(w => w.id === galaxyId)
    applyPlanet(galaxyId.split('~')[0], world?.seed, world?.nameSeed !== undefined ? { nameSeed: world.nameSeed } : {})
  }
  /** Labels follow the world in play: its name and seed, and which worlds can be chosen now. */
  private refreshGalaxyLabels(open: boolean): void {
    const current = currentPlanet().id
    for (const [id, chip] of this.galaxyChips) {
      // The world in play is whatever the room says it is: its sphere and label follow.
      const world = this.galaxyWorlds.find(w => w.id === id)
      if (world && id === current && !world.forming) {
        world.nameSeed = worldNameSeed.value
        if (world.seed !== worldSeed.value) this.galaxy?.setSeed(id, worldSeed.value)
      }
      const name = chip.querySelector('strong')!, text = world ? planetLabelText(world).name : name.textContent
      if (name.textContent !== text) name.textContent = text
      chip.classList.toggle('is-current', id === current); chip.classList.toggle('is-selected', id === current)
      chip.classList.toggle('is-locked', !open && id !== current)
    }
  }
  /** The galaxy is the index; any other panel opens over it. */
  private galaxyFor(panel: string): void {
    if (!this.galaxy) return
    const open = panel === 'index', editing = panel === 'advanced' && this.shapingCustom && this.advancedGroups !== undefined
    this.element.classList.toggle('is-shaping-world', editing)
    this.galaxy.editing = editing
    this.element.classList.toggle('galaxy-open', open)
    this.element.querySelector<HTMLElement>('.galaxy-ui')!.hidden = false
    if (open) this.galaxy.home()
    // Behind a panel the galaxy dims and holds still; behind the name form a little less,
    // since the world just chosen is the picture there.
    this.galaxy.backdrop = open ? 1 : editing ? 0.85 : panel === 'explore' ? 0.7 : 0.35
  }
  /** What the lobby's own graphics are doing, for the phone checks. */
  get graphics(): { galaxyLive: boolean; galaxyFrames: number; planetMaps: number } {
    return { galaxyLive: this.galaxy?.live ?? false, galaxyFrames: this.galaxy?.frames ?? 0, planetMaps: this.galaxy?.painted ?? 0 }
  }
  /**
   * Every button is the game's glass button (.liquid-glass in glass.css), except the quiet text
   * links, the Paused veil (a full-screen button), the panels' rows and switches, and the gear
   * drum and left column, which are floating text. This also carries that site's GlassShine: while the pointer is over a
   * glass button, the bright side of its one-pixel rim turns to face the pointer, and settles
   * back when the pointer leaves. Nothing is drawn on the face of the button.
   */
  private glass(signal: AbortSignal): void {
    const buttons = [...this.element.querySelectorAll<HTMLElement>('button'), ...this.touch.element.querySelectorAll<HTMLElement>('button')]
    for (const button of buttons) if (!button.matches('.link-button, .pause-veil, .lobby-version, .lobby-close, .card-close, .about-tabs *, .lobby-links *, .mira-advanced *, .world-inspector *, .performance-recommendation *, .race-controls *, .update-banner-actions *, .exit-confirm-actions *, .join-view *, .gear-selector *, .hud-accessories *, .hud-chat *')) button.classList.add('liquid-glass')
    // Touch screens have no hover, so there is nothing to face.
    if (!matchMedia('(hover: hover)').matches) return
    // Upper left, where the light strikes at rest (glass.css).
    const REST = 315
    let current: HTMLElement | null = null
    // Kept unwrapped (it may pass 360) so the CSS transition always takes the short way round.
    let angle = REST
    document.addEventListener('pointermove', event => {
      const target = event.target instanceof Element ? event.target : null
      const button = target?.closest<HTMLElement>('.liquid-glass') ?? null
      if (button !== current) { current?.style.removeProperty('--rim-angle'); current = button; angle = REST }
      if (!button) return
      const box = button.getBoundingClientRect()
      const dx = event.clientX - (box.left + box.width / 2), dy = event.clientY - (box.top + box.height / 2)
      // CSS conic angles start at the top and run clockwise.
      const facing = (Math.atan2(dx, -dy) * 180) / Math.PI
      angle += ((((facing - angle) % 360) + 540) % 360) - 180
      button.style.setProperty('--rim-angle', `${angle.toFixed(1)}deg`)
    }, { signal, passive: true })
  }
  /** Desktop with a mouse only: phones and tablets have their thumb controls. */
  private get capturesCursor(): boolean { return !this.touch.available && typeof this.game.canvas.requestPointerLock === 'function' }
  private cursorRequest = 0
  private cursorPending = false
  private async captureCursor(entering = false): Promise<void> {
    if (this.cursorPending || this.aboutOpen) return
    this.cursorPending = true
    const requestId = ++this.cursorRequest
    // While entering a world the menu is still up and the descent is running, and play may not
    // have begun yet: the entry itself is enough to keep the cursor.
    const active = () => requestId === this.cursorRequest && !this.abort.signal.aborted && (entering ? (this.started || this.enteringByGesture) && !this.userPaused : this.started && !this.menuVisible && !this.game.input.suspended)
    try {
      try {
        await (this.game.canvas.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void> | void).call(this.game.canvas, { unadjustedMovement: true })
      } catch {
        // Some browsers reject raw motion. A denied fallback must not reject unhandled.
        if (active()) await this.game.canvas.requestPointerLock()
      }
    } catch { /* A denied capture leaves the native cursor available. */ }
    finally {
      this.cursorPending = false
      if (!active() && document.pointerLockElement === this.game.canvas) document.exitPointerLock()
    }
  }
  private releaseCursor(): void {
    ++this.cursorRequest
    this.game.input.mouseFire = false
    if (document.pointerLockElement === this.game.canvas) document.exitPointerLock()
  }
  private updateHelp(): void {
    this.element.querySelector('.shell-touch-hint')!.textContent = touchHelp(this.choice.vehicleKind)
    renderHelp(this.element.querySelector('.shell-controls')!, this.choice.vehicleKind)
  }
  /** Call after an actual spawn so query overrides and future respawns show the right controls. */
  private readonly gearSelector: GearSelector
  private readonly accessories: AccessoryControls
  /** The vehicle being driven, for the accessory controls; set every frame by the bridge. */
  private drivenVehicle: AccessoryVehicle | null = null
  private gearRack?: GearRack
  private gearView?: GearSource
  /** The rack, wrapped once so the drum gets every gear's player-facing name. */
  private gearSource(): GearSource | undefined {
    const rack = (window as unknown as { miraNet?: { gear?: GearRack } }).miraNet?.gear
    if (!rack) return undefined
    if (rack !== this.gearRack) {
      this.gearRack = rack
      this.gearView = {
        list: () => rack.list(),
        get current() { return rack.current },
        select: id => rack.select(id as GearId),
        labelOf: id => GEAR_LABELS[id as GearId],
        controls: () => rack.controls(),
      }
    }
    return this.gearView
  }
  /** Gear selection and touch actions live in the HUD drum. */
  private updateGear(): void {
    const rack = (window as unknown as { miraNet?: { gear?: GearRack } }).miraNet?.gear
    this.hasSeveralGear = (rack?.list().length ?? 0) > 1
  }
  private updateGI(): void {
    // Match the post gate: lite and full allow effects selected by their strength.
    const value = Number(params.get('post.gi')?.value ?? 0), on = Boolean(params.get('post.on')?.value)
    const state = this.game.quality.getQualityState(), level = state.name
    const budget = Math.min(1, Math.max(0, this.game.quality.postBudget))
    const tier = postTier({ on, tier: state.postTier, shed: 1 - budget })
    const eligible = tier === 'lite' || tier === 'full'
    let status: string
    if (!on) status = `GI is off: post effects are turned off at ${level}. Turn Post effects on to use it.`
    else if (state.postTier === 'off' || state.postTier === 'base') status = `GI is unavailable at ${level}. Choose Medium or higher to enable indirect light.`
    else if (budget <= 0) status = `GI is paused while ${level} eases its post effects to keep the frame rate.`
    else if (value === 0) status = `GI is off at ${level}. Raise this strength, or choose Cinematic, to turn on indirect light.`
    else status = budget < .99 ? `GI is on at reduced strength while ${level} eases its post effects.` : `GI is on at ${level}: indirect light from visible surfaces.`
    this.inspector.setGIStatus(status, eligible)
  }
  private hasSeveralGear = false
  /** The vehicle being driven, read by the accessory controls each frame. */
  setDrivenVehicle(vehicle: AccessoryVehicle | null): void { this.drivenVehicle = vehicle }
  setVehicleKind(kind: VehicleKind): void { this.activeVehicleKind = kind; this.touch.setVehicleKind(kind); if (this.started) this.showHelp(false) }
  /**
   * The controls card, in the lower left so it never covers the vehicle. After Play it is the
   * short version: it leaves after five seconds or on the first key, click or touch, but stays
   * at least a second and a half so an eager driver still gets to read it. H or ? opens the
   * full list, which stays for its whole time because the player asked for it.
   */
  showHelp(full = true): void {
    const hint = this.element.querySelector<HTMLElement>('.spawn-help')!, touch = this.touch.available
    renderHelp(hint.querySelector('div')!, this.activeVehicleKind, touch, !full, this.hasSeveralGear)
    hint.classList.toggle('is-full', full); hint.classList.remove('is-hint', 'is-quiet'); this.touch.highlight(null)
    fillHelpLine(hint.querySelector('small')!, touch ? '' : full ? 'H or ?: hide' : 'H: all controls')
    hint.hidden = false; clearTimeout(this.helpTimer); this.helpInput?.abort(); this.helpInput = undefined
    const hide = () => this.hideHelp()
    this.helpTimer = setTimeout(hide, full ? 8500 : 5000)
    if (full) return
    const shown = performance.now(), input = this.helpInput = new AbortController()
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && (event.repeat || event.code === 'KeyH' || event.key === '?')) return
      input.abort(); clearTimeout(this.helpTimer)
      this.helpTimer = setTimeout(hide, Math.max(0, 1500 - (performance.now() - shown)))
    }
    for (const type of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(type, dismiss, { capture: true, passive: true, signal: input.signal })
  }
  private hideHelp(): void {
    clearTimeout(this.helpTimer); this.helpInput?.abort(); this.helpInput = undefined
    this.touch.highlight(null)
    this.element.querySelector<HTMLElement>('.spawn-help')!.hidden = true
  }
  /**
   * One line in the controls card for a player who seems stuck, for example pushing W on a
   * parked jet. On touch the button it names pulses. Stays out of the way of the full list.
   */
  showHint(hint: Hint): void {
    const card = this.element.querySelector<HTMLElement>('.spawn-help')!
    if (!this.started || this.menuVisible || (!card.hidden && card.classList.contains('is-full'))) return
    // A Zorb cue is the Zorb control's pulse (cueZorb); words only where no Zorb control shows.
    if (hint.cue === 'zorb' && this.zorbControl()) return
    const line = document.createElement('div'); line.textContent = hint.text
    card.querySelector('div')!.replaceChildren(line); card.querySelector('small')!.textContent = ''
    card.classList.remove('is-full'); card.classList.add('is-hint'); card.classList.toggle('is-quiet', hint.cue === 'zorb'); card.hidden = false
    this.touch.highlight(hint.touchAction ?? null)
    clearTimeout(this.helpTimer); this.helpInput?.abort(); this.helpInput = undefined
    this.helpTimer = setTimeout(() => this.hideHelp(), 5000)
  }
  /**
   * The Zorb control on screen, if one shows: the ZORB thumb button on touch, or the Zorb row of
   * the left column. Null when the HUD is hidden, the layout leaves it out or it is off screen.
   */
  private zorbControl(): HTMLElement | null {
    const options = [this.touch.available ? this.touch.element.querySelector<HTMLElement>('[data-action="zorb"]') : null, this.accessories.element.querySelector<HTMLElement>('.acc-row[data-id="zorb"]')]
    for (const el of options) {
      if (!el || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
      const box = el.getBoundingClientRect()
      if (box.width > 0 && box.right > 0 && box.bottom > 0 && box.left < innerWidth && box.top < innerHeight) return el
    }
    return null
  }
  private zorbCue: { on: boolean; el: HTMLElement | null } = { on: false, el: null }
  /**
   * Pulse the Zorb control while a sunk buggy should reach for it (PlayHints.zorbCue). Runs every
   * frame; looks for the control only when the cue starts, and touches the DOM only on a change.
   */
  cueZorb(on: boolean): void {
    if (on === this.zorbCue.on) { if (on && this.zorbCue.el?.classList.contains('acc-row')) this.accessories.wake(); return }
    this.zorbCue.el?.classList.remove('is-cued')
    this.zorbCue = { on, el: on ? this.zorbControl() : null }
    this.zorbCue.el?.classList.add('is-cued')
  }
  private toggleHelp(): void {
    const hint = this.element.querySelector<HTMLElement>('.spawn-help')!
    if (!hint.hidden && hint.classList.contains('is-full')) this.hideHelp(); else this.showHelp()
  }
  /** Who is in the room, as names are shown (main.ts): the rows, the match board and toasts mark bots from it. */
  setPlayerRoster(roster: PlayerRoster): void { this.roster = roster; this.hudBoard.setRoster(roster); this.matchHud.setRoster(roster) }
  private roster: PlayerRoster = () => []
  setStatus(lines: readonly string[]): void { this.board.setStatus(lines); this.hudBoard.setStatus(lines); const players = (window as unknown as {miraNet?:{players?:Map<number,{bot?:boolean}>}}).miraNet?.players; const count = players ? [...players.values()].filter(player => !player.bot).length : lines.filter(line => parseScoreRow(line)).length
    // The status arrives every frame; the invite only depends on it through the player count.
    if (count !== this.playerCount) { this.playerCount = count; this.updateInvite() } }
  /**
   * The bearing the compass readout shows, the same as the minimap's top: the camera's
   * heading when the map is heading up, your vehicle's when it is north up.
   */
  private compassHeading(): number { return mapNorthUp.value || !this.minimap ? this.self?.heading ?? 0 : this.minimap.turn }
  setSpeed(metresPerSecond: number): void {
    this.speed.textContent = String(Math.round(speedValue(metresPerSecond)))
    const unit = this.speed.nextElementSibling!, text = speedUnit().toUpperCase(); if (unit.textContent !== text) unit.textContent = text
  }
  // Installed only by the opt-in renderer. Eligibility belongs to the shell
  // because it owns both the entry transition and the manual quality veil.
  driveGlassFrame?: (playing: boolean, eligible: boolean) => void

  update(dt = 0): void {
    if (this.tintTransition.update(dt)) this.onTint?.(this.tintTransition.current.body, this.tintTransition.current.accent, false)
    this.touch.update()
    if (!this.menuVisible && this.minimap) {
      // The camera has moved for this frame already (the chase camera updates before the shell).
      this.minimap.setNorthUp(mapNorthUp.value)
      this.viewHeading = cameraHeading(this.game.camera.quaternion, this.viewHeading)
      this.minimap.setView(this.viewHeading)
      this.minimap.update()
    }
    // A captured cursor alone is insufficient while a menu or another flow suspends input.
    this.syncPanels()
    this.performancePanel.setContext(this.started && !this.menuVisible && !this.game.input.suspended, this.element.classList.contains('is-focus'))
    this.raceHud.update(this.started && !this.menuVisible && !this.game.input.suspended, this.element.classList.contains('is-focus'), this.self, this.ground?.size)
    this.element.classList.toggle('show-diagnostics', diagnostics.value)
    this.switches.get('diagnostics')!(diagnostics.value)
    this.updateGear()
    this.gearSelector.update(this.element.classList.contains('is-focus'))
    this.accessories.update(this.drivenVehicle)
    this.touch.setFlipReady(Boolean(this.drivenVehicle?.canFlip))
    if (this.inspector.open) this.updateGI()
    if (this.started && !this.menuVisible) {
      const focus = this.element.classList.contains('is-focus')
      if (!focus && this.inspector.open) this.inspector.update()
      const world = `${currentWorldName()} · ${currentPlanet().label}`
      this.focusHud.update(true, { speed: this.telemetry.speed, altitude: this.telemetry.seaAltitude, thrust: this.telemetry.thrust, heading: this.compassHeading(), world, hour: currentHour() })
      if (this.element.dataset.glass !== '1') this.element.dataset.glass = '1'
    }
    // The stylesheet drops frost at the lowest graphics level.
    // Frost goes at the lowest graphics level, and when the quality ladder is shedding post effects.
    this.driveGlassFrame?.(this.playing, !this.transitioning && !this.qualityVeil && !this.userPaused &&
      !this.game.holdDraws && !this.game.quality.isLoading && !document.hidden &&
      !document.documentElement.matches('[data-boot=loading], [data-boot=ready]'))
    const gfx = qualityLevel() >= 2 ? '0' : String(levelNumber(graphicsLevel.value))
    const frost = qualityBudget().uiFrost && qualityLevel() < 2 ? 'on' : 'off'
    if (this.element.dataset.uiFrost !== frost) this.element.dataset.uiFrost = frost
    if (document.documentElement.dataset.gfx !== gfx) document.documentElement.dataset.gfx = gfx
    if (!this.menuVisible) return
    this.lobbySettings.update()
    const seed = this.element.querySelector<HTMLInputElement>('#world-seed')!
    if (document.activeElement !== seed && seed.dataset.dirty !== 'true') seed.value = String(worldSeed.value)
    const time = currentHour()
    this.element.querySelector<HTMLInputElement>('#sky-time')!.value = String(time)
    this.element.querySelector('#sky-time-value')!.textContent = `${String(Math.floor(time) % 24).padStart(2, '0')}:${String(Math.floor((time % 1) * 60)).padStart(2, '0')}`
    const editable = canEditWorld(), net = hostControls()
    const planet = currentPlanet()
    // A guest who came by an invite link is shown that world and no other until they are in
    // the room, where the host's lock decides.
    const invitedOnly = this.invited && !this.started
    if (this.worldDirty) {
      this.worldDirty = false
      this.element.querySelector('.planet-current')!.textContent = `${currentWorldName()}, ${/^[aeiou]/i.test(planet.label) ? 'an' : 'a'} ${planet.label.toLowerCase()} world. ${planet.centre}.${invitedOnly ? ' You were invited to this world.' : ''}`
      this.updateInvite()
    }
    this.refreshGalaxyLabels(editable && !invitedOnly)
    for (const input of this.element.querySelectorAll<HTMLInputElement | HTMLButtonElement>('.world-controls input, .world-controls button')) input.disabled = !editable || invitedOnly
    for (const note of this.element.querySelectorAll<HTMLElement>('.world-lock-note')) note.hidden = editable
    this.paramPanel?.setWorldEditable(editable)
    this.hostControls.querySelector<HTMLButtonElement>('.world-reset')!.disabled = !editable
    this.switches.get('host-lock')!(net?.locked ?? false)
    this.hostControls.querySelector<HTMLElement>('.host-lock')!.hidden = !net?.isHost
    this.hostControls.querySelector('.host-note')!.textContent = !net ? 'Join a room to manage shared settings.' : !editable ? 'Sliders locked by host.' : net.isHost ? 'You are the host.' : 'Shared sliders are open.'
    const mode = params.get('game.mode')
    // Explore is the default and has no game: no scores, nobody "it". The player list stays.
    this.element.classList.toggle('is-explore', !mode || Number(mode.value) === 2)
    const bots = params.get('bots.count'), botsRow = this.element.querySelector<HTMLElement>('.bots-control')!
    botsRow.hidden = !bots
    if (bots) { const input = this.element.querySelector<HTMLInputElement>('#bots-count')!; input.min = String(bots.def.min ?? 0); input.max = String(bots.def.max ?? 16); input.value = String(bots.value); botsRow.querySelector('output')!.textContent = String(bots.value) }
    const keep = params.get('bots.keepCount'), keepRow = this.element.querySelector<HTMLElement>('.bots-keep')!
    keepRow.hidden = !bots || !keep
    if (keep) { keepRow.querySelector<HTMLInputElement>('#bots-keep')!.checked = keep.value === true; }
  }
  dispose(): void {
    this.abort.abort(); this.chipSizes.disconnect(); this.releaseCursor(); this.pauseUnsubscribe?.(); clearTimeout(this.tintTimer); this.performancePanel.dispose(); this.lobbySettings.dispose(); this.aboutSheet.dispose(); this.updatesSheet.dispose(); this.gearSelector.dispose(); clearTimeout(this.customMapTimer); clearTimeout(this.toastTimer); clearTimeout(this.helpTimer); this.helpInput?.abort(); this.inspector.dispose(); this.focusHud.dispose(); this.raceHud.dispose(); this.savedMoons?.dispose(); this.galaxy?.dispose();  this.matchHud.dispose(); this.invite.dispose(); this.minimap?.dispose(); this.panels.dispose(); this.touch.dispose(); this.element.remove()
    document.body.classList.remove('has-game-shell'); this.game.input.suspended = this.previousSuspended; this.game.input.mouseFire = false
  }
}

/** Call after creating the player, before constructing ParamPanel. */
export function initGameShell(game: Game, player: Vehicle, terrain: Terrain, entryName?: string | null): { shell: Shell; audio: GameAudio; setPlayer: (player: Vehicle) => void; dispose: () => void } {
  const audio = new GameAudio(game.camera), shell = game.add(new Shell(game, audio, entryName), 'Shell and lobby')
  shell.setVehicleKind(player.kind); shell.setTerrain(terrain); audio.setPlayer(player,terrain)
  let activePlayer = player
  activePlayer.name = shell.playerName
  // Read the body directly: the HUD snapshot can still describe the previous world
  // when a room rebuild moves the spawn between animation frames.
  shell.arrivalVehicle = () => {
    const p = activePlayer.body.translation(), q = activePlayer.body.rotation()
    return { x: p.x, z: p.z, heading: Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)), altitude: p.y - terrain.heightAt(p.x, p.z) }
  }
  const hints = new PlayHints(); let height = new HeightAboveGround()
  // A colour picked in play repaints the local vehicle at once and, once settled, tells the room.
  shell.onTint = (body, accent, commit) => {
    // A commit only announces: the vehicle already shows these colours, or is easing to them.
    if (!commit) activePlayer.setColors(body, accent)
    if (commit) (window as unknown as { miraNet?: { setProfile?(profile: { colors: { body: string; accent: string } }): void } }).miraNet?.setProfile?.({ colors: { body, accent } })
  }
  // A rename in the Me card: this vehicle's own label and the room follow at once.
  shell.onRename = name => {
    activePlayer.name = name
    ;(window as unknown as { miraNet?: { setName?(name: string): void } }).miraNet?.setName?.(name)
  }
  const bridge = game.add({ update(dt = 0) {
    const v = activePlayer.body.linvel(), p = activePlayer.body.translation(), speed = Math.hypot(v.x, v.y, v.z)
    shell.setSpeed(speed)
    const q = activePlayer.body.rotation()
    const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y))
    shell.setMapSelf({ x: p.x, z: p.z, heading, color: activePlayer.colors.body, self: true })
    shell.setDrivenVehicle(activePlayer)
    // Height above ground (contact surfaces, 0 when resting) for the arrival camera; the ALT
    // readout shows the contact surfaces' height above sea level instead.
    shell.setTelemetry(speed, height.read(activePlayer, p.y, terrain.heightAt(p.x, p.z)), activePlayer.kind === 'jet' && !activePlayer.zorbed ? activePlayer.input.z : undefined, altitudeAboveSea(activePlayer.contactHeight()))
    audio.motion = { speed, throttle: activePlayer.kind === 'jet' ? activePlayer.input.z : activePlayer.input.y, airborne: p.y - terrain.heightAt(p.x, p.z) > 2 }
    const input = activePlayer.input
    const hint = hints.update(dt, { kind: activePlayer.kind, touch: shell.touch.available, altitude: p.y - terrain.heightAt(p.x, p.z), speed, steer: input.x, pitch: input.y, throttle: input.z, hoverMode: !input.special, canLiftOut: activePlayer.canLiftOut, zorbed: activePlayer.zorbed, zorbAvailable: zorbSpeed.value > 0 })
    if (hint) shell.showHint(hint)
    shell.cueZorb(hints.zorbCue)
  } }, 'Telemetry and hints')
  game.add(audio, 'Game audio')
  return { shell, audio, setPlayer(next) { activePlayer = next; height = new HeightAboveGround(); hints.reset(); audio.setPlayer(next,terrain); shell.setVehicleKind(next.kind) }, dispose() { game.remove(bridge); game.remove(shell); game.remove(audio) } }
}
