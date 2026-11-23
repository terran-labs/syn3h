/** Scenario only. The companion fixture owns browser provenance, deadlines and closure.
 * Private-cord diagnostics are separate from native normal-loop gameplay evidence. */
import assert from 'node:assert/strict'
const run = globalThis.__grappleRun
assert.ok(run, 'use the reviewed fixture under the external dedicated supervisor')
const { page, report, out, origin, expected, remaining, bounded, checkpoint, verifyBrowserEvidence, roomStatus } = run
const errors = report.errors, failures = report.failures, sockets = []
const intendedReach = 300
page.on('websocket', socket => { if (new URL(socket.url()).pathname === '/ws') sockets.push(socket.url()) })
const evaluate = (fn, arg) => bounded(page.evaluate(fn, arg), 30000, 'scenario evaluation')
const ready = (fn, arg, options = {}) => page.waitForFunction(fn, arg, { ...options, timeout: remaining(options.timeout ?? 10000) })
async function held(key, action) {
  let primary
  try { await bounded(page.keyboard.down(key), 5000, 'native key down'); await action() }
  catch (error) { primary = error; throw error }
  finally {
    try { await bounded(page.keyboard.up(key), 5000, 'native key up') }
    catch (error) { report.cleanupErrors.push(`Release ${key}: ${String(error)}`); if (!primary) throw error }
  }
}
const room = `grapple-ground-${expected.slice(0, 12)}-${Date.now()}`
const url = new URL(origin); url.searchParams.set('room', room)
report.navigationURL = url.href
await checkpoint('navigation starting')
await page.goto(url.href, { waitUntil: 'load', timeout: remaining(120000) })
await ready(() => window.mira?.game.tick > 25 && document.querySelector('.lobby-panels')?.dataset.busy === 'false', null, { timeout: remaining(120000) })
await page.locator('.galaxy-label[data-world="volcanic"]').click({ timeout: remaining(30000) })
await ready(room => window.mira?.shell.playing && window.mira.shell.room === room &&
  window.miraNet?.connected && window.miraNet.isHost && !window.mira.game.input.suspended,
  room, { timeout: remaining(120000) })
