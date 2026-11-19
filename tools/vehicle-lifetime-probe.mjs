const CYCLES = 20

/**
 * Run on an existing visible Playwright page in a dedicated solo host room.
 * Each cycle adds a fresh bot, swaps the player out and back through the
 * normal cached swap path, then lets the bot depart through its normal effect.
 */
export async function runVehicleLifetimeProbe(page, { settleMs = 3000, timeout = 60_000 } = {}) {
  const wait = async (predicate, arg) => { await page.waitForFunction(predicate, arg, { timeout }) }
  const idle = () => {
    const s = window.syn3h
    return !!s?.shell.playing && !s.shell.transitioning && !s.game.isPaused
      && document.visibilityState === 'visible'
      && !s.bots.arriving && s.bots.leaving.size === 0
      && s.bots.vehicles.length === 0 && s.materialize.holds.length === 0
      && s.game.scene.userData.playerVehicleCache?.pending === false
  }
  const snapshot = () => page.evaluate(() => {
    const { game, params, player, bots } = window.syn3h
    const memory = game.renderer.info.memory
    const rendererMemory = Object.fromEntries(
      Object.entries(memory ?? {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
    )
    const materials = new Set()
    game.scene.traverse(object => {
      if (Array.isArray(object.material)) {
        for (const material of object.material) if (material) materials.add(material)
      } else if (object.material) materials.add(object.material)
    })
    return {
      frame: game.frames,
      backend: game.backend,
      quality: params.get('gfx.quality').value,
      resolution: [game.canvas.width, game.canvas.height],
      playerKind: player.kind,
      bots: bots.vehicles.length,
      rendererMemory,
      rendererLivePipelines: game.performance.pipelinesLive ?? null,
      sceneUniqueMaterials: materials.size,
    }
  })
  const setBotCount = count => page.evaluate(count => window.syn3h.params.set('bots.count', count), count)
  const swap = async kind => {
    await page.evaluate(kind => {
      const s = window.syn3h
      if (!s.swapVehicle(kind) || s.player.kind !== kind) throw new Error(`Could not switch to ${kind}`)
    }, kind)
    await wait(kind => {
      const s = window.syn3h
      return s.shell.playing && s.player.kind === kind && s.materialize.holds.length === 0
    }, kind)
  }
  const settle = async () => {
    await wait(idle)
    const start = await page.evaluate(() => ({ frame: window.syn3h.game.frames, now: performance.now() }))
    await wait(({ frame, now, settleMs }) => (
      window.syn3h.game.frames >= frame + 2 && performance.now() - now >= settleMs
    ), { ...start, settleMs })
    await wait(idle)
  }

  const setup = await page.evaluate(() => {
    const s = window.syn3h, net = window.syn3hNet
    if (!s?.shell.playing || s.shell.transitioning || s.game.isPaused || document.visibilityState !== 'visible'
      || !net?.connected || !net.isHost || net.remotes.size > 0 || s.bots.remote) {
      throw new Error('Use a visible page playing in a dedicated solo host room')
    }
    const keys = ['bots.count', 'bots.keepCount', 'daydream.seconds']
    const settings = keys.map(key => [key, s.params.get(key).value])
    return { settings, playerKind: s.player.kind }
  })
  const alternate = setup.playerKind === 'hovercraft' ? 'buggy' : 'hovercraft'
  const cycles = []
  try {
    await page.evaluate(() => {
      const { params } = window.syn3h
      params.set('daydream.seconds', 0)
      params.set('bots.keepCount', true)
      params.set('bots.count', 0)
    })
    await settle()
    const initial = await snapshot()
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      await setBotCount(1)
      await wait(() => {
        const s = window.syn3h
        return s.shell.playing && s.bots.vehicles.length === 1 && !s.bots.arriving
          && s.materialize.holds.length === 0
      })
      const botId = await page.evaluate(() => window.syn3h.bots.vehicles[0].id)
      await swap(alternate)
      await swap(setup.playerKind)
      await setBotCount(0)
      // The count drops before the departure effect has finished and the game removes the bot.
      await wait(idle)
      cycles.push({ cycle, botId, afterRemoval: await snapshot() })
    }
    await settle()
    const final = await snapshot()
    const rendererMemoryDelta = Object.fromEntries(
      Object.entries(initial.rendererMemory)
        .filter(([key]) => Object.hasOwn(final.rendererMemory, key))
        .map(([key, value]) => [key, final.rendererMemory[key] - value]),
    )
    return {
      initial,
      cycles,
      final,
      delta: {
        rendererMemory: rendererMemoryDelta,
        rendererLivePipelines: final.rendererLivePipelines === null || initial.rendererLivePipelines === null
          ? null : final.rendererLivePipelines - initial.rendererLivePipelines,
        sceneUniqueMaterials: final.sceneUniqueMaterials - initial.sceneUniqueMaterials,
      },
      notes: [
        'rendererMemory comes directly from renderer.info.memory. Missing counters are unavailable.',
        'sceneUniqueMaterials counts distinct material objects attached to the game scene, including hidden objects. It does not count renderer-live materials.',
        'Player swaps deliberately reuse parked vehicles. Bot creation and removal exercise fresh lifetimes.',
      ],
    }
  } finally {
    await page.evaluate(({ settings, playerKind }) => {
      const s = window.syn3h
      for (const [key, value] of settings) s.params.set(key, value)
      if (s.shell.playing && s.player.kind !== playerKind && !s.swapVehicle(playerKind)) {
        throw new Error(`Could not restore player vehicle ${playerKind}`)
      }
    }, setup)
  }
}
