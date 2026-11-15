import { describe, expect, it } from 'vitest'
import { roadWaypoint } from '../../src/bots/navigation'
describe('optional road navigation', () => {
  const points = [{x:0,z:0}, {x:0,z:10}, {x:10,z:10}, {x:20,z:10}]
  it('accepts public plain paths and legacy road objects with identical results', () => {
    const args = [{x:0,z:0}, {x:20,z:10}, 12] as const
    const expected = {x:10,z:10}
    expect(roadWaypoint({roadPaths:()=>[points]}, ...args)).toEqual(expected)
    expect(roadWaypoint({data:{roads:[{points}]}}, ...args)).toEqual(expected)
    expect(roadWaypoint({}, ...args)).toBeNull()
  })
  it('follows the reverse direction and refuses a distant road', () => {
    expect(roadWaypoint({roadPaths:()=>[points]}, points[3], points[0], 12)).toEqual(points[1])
    expect(roadWaypoint({roadPaths:()=>[points]}, {x:300,z:300}, points[0], 12)).toBeNull()
  })
})

describe('island road junctions', () => {
  it('connects the approach, foot road and rising spiral', () => {
    const roads = [
      {kind:'plain',points:[{x:0,y:0,z:0},{x:0,y:0,z:10}]},
      {kind:'plain',points:[{x:0,y:0,z:10},{x:10,y:0,z:10},{x:20,y:0,z:10}]},
      {kind:'volcano',points:[{x:20,y:0,z:10},{x:20,y:10,z:20},{x:10,y:20,z:20}]},
    ]
    expect(roadWaypoint({roadPaths:()=>roads},{x:0,y:0,z:0},{x:10,y:20,z:20},12)).toEqual({x:10,y:0,z:10})
  })
  it('does not connect a coastal ring to a summit ring above it', () => {
    const terrain={roadPaths:()=>[
      {kind:'plain',closed:true,points:[{x:0,y:0,z:0},{x:10,y:0,z:0},{x:10,y:0,z:10}]},
      {kind:'rim',closed:true,points:[{x:0,y:100,z:0},{x:10,y:100,z:0},{x:10,y:100,z:10}]},
    ]}
    expect(roadWaypoint(terrain,{x:0,y:0,z:0},{x:10,y:100,z:10},8)).toBeNull()
    expect(roadWaypoint(terrain,{x:0,y:100,z:0},{x:10,y:100,z:10},8)?.y).toBe(100)
  })
  it('rebuilds when regeneration replaces the public roads', () => {
    let roads=[{points:[{x:0,z:0},{x:10,z:0}]}];const terrain={roadPaths:()=>roads}
    expect(roadWaypoint(terrain,{x:0,z:0},{x:10,z:0},8)).toEqual({x:10,z:0})
    roads=[{points:[{x:0,z:0},{x:0,z:10}]}]
    expect(roadWaypoint(terrain,{x:0,z:0},{x:0,z:10},8)).toEqual({x:0,z:10})
  })
})