assert.deepEqual(await roomStatus(), { rooms: 1, players: 1 })
const expectedSocket = new URL('/ws', origin); expectedSocket.protocol = 'ws:'; expectedSocket.searchParams.set('room', room)
assert.ok(sockets.includes(expectedSocket.href), 'actual page socket joins the isolated room through owned Vite')
assert.ok(sockets.every(value => new URL(value).host === expectedSocket.host), 'no external room socket')
report.room = { name: room, socket: expectedSocket.href, sockets }
await evaluate(async () => {
  const { currentPlanet } = await import('/src/world/planets.ts')
  if (currentPlanet().id !== 'volcanic') throw new Error('wrong joined world')
  const { Bungee } = await import('/src/weapons/bungee/Bungee.ts')
  const { Game } = await import('/src/core/Game.ts')
  const { NetClient } = await import('/src/net/index.ts')
  if (!(window.miraNet.bungee instanceof Bungee) || !(window.mira.game instanceof Game) || !(window.miraNet instanceof NetClient))
    throw new Error('runtime objects do not match verified module classes')
  const { warmStats } = await import('/src/weapons/warm.ts')
  window.__terrainWarm = () => warmStats(window.mira.game)
})
report.parameterSetup = []
for (const [id, requested] of Object.entries({ 'gfx.auto': false, 'bots.canDrive': false,
  'bots.tagBeams': false, 'bots.count': 0, 'bungee.allowed': true, 'bungee.timeout': 0, 'bungee.length': intendedReach })) {
  const receipt = await evaluate(async ({ id, requested }) => {
    const { sanitize } = await import('/shared/params.ts')
    const p = window.mira.params, parameter = p.get(id)
    const result = { id, requested, before: parameter?.value ?? null, expected: null,
      effective: parameter?.value ?? null, changed: null, error: null,
      domain: parameter ? { default: parameter.def.default, min: parameter.def.min ?? null, max: parameter.def.max ?? null } : null }
    try {
      if (!parameter) throw new Error(`unknown parameter: ${id}`)
      if (typeof requested === 'number' && !Number.isFinite(requested)) throw new Error(`non-finite request: ${id}`)
      if (id === 'bungee.length' && (![parameter.def.min, parameter.def.max].every(Number.isFinite) ||
        typeof parameter.def.default !== 'number')) throw new Error('invalid reach domain')
      result.expected = sanitize(parameter.def, requested)
      if (result.expected !== requested) throw new Error(`unsupported parameter request: ${id}`)
      result.changed = p.set(id, requested)
      result.effective = p.get(id)?.value ?? null
      if (result.effective !== requested) throw new Error(`parameter not applied: ${id}`)
      // false is valid for an already-correct value; effective equality remains mandatory.
    } catch (error) { result.error = String(error.stack ?? error); result.effective = p.get(id)?.value ?? null }
    return result
  }, { id, requested })
  report.parameterSetup.push(receipt)
  await checkpoint(`parameter setup: ${id}`)
  assert.equal(receipt.error, null, `parameter setup failed: ${id}`)
  assert.equal(receipt.effective, requested, `effective parameter: ${id}`)
}
await verifyBrowserEvidence('entered real app before native gameplay')
await checkpoint('joined exact room and verified actual app modules')
const settle = async level => {
  await evaluate(level => {
    const s = window.mira
    if (s.game.isPaused) { window.miraNet.bungee.reset(); s.player.body.setGravityScale(1, true); s.game.resume() }
    if (!s.params.get('gfx.quality')) throw new Error('unknown quality parameter')
    s.params.set('gfx.quality', level)
    window.__qualityStartFrame = s.game.frames
  }, level)
  await ready(level => {
    const s = window.mira, warm = window.__terrainWarm()
    return s.params.get('gfx.quality')?.value === level && s.game.quality.appliedLevel === level &&
      !s.game.quality.isLoading && s.game.frames > window.__qualityStartFrame + 8 &&
      warm?.left === 0 && warm.frames > 0 && window.miraNet.bungee.look.segments === (level === 0 ? 12 : 24)
  }, level, { timeout: remaining(120000) })
  return evaluate(() => ({ quality: window.mira.params.get('gfx.quality').value,
    applied: window.mira.game.quality.appliedLevel, frames: window.mira.game.frames, warm: window.__terrainWarm() }))
}
report.initialWarm = await settle(3)

