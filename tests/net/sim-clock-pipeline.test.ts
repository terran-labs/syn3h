/**
 * The whole path of one remote vehicle, replayed without a browser: a sender's frame loop and
 * fixed steps, the wire with latency, a receiver's frame loop, the real SnapshotBuffer and its
 * automatic delay. Run twice over the same motion and schedules: the old way (wall clock
 * stamps and sampling, send timer restarted from zero) and the new (SimClock, SendPacer).
 *
 * What is measured is geometric: where the receiver's copy is at each of its physics steps,
 * against where the sender's vehicle truly was at the moment that step shows. The mean is
 * removed (a constant offset is only a slightly different delay); what is left is the noise
 * a player sees as judder.
 */
import { describe, expect, it } from 'vitest'
import { SendPacer, SimClock } from '../../src/net/SimClock'
import { SnapshotBuffer } from '../../src/net/SnapshotBuffer'
import { emptyInputLike } from './helpers'

const STEP = 1 / 50
const MAX_STEPS = 5
const ROOM = 1000
const CAP = 0.15

/** A car at about 30 m/s that speeds up and slows down, so velocity errors show too. */
const truth = (t: number) => 30 * t + 6 * Math.sin(t * 0.9)
const speed = (t: number) => 30 + 5.4 * Math.cos(t * 0.9)

interface Frame { wall: number; steps: number[]; cont: number; dt: number }

/** A frame schedule: wall time of each frame, the sim times its steps end at, sim time after. */
function schedule(fps: number, seconds: number, phase: number): Frame[] {
  const out: Frame[] = []
  let wall = phase
  let sim = 0
  let acc = 0
  for (let f = 0; f < fps * seconds; f++) {
    // A little frame time noise, the same for both variants (deterministic).
    const dt = (1 / fps) * (1 + 0.08 * Math.sin(f * 1.7))
    wall += dt
    acc += Math.min(0.25, dt)
    const steps: number[] = []
    while (acc >= STEP && steps.length < MAX_STEPS) {
      sim += STEP
      acc -= STEP
      steps.push(sim)
    }
    if (steps.length === MAX_STEPS) acc = 0
    out.push({ wall, steps, cont: sim + acc, dt })
  }
  return out
}

function run(variant: 'old' | 'new', senderFps: number, receiverFps: number, oneWay: number, seconds = 40) {
  // Sender.
  const sent: { arrive: number; t: number; x: number; v: number }[] = []
  const sClock = new SimClock()
  const pacer = new SendPacer()
  let timer = 0
  for (const fr of schedule(senderFps, seconds, 0)) {
    for (const end of fr.steps) {
      let due: boolean
      if (variant === 'old') {
        timer += STEP
        due = timer >= 1 / 20
        if (due) timer = 0
      } else {
        due = pacer.step(STEP, 20)
      }
      if (!due) continue
      const t = variant === 'old' ? fr.wall + ROOM : sClock.at(end, STEP, fr.wall + ROOM)
      // A little latency variation too, deterministic: 10% of the one way trip.
      const lag = oneWay * (1 + 0.1 * Math.sin(sent.length * 2.3))
      sent.push({ arrive: fr.wall + lag, t, x: truth(end), v: speed(end) })
    }
    sClock.observe(fr.wall + ROOM, fr.cont, fr.dt)
  }
  // Receiver.
  const buffer = new SnapshotBuffer(32)
  const rClock = new SimClock()
  const residual: number[] = []
  const advance: number[] = []
  const delays: number[] = []
  let next = 0
  let lastX: number | null = null
  let lastWhen = 0
  for (const fr of schedule(receiverFps, seconds, 0.0071)) {
    // Messages are handled between frames: everything that has arrived by now.
    while (next < sent.length && sent[next].arrive <= fr.wall) {
      const s = sent[next++]
      buffer.push({ t: s.t, p: [s.x, 0, 0], q: [0, 0, 0, 1], v: [s.v, 0, 0], w: [0, 0, 0], input: emptyInputLike() }, s.arrive + ROOM, 20)
    }
    for (const end of fr.steps) {
      const delay = buffer.delay(STEP, 0, CAP)
      const now = variant === 'old' ? fr.wall + ROOM : rClock.at(end, STEP, fr.wall + ROOM)
      const s = buffer.sample(now - delay, 1)
      if (s.mode === 'empty' || end < 8) continue
      // The moment this step shows, on the receiver's own even timeline, in sender sim time.
      // Sender sim time 0 and receiver sim time 0.0071 are the same wall instant.
      const shown = end + 0.0071 - delay
      residual.push(s.p[0] - truth(shown))
      delays.push(delay)
      if (lastX !== null) advance.push((s.p[0] - lastX) - (truth(shown) - truth(lastWhen)))
      lastX = s.p[0]
      lastWhen = shown
    }
    rClock.observe(fr.wall + ROOM, fr.cont, fr.dt)
  }
  const mean = residual.reduce((a, b) => a + b, 0) / residual.length
  const noise = residual.map((r) => r - mean)
  const rms = Math.sqrt(noise.reduce((a, b) => a + b * b, 0) / noise.length)
  return {
    rms,
    peak: Math.max(...noise.map(Math.abs)),
    stepJump: Math.max(...advance.map(Math.abs)),
    delayMax: Math.max(...delays),
    delayMean: delays.reduce((a, b) => a + b, 0) / delays.length,
    states: sent.length / seconds,
  }
}

describe('remote vehicle path, old timing against new', () => {
  const cases: [number, number, number][] = [
    // sender fps, receiver fps, one way latency in seconds
    [60, 60, 0.02], [60, 60, 0.04], [30, 60, 0.04], [60, 30, 0.04], [45, 24, 0.04], [120, 60, 0.02], [60, 60, 0.08], [30, 30, 0.08],
  ]
  const rows: string[] = []
  for (const [sf, rf, lag] of cases) {
    it(`sender ${sf} fps, receiver ${rf} fps, ${lag * 1000} ms one way: no noisier, and not pinned at the delay cap`, () => {
      const o = run('old', sf, rf, lag)
      const n = run('new', sf, rf, lag)
      const f = (x: number) => x.toFixed(3)
      rows.push(`${sf}/${rf} fps ${lag * 1000} ms | noise rms m old ${f(o.rms)} new ${f(n.rms)} | peak m old ${f(o.peak)} new ${f(n.peak)} | worst step jump m old ${f(o.stepJump)} new ${f(n.stepJump)} | delay ms mean old ${Math.round(o.delayMean * 1000)} new ${Math.round(n.delayMean * 1000)} max old ${Math.round(o.delayMax * 1000)} new ${Math.round(n.delayMax * 1000)} | states/s old ${o.states.toFixed(1)} new ${n.states.toFixed(1)}`)
      console.log(rows[rows.length - 1])
      expect(n.rms).toBeLessThanOrEqual(o.rms)
      expect(n.peak).toBeLessThanOrEqual(o.peak)
      expect(n.stepJump).toBeLessThanOrEqual(o.stepJump)
      expect(n.states).toBeGreaterThan(19.5)
      // At demo pings the automatic delay must not sit at its cap.
      if (lag <= 0.04) expect(n.delayMean).toBeLessThan(CAP - 0.01)
    })
  }
})
