/** Fraction of a vertical body interval below the liquid surface. */
export function submergedFraction(bottom:number,top:number,surface:number):number {
  if(![bottom,top,surface].every(Number.isFinite)||top<=bottom)return 0
  return Math.max(0,Math.min(1,(surface-bottom)/(top-bottom)))
}
/** Beer-Lambert transmittance at depth or along a viewing ray, in metres. */
export function waterTransmission(distance:number,extinction=.085):number {
  return Math.exp(-Math.max(0,extinction)*Math.max(0,distance))
}
export function underwaterLook(depth:number){
  const transmission=waterTransmission(depth)
  return {transmission,extinction:.085+.035*(1-transmission),red:.018*transmission,green:.16*transmission,blue:.21*transmission}
}
/** Vertical half extent of an oriented box. Quaternion is a unit world rotation. */
export function verticalHalfExtent(h:{x:number;y:number;z:number},q:{x:number;y:number;z:number;w:number}):number {
  return Math.abs(2*(q.x*q.y+q.w*q.z))*h.x+Math.abs(1-2*(q.x*q.x+q.z*q.z))*h.y+Math.abs(2*(q.y*q.z-q.w*q.x))*h.z
}