// Native slice FIRST: normal loop/camera, no private launch, seeded cord, manual
// ticks, altered gravity or camera assignment. This is desktop automation only.
await bounded(page.keyboard.press('Digit1'), 5000, 'native keyboard press')
const canvasPoint = await evaluate(() => {
  const canvas = window.mira.game.canvas, rect = canvas.getBoundingClientRect()
  for (const fy of [0.5, 0.65, 0.35, 0.8]) for (const fx of [0.5, 0.65, 0.35, 0.8]) {
    const x = rect.left + rect.width * fx, y = rect.top + rect.height * fy
    if (x > 0 && y > 0 && x < innerWidth && y < innerHeight && document.elementFromPoint(x, y) === canvas)
      return { x, y, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
  }
  throw new Error('no exposed game canvas point')
})
await checkpoint('exposed canvas point selected', { canvasPoint })
assert.ok(await evaluate(({ x, y }) => document.elementFromPoint(x, y) === window.mira.game.canvas, canvasPoint), 'canvas must still own native click point')
await bounded(page.mouse.click(canvasPoint.x, canvasPoint.y), 5000, 'native exposed canvas click')
await ready(() => document.pointerLockElement === window.mira.game.canvas)
await bounded(page.keyboard.press('Digit4'), 5000, 'native keyboard press')
await bounded(page.mouse.move(canvasPoint.x, Math.min(780, canvasPoint.y + 320), { steps: 12 }), 5000, 'native aim movement')
await ready(async intendedReach => {
  const { aimFrom } = await import('/src/weapons/aim.ts')
  const { BUNGEE_MUZZLE_UP, BUNGEE_MUZZLE_AHEAD } = await import('/src/weapons/bungee/Bungee.ts')
  const s = window.mira, effectiveReach = s.params.get('bungee.length')?.value
  if (!Number.isFinite(effectiveReach) || effectiveReach !== intendedReach) throw new Error('native aim reach differs from declared setup')
  const aim = aimFrom(s.game, s.player.body, effectiveReach, BUNGEE_MUZZLE_UP, BUNGEE_MUZZLE_AHEAD, 0.12)
  return window.miraNet.gear.current === 'bungee' && aim.point && aim.handle === null && aim.o.distanceTo(aim.point) > 5
}, intendedReach, { timeout: remaining(30000) })
await checkpoint('native aim ready')
const nativeBefore = await evaluate(() => ({ tick: window.mira.game.tick, stats: { ...window.miraNet.bungee.stats } }))
await held('KeyL', async () => {
  await ready(() => window.miraNet.bungee.attached, null, { timeout: 15000 })
})
const attached = await evaluate(() => ({ tick: window.mira.game.tick, stats: { ...window.miraNet.bungee.stats },
  at: window.miraNet.bungee.mine?.at?.toArray(), rest: window.miraNet.bungee.mine?.rest }))
await checkpoint('native attached', { nativeBefore, attached })
assert.equal(attached.stats.launched, nativeBefore.stats.launched + 1, 'one native launch')
assert.ok(attached.at && attached.tick > nativeBefore.tick, 'normal simulation attached to terrain')
await page.screenshot({ timeout: remaining(10000), path: `${out}/native-attached.png` })
await held('KeyV', async () => {
  await ready(rest => window.miraNet.bungee.mine?.rest > rest + 3, attached.rest, { timeout: 10000 })
})
const extended = await evaluate(() => ({ rest: window.miraNet.bungee.mine.rest, time: window.mira.game.time }))
await ready(time => window.mira.game.time > time + 0.6, extended.time)
await held('KeyL', async () => {
  await ready(rest => window.miraNet.bungee.mine?.rest < rest - 1, extended.rest, { timeout: 10000 })
  await page.screenshot({ timeout: remaining(10000), path: `${out}/native-reeling.png` })
})
report.native = { scope: 'trusted automated desktop input, normal loop and camera; not physical touch', before: nativeBefore, attached, extended,
  after: await evaluate(() => ({ rest: window.miraNet.bungee.mine?.rest, stats: { ...window.miraNet.bungee.stats }, tick: window.mira.game.tick })) }
report.native.contact = await evaluate(() => {
  const s = window.mira, b = window.miraNet.bungee, c = b.mine, t = s.terrain
  if (!c?.at) throw new Error('native terrain anchor missing')
  const V = s.player.object.position.constructor, n = b.look.segments
  const pos = b.look.cord.geometry.getAttribute('position'), base = c.slot * 50
  if (!Number.isInteger(c.slot) || c.slot < 0 || b.look.cordUsed[c.slot] !== true ||
    !Number.isInteger(n) || ![12, 24].includes(n) || !pos || pos.itemSize !== 3 ||
    !Number.isInteger(pos.count) || base + n * 2 + 1 >= pos.count)
    throw new Error('invalid native cord slot/segment position geometry')
  const finite = (values, label) => { if (!values.every(Number.isFinite)) throw new Error(`non-finite native ${label}`) }
  for (let i = base; i <= base + n * 2 + 1; i++) finite([pos.getX(i), pos.getY(i), pos.getZ(i)], 'ribbon coordinates')
  finite(c.at.toArray(), 'stored anchor')
  const midpoint = i => new V().fromBufferAttribute(pos, base + i * 2).lerp(new V().fromBufferAttribute(pos, base + i * 2 + 1), 0.5)
  const vehicle = b.hitch(s.player.object, new V()), anchor = b.nearestTo(c.at, vehicle)
  const sample = p => {
    finite(p.toArray(), 'endpoint coordinates')
    const collision = t.heightAt(p.x, p.z), rendered = t.renderHeightAt(p.x, p.z)
    const rawLiquid = t.liquidHeightAt?.(p.x, p.z)
    // Terrain's documented -Infinity sentinel means no liquid, not a measurement.
    const liquid = rawLiquid == null || rawLiquid === -Infinity ? null : rawLiquid
    if (liquid !== null) finite([liquid], 'liquid height')
    const surface = Math.max(rendered, liquid ?? -Infinity)
    finite([collision, rendered, surface], 'surface heights')
    return { point: p.toArray(), collision, rendered, liquid, surface }
  }
  const vehicleGap = midpoint(0).distanceTo(vehicle), anchorGap = midpoint(n).distanceTo(anchor)
  finite([vehicleGap, anchorGap], 'attachment gaps')
  return { vehicle: sample(vehicle), anchor: sample(anchor), vehicleGap, anchorGap, scope: 'observed native contact; no relocation or fallback reclassification' }
})
await checkpoint('native launch attach reel complete')
for (const key of ['vehicleGap', 'anchorGap']) {
  assert.ok(Number.isFinite(report.native.contact[key]), `native: finite ${key} required`)
  if (report.native.contact[key] > 0.02) failures.push(`native: ${key} ${report.native.contact[key]} exceeds 0.02 m`)
}
await bounded(page.keyboard.press('KeyG'), 5000, 'native keyboard press')
await ready(() => !window.miraNet.bungee.mine)
await evaluate(() => document.exitPointerLock())

await evaluate(() => {
  const s = window.mira, b = window.miraNet.bungee, t = s.terrain
  // Discover diagnostic locations without stopping normal warm-up.
  window.__groundSurface = b.hooks.surface
  const ground = (x, z) => Math.max(t.heightAt(x, z), t.liquidHeightAt?.(x, z) ?? -Infinity)
  const spawn = t.spawnPoint(0).position
  const fixtures = { flat: { a: [spawn.x, spawn.z], b: [spawn.x + 12, spawn.z], slack: true } }
  let ridge = { score: -Infinity }, dune = { score: -Infinity }, shore = { score: Infinity }, seam = { score: -Infinity }
  const half = t.size / 2
  for (let z = -half + 80; z < half - 80; z += 64) for (let x = -half + 80; x < half - 80; x += 64) {
    const a = ground(x - 60, z), h = ground(x, z), c = ground(x + 60, z)
    const score = h - (a + c) / 2
    if (Math.hypot(x, z) < half * 0.65 && score > ridge.score) ridge = { score, a: [x - 60, z], b: [x + 60, z], slack: false }
    if (Math.hypot(x, z) > half * 0.55 && h > 2 && h < 80 && score > dune.score) dune = { score, a: [x - 60, z], b: [x + 60, z], slack: false }
    const wet = t.liquidHeightAt?.(x - 30, z) ?? -Infinity
    if (t.heightAt(x - 30, z) < wet && t.heightAt(x + 30, z) > wet && Math.abs(t.heightAt(x, z) - wet) < shore.score)
      shore = { score: Math.abs(t.heightAt(x, z) - wet), a: [x - 30, z], b: [x + 30, z], slack: true }
  }
  for (let z = -half + 80; z < half - 80; z += 64) {
    const score = ground(half, z) - (ground(half - 40, z) + ground(half + 40, z)) / 2
    if (score > seam.score) seam = { score, a: [half - 40, z], b: [half + 40, z], slack: false }
  }
  if (!ridge.a || !dune.a || !shore.a || !seam.a) throw new Error('Could not locate all requested terrain fixtures')
  window.__groundFixtures = { ...fixtures, volcano: ridge, outerCrest: { ...dune, classification: 'outer low crest on volcanic recipe; NOT a verified desert dune' }, shoreline: shore, wrap: seam }
})
const capture = async (name, fixture, level, fixed = true, contactMode = 'valid-rendered-contact') => {
  assert.ok(['valid-rendered-contact', 'buried-contact-fallback'].includes(contactMode))
  await checkpoint('diagnostic intent before generation', { diagnosticIntent: { name, fixture, level, fixed, contactMode } })
  const warm = await settle(level)
  const prepared = await evaluate(async ({ fixture, level, fixed, contactMode }) => {
    const s = window.mira, b = window.miraNet.bungee, t = s.terrain, f = window.__groundFixtures[fixture]
    s.game.pause() // diagnostic only; the effective quality and warm gate ran on normal frames
    const V = s.player.object.position.constructor
    if (!t.renderHeightAt) throw new Error('rendered terrain sampler required')
    const finite = (values, label) => { if (!values.every(Number.isFinite)) throw new Error(`non-finite setup ${label}`) }
    const heights = (x, z) => {
      finite([x, z], 'sample coordinates')
      const collision = t.heightAt(x, z), rendered = t.renderHeightAt(x, z)
      const rawLiquid = t.liquidHeightAt?.(x, z)
      const liquid = rawLiquid == null || rawLiquid === -Infinity ? null : rawLiquid
      if (liquid !== null) finite([liquid], 'liquid height')
      const surface = Math.max(rendered, liquid ?? -Infinity)
      finite([collision, rendered, surface], 'surface heights')
      return { collision, rendered, liquid, surface }
    }
    // Camera and LOD are fixed before constructing either diagnostic contact.
    // These provisional collision points choose framing only, never attachment height.
    const frameA = new V(f.a[0], t.heightAt(...f.a) + 2, f.a[1])
    const frameB = new V(f.b[0], t.heightAt(...f.b), f.b[1])
    const midpoint = frameA.clone().lerp(frameB, 0.5), span = frameA.distanceTo(frameB)
    midpoint.y = Math.max(midpoint.y, t.heightAt(midpoint.x, midpoint.z))
    finite([...frameA.toArray(), ...frameB.toArray(), ...midpoint.toArray(), span], 'framing coordinates')
    s.game.camera.position.copy(midpoint).add(new V(0, Math.max(10, span * 0.4), Math.max(20, span * 0.9)))
    s.game.camera.lookAt(midpoint); s.game.camera.updateMatrixWorld()
    t.afterCamera()
    const lodBefore = t.meshes.stats(s.game.camera)
    const a = new V(f.a[0], heights(...f.a).surface + 2, f.a[1])
    const end = new V(f.b[0], heights(...f.b).surface - (contactMode === 'buried-contact-fallback' ? 0.5 : 0), f.b[1])
    s.player.teleport(a, 0); s.player.object.position.copy(a); s.player.body.setGravityScale(0, true)
    s.player.body.setLinvel({ x: 0, y: 0, z: 0 }, true); s.player.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    // Ensure the synthetic hitch is clear at its actual offset, not at the body centre.
    const setupHitch = b.hitch(s.player.object, new V())
    finite(setupHitch.toArray(), 'hitch coordinates')
    const lift = Math.max(0, heights(setupHitch.x, setupHitch.z).surface + 2 - setupHitch.y)
    a.y += lift; s.player.teleport(a, 0); s.player.object.position.copy(a)
    const contactHitch = b.hitch(s.player.object, new V())
    const contactSetup = { mode: contactMode, generationStarted: false, lod: lodBefore,
      camera: { position: s.game.camera.position.toArray(), quaternion: s.game.camera.quaternion.toArray() },
      vehicle: { point: contactHitch.toArray(), ...heights(contactHitch.x, contactHitch.z) },
      anchor: { point: end.toArray(), ...heights(end.x, end.z) } }
    contactSetup.vehicle.gap = contactHitch.y - contactSetup.vehicle.surface
    contactSetup.anchor.gap = end.y - contactSetup.anchor.surface
    finite([...contactSetup.vehicle.point, ...contactSetup.anchor.point, contactSetup.vehicle.gap, contactSetup.anchor.gap,
      ...contactSetup.camera.position, ...contactSetup.camera.quaternion], 'contact coordinates/gaps/camera')
    if (contactSetup.vehicle.gap < 0 || (contactMode === 'valid-rendered-contact'
      ? Math.abs(contactSetup.anchor.gap) > 1e-8 : contactSetup.anchor.gap > -0.49))
      throw new Error('declared diagnostic contact precondition failed')
    window.__preparedContact = { a, end, midpoint, span, lodBefore, contactSetup, f }
    return contactSetup
  }, { fixture, level, fixed, contactMode })
  await checkpoint('diagnostic contacts before cord generation', { contactSetup: prepared })
  const result = await evaluate(async ({ fixture, level, fixed, contactMode }) => {
    const s = window.mira, b = window.miraNet.bungee, t = s.terrain
    const V = s.player.object.position.constructor, surface = window.__groundSurface
    const { a, end, midpoint, span, lodBefore, contactSetup, f } = window.__preparedContact
    if (contactSetup.mode !== contactMode || JSON.stringify(t.meshes.stats(s.game.camera)) !== JSON.stringify(lodBefore))
      throw new Error('prepared contact mode or LOD changed before generation')
    const selectedHeight = surface.heightAt(end.x, end.z)
    if (![...a.toArray(), ...end.toArray(), selectedHeight, contactSetup.anchor.surface, contactSetup.vehicle.gap, contactSetup.anchor.gap].every(Number.isFinite))
      throw new Error('non-finite prepared contact before generation')
    if (Math.abs(selectedHeight - contactSetup.anchor.surface) > 1e-8)
      throw new Error('contact surface changed before generation')
    b.reset()
    const c = b.makeCord(window.miraNet.id)
    c.at = b.canonical3(end); c.rest = f.slack ? a.distanceTo(end) + 40 : Math.max(4, a.distanceTo(end) * 0.7)
    const unchangedAnchor = c.at.toArray()
    c.twang = 0; c.since = s.game.time - 5; c.pull = f.slack ? 0 : 10000; c.mass = 1
    b.hooks.surface = fixed ? surface : undefined
    b.update(0)
    await s.game.renderer.renderAsync(s.game.scene, s.game.camera)
    if (JSON.stringify(c.at.toArray()) !== JSON.stringify(unchangedAnchor)) throw new Error('diagnostic anchor mutated')
    if (JSON.stringify(t.meshes.stats(s.game.camera)) !== JSON.stringify(lodBefore)) throw new Error('LOD changed after contact setup')
    const pos = b.look.cord.geometry.getAttribute('position'), n = b.look.segments, base = c.slot * 50
    const vertex = i => new V().fromBufferAttribute(pos, base + i)
    let minimum = Infinity, queries = 0
    for (let i = 1; i <= n; i++) for (const across of [0, 0.5, 1]) {
      const aa = vertex((i - 1) * 2).lerp(vertex((i - 1) * 2 + 1), across)
      const bb = vertex(i * 2).lerp(vertex(i * 2 + 1), across)
      for (let k = 0; k <= 30; k++) { const p = aa.clone().lerp(bb, k / 30); minimum = Math.min(minimum, p.y - surface.heightAt(p.x, p.z)) }
    }
    const first = vertex(0).lerp(vertex(1), 0.5), last = vertex(n * 2).lerp(vertex(n * 2 + 1), 0.5)
    const hitch = b.hitch(s.player.object, new V())
    if (![...first.toArray(), ...last.toArray(), ...hitch.toArray(), ...end.toArray()].every(Number.isFinite))
      throw new Error('non-finite diagnostic endpoint coordinates')
    const attachment = { vehicleGap: first.distanceTo(hitch), anchorGap: last.distanceTo(end), first: first.toArray(), last: last.toArray(), anchor: end.toArray() }
    if (![attachment.vehicleGap, attachment.anchorGap, minimum].every(Number.isFinite))
      throw new Error('non-finite diagnostic gaps or unbent clearance')
    let cost
    if (fixed) {
      b.hooks.surface = { ...surface, heightAt(x, z) { queries++; return surface.heightAt(x, z) } }
      const start = performance.now()
      for (let i = 0; i < 20; i++) b.update(0)
      cost = { millisecondsPerUpdate: (performance.now() - start) / 20, heightQueriesPerUpdate: queries / 20, iterations: 20, sampler: 'active procedural terrain LOD plus liquid' }
      b.hooks.surface = surface
    }
    // CPU copies of the CURRENT visible terrain triangles, transformed exactly as
    // their GPU vertices are. Do not substitute the collision height for this check.
    const { curveOffset, copyCurveState } = await import('/src/world/curve.ts')
    const THREE = await import('/node_modules/three/build/three.webgpu.js')
    const bend = copyCurveState(new V()), curved = p => p.clone().add(curveOffset(p.x, p.y, p.z, new V()))
    const cpuLand = [], material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    t.meshes.group.updateMatrixWorld(true)
    t.meshes.group.traverseVisible(mesh => {
      if (!mesh.isMesh) return
      const geometry = mesh.geometry.clone(), positions = geometry.getAttribute('position')
      for (let i = 0; i < positions.count; i++) {
        const point = new V().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld)
        const drawn = curved(point); positions.setXYZ(i, drawn.x, drawn.y, drawn.z)
      }
      geometry.computeBoundingBox(); geometry.computeBoundingSphere()
      const copy = new THREE.Mesh(geometry, material); copy.updateMatrixWorld(true); cpuLand.push(copy)
    })
    const ray = new THREE.Raycaster(), radius = bend.z > 0 ? 1 / bend.z : Infinity
    const center = new V(bend.x, -radius, bend.y), reach = Math.max(1000, t.size * 2)
    let renderedMinimum = Infinity, renderedSamples = 0, missingTerrainRays = 0
    try {
      const index = b.look.cord.geometry.getIndex(), offset = c.slot * n * 6
      // Barycentric samples of BOTH actual indexed triangles per ribbon segment.
      // Finite sample evidence, not a universal proof between sample locations.
      for (let i = 0; i < n * 6; i += 3) {
        const triangle = [0, 1, 2].map(j => curved(new V().fromBufferAttribute(pos, index.getX(offset + i + j))))
        for (let u = 0; u <= 8; u++) for (let v = 0; v <= 8 - u; v++) {
          const point = triangle[0].clone().multiplyScalar(1 - (u + v) / 8)
            .addScaledVector(triangle[1], u / 8).addScaledVector(triangle[2], v / 8)
          const outward = bend.z > 0 ? point.clone().sub(center).normalize() : new V(0, 1, 0)
          ray.set(point.clone().addScaledVector(outward, reach), outward.clone().negate()); ray.far = reach * 2
          const hit = ray.intersectObjects(cpuLand, false)[0]
          if (!hit) { missingTerrainRays++; continue }
          let clearance = point.clone().sub(hit.point).dot(outward)
          // Shared liquid height is analytic, not a copied liquid render mesh.
          // Record this distinction; it checks the shared wave surface at the
          // sample's inverse spherical coordinate in addition to actual land.
          let x = point.x, z = point.z, height = point.y
          if (bend.z > 0) {
            const radial = point.clone().sub(center), horizontal = Math.hypot(radial.x, radial.z)
            const distance = Math.atan2(horizontal, radial.y) * radius
            x = bend.x + (horizontal > 1e-9 ? radial.x / horizontal * distance : 0)
            z = bend.y + (horizontal > 1e-9 ? radial.z / horizontal * distance : 0)
            height = radial.length() - radius
          }
          clearance = Math.min(clearance, height - (t.liquidHeightAt?.(x, z) ?? -Infinity))
          renderedMinimum = Math.min(renderedMinimum, clearance); renderedSamples++
        }
      }
    } finally { for (const mesh of cpuLand) mesh.geometry.dispose(); material.dispose() }
    if (!renderedSamples || missingTerrainRays) throw new Error(`Rendered terrain ray coverage missing: ${missingTerrainRays}`)
    const project = p => { const v = curved(p).project(s.game.camera); return [v.x, v.y, v.z] }
    const projected = [first, last, midpoint].map(project)
    const projectedSpan = Array.from({ length: (n + 1) * 2 }, (_, i) => project(vertex(i)))
    const projectedTargets = [hitch, end].map(project)
    return { fixture, level, fixed, contactMode, contactSetup, exactAttachmentAcceptance: fixed && contactMode === 'valid-rendered-contact', diagnostic: true, hookDisabledComparison: !fixed,
      minimum, renderedMinimum, renderedSamples, missingTerrainRays,
      renderedScope: 'actual bent land triangles and ribbon triangles, finite barycentric samples; analytic shared liquid surface',
      bend: bend.toArray(), lod: t.meshes.stats(s.game.camera),
      attachment, cost, projected, projectedSpan, projectedTargets, span, segments: n, scenario: f }

  }, { fixture, level, fixed, contactMode })
  result.warm = warm
  report.matrix.push({ name, ...result })
  await checkpoint(`diagnostic measured: ${name}`)
  assert.ok([...result.projected, ...result.projectedSpan, ...result.projectedTargets].every(([x, y, z]) => Math.abs(x) < .95 && Math.abs(y) < .95 && z > -1 && z < 1), `${name}: cord in frame`)
  await page.screenshot({ timeout: remaining(10000), path: `${out}/${name}.png` })
  // Both endpoint close-ups are required even when the whole cord is in view.
  for (const [index, label] of [[0, 'vehicle'], [1, 'anchor']]) {
    const [drawnX, drawnY, z] = result.projected[index]
    const [targetX, targetY] = result.projectedTargets[index]
    const x = (drawnX + targetX) / 2, y = (drawnY + targetY) / 2
    assert.ok(Math.abs(drawnX - targetX) * 640 < 280 && Math.abs(drawnY - targetY) * 400 < 200, `${name}: drawn end and actual ${label} fit the same close-up`)
    assert.ok(Math.abs(x) < .95 && Math.abs(y) < .95 && z > -1 && z < 1, `${name}: mandatory ${label} close-up in frame`)
    {
      await page.screenshot({ timeout: remaining(10000), path: `${out}/${name}-${label}.png`, clip: { x: Math.max(0, Math.min(960, (x + 1) * 640 - 160)), y: Math.max(0, Math.min(560, (1 - y) * 400 - 120)), width: 320, height: 240 } })
    }
  }
  if (fixed) {
    assert.ok([result.minimum, result.renderedMinimum, result.attachment.vehicleGap, result.attachment.anchorGap].every(Number.isFinite), 'finite clearances and attachment gaps required')
    if (result.minimum < -0.02) failures.push(`${name}: unbent penetration ${result.minimum}`)
    if (result.renderedMinimum < -0.02) failures.push(`${name}: rendered penetration ${result.renderedMinimum}`)
    // Intent was fixed before generation. Never reclassify a failed valid contact.
    if (contactMode === 'valid-rendered-contact') for (const key of ['vehicleGap', 'anchorGap']) if (result.attachment[key] > 0.02) failures.push(`${name}: ${key} ${result.attachment[key]} exceeds 0.02 m`)
  }
  await checkpoint(`diagnostic captured: ${name}`)
  console.log(JSON.stringify(result))
  return result
}
for (const fixture of ['flat', 'volcano']) {
  const before = await capture(`${fixture}-diagnostic-before`, fixture, 3, false)
  assert.ok(before.minimum < -0.5, 'diagnostic baseline reproduces penetration')
  const after = await capture(`${fixture}-after`, fixture, 3, true)
  report.comparisons.push({ before, after })
}
for (let level = 0; level < 6; level++) for (const fixture of ['volcano', 'outerCrest', 'shoreline', 'wrap'])
  await capture(`q${level}-${fixture}`, fixture, level, true)
for (const fixture of ['flat', 'volcano'])
  await capture(`${fixture}-buried-contact-fallback`, fixture, 3, true, 'buried-contact-fallback')
assert.deepEqual(errors, [])
assert.deepEqual(failures, [], 'clearance and endpoint assertions must pass')
console.log('GRAPPLE TERRAIN BROWSER PASS')
