// Test observers only. They call each original exactly once and restore own properties.
export function installAboutInputObservers() {
  const { game, shell, params } = window.syn3h
  const net = window.syn3hNet
  if (!net?.gear || !net.bigRed || !net.yoink) throw new Error('Actual networked gear required')
  const restorers = [], records = [], order = [], events = [], redCalls = [], yoinkSends = [], transactions = [], pending = []
  let armed = null, acquiredAt = null, previousHolding = null, transaction = null, sequence = 0
  const snapshot = () => ({ tick: game.tick, time: game.time, fire: game.input.state.fire,
    suspended: game.input.suspended, paused: game.isPaused, gear: net.gear.current,
    charge: net.bigRed.charge, ready: net.bigRed.ready, red: { ...net.bigRed.stats },
    redCalls: redCalls.length, yoinkSends: yoinkSends.map(entry => ({ ...entry })), holding: net.yoink.holding, yoink: { ...net.yoink.stats },
    acquiredAt, holdTime: params.get('yoink.holdTime').value,
    rawPrimary: [...game.input.rawMouse], canvasOwners: [...game.input.canvasFirePointers],
    focus: document.activeElement?.className ?? '', locked: document.pointerLockElement === game.canvas })
  const wrap = (object, name, around) => {
    const original = object[name], descriptor = Object.getOwnPropertyDescriptor(object, name)
    if (typeof original !== 'function') throw new Error(`Missing observer method ${name}`)
    const replacement = function (...args) { return around.call(this, original, args) }
    object[name] = replacement
    restorers.push(() => { if (object[name] !== replacement) throw new Error(`Observer changed externally: ${name}`)
      if (descriptor) Object.defineProperty(object, name, descriptor); else delete object[name] })
    return replacement
  }
  const capture = (kind, detail) => {
    if (!armed || armed.kind !== kind) return
    const spec = armed; armed = null
    const record = { label: spec.label, detail, before: spec.before, preEvent: spec.preEvent ?? spec.before, preconditionFailure: spec.preconditionFailure ?? null, eventReturn: snapshot(), immediate: null, firstStep: null, stepEntry: null, resumedBy: null, orderStart: spec.orderStart }
    record.orderEnd = order.length
    records.push(record)
    // Attached AFTER actual target handlers for TAG, after global key handlers for keyup,
    // or queued after the real Shell modal method returns. Never a later evaluate snapshot.
    queueMicrotask(() => {
      record.immediate = snapshot()
      record.transactions = transactions.filter(t => t.start >= spec.orderStart && t.start < record.orderEnd).map(t => ({ ...t, calls: [...t.calls] }))
      if (spec.pausedRecord) {
        spec.pausedRecord.resumedBy = record.label
        spec.pausedRecord.beforeResume = spec.before
        record.resumes = spec.pausedRecord.label
      }
      pending.push(record)
    })
  }
  const listen = (target, type, fn, options) => {
    target.addEventListener(type, fn, options)
    restorers.push(() => target.removeEventListener(type, fn, options))
  }
  const tag = document.querySelector('.touch-fire[data-action="fire"]')
  const describe = event => ({ type: event.type, pointerId: event.pointerId, pointerType: event.pointerType,
    button: event.button, buttons: event.buttons, code: event.code, trusted: event.isTrusted })
  let droppedEvents = 0
  const elementName = element => element instanceof Element
    ? { tag: element.tagName, id: element.id, class: element.getAttribute('class'), action: element.getAttribute('data-action') } : null
  const logEvent = (event, phase) => {
    if (events.length >= 2000) { droppedEvents++; return }
    events.push({ ...describe(event), phase, tick: game.tick, time: game.time,
      target: elementName(event.target), relatedTarget: elementName(event.relatedTarget),
      focus: elementName(document.activeElement), x: event.clientX, y: event.clientY,
      tagHasCapture: typeof event.pointerId === 'number' ? tag?.hasPointerCapture(event.pointerId) ?? false : null,
      fire: game.input.state.fire, holding: net.yoink.holding })
  }
  // Passive evidence only: capture precedes the TAG target cleanup; target observes its result.
  for (const type of ['pointerleave', 'lostpointercapture', 'blur']) {
    listen(document, type, event => { if (event.target === tag) logEvent(event, 'capture') }, { capture: true, passive: true })
    if (tag) listen(tag, type, event => logEvent(event, 'after-tag-handler'), { passive: true })
  }
  if (tag) for (const type of ['pointerup', 'pointercancel']) listen(tag, type, event => {
    logEvent(event, 'after-tag-handler'); capture(type, describe(event))
  })
  const preFling = event => {
    if (!armed || armed.kind !== 'fling' || !(event.target instanceof Element) || !event.target.closest('.gs-action[data-action=fling]')) return
    armed.preEvent = snapshot()
    if (armed.preEvent.holding !== armed.expectedTarget || armed.preEvent.acquiredAt === null ||
        (armed.preEvent.holdTime > 0 && armed.preEvent.time - armed.preEvent.acquiredAt >= armed.preEvent.holdTime - .5))
      armed.preconditionFailure = 'Fling target/hold-window invalid at actual event'
  }
  document.addEventListener('click', preFling, true)
  restorers.push(() => document.removeEventListener('click', preFling, true))
  for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'keydown', 'keyup']) {
    listen(document, type, event => logEvent(event, 'capture'), { capture: true, passive: true })
  }
  listen(document, 'click', event => {
    if (event.target instanceof Element && event.target.closest('.gs-action[data-action=fling]'))
      capture('fling', { type: 'click', trusted: event.isTrusted })
  })
  listen(window, 'keyup', event => { if (event.code === 'KeyL') capture('keyup', describe(event)) })
  // Observe canvas endings after Input capture has recomputed/retired the native owner.
  listen(game.canvas, 'pointerup', event => capture('canvasup', describe(event)))
  wrap(net.gear, 'cancelActions', function (original, args) {
    const parent = transaction
    const current = { id: ++sequence, start: order.length, before: snapshot(), calls: [], returned: null }
    transactions.push(current); transaction = current
    order.push({ transaction: current.id, method: 'GearRack.cancelActions', phase: 'before', state: current.before })
    try { return original.apply(this, args) }
    finally {
      current.returned = snapshot()
      order.push({ transaction: current.id, method: 'GearRack.cancelActions', phase: 'after', state: current.returned })
      transaction = parent
    }
  })
  for (const [object, method, label] of [[game.input, 'cancelFireUntilNeutral', 'Input.inhibit'],
    [net.bigRed, 'cancel', 'BigRed.cancel'], [net.yoink, 'cancel', 'Yoink.cancel']]) wrap(object, method, function (original, args) {
    const owner = transaction
    const entry = { transaction: owner?.id ?? null, method: label, before: snapshot(), after: null }
    owner?.calls.push(entry)
    order.push({ transaction: entry.transaction, method: label, phase: 'before', state: entry.before })
    try { return original.apply(this, args) }
    finally {
      entry.after = snapshot()
      order.push({ transaction: entry.transaction, method: label, phase: 'after', state: entry.after })
    }
  })
  for (const name of ['requestPause', 'requestResume', 'releaseCursor']) wrap(shell, name, function (original, args) {
    try { return original.apply(this, args) }
    finally { capture(name, { method: name, trigger: 'actual Shell event handler' }) }
  })
  wrap(net, 'fire', function (original, args) {
    if (args[2] === 'red') redCalls.push({ tick: game.tick, time: game.time })
    return original.apply(this, args)
  })
  wrap(net, 'send', function (original, args) {
    if (args[0]?.type === 'yoink' && args[0].bot === undefined) {
      const { s: kind, to: target } = args[0].y
      yoinkSends.push({ kind, target: target ?? null, tick: game.tick, time: game.time })
      if (kind === 'grab') { acquiredAt = game.time; previousHolding = target }
      else if (kind === 'drop' || kind === 'fling') { acquiredAt = null; previousHolding = null }
    }
    return original.apply(this, args)
  })
  wrap(net.yoink, 'fixedUpdate', function (original, args) {
    const result = original.apply(this, args)
    if (net.yoink.holding === null) acquiredAt = null
    else if (net.yoink.holding !== previousHolding) acquiredAt = game.time
    previousHolding = net.yoink.holding
    return result
  })
  // Retain identities, never retarget a pending observation to a later system.
  const ids = new WeakMap()
  let nextId = 0
  const id = object => { if (!object) return null; if (!ids.has(object)) ids.set(object, ++nextId); return ids.get(object) }
  const first = game.systems.find(system => typeof system.fixedUpdate === 'function')
  const last = [...game.systems].reverse().find(system => typeof system.postPhysics === 'function')
  if (!first || !last) throw new Error('Normal ordered simulation hooks unavailable')
  const installedOrder = [...game.systems]
  const lifecycle = [], lifecycleFailures = []
  const invocations = { entry: 0, terminal: 0 }
  let entryWrapper, terminalWrapper, droppedLifecycle = 0, droppedFailures = 0
  const inspectHooks = phase => {
    const systems = [...game.systems]
    return { phase, tick: game.tick, frame: game.frames, first: id(first), last: id(last),
      firstIndex: systems.indexOf(first), lastIndex: systems.indexOf(last),
      systems: systems.map(id), installedOrder: installedOrder.map(id),
      bots: window.syn3h.bots.vehicles.map(id),
      roster: [...net.players.values()].filter(p => p.bot).map(p => ({ id: p.id, vehicle: id(net.vehicleOf(p.id)) })),
      entryWrapperIntact: first.fixedUpdate === entryWrapper,
      terminalWrapperIntact: last.postPhysics === terminalWrapper,
      firstStillFirst: systems.find(s => typeof s.fixedUpdate === 'function') === first,
      lastStillLast: [...systems].reverse().find(s => typeof s.postPhysics === 'function') === last }
  }
  const failLifecycle = (phase, reason, evidence = inspectHooks(phase)) => {
    const failure = { phase, reason, evidence }
    if (lifecycleFailures.length < 100) lifecycleFailures.push(failure); else droppedFailures++
    for (const record of pending) record.lifecycleFailure ??= failure
    return failure
  }
  const validateHooks = phase => {
    const evidence = inspectHooks(phase)
    if (lifecycle.length < 1000) lifecycle.push(evidence); else droppedLifecycle++
    if (evidence.firstIndex < 0 || evidence.lastIndex < 0 || !evidence.entryWrapperIntact ||
        !evidence.terminalWrapperIntact || !evidence.firstStillFirst || !evidence.lastStillLast ||
        game.systems.length !== installedOrder.length || game.systems.some((s, i) => s !== installedOrder[i]))
      return failLifecycle(phase, 'Retained simulation hook membership/order/wrapper changed', evidence)
    return null
  }
  entryWrapper = wrap(first, 'fixedUpdate', function (original, args) {
    invocations.entry++
    if (pending.length) {
      validateHooks('stepEntry')
      for (const record of pending) {
        if (record.stepEntry) failLifecycle('stepEntry', 'Terminal hook missed the first normal step')
        if (!record.lifecycleFailure) record.stepEntry = snapshot()
      }
    }
    try { return original.apply(this, args) }
    catch (error) { if (pending.length) failLifecycle('entryThrow', String(error)); throw error }
  })
  terminalWrapper = wrap(last, 'postPhysics', function (original, args) {
    invocations.terminal++
    if (pending.length) validateHooks('terminalBefore')
    let result
    try { result = original.apply(this, args) }
    catch (error) { if (pending.length) failLifecycle('terminalThrow', String(error)); throw error }
    if (pending.length) {
      validateHooks('terminalAfter')
      for (const record of pending.splice(0)) {
        if (!record.stepEntry || record.stepEntry.tick !== game.tick)
          record.lifecycleFailure ??= failLifecycle('terminalAfter', 'Terminal hook is not in the first entry tick')
        if (!record.lifecycleFailure) record.firstStep = snapshot()
      }
    }
    return result
  })
  validateHooks('install')
  const api = {
    snapshot, records, order, events, redCalls, yoinkSends, transactions,
    diagnostics() {
      validateHooks('diagnostic')
      return { lifecycle, lifecycleFailures, droppedLifecycle, droppedFailures, droppedEvents, invocations: { ...invocations },
        finalHooks: inspectHooks('final'), finalState: snapshot(),
        pending: pending.map(r => r.label), armed: armed?.label ?? null }
    },
    arm(label, kind, expectedTarget = null) {
      if (validateHooks('arm') || lifecycleFailures.length) throw new Error('Observer lifecycle invalid before arm')
      if (armed) throw new Error('Previous event observation still armed')
      const before = snapshot()
      const pausedRecord = pending.length === 1 && pending[0].immediate?.paused && kind === 'requestResume' ? pending[0] : null
      if (pending.length && !pausedRecord) throw new Error('Previous event has not reached its first normal step')
      if (pausedRecord && before.tick !== pausedRecord.immediate.tick) throw new Error('Simulation advanced while paused')
      if (expectedTarget !== null) {
        if (before.holding !== expectedTarget || before.acquiredAt === null) throw new Error('Target not held immediately before event')
        if (before.holdTime > 0 && before.time - before.acquiredAt >= before.holdTime - .5)
          throw new Error('Yoink hold too close to automatic timeout')
      }
      armed = { label, kind, before, expectedTarget, pausedRecord, orderStart: order.length }
      return before
    },
    restore() {
      const failures = []
      for (const restore of restorers.reverse()) try { restore() } catch (error) { failures.push(String(error)) }
      delete window.aboutInputObserver
      if (failures.length) throw new Error(failures.join('; '))
    },
  }
  window.aboutInputObserver = api
  return snapshot()
}
