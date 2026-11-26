/**
 * Graphics capability in words fit for grouping (launch analytics' device and perf rows): the
 * client normalises with these, and the server checks the result against the same vocabulary
 * (server/analytics.ts). Coarse on purpose: a GPU family groups thousands of players; a raw
 * driver string with its versions would only help to tell one machine from another.
 */

export const GPU_VENDORS = ['apple', 'nvidia', 'amd', 'intel', 'qualcomm', 'arm', 'imagination', 'microsoft', 'google', 'mesa', 'other', 'unknown'] as const
export type GpuVendor = (typeof GPU_VENDORS)[number]

/** A vendor from any of the strings a browser gives (WebGPU vendor, WebGL renderer). */
export function gpuVendor(...texts: (string | null | undefined)[]): GpuVendor {
  const t = texts.filter(Boolean).join(' ').toLowerCase()
  if (!t.trim()) return 'unknown'
  if (/swiftshader|google/.test(t)) return 'google'
  if (/llvmpipe|softpipe|mesa/.test(t)) return 'mesa'
  if (/\bwarp\b|microsoft basic render/.test(t)) return 'microsoft'
  if (/apple/.test(t)) return 'apple'
  if (/nvidia|geforce|quadro|\brtx\b/.test(t)) return 'nvidia'
  if (/\bamd\b|\bati\b|radeon/.test(t)) return 'amd'
  if (/intel|iris|uhd graphics/.test(t)) return 'intel'
  if (/qualcomm|adreno/.test(t)) return 'qualcomm'
  if (/\barm\b|mali/.test(t)) return 'arm'
  if (/imagination|powervr/.test(t)) return 'imagination'
  return 'other'
}

export const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 +-]{0,39}$/

/**
 * A groupable model family from a renderer string: ANGLE's wrapper, API and driver details,
 * device ids and versions removed. "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max,
 * Unspecified Version)" gives "Apple M2 Max"; "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070
 * (0x00002786) Direct3D11 vs_5_0 ps_5_0, D3D11)" gives "GeForce RTX 4070". At most 40
 * characters of [A-Za-z0-9 +-]; '' when nothing usable is left.
 */
export function gpuFamily(raw: string | null | undefined): string {
  let s = (raw ?? '').trim()
  const angle = /^ANGLE \(([^,]*),\s*(.*?)(?:,\s*[^,]*)?\)$/.exec(s)
  if (angle) s = angle[2]
  s = s
    .replace(/ANGLE Metal Renderer:\s*/i, '')
    .replace(/\((?:0x)?[0-9a-f]{4,}\)/gi, ' ')
    .replace(/\b(?:Direct3D\s*\d+|D3D\d+|vs_\d_\d|ps_\d_\d|OpenGL(?: ES)?(?: Engine)?|Vulkan[\d. ]*|Metal|Unspecified Version|Compatibility Profile Context)\b.*$/i, '')
    .replace(/\b(?:NVIDIA|AMD|Intel\(R\)|Intel|Qualcomm|ARM)\s+(?=\S)/gi, (m) => (/intel/i.test(m) ? 'Intel ' : ''))
    .replace(/\((?:R|TM)\)|®|™/gi, '')
    .replace(/[^A-Za-z0-9 +-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim()
  return MODEL_PATTERN.test(s) ? s : ''
}

/**
 * The WebGPU features recorded: the one the game uses (timestamp-query, glass timing) and
 * those that decide whether a rendering feature could reach a player. Short codes, sorted.
 */
export const GPU_FEATURES: Readonly<Record<string, string>> = {
  'timestamp-query': 'ts',
  'float32-filterable': 'f32f',
  'texture-compression-bc': 'bc',
  'texture-compression-etc2': 'etc2',
  'texture-compression-astc': 'astc',
  'shader-f16': 'f16',
}
const CODES = new Set(Object.values(GPU_FEATURES))

export function featureCodes(features: Iterable<string> | null | undefined): string {
  const out = new Set<string>()
  for (const f of features ?? []) if (GPU_FEATURES[f]) out.add(GPU_FEATURES[f])
  return [...out].sort().join(',')
}

/** A feature list as sent, if every code is ours. */
export function cleanFeatureCodes(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (v === '') return ''
  const parts = v.split(',')
  return parts.length <= CODES.size && parts.every((p) => CODES.has(p)) ? [...new Set(parts)].sort().join(',') : null
}
