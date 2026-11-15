/** QR Model 2, byte mode, M correction, versions 1..10. No runtime dependencies.
 * Format placement checked against Project Nayuki's MIT reference; notice in brand/licenses/qr.txt.
 */
const capacities = [0,16,28,44,64,86,108,124,154,182,216]
const parityLengths = [0,10,16,26,18,24,16,18,22,22,26]
const blockCounts = [0,1,1,1,2,2,4,4,4,5,5]
const alignment = [[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]]
const masks = [(x:number,y:number)=>(x+y)%2===0,(x:number,y:number)=>y%2===0,(x:number)=>x%3===0,(x:number,y:number)=>(x+y)%3===0,(x:number,y:number)=>(Math.floor(y/2)+Math.floor(x/3))%2===0,(x:number,y:number)=>x*y%2+x*y%3===0,(x:number,y:number)=>(x*y%2+x*y%3)%2===0,(x:number,y:number)=>((x+y)%2+x*y%3)%2===0]
function multiply(a:number,b:number):number { let result=0; for(let i=7;i>=0;i--) { result=(result<<1)^((result>>>7)*0x11d); result^=((b>>>i)&1)*a } return result }
function parity(data:number[],degree:number):number[] {
  let poly=[1], root=1
  for(let i=0;i<degree;i++) { const next=Array(poly.length+1).fill(0); for(let j=0;j<poly.length;j++){next[j]^=poly[j];next[j+1]^=multiply(poly[j],root)}poly=next;root=multiply(root,2) }
  const result=Array(degree).fill(0)
  for(const value of data) { const factor=value^result.shift()!;result.push(0);for(let i=0;i<degree;i++) result[i]^=multiply(poly[i+1],factor) }
  return result
}
export interface QrCode { version:number; mask:number; modules:boolean[][] }
export function encodeQr(text:string, forcedMask?:number):QrCode {
  const bytes=[...new TextEncoder().encode(text)]
  const version=capacities.findIndex((capacity,v)=>v>0 && 4+(v<10?8:16)+bytes.length*8<=capacity*8)
  if(version<1) throw new RangeError('Invite link is too long for this QR code. Copy the link instead.')
  if(forcedMask!==undefined && (!Number.isInteger(forcedMask)||forcedMask<0||forcedMask>7)) throw new RangeError('Invalid QR mask')
  const bits:number[]=[], append=(value:number,count:number)=>{for(let i=count-1;i>=0;i--)bits.push(value>>>i&1)}
  append(4,4);append(bytes.length,version<10?8:16);bytes.forEach(byte=>append(byte,8))
  append(0,Math.min(4,capacities[version]*8-bits.length));while(bits.length%8)bits.push(0)
  const data:number[]=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>a*2+b,0))
  for(let i=0;data.length<capacities[version];i++)data.push(i%2?0x11:0xec)
  const count=blockCounts[version], short=Math.floor(data.length/count), longer=data.length%count
  const blocks:number[][]=[], ecc:number[][]=[];let offset=0
  for(let i=0;i<count;i++){const length=short+Number(i>=count-longer),block=data.slice(offset,offset+length);offset+=length;blocks.push(block);ecc.push(parity(block,parityLengths[version]))}
  const codewords:number[]=[]
  for(let i=0;i<=short;i++)for(const block of blocks)if(i<block.length)codewords.push(block[i])
  for(let i=0;i<parityLengths[version];i++)for(const block of ecc)codewords.push(block[i])
  const size=version*4+17, base=Array.from({length:size},()=>Array<boolean>(size).fill(false)), fixed=base.map(row=>row.slice())
  const set=(x:number,y:number,value:boolean)=>{if(x>=0&&y>=0&&x<size&&y<size){base[y][x]=value;fixed[y][x]=true}}
  for(let i=0;i<size;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
  for(const [cx,cy] of [[3,3],[size-4,3],[3,size-4]])for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++)set(cx+x,cy+y,![2,4].includes(Math.max(Math.abs(x),Math.abs(y))))
  const centers=alignment[version]
  for(let i=0;i<centers.length;i++)for(let j=0;j<centers.length;j++) {
    if(i===0&&(j===0||j===centers.length-1)||j===0&&i===centers.length-1)continue
    for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)set(centers[i]+x,centers[j]+y,Math.max(Math.abs(x),Math.abs(y))!==1)
  }
  const format=(mask:number)=>{
    let rem=mask;for(let i=0;i<10;i++)rem=(rem<<1)^((rem>>>9)*0x537)
    const value=((mask<<10)|rem)^0x5412, bit=(i:number)=>Boolean(value>>>i&1)
    for(let i=0;i<6;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8))
    for(let i=9;i<15;i++)set(14-i,8,bit(i))
    for(let i=0;i<8;i++)set(size-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,size-15+i,bit(i));set(8,size-8,true)
  }
  format(0)
  if(version>=7){let rem=version;for(let i=0;i<12;i++)rem=(rem<<1)^((rem>>>11)*0x1f25);const value=version<<12|rem;for(let i=0;i<18;i++){const a=size-11+i%3,b=Math.floor(i/3),bit=Boolean(value>>>i&1);set(a,b,bit);set(b,a,bit)}}
  let index=0
  for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let vertical=0;vertical<size;vertical++){const y=((right+1)&2)===0?size-1-vertical:vertical;for(let j=0;j<2;j++){const x=right-j;if(!fixed[y][x]){base[y][x]=Boolean((codewords[index>>>3]??0) >>> (7-index%8)&1);index++}}}}
  let best:QrCode|undefined, bestPenalty=Infinity
  for(const mask of forcedMask===undefined?[0,1,2,3,4,5,6,7]:[forcedMask]) {
    format(mask)
    const modules=base.map((row,y)=>row.map((value,x)=>value!==(!fixed[y][x]&&masks[mask](x,y))))
    const score=penalty(modules);if(score<bestPenalty){bestPenalty=score;best={version,mask,modules}}
  }
  return best!
}
function penalty(matrix:boolean[][]):number {
  const size=matrix.length;let score=0,dark=0
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){dark+=Number(matrix[y][x]);if(x&&y&&matrix[y][x]===matrix[y-1][x]&&matrix[y][x]===matrix[y][x-1]&&matrix[y][x]===matrix[y-1][x-1])score+=3}
  for(let direction=0;direction<2;direction++)for(let i=0;i<size;i++) {
    const line=Array.from({length:size},(_,j)=>Number(direction?matrix[j][i]:matrix[i][j]));let run=1
    for(let j=1;j<size;j++){if(line[j]===line[j-1]){run++;if(run===5)score+=3;else if(run>5)score++}else run=1}
    const text='0000'+line.join('')+'0000';for(let j=0;j<=text.length-11;j++)if(['00001011101','10111010000'].includes(text.slice(j,j+11)))score+=40
  }
  return score+Math.floor(Math.abs(dark*100/(size*size)-50)/5)*10
}
export function qrSvg(text:string):SVGSVGElement {
  const {modules}=encodeQr(text), size=modules.length+8, ns='http://www.w3.org/2000/svg'
  const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${size} ${size}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','Scan to join this room');svg.setAttribute('shape-rendering','crispEdges')
  const background=document.createElementNS(ns,'rect');background.setAttribute('width',String(size));background.setAttribute('height',String(size));background.setAttribute('fill','white')
  const path=document.createElementNS(ns,'path');path.setAttribute('fill','black');path.setAttribute('d',modules.flatMap((row,y)=>row.flatMap((dark,x)=>dark?[`M${x+4},${y+4}h1v1h-1z`]:[])).join(''))
  svg.append(background,path);return svg
}
