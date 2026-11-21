// Inspector.openPanel animates a rounded inset independently of the layout
// border box. Read the resolved inset on the same draw as the transformed box.
export function paintedInset(rect: DOMRect, clip: string, sx: number, sy: number): DOMRect {
  const inset = /^inset\(([^)]*)\)$/.exec(clip)
  if (!inset) return rect
  const sides = inset[1].split(/\s+round\s+/)[0].trim().split(/\s+/)
  const [t, r = t, b = t, l = r] = sides
  const length = (value: string, extent: number, scale: number) =>
    value.endsWith('%') ? parseFloat(value) * extent / 100 : parseFloat(value) * scale
  const left = length(l, rect.width, sx), right = length(r, rect.width, sx)
  const top = length(t, rect.height, sy), bottom = length(b, rect.height, sy)
  return new DOMRect(rect.left + left, rect.top + top,
    Math.max(0, rect.width - left - right), Math.max(0, rect.height - top - bottom))
}

// Compositor animations normally advance between game draws. Keep the original
// keyframes, easing and finish/cancel handlers, but present their pose only
// when the canvas can present the same pose. This matters on 30 Hz phones.
export class GlassMotionClock {
  private readonly running = new Map<Animation, { start: number; initial: number; end: number }>()

  follow(element: Element, now: number): void {
    for (const animation of element.getAnimations()) {
      if (this.running.has(animation) || animation.playState !== 'running') continue
      const effect = animation.effect
      if (!(effect instanceof KeyframeEffect) || animation.playbackRate <= 0) continue
      const end = Number(effect.getComputedTiming().endTime)
      if (!Number.isFinite(end) || !effect.getKeyframes().some(frame =>
        ['transform', 'scale', 'translate', 'opacity', 'clipPath', 'height', 'width', 'flexBasis', 'borderRadius']
          .some(property => property in frame))) continue
      const initial = Number(animation.currentTime ?? 0)
      animation.pause()
      animation.currentTime = initial
      this.running.set(animation, { start: now, initial, end })
    }
  }

  advance(now: number): boolean {
    const wasMoving = this.running.size > 0
    for (const [animation, state] of this.running) {
      if (animation.playState === 'paused') {
        const time = state.initial + (now - state.start) * animation.playbackRate
        if (time < state.end) { animation.currentTime = time; continue }
        animation.finish()
      }
      this.running.delete(animation)
    }
    return wasMoving
  }

  release(): void {
    for (const animation of this.running.keys()) if (animation.playState === 'paused') animation.play()
    this.running.clear()
  }
}
