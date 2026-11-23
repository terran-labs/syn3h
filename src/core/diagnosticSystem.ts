import type { PerformanceSnapshot } from './performance'
import { LEVELS, type GovernorReason } from './quality'

declare const __MIRA_BUILD__: string | undefined
declare const __MIRA_FREEZE_ID__: string | null | undefined
declare const __MIRA_COMMIT__: string | null | undefined

const backendReasons = {
  'forced-webgl2': 'WebGL 2 was explicitly requested',
  webgpu: 'WebGPU initialized',
  'adapter-timeout': 'WebGPU adapter probe timed out',
  'adapter-missing': 'No WebGPU adapter was available',
  'webgpu-unsupported': 'WebGPU was unavailable in this browser',
  'webgpu-start-timeout': 'WebGPU startup timed out',
  'webgpu-start-failed': 'WebGPU startup failed',
  'webgpu-device-failed': 'WebGPU device or context failed',
} as const

const qualityReasons: Readonly<Record<GovernorReason | 'start', string>> = {
  start: 'Startup', shed: 'Reduced rendering cost', climb: 'Restored rendering quality',
  'level-drop': 'Moved to a lower level', 'level-climb': 'Moved to a higher level', 'climb-abandoned': 'Higher level not ready in time',
  manual: 'Player selection', 'auto-off': 'Automatic quality disabled',
  'auto-on': 'Automatic quality enabled', display: 'Display budget changed',
}

const unavailable = 'Unavailable'

function mapped(labels: Readonly<Record<string, string>>, key: unknown): string | undefined {
  return typeof key === 'string' && Object.hasOwn(labels, key) ? labels[key] : undefined
}

function browserLabel(ua: string): string {
  // Check browser-specific tokens before the engines they also advertise.
  const browsers: readonly (readonly [string, RegExp])[] = [
    ['Edge', /\b(?:Edg|EdgA|EdgiOS|Edge)\/(\d{1,4}(?:\.\d{1,6}){0,3})(?=\s|[;)]|$)/],
    ['Opera', /\b(?:OPR|OPiOS)\/(\d{1,4}(?:\.\d{1,6}){0,3})(?=\s|[;)]|$)/],
    ['Samsung Internet', /\bSamsungBrowser\/(\d{1,4}(?:\.\d{1,6}){0,3})(?=\s|[;)]|$)/],
    ['Firefox', /\b(?:Firefox|FxiOS)\/(\d{1,4}(?:\.\d{1,6}){0,3})(?=\s|[;)]|$)/],
    ['Chrome', /\b(?:Chrome|CriOS)\/(\d{1,4}(?:\.\d{1,6}){0,3})(?=\s|[;)]|$)/],
    ['Safari', /\bVersion\/(\d{1,4}(?:\.\d{1,6}){0,3})(?=[^\n]*\bSafari\/)/],
  ]
  for (const [name, pattern] of browsers) {
    const version = pattern.exec(ua)?.[1]
    if (version) return `${name} ${version}`
  }
  return unavailable
}

function platformLabels(ua: string, touch: number | undefined): [os: string, device: string] {
  const appleMobile = /\b(iPad|iPhone|iPod)\b/.exec(ua)?.[1]
  if (appleMobile) {
    const version = /\bOS (\d{1,3}(?:_\d{1,3}){0,3})(?=\s|[;)]|$)/.exec(ua)?.[1].replaceAll('_', '.')
    const tablet = appleMobile === 'iPad'
    return [`${tablet ? 'iPadOS' : 'iOS'}${version ? ' ' + version : ''}`, tablet ? 'Tablet' : 'Phone']
  }
  if (/\bAndroid\b/.test(ua)) {
    const version = /\bAndroid (\d{1,3}(?:\.\d{1,3}){0,3})(?=\s|[;)]|$)/.exec(ua)?.[1]
    return [version ? 'Android ' + version : 'Android', /\bMobile\b/.test(ua) ? 'Phone' : 'Tablet']
  }
  if (/\bMacintosh\b/.test(ua)) {
    // Safari on iPad can use a desktop UA which gives no iPadOS version.
    if ((touch ?? 0) > 1) return ['iPadOS (inferred)', 'Tablet']
    const version = /\bMac OS X (\d{1,3}(?:[_.]\d{1,3}){0,3})(?=\s|[;)]|$)/.exec(ua)?.[1].replaceAll('_', '.')
    return [version ? 'macOS ' + version : 'macOS', 'Desktop']
  }
  const nt = /\bWindows NT (\d{1,2}\.\d{1,2})(?=\s|[;)]|$)/.exec(ua)?.[1]
  if (nt) return [`Windows (NT ${nt})`, 'Desktop']
  const chromeOS = /\bCrOS [a-z0-9_]+ (\d{1,6}(?:\.\d{1,6}){0,3})(?=\s|[;)]|$)/i.exec(ua)?.[1]
  if (chromeOS) return ['ChromeOS ' + chromeOS, 'Desktop']
  if (/\bLinux\b/.test(ua)) return ['Linux', 'Desktop']
  return [unavailable, unavailable]
}

