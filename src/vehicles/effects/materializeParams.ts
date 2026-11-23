/**
 * Sliders for vehicle materialization (Materialize.ts). Free of Three.js so the room server
 * can import and validate them. The hold and hover change where a vehicle is and when it can
 * move, so they are shared by the room; the look is personal.
 */
import {defineParam} from '../../../shared/params'

// The arrival cloud is how a vehicle looks to everyone: world settings, in the Game card's Vehicle
// looks group (22 November 2026). Each player's quality level still sets its particle budget.

export const materializeHold=defineParam({
  id:'materialize.hold',label:'Materialize hold (seconds)',group:'Vehicle looks',scope:'world',
  default:1,min:0,max:3,step:.05,
})

export const materializeHover=defineParam({
  id:'materialize.hover',label:'Materialize hover height (m)',group:'Vehicle looks',scope:'world',
  default:1.5,min:0,max:5,step:.1,
})

export const materializeCloudSize=defineParam({
  id:'materialize.cloudSize',label:'Materialize cloud size',group:'Vehicle looks',scope:'world',
  default:1,min:.25,max:3,step:.05,
})

export const materializeBrightness=defineParam({
  id:'materialize.brightness',label:'Materialize cloud brightness',group:'Vehicle looks',scope:'world',
  default:1,min:0,max:3,step:.05,
})

/** Small crackling arcs in the cloud. 0 is none, the default. */
export const materializeArcs=defineParam({
  id:'materialize.arcs',label:'Materialize sparks',group:'Vehicle looks',scope:'world',
  default:0,min:0,max:1,step:.05,
})
