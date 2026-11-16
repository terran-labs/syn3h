// Test observers only. They call each original exactly once and restore own properties.
export function installAboutInputObservers() {
  const { game, shell, params } = window.syn3h
  const net = window.syn3hNet
  if (!net?.gear || !net.bigRed || !net.yoink) throw new Error('Actual networked gear required')
  const restorers = [], records = [], order = [], events = [], redCalls = []
  let armed = null, active = null, acquiredAt = null, previousHolding = null
  const snapshot = () => ({ tick: game.tick, time: game.time, fire: game.input.state.fire,
    suspended: game.input.suspended, paused: game.isPaused, gear: net.gear.current,
    charge: net.bigRed.charge, ready: net.bigRed.ready, red: { ...net.bigRed.stats },
    redCalls: redCalls.length, holding: net.yoink.holding, yoink: { ...net.yoink.stats },
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
  }
  const capture = (kind, detail) => {
    if (!armed || armed.kind !== kind) return
    const spec = armed; armed = null
    const record = { label: spec.label, detail, before: spec.before, preEvent: spec.preEvent ?? spec.before, preconditionFailure: spec.preconditionFailure ?? null, immediate: null, firstStep: null, orderStart: order.length }
    records.push(record)
    // Attached AFTER actual target handlers for TAG, after global key handlers for keyup,
    // or queued after the real Shell modal method returns. Never a later evaluate snapshot.
    queueMicrotask(() => { record.immediate = snapshot(); active = record })
  }
  const listen = (target, type, fn) => {
    target.addEventListener(type, fn)
    restorers.push(() => target.removeEventListener(type, fn))
  }
  const tag = document.querySelector('.touch-fire[data-action="fire"]')
  const describe = event => ({ type: event.type, pointerId: event.pointerId, pointerType: event.pointerType,
    button: event.button, buttons: event.buttons, code: event.code, trusted: event.isTrusted })
  if (tag) for (const type of ['pointerup', 'pointercancel']) listen(tag, type, event => {
    events.push(describe(event)); capture(type, describe(event))
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
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'keydown', 'keyup']) {
    const log = event => { if (events.length < 2000) events.push(describe(event)) }
    document.addEventListener(type, log, true)
    restorers.push(() => document.removeEventListener(type, log, true))
  }
  listen(document, 'click', event => {
    if (event.target instanceof Element && event.target.closest('.gs-action[data-action=fling]'))
      capture('fling', { type: 'click', trusted: event.isTrusted })
  })
  listen(window, 'keyup', event => { if (event.code === 'KeyL') capture('keyup', describe(event)) })
  // Observe canvas endings after Input capture has recomputed/retired the native owner.
  listen(game.canvas, 'pointerup', event => capture('canvasup', describe(event)))
  for (const [object, method] of [[net.gear, 'cancelActions'], [game.input, 'cancelFireUntilNeutral'],
    [net.bigRed, 'cancel'], [net.yoink, 'cancel']]) wrap(object, method, function (original, args) {
    order.push({ method, phase: 'before', state: snapshot() })
    try { return original.apply(this, args) }
    finally { order.push({ method, phase: 'after', state: snapshot() }) }
  })
  for (const name of ['requestPause', 'requestResume', 'releaseCursor']) wrap(shell, name, function (original, args) {
    try { return original.apply(this, args) }
    finally { capture(name, { method: name, trigger: 'actual Shell event handler' }) }
  })
  wrap(net, 'fire', function (original, args) {
    if (args[2] === 'red') redCalls.push({ tick: game.tick, time: game.time })
    return original.apply(this, args)
  })
  wrap(net.yoink, 'fixedUpdate', function (original, args) {
    const result = original.apply(this, args)
    if (net.yoink.holding !== null && net.yoink.holding !== previousHolding) acquiredAt = game.time
    previousHolding = net.yoink.holding
    return result
  })
  // Existing actual systems order, not a manual weapon tick or altered accumulator.
  const first = game.systems.find(system => typeof system.fixedUpdate === 'function')
  const last = [...game.systems].reverse().find(system => typeof system.postPhysics === 'function')
  if (!first || !last) throw new Error('Normal ordered simulation hooks unavailable')
  wrap(first, 'fixedUpdate', function (original, args) {
    if (active && !active.firstStep) active.stepEntry = snapshot()
    return original.apply(this, args)
  })
  wrap(last, 'postPhysics', function (original, args) {
    const result = original.apply(this, args)
    if (active && !active.firstStep) { active.firstStep = snapshot(); active = null }
    return result
  })
  const api = {
    snapshot, records, order, events, redCalls,
    arm(label, kind, expectedTarget = null) {
      if (armed) throw new Error('Previous event observation still armed')
      const before = snapshot()
      if (expectedTarget !== null) {
        if (before.holding !== expectedTarget || before.acquiredAt === null) throw new Error('Target not held immediately before event')
        if (before.holdTime > 0 && before.time - before.acquiredAt >= before.holdTime - .5)
          throw new Error('Yoink hold too close to automatic timeout')
      }
      armed = { label, kind, before, expectedTarget }
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
