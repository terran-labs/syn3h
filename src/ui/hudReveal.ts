/**
 * The HUD's entry reveal (hud-reveal.css): once per arrival in a world, the play interface comes
 * in group by group, each sliding a short way in from its own edge as it fades up, timed to land
 * as the descent's camera settles. The owner, 25 November 2026: "Fade the initial sidebar,
 * minimap, etc UX in slower as the user is entering a world. Try and do a cool animation so it
 * slides and fades gracefully in."
 *
 * A deliberate exception to the interface's rule that nothing slides: only this one reveal, at
 * entry. Nothing opening during play slides, and nothing moves once it is done. Pausing, a
 * vehicle change, a quality change or panels opening never replay it: Shell calls
 * startHudReveal only where a world is entered (the descent and covered entry), and the reveal
 * ends early if play stops (the pause menu) so a resume shows the HUD as it was.
 *
 * Only opacity and the individual `translate` property animate, from a starting keyframe to the
 * element's own value, so every group ends exactly where its rules put it, and nothing is built.
 */
import { defineParam, params } from '../../shared/params'
import './hud-reveal.css'

export const hudRevealOn = defineParam({ id: 'hud.revealOn', label: 'Entry reveal: the HUD slides and fades in on arrival', group: 'Interface', scope: 'client', default: true })
/** How long each group takes to come in, in milliseconds. */
export const hudRevealMs = defineParam({ id: 'hud.revealMs', label: 'Entry reveal: each group (ms)', group: 'Interface', scope: 'client', default: 750, min: 0, max: 3000, step: 50 })
/** The wait between one group starting and the next, in milliseconds. */
export const hudRevealStep = defineParam({ id: 'hud.revealStep', label: 'Entry reveal: between groups (ms)', group: 'Interface', scope: 'client', default: 110, min: 0, max: 1000, step: 10 })

/** Groups in order, by their --reveal-at index (hud-reveal.css); the last one's index. */
export const HUD_REVEAL_LAST = 6
export const HUD_REVEAL_ATTRIBUTE = 'data-hud-reveal'
/** On a group that opened or closed while the reveal ran: it appears at once (hud-reveal.css). */
export const HUD_REVEAL_SKIP = 'data-reveal-skip'
/**
 * What the player can open while the reveal runs: the panels. Opened (or closed) mid-reveal, they
 * appear at once instead of riding the arrival. Only these: the readouts, the minimap and the rest
 * come into being a frame or two after play begins, and they are what the reveal is for.
 */
const OPENABLE = '.world-inspector'
const shown = (e: Element): boolean => getComputedStyle(e).display !== 'none'

/** The whole reveal's length in milliseconds at the current settings. */
export const hudRevealTotal = (): number => hudRevealMs.value + hudRevealStep.value * HUD_REVEAL_LAST

const running = new WeakMap<HTMLElement, () => void>()

/**
 * Play the reveal on the shell `root`, called just after play begins (Shell.closeMenu). Sets one attribute for the reveal's length
 * and clears it after, or at once if play stops first.
 */
export function startHudReveal(root: HTMLElement): void {
  running.get(root)?.()
  if (!hudRevealOn.value || hudRevealTotal() <= 0 || !root.classList.contains('is-playing')) return
  root.style.setProperty('--reveal-ms', `${hudRevealMs.value}ms`)
  root.style.setProperty('--reveal-step', `${hudRevealStep.value}ms`)
  root.setAttribute(HUD_REVEAL_ATTRIBUTE, '')
  // Whether the panels show as the reveal starts. Opened or closed after that by the player, they
  // are not part of the arrival: they appear at once, with their own motion, if any.
  const groups = [...root.querySelectorAll(OPENABLE)]
  const start = new Map(groups.map(e => [e, shown(e)]))
  const watch = new MutationObserver(() => {
    if (!root.classList.contains('is-playing')) { end(); return }
    for (const [e, was] of start) if (shown(e) !== was) { e.setAttribute(HUD_REVEAL_SKIP, ''); start.delete(e) }
  })
  const timer = setTimeout(() => end(), hudRevealTotal() + 50)
  const off = params.onChange(id => { if (id === hudRevealOn.def.id && !hudRevealOn.value) end() })
  function end(): void {
    clearTimeout(timer); watch.disconnect(); off(); running.delete(root)
    root.removeAttribute(HUD_REVEAL_ATTRIBUTE)
    for (const e of groups) e.removeAttribute(HUD_REVEAL_SKIP)
  }
  watch.observe(root, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden'] })
  running.set(root, end)
}
