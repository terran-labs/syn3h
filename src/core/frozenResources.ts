/** Explicit URLs keep late model/licence loads on the entry build after lobby cleanup.
 * Dev lab entrypoints do not initialize this policy and retain their existing URLs.
 * This module never fetches resources or retries a missing resource on latest.
 */
const VERSION = /^v?(\d+\.\d+\.\d+)$/ // Same grammar as server/worker.ts.

function version(value: string): string {
  const matched = VERSION.exec(value.trim())
  if (!matched) throw new Error(`Invalid frozen version selector: ${value}`)
  return matched[1]!
}

function pathVersion(path: string): string | null {
  if (!path.startsWith('/v/')) return null
  return version(path.slice(3).split('/')[0]!)
}

export function createFrozenResourceResolver(entryHref: string) {
  const entry = new URL(entryHref)
  const selectors = entry.searchParams.getAll('v').map(version)
  const fromPath = pathVersion(entry.pathname)
  if (fromPath !== null) selectors.push(fromPath)
  if (new Set(selectors).size > 1) throw new Error('Conflicting frozen version selectors')
  const selected = selectors[0] ?? null
  return Object.freeze({
    version: selected,
    resolve(resource: string): string {
      // Only these production static-resource families belong to this policy.
      // External, data/blob, protocol-relative and network endpoint URLs pass through.
      if (!resource.startsWith('/') || resource.startsWith('//')) return resource
      const existing = pathVersion(resource.split(/[?#]/)[0]!)
      if (existing !== null) {
        if (selected !== null && existing !== selected) throw new Error('Conflicting frozen resource version')
        return resource
      }
      // The Welcome pictures too, so a pinned build shows its own release's pictures.
      if (!/^\/(?:models|brand\/licenses|welcome)\//.test(resource)) return resource
      if (selected === null) return resource
      const parsed = new URL(resource, entry.origin)
      if (parsed.pathname !== resource.split(/[?#]/)[0]) throw new Error('Invalid frozen resource path')
      return `/v/${selected}${resource}`
    },
  })
}

let captured: ReturnType<typeof createFrozenResourceResolver> | undefined

/** Call once before constructing vehicles or cleaning the address. */
export function initializeFrozenResources(entryHref: string): void {
  if (captured) throw new Error('Frozen resource entry already captured')
  captured = createFrozenResourceResolver(entryHref)
}

export function frozenResourceURL(resource: string): string {
  return captured ? captured.resolve(resource) : resource
}