const gpuVendors = { amd: 'AMD', apple: 'Apple', arm: 'Arm', intel: 'Intel', nvidia: 'NVIDIA',
  qualcomm: 'Qualcomm', imagination: 'Imagination', mesa: 'Mesa', google: 'Google', microsoft: 'Microsoft' } as const
const gpuArchitectures = { adreno: 'Adreno', ampere: 'Ampere', blackwell: 'Blackwell', gcn: 'GCN',
  mali: 'Mali', rdna: 'RDNA', rdna2: 'RDNA 2', rdna3: 'RDNA 3', rdna4: 'RDNA 4',
  turing: 'Turing', 'ada-lovelace': 'Ada Lovelace', swiftshader: 'SwiftShader', 'apple-gpu': 'Apple GPU',
  geforce: 'GeForce', quadro: 'Quadro', radeon: 'Radeon', arc: 'Arc', iris: 'Iris', uhd: 'UHD Graphics',
  powervr: 'PowerVR', llvmpipe: 'LLVMpipe', softpipe: 'Softpipe', warp: 'WARP' } as const

function safeAdapter(environment: PerformanceSnapshot['environment'] | undefined): string {
  // The old snapshot joins vendor, architecture, device and free-form driver description.
  // Accept a recognized leading vendor only. Architecture needs its own field.
  const candidate = environment?.adapterVendor ?? environment?.adapter?.trim().split(/\s+/, 1)[0]
  const vendor = mapped(gpuVendors, candidate?.trim().toLowerCase())
  const architecture = mapped(gpuArchitectures, environment?.adapterArchitecture?.trim().toLowerCase())
  return [vendor, architecture].filter(Boolean).join(' / ') || unavailable
}

function rendererReason(environment: PerformanceSnapshot['environment'] | undefined): string {
  const stated = mapped(backendReasons, environment?.backendReason)
  if (stated) return stated
  if (environment?.backend === 'webgpu') return backendReasons.webgpu
  const fallback = environment?.fallbackReason
  if (environment?.backend !== 'webgl' || !fallback) return unavailable
  // Recognize the renderer's fixed prefixes without including any driver error text.
  if (fallback.startsWith('the WebGPU adapter probe stalled')) return backendReasons['adapter-timeout']
  if (fallback.startsWith('no WebGPU adapter;')) return backendReasons['adapter-missing']
  if (fallback.startsWith('no WebGPU in this browser;')) return backendReasons['webgpu-unsupported']
  if (fallback.startsWith('WebGPU startup took longer')) return backendReasons['webgpu-start-timeout']
  if (fallback.startsWith('WebGPU startup failed:')) return backendReasons['webgpu-start-failed']
  if (fallback.startsWith('WebGPU device or context failed;')) return backendReasons['webgpu-device-failed']
  return unavailable
}

function amount(value: number | undefined | null, minimum: number, maximum: number, precision = 0): string {
  return value != null && Number.isFinite(value) && value >= minimum && value <= maximum
    ? String(Number(value.toFixed(precision))) : unavailable
}

