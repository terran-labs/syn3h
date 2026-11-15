/** Fractional emission carry makes counts independent of frame rate. */
export function emission(speed:number, submerged:number, dt:number, carry:number) {
  const total=carry+Math.min(160,Math.max(0,speed)*4)*Math.max(0,Math.min(1,submerged))*Math.max(0,Math.min(.1,dt))
  return {count:Math.floor(total),carry:total-Math.floor(total)}
}
