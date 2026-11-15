/** Host-owned gear controllers reuse the player physics without reading player input. */
import * as THREE from 'three/webgpu'
import type { CordWire, YoinkWire } from '../../shared/protocol'
import type { Game } from '../core/Game'
import type { Vehicle } from '../vehicles/Vehicle'
import type { BotGearAction, BotGearOption } from '../bots/gear'
import { Bungee, type BungeeHooks } from './bungee/Bungee'
import { Yoink, type YoinkHooks } from './yoink/Yoink'
import { BigRed } from './BigRed'
import type { GearControl } from './aim'
import { bungeeAllowed, bungeeLength, bungeeCooldown } from './bungee/params'
import { yoinkAllowed, yoinkRange, yoinkCooldown } from './yoink/params'
import { bigRedAllowed, bigRedCharge, bigRedCooldown } from './bigRedParams'
import { pesterAllowed, pesterRange, pesterCooldown } from './pester/params'

export function botGearOptions(): BotGearOption[] {
  const options: BotGearOption[] = []
  if (bungeeAllowed.value) options.push({ id: 'bungee', range: bungeeLength.value, cooldown: bungeeCooldown.value })
  if (yoinkAllowed.value) options.push({ id: 'yoink', range: yoinkRange.value, cooldown: yoinkCooldown.value })
  if (bigRedAllowed.value) options.push({ id: 'red', range: 250, cooldown: bigRedCooldown.value, chargeSeconds: bigRedCharge.value })
  if (pesterAllowed.value) options.push({ id: 'pester', range: pesterRange.value, cooldown: pesterCooldown.value })
  return options
}

export interface BotGearHooks extends Omit<BungeeHooks, 'self' | 'control' | 'inHand' | 'send'> {
  vehicleIds(): number[]
  heldElsewhere(id: number): boolean
  responding(id: number): boolean
  sendCord(id: number, cord: CordWire): void
  sendYoink(id: number, y: YoinkWire): void
  fireRed(id: number, direction: [number, number, number]): void
  launchPester(id: number, target: Vehicle, direction: [number, number, number]): boolean
}

export class BotGear {
  readonly bungee: Bungee
  readonly yoink: Yoink
  readonly red: BigRed
  private selected: BotGearAction['gear'] | null = null
  private target: Vehicle | null = null
  private readonly control: GearControl = { fire: false, direction: [0, 0, -1] }
  private nextPester = 0

  constructor(private readonly game: Game, readonly id: number, readonly vehicle: Vehicle, private readonly hooks: BotGearHooks) {
    const common = {
      self: () => id, vehicleOf: hooks.vehicleOf, owns: hooks.owns,
      lagOf: hooks.lagOf, wrapSize: hooks.wrapSize, control: () => this.control,
    }
    this.bungee = new Bungee(game, {
      ...common, idOfBody: hooks.idOfBody, now: hooks.now,
      inHand: () => this.selected === 'bungee', send: cord => hooks.sendCord(id, cord), cue: hooks.cue,
    })
    this.yoink = new Yoink(game, {
      ...common, vehicleIds: hooks.vehicleIds, heldElsewhere: hooks.heldElsewhere,
      responding: hooks.responding, inHand: () => this.selected === 'yoink',
      send: y => hooks.sendYoink(id, y),
    } satisfies YoinkHooks)
    this.red = new BigRed(game, {
      control: () => this.control, body: () => vehicle.body, object: () => vehicle.object,
      inHand: () => this.selected === 'red', fire: d => hooks.fireRed(id, d),
    })
  }

  act(action: BotGearAction): void {
    if (action.phase === 'cancel') { this.cancel(); return }
    if (!this.valid(this.vehicle) || !this.valid(action.target)) { this.cancel(); return }
    if (this.selected !== action.gear) this.cancel()
    this.selected = action.gear
    this.target = action.target
    this.aim()
    this.control.fire = action.phase === 'press' || action.phase === 'hold'
    if (action.gear === 'bungee' && action.phase === 'release') this.bungee.letGo()
    if (action.gear === 'pester' && action.phase === 'press' && this.game.time >= this.nextPester) {
      if (this.hooks.launchPester(this.id, action.target, this.control.direction)) this.nextPester = this.game.time + pesterCooldown.value
    }
  }

  private aim(): void {
    if (!this.target) return
    const from = this.vehicle.body.translation(), to = this.target.body.translation()
    const size = this.hooks.wrapSize()
    const delta = (n: number) => size > 0 ? n - Math.round(n / size) * size : n
    const d = new THREE.Vector3(delta(to.x - from.x), to.y - from.y, delta(to.z - from.z)).normalize()
    this.control.direction = [d.x, d.y, d.z]
  }

  private valid(vehicle: Vehicle): boolean {
    return this.game.world.getRigidBody(vehicle.body.handle) === vehicle.body
      && this.hooks.idOfBody(vehicle.body.handle) !== null
  }

  fixedUpdate(dt: number): void {
    if (!this.valid(this.vehicle) || (this.target && !this.valid(this.target))) this.cancel()
    if (this.selected && !botGearOptions().some(o => o.id === this.selected)) this.cancel()
    this.aim()
    this.bungee.fixedUpdate(dt)
    this.yoink.fixedUpdate(dt)
    this.red.fixedUpdate(dt)
  }

  update(dt: number): void { this.bungee.update(dt); this.yoink.update(dt); this.red.update() }

  cancel(): void {
    this.control.fire = false
    this.selected = null
    this.target = null
    this.bungee.cancel()
    this.yoink.cancel()
    this.red.cancel()
  }

  dispose(): void {
    // Authority or roster already changed: remove local state without sending as a stale bot.
    this.bungee.dispose(); this.yoink.dispose(); this.red.dispose()
  }
}
