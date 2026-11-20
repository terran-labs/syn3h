/**
 * The touch Tag stick and the right side's pinch, driven with synthetic touch sequences.
 * Each test names the bug it catches. No sensitivities are pinned: the tuning comes from the
 * parameter registry and only directions and counts are asserted.
 */
import { describe, expect, it } from 'vitest'
import { AimTouches, TagStick, aimRate, tagModeFor, type TagMode } from '../../src/ui/tagStick'

/** A fake game: the tag control as Input.external.fire, and fixed steps that see it. */
function rig(mode: TagMode) {
  const log = { looks: [] as [number, number][], cancels: 0 }
  let fire = false, pulse = false
  const shots: number[] = []
  const stick = new TagStick({
    fire: (on) => { fire = on },
    tap: () => { fire = true; pulse = true },
    cancel: () => { log.cancels++; fire = false },
    look: (dx, dy) => log.looks.push([dx, dy]),
  }, () => ({ speed: 400, radius: 50, curve: 2 }))
  /** One physics step: records whether the gear saw the tag control, and ends a one-step press (GearRack.fixedUpdate). */
  const step = (n = 1) => { for (let i = 0; i < n; i++) { shots.push(fire ? 1 : 0); if (pulse && fire) { pulse = false; fire = false } } }
  const fired = () => shots.reduce((a, b) => a + b, 0)
  /** Rising edges of the tag control: what Chaser and the Grapple launch count as shots. */
  const presses = () => shots.filter((v, i) => v && !shots[i - 1]).length
  const zone = { x: 300, y: 100, r: 30 }
  const down = () => stick.down(1, 200, 200, mode, zone)
  return { stick, log, step, fired, presses, down, zone, firing: () => fire }
}

describe('Tag with the quick-fire gear (Plasma Tag)', () => {
  it('holds the tag control every step from the first touch to the lift, dragging or not', () => {
    // Bug: the beam only fires once the thumb moves, or stops while it drags.
    const r = rig('stream')
    r.down(); r.step(5)
    expect(r.fired()).toBe(5)
    r.stick.move(1, 260, 170); r.stick.frame(1 / 60); r.step(5)
    expect(r.fired()).toBe(10)
    r.stick.up(1); r.step(5)
    expect(r.fired()).toBe(10)
  })

  it('never shows Cancel, so a drag up and out still fires', () => {
    const r = rig('stream')
    r.down(); r.stick.move(1, r.zone.x, r.zone.y)
    expect(r.stick.cancellable).toBe(false)
    expect(r.stick.up(1)).toBe('stopped')
  })
})

describe('Tag with gear that sends on the lift', () => {
  it('sends nothing while held and dragged, then exactly one shot on the lift', () => {
    // Bug: a Chaser leaves at the press, before the player has aimed, or two leave at once.
    const r = rig('release')
    r.down(); r.step(3)
    r.stick.move(1, 240, 180); r.stick.frame(1 / 60); r.step(10)
    expect(r.fired()).toBe(0)
    expect(r.stick.up(1)).toBe('fired')
    r.step(10)
    expect(r.presses()).toBe(1)
    expect(r.fired()).toBe(1)
  })

  it('a tap with no drag still fires at once', () => {
    const r = rig('release')
    r.down(); r.stick.up(1); r.step(3)
    expect(r.presses()).toBe(1)
  })

  it('lifting on the Cancel ring sends nothing', () => {
    // Bug: there is no way to take back an aimed shot.
    const r = rig('release')
    r.down(); r.stick.move(1, 250, 150)
    expect(r.stick.cancellable).toBe(true)
    r.stick.move(1, r.zone.x + 5, r.zone.y - 5)
    expect(r.stick.overCancel).toBe(true)
    expect(r.stick.up(1)).toBe('cancelled')
    r.step(10)
    expect(r.fired()).toBe(0)
  })

  it('moving back off the ring re-arms the shot', () => {
    const r = rig('release')
    r.down(); r.stick.move(1, r.zone.x, r.zone.y); r.stick.move(1, 210, 210)
    expect(r.stick.overCancel).toBe(false)
    r.stick.up(1); r.step(2)
    expect(r.presses()).toBe(1)
  })

  it('a system pointercancel sends nothing', () => {
    const r = rig('release')
    r.down(); r.stick.move(1, 240, 160)
    r.stick.up(1, 'cancel'); r.step(5)
    expect(r.fired()).toBe(0)
  })
})

describe('Tag with gear held to act (Plasma Thunder, Yoink)', () => {
  it('holds the tag control while down, so it charges, and lets go once on the lift', () => {
    const r = rig('hold')
    r.down(); r.stick.move(1, 240, 160); r.step(6)
    expect(r.fired()).toBe(6)
    expect(r.stick.up(1)).toBe('fired')
    r.step(3)
    expect(r.fired()).toBe(6)
    expect(r.log.cancels).toBe(0)
  })

  it('Cancel drops the charge or carry instead of letting go into a send', () => {
    // Bug: cancelling a Thunder charge sends it anyway, because releasing the control is the send.
    const r = rig('hold')
    r.down(); r.stick.move(1, r.zone.x, r.zone.y)
    expect(r.stick.up(1)).toBe('cancelled')
    expect(r.log.cancels).toBe(1)
    expect(r.firing()).toBe(false)
  })

  it('reset (rotation, blur, leaving play) cancels rather than sends', () => {
    const r = rig('hold')
    r.down(); r.stick.reset()
    expect(r.log.cancels).toBe(1)
    expect(r.stick.held).toBe(false)
  })
})

