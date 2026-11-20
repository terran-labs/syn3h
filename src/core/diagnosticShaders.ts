type ShaderWork = 'Node build' | 'Render pipeline' | 'Compute pipeline'
type Phase = 0 | 1

type ShaderMaterial = {
  type?: string
  isShadowPassMaterial?: boolean
  transparent?: boolean
  userData?: { sharedShowroom?: boolean; glass?: boolean }
}
type ShaderObject = {
  parent?: ShaderObject | null
  isQuadMesh?: boolean
  isInstancedMesh?: boolean
  isSkinnedMesh?: boolean
  isSprite?: boolean
  geometry?: { attributes?: Record<string, unknown> }
  userData?: { vehicleColors?: unknown; clipmap?: unknown }
}
export type ShaderSource = {
  object?: ShaderObject | null
  material?: ShaderMaterial | null
  context?: { fullscreenPass?: boolean }
  compute?: unknown
}

const work: readonly ShaderWork[] = ['Node build', 'Render pipeline', 'Compute pipeline']
const topCount = 4

type Total = { calls: number; ms: number }
type SlowCall = { kind: ShaderWork; family: string; ms: number }
type PhaseStats = {
  totals: Record<ShaderWork, Total>
  wallMs: number
  slow: SlowCall[]
  smallest: number
}

function stats(): PhaseStats {
  return {
    totals: {
      'Node build': { calls: 0, ms: 0 },
      'Render pipeline': { calls: 0, ms: 0 },
      'Compute pipeline': { calls: 0, ms: 0 },
    },
    wallMs: 0,
    slow: Array.from({ length: topCount }, (): SlowCall => ({ kind: 'Node build', family: '', ms: 0 })),
    smallest: 0,
  }
}

const phases = [stats(), stats()] as const
let revealAt = Infinity
let depth = 0

/** The first gameplay overlay fade in this page session. Subsequent entries keep the split. */
export function markShaderReveal(): void {
  if (revealAt === Infinity) revealAt = performance.now()
}

export function beginShaderTiming(): Phase {
  depth++
  return revealAt === Infinity ? 0 : 1
}

function shaderFamily(kind: ShaderWork, source?: ShaderSource): string {
  const material = source?.material
  const object = source?.object
  if (kind === 'Compute pipeline' || source?.compute) return 'Compute shader'
  if (material?.isShadowPassMaterial) return 'Shadow pass'
  if (object?.isQuadMesh || source?.context?.fullscreenPass) return 'Fullscreen pass'
  if (material?.userData?.sharedShowroom) return 'Shared vehicle showroom'

  const attributes = object?.geometry?.attributes
  if (attributes?.aPlantTint && attributes.aGround) return 'Ground cover'
  if (attributes?.volcanic && attributes.road) return 'Terrain surface'
  if (object?.userData?.clipmap) return 'Liquid surface'
  // The vehicle and its generated assemblies publish their paint through this marker.
  // Read its presence only, and cap the walk for unexpectedly deep object trees.
  for (let parent = object, levels = 0; parent && levels < 16; parent = parent.parent, levels++) {
    if (!parent.userData?.vehicleColors) continue
    if (material?.userData?.glass || material?.transparent) return 'Vehicle transparent material'
    if (object?.isInstancedMesh) return 'Vehicle instanced mesh'
    if (attributes?.surfaceId) return 'Vehicle packed surfaces'
    return 'Vehicle mesh'
  }

  if (object?.isInstancedMesh) return 'Instanced mesh'
  if (object?.isSkinnedMesh) return 'Skinned mesh'
  if (object?.isSprite) return 'Sprite'
  // Only fixed allowlisted output strings. Never retain scene objects or use any object's name.
  switch (material?.type) {
    case 'MeshPhysicalMaterial':
    case 'MeshPhysicalNodeMaterial': return 'Physical material'
    case 'MeshStandardMaterial':
    case 'MeshStandardNodeMaterial': return 'Standard material'
    case 'MeshBasicMaterial':
    case 'MeshBasicNodeMaterial': return 'Unlit material'
    case 'NodeMaterial': return 'Node material'
    default: return 'Other render material'
  }
}

export function endShaderTiming(kind: ShaderWork, phase: Phase, start: number, end: number, source?: ShaderSource): void {
  // Calls are synchronous and paired in finally. Only the outer span contributes to
  // wall time. Counts and inclusive totals belong to the phase in which a call started.
  if (--depth === 0) {
    phases[0].wallMs += Math.max(0, Math.min(end, revealAt) - start)
    phases[1].wallMs += Math.max(0, end - Math.max(start, revealAt))
  }

  const row = phases[phase]
  const ms = Math.max(0, end - start)
  const total = row.totals[kind]
  total.calls++
  total.ms += ms

  const entry = row.slow[row.smallest]
  if (ms <= entry.ms) return
  entry.kind = kind
  entry.family = shaderFamily(kind, source)
  entry.ms = ms
  for (let i = 0; i < row.slow.length; i++) {
    if (row.slow[i].ms < row.slow[row.smallest].ms) row.smallest = i
  }
}

function summaryLine(title: string, first: PhaseStats, second?: PhaseStats): string {
  const wallMs = first.wallMs + (second?.wallMs ?? 0)
  const totals = work.map(kind => {
    const a = first.totals[kind]
    const b = second?.totals[kind]
    return `${kind} ×${a.calls + (b?.calls ?? 0)} / ${(a.ms + (b?.ms ?? 0)).toFixed(1)} ms`
  })
  return `${title} · ${wallMs.toFixed(1)} ms tracked wall time · ${totals.join(' · ')}`
}

/** Allocate report text only when Copy diagnostics asks for it. */
export function shaderReportLines(): string[] {
  const lines = [
    'Shader work since renderer hooks were installed (CPU elapsed)',
    'Per-kind totals are inclusive and assigned by call start. Tracked wall time counts nested calls once.',
    'Async graph builds, deferred compile completion, and GPU execution are excluded.',
    summaryLine('Whole session', phases[0], phases[1]),
  ]
  for (const [phase, row] of phases.entries()) {
    const section = phase === 0 ? 'Before first overlay fade'
      : revealAt === Infinity ? 'After first overlay fade (pending)' : 'After first overlay fade'
    lines.push(summaryLine(section, row))
    for (const item of row.slow.slice().sort((a, b) => b.ms - a.ms)) {
      if (item.ms > 0) lines.push(`  Slow call · ${item.kind} · ${item.family} · ${item.ms.toFixed(1)} ms`)
    }
  }
  return lines
}
