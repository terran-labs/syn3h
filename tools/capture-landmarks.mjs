/** Self-contained so the same resolver runs in Node tests and the capture page. */
export function resolveCaptureTeleport(terrain, request) {
  const finite = value => typeof value === 'number' && Number.isFinite(value)
  let t = { ...request }
  const landmark = request.landmark
  if (landmark === 'pad') {
    const spawn = terrain.spawnPoint(request.index ?? 0)
    t = { ...spawn.position, heading: spawn.heading }
  } else if (landmark === 'summit' || landmark === 'lava' || landmark === 'lava lake') {
    const summit = terrain.summit?.()
    if (!summit) throw new Error(`No summit for landmark ${landmark}`)
    if (landmark === 'summit') t = { x: summit.x + summit.rimRadius, z: summit.z, heading: Math.PI / 2 }
    else {
      if (!summit.lake) throw new Error('No lava lake on this terrain')
      t = { x: summit.x, z: summit.z, y: terrain.liquidHeightAt?.(summit.x, summit.z) + (request.clearance ?? 2), heading: 0 }
    }
  } else if (landmark === 'sea') {
    let found = null
    for (let i = 0; i < 64 && !found; i++) {
      const angle = i * Math.PI / 32, x = Math.cos(angle) * terrain.size * 0.47, z = Math.sin(angle) * terrain.size * 0.47
      const surface = terrain.liquidHeightAt?.(x, z)
      if (finite(surface) && terrain.heightAt(x, z) < surface - 1) found = { x, z, y: surface + (request.clearance ?? 2), heading: Math.atan2(x, z) }
    }
    if (!found) throw new Error('No exposed sea found near terrain boundary')
    t = found
  } else if (landmark === 'slope') {
    const road = terrain.roadPaths?.().find(r => r.kind === 'volcano')
    if (!road || road.points.length < 2) throw new Error('Slope landmark needs a summit road')
    const index = Math.min(road.points.length - 2, Math.floor(road.points.length / 4))
    const a = road.points[index], b = road.points[index + 1]
    t = { x: a.x, z: a.z, heading: Math.atan2(a.x - b.x, a.z - b.z) }
  } else if (landmark === 'dune') {
    let best = null, score = -Infinity
    for (let x = -280; x <= 280; x += 40) for (let z = -280; z <= 280; z += 40) {
      if (Math.hypot(x, z) < 100) continue
      for (let a = 0; a < 16; a++) {
        const heading = a * Math.PI / 8, dx = -Math.sin(heading), dz = -Math.cos(heading)
        const h = d => terrain.heightAt(x + dx * d, z + dz * d)
        const rise = h(0) - h(-25), fall = h(0) - h(25)
        const liquid = terrain.liquidHeightAt?.(x, z) ?? -Infinity
        if (rise > 1 && rise < 8 && fall > 2 && fall < 12 && h(-45) > liquid + 2 && rise + fall > score) {
          score = rise + fall; best = { x: x - dx * 45, z: z - dz * 45, heading }
        }
      }
    }
    if (!best) throw new Error('No suitable dune approach for this terrain seed')
    t = best
  } else if (landmark != null) throw new Error(`Unknown capture landmark: ${landmark}`)
  if (!finite(t.x) || !finite(t.z)) throw new Error('Teleport needs finite x and z')
  const result = { x: t.x, y: t.y ?? terrain.heightAt(t.x, t.z) + (request.clearance ?? 2), z: t.z, heading: request.heading ?? t.heading ?? 0 }
  if (!Object.values(result).every(finite)) throw new Error('Teleport resolved to a non-finite coordinate or heading')
  return result
}
