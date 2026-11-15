import {describe,expect,it,vi} from 'vitest'
import {PlayerSlot} from '../../src/vehicles/PlayerSlot'
import type {Vehicle} from '../../src/vehicles/Vehicle'

const vehicle=(kind:string)=>({kind}) as unknown as Vehicle

describe('the player slot',()=>{
 it('holds the current vehicle and announces a change with the previous one',()=>{
  const a=vehicle('buggy'),b=vehicle('jet'),slot=new PlayerSlot(a),seen=vi.fn()
  slot.onChange(seen)
  expect(slot.current).toBe(a)
  slot.set(b)
  expect(slot.current).toBe(b);expect(seen).toHaveBeenCalledExactlyOnceWith(b,a)
 })
 it('says nothing when set to the vehicle it already holds',()=>{
  const a=vehicle('buggy'),slot=new PlayerSlot(a),seen=vi.fn()
  slot.onChange(seen);slot.set(a)
  expect(seen).not.toHaveBeenCalled()
 })
 it('already reports the new vehicle to a listener that reads it back',()=>{
  const a=vehicle('buggy'),b=vehicle('tank'),slot=new PlayerSlot(a)
  let read:Vehicle|undefined
  slot.onChange(()=>{read=slot.current});slot.set(b)
  expect(read).toBe(b)
 })
 it('calls listeners in subscription order and stops calling one that unsubscribed',()=>{
  const slot=new PlayerSlot(vehicle('buggy')),order:string[]=[]
  const off=slot.onChange(()=>order.push('first'));slot.onChange(()=>order.push('second'))
  slot.set(vehicle('jet'));off();off();slot.set(vehicle('tank'))
  expect(order).toEqual(['first','second','second'])
 })
 it('lets a listener unsubscribe during a change without skipping the others',()=>{
  const slot=new PlayerSlot(vehicle('buggy')),later=vi.fn()
  const off=slot.onChange(()=>off());slot.onChange(later)
  slot.set(vehicle('jet'))
  expect(later).toHaveBeenCalledTimes(1)
 })
 it('still tells every listener when one throws, then reports the first error',()=>{
  const slot=new PlayerSlot(vehicle('buggy')),later=vi.fn(),next=vehicle('jet')
  slot.onChange(()=>{throw new Error('audio failed')});slot.onChange(later)
  expect(()=>slot.set(next)).toThrow('audio failed')
  expect(later).toHaveBeenCalledTimes(1);expect(slot.current).toBe(next)
 })
})
