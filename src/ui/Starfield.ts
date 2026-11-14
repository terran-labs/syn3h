/** A slow downward field follows LobbyStarfield's direction without a second 3D renderer. */
export class Starfield {
  readonly canvas = document.createElement('canvas')
  private readonly context = this.canvas.getContext('2d')!
  private readonly stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), depth: 0.2 + Math.random() * 0.8 }))
  private frame = 0
  private last = 0
  private active = true
  private readonly resizeObserver: ResizeObserver
  constructor(host: HTMLElement) {
    this.canvas.className = 'lobby-starfield'; this.canvas.setAttribute('aria-hidden', 'true'); host.prepend(this.canvas)
    this.resizeObserver = new ResizeObserver(() => {
      this.canvas.width = Math.round(host.clientWidth * Math.min(devicePixelRatio, 1.5)); this.canvas.height = Math.round(host.clientHeight * Math.min(devicePixelRatio, 1.5))
      this.draw(0)
    }); this.resizeObserver.observe(host)
    this.loop(0)
  }
  set enabled(value: boolean) {
    this.active = value; cancelAnimationFrame(this.frame)
    if (value) { this.last = 0; this.loop(0) }
  }
  private loop = (now: number): void => {
    if (!this.active) return
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.1) : 0; this.last = now
    this.draw(matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : dt)
    this.frame = requestAnimationFrame(this.loop)
  }
  private draw(dt: number): void {
    const { context: ctx, canvas: c } = this
    ctx.clearRect(0, 0, c.width, c.height)
    for (const star of this.stars) {
      star.y = (star.y + dt * 0.009 * star.depth) % 1
      ctx.fillStyle = `rgba(180,205,255,${star.depth * 0.7})`
      ctx.beginPath(); ctx.arc(star.x * c.width, star.y * c.height, star.depth * 1.5, 0, Math.PI * 2); ctx.fill()
    }
  }
  dispose(): void { this.active = false; cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.canvas.remove() }
}