/** Read-only diagnostics suitable for copying. Reads only local browser and shipped build data. */
export function systemReportLines(snapshot: PerformanceSnapshot | null): string[] {
  const environment = snapshot?.environment
  const nav = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { deviceMemory?: number }
  const display = typeof screen === 'undefined' ? undefined : screen
  const ua = nav?.userAgent ?? ''
  const [os, device] = platformLabels(ua, nav?.maxTouchPoints)
  const media = (query: string) => typeof matchMedia === 'function' && matchMedia(query).matches
  const pointer = media('(pointer: fine)') ? 'Fine'
    : media('(pointer: coarse)') ? 'Coarse' : media('(pointer: none)') ? 'None' : unavailable
  const motion = media('(prefers-reduced-motion: reduce)') ? 'Reduced'
    : media('(prefers-reduced-motion: no-preference)') ? 'No preference' : unavailable
  const width = amount(display?.width, 1, 32768)
  const height = amount(display?.height, 1, 32768)
  const dimensions = width !== unavailable && height !== unavailable ? `${width} × ${height} CSS px` : unavailable
  const dpr = amount(typeof devicePixelRatio === 'number' ? devicePixelRatio : undefined, 0.1, 16, 2)
  const buildLabel = typeof __MIRA_BUILD__ === 'string' ? __MIRA_BUILD__.trim() : ''
  const buildFreeze = typeof __MIRA_FREEZE_ID__ === 'string' ? __MIRA_FREEZE_ID__.trim() : ''
  const buildCommit = typeof __MIRA_COMMIT__ === 'string' ? __MIRA_COMMIT__.trim() : ''
  const version = /^v?\d{1,4}\.\d{1,4}\.\d{1,6}$/.test(buildLabel) ? buildLabel : unavailable
  const freezeId = /^\d{8}-\d{6}-[0-9a-f]{7,64}$/.test(buildFreeze) ? buildFreeze : unavailable
  const commit = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(buildCommit) ? buildCommit : unavailable
  const backend = mapped({ webgpu: 'WebGPU', webgl: 'WebGL 2', initializing: 'Initializing' }, environment?.backend) ?? unavailable
  const memory = amount(environment?.memoryGB ?? nav?.deviceMemory, 0.1, 1024, 2)
  const lines = [
    `Version: ${version}`, `Freeze build ID: ${freezeId}`, `Source commit: ${commit}`,
    `Browser: ${browserLabel(ua)}`, `OS: ${os} (as reported by the browser)`, `Device class: ${device}`,
    `Input: primary pointer ${pointer}; touch points ${amount(nav?.maxTouchPoints, 0, 128)}; motion ${motion}`,
    `Screen: ${dimensions}; DPR ${dpr}`,
    `Logical cores: ${amount(nav?.hardwareConcurrency, 1, 4096)}`,
    `Memory estimate: ${memory === unavailable ? unavailable : memory + ' GB'} (as reported by the browser)`,
    `Renderer: ${backend}; reason: ${rendererReason(environment)}`,
    `Adapter: ${safeAdapter(environment)}; max texture dimension: ${amount(environment?.maxTextureSize, 1, 131072)}`,
  ]
  if (environment?.deviceLost) lines.push('Graphics device or context loss recorded')
  if (snapshot) {
    const quality = snapshot.quality
    const level = LEVELS[quality.level]?.name ?? unavailable
    const easing = mapped({ base: 'None', post: 'Post effects', resolution: 'Resolution' }, quality.kind) ?? unavailable
    const reason = mapped(qualityReasons, snapshot.qualityReason) ?? unavailable
    lines.push(`Graphics quality: ${level} (level ${quality.level}); auto ${quality.auto ? 'on' : 'off'}; level ${snapshot.levelPinned ? 'pinned' : 'unpinned'}`)
    lines.push(`Quality easing: ${easing}; rung ${quality.rung + 1} of ${quality.rungs}; target ${quality.targetFps} FPS`)
    lines.push(`Quality reason: ${reason}; automatic changes ${amount(snapshot.qualityChanges, 0, Number.MAX_SAFE_INTEGER)}; level changes ${amount(snapshot.qualityLevelChanges, 0, Number.MAX_SAFE_INTEGER)}`)
  } else {
    lines.push('Graphics quality: Unavailable')
  }
  return lines
}