describe('the aim stick', () => {
  it('turns toward the drag, faster the further it goes, and not at all inside the dead zone', () => {
    // Bug: the view turns the wrong way, or drifts with the thumb at rest.
    const r = rig('stream')
    r.down(); r.stick.move(1, 203, 200); r.stick.frame(1 / 60)
    expect(r.log.looks.at(-1)).toEqual([0, 0])
    r.stick.move(1, 220, 200); r.stick.frame(1 / 60)
    const small = r.log.looks.at(-1)![0]
    r.stick.move(1, 260, 200); r.stick.frame(1 / 60)
    const big = r.log.looks.at(-1)![0]
    expect(small).toBeGreaterThan(0)
    expect(big).toBeGreaterThan(small)
    r.stick.move(1, 200, 120); r.stick.frame(1 / 60)
    const [x, y] = r.log.looks.at(-1)!
    expect(x).toBeCloseTo(0); expect(y).toBeLessThan(0)
  })

  it('keeps turning while the thumb is held still past the anchor, and stops on the Cancel ring', () => {
    const r = rig('release')
    r.down(); r.stick.move(1, 260, 200)
    r.stick.frame(1 / 60); r.stick.frame(1 / 60)
    expect(r.log.looks.slice(-2).every(([dx]) => dx > 0)).toBe(true)
    r.stick.move(1, r.zone.x, r.zone.y); r.stick.frame(1 / 60)
    expect(r.log.looks.at(-1)).toEqual([0, 0])
  })

  it('never produces a non-finite turn', () => {
    const out = { x: 0, y: 0 }
    for (const [dx, dy, radius] of [[0, 0, 50], [1e9, 1, 50], [10, 10, 0], [NaN, 1, 50], [Infinity, 0, 50]]) {
      aimRate(dx, dy, radius, 2, out)
      expect(Number.isFinite(out.x) && Number.isFinite(out.y)).toBe(true)
      expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('one Tag at a time: a second finger on Tag is ignored', () => {
    const r = rig('stream')
    r.down()
    expect(r.stick.down(2, 0, 0, 'release', null)).toBe(false)
    expect(r.stick.up(2)).toBeNull()
    expect(r.stick.held).toBe(true)
  })
})

it('maps the gear in hand to a Tag mode', () => {
  expect(tagModeFor('beam')).toBe('stream')
  expect(tagModeFor('pester', { hold: false })).toBe('release')
  expect(tagModeFor('bungee', { hold: false })).toBe('release')
  expect(tagModeFor('bungee', { hold: true })).toBe('hold')
  expect(tagModeFor('red', { hold: true })).toBe('hold')
  expect(tagModeFor('yoink')).toBe('hold')
})

describe('pinch on the free right side', () => {
  function pinchRig() {
    const looks: number[][] = [], zooms: number[] = []
    const t = new AimTouches({ look: (dx, dy) => looks.push([dx, dy]), zoom: (d) => zooms.push(d) }, () => 3)
    return { t, looks, zooms }
  }

  it('in the chase and orbit cameras, spreading two fingers zooms in and pinching zooms out', () => {
    const { t, zooms } = pinchRig()
    expect(t.down(1, 500, 300, true)).toBe('look')
    expect(t.down(2, 600, 300, true)).toBe('pinch')
    t.move(2, 650, 300)
    expect(zooms.at(-1)).toBeLessThan(0)
    t.move(1, 560, 300)
    expect(zooms.at(-1)).toBeGreaterThan(0)
  })

  it('a pinch does not look, and the finger left behind does not look either', () => {
    // Bug: lifting one finger of a pinch snaps the view by the other finger's travel.
    const { t, looks } = pinchRig()
    t.down(1, 500, 300, true); t.down(2, 600, 300, true)
    t.move(1, 450, 300); t.up(2); t.move(1, 300, 300); t.move(1, 200, 250)
    expect(looks).toEqual([])
  })

  it('in a camera with no distance (cockpit, stationary, roam) a second finger does nothing and the first keeps looking', () => {
    const { t, looks, zooms } = pinchRig()
    t.down(1, 500, 300, false); t.move(1, 520, 300)
    expect(t.down(2, 600, 300, false)).toBeNull()
    t.move(2, 700, 300); t.move(1, 540, 300)
    expect(zooms).toEqual([])
    expect(looks.length).toBe(2)
  })

  it('one finger dragging still looks, after 8 px', () => {
    const { t, looks } = pinchRig()
    t.down(1, 500, 300, true); t.move(1, 503, 300)
    expect(looks).toEqual([])
    t.move(1, 520, 300)
    expect(looks).toEqual([[20, 0]])
  })
})
