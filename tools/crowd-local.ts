// npx tsx tools/crowd-local.ts PORT ARRIVALS [BOTS] [assign]
// Ten-second arrival wave, five-second steady sample, then exercise three departures.
import WebSocket from 'ws'
import { randomBytes, randomInt } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import { encodeState, BOT_ID_BASE, MAX_BOTS, PROTOCOL_VERSION } from '../shared/protocol'
import { netSendRate } from '../src/net/params'

const [port, count, bots = '0', mode = 'legacy'] = process.argv.slice(2)
const n = Number(count), b = Number(bots)
if (!/^\d+$/.test(port) || !Number.isInteger(n) || n < 1 || n > 500 ||
    !Number.isInteger(b) || b < 0 || b > MAX_BOTS || !['legacy','assign'].includes(mode)) throw Error('Invalid arguments')
const token = () => randomBytes(16).toString('hex')
const players = Array.from({length:n}, (_, index) => ({
  index, resume:token(), page:token(), room:'lobby', socket:null as WebSocket|null,
  id:0, host:false, joined:false, outcome:'pending', reconnect:'', priorId:0,
}))
type Player = typeof players[number]
const rooms = new Map<string, { sent:number, received:number, refused:number, welcomes:number, closes:Record<string,number>, errors:string[] }>()
function stats(name:string) {
  if (!rooms.has(name)) rooms.set(name,{sent:0,received:0,refused:0,welcomes:0,closes:{},errors:[]})
  return rooms.get(name)!
}
function connect(p:Player) {
  const url = new URL('ws://127.0.0.1:'+port+'/ws?room=lobby')
  if (mode === 'assign') {
    url.searchParams.set('assign','1')
    if (p.reconnect) url.searchParams.set('prefer',p.room)
  }
  const ws = p.socket = new WebSocket(url)
  p.joined = false
  p.host = false
  ws.on('open',() => ws.send(JSON.stringify({type:'hello',v:PROTOCOL_VERSION,largeWelcome:true,sparseWorld:true,modes:2,
    name:'Guest'+p.index,params:{},kind:'buggy',colors:['#336699','#ffee00'],resume:p.resume,page:p.page})))
  ws.on('message',(raw,binary) => {
    if (binary) {stats(p.room).received++;return}
    const m = JSON.parse(raw.toString())
    if (m.type === 'welcome') {
      p.room=m.room; p.id=m.id; p.joined=true; p.outcome='online'; stats(p.room).welcomes++
      if (p.reconnect) p.outcome=p.id===p.priorId?'rejoined same id':'rejoined new id'
    }
    if (m.game && p.joined) {
      const host=m.game.host===p.id
      if (host && !p.host) for(let i=0;i<b;i++) ws.send(JSON.stringify({type:'bot',id:BOT_ID_BASE+i,kind:'buggy'}))
      p.host=host
    }
    if (m.message==='room is full') {stats(p.room).refused++;p.outcome='full (legacy client goes local)'}
    else if(m.type==='error') stats(p.room).errors.push(m.message)
  })
  ws.on('error',e=>stats(p.room).errors.push(e.message))
  ws.on('close',(code,reason)=>{
    const closes=stats(p.room).closes, key=code+' '+reason
    closes[key]=(closes[key]??0)+1
    if(p.socket===ws) p.joined=false
  })
}
const ticks=setInterval(()=>{
  for(const p of players) if(p.joined && p.socket?.readyState===WebSocket.OPEN) {
    for(let slot=0;slot<= (p.host?b:0);slot++) {
      p.socket.send(encodeState({id:slot?BOT_ID_BASE+slot-1:0,bot:slot>0,t:Date.now()/1000,p:[p.index,5,0],
        q:[0,0,0,1],v:[0,0,0],w:[0,0,0],input:{x:0,y:0,z:0,w:0,brakes:false,fire:false,special:false}}))
      stats(p.room).sent++
    }
  }
},1000/netSendRate.value)
players.forEach((p,i)=>setTimeout(()=>connect(p),10000*i/n))
await wait(11000)
const sample=performance.now()
const snapshots=Array.from(rooms,([room,s])=>({room,sent:s.sent,received:s.received,players:players.filter(p=>p.joined && p.room===room).length}))
await wait(5000)
const seconds=(performance.now()-sample)/1000
const rates=snapshots.map(s=>({...s,toRoomHz:(stats(s.room).sent-s.sent)/seconds,fromRoomHz:(stats(s.room).received-s.received)/seconds}))
const live=players.filter(p=>p.joined)
for(const action of ['leave','reload','drop']){
  if(!live.length) break
  const [p]=live.splice(randomInt(live.length),1)
  p.priorId=p.id
  if(action==='drop') p.socket!.terminate()
  else p.socket!.close(1000,'going away')
  p.outcome=action
  if(action!=='leave') {
    p.reconnect=action
    if(action==='reload') p.page=token()
    await wait(350)
    connect(p)
  }
}
await wait(1800)
clearInterval(ticks)
const outcomes=players.reduce((acc,p)=>{const k=[p.room,p.reconnect,p.outcome].filter(Boolean).join(' ');acc[k]=(acc[k]??0)+1;return acc},{} as Record<string,number>)
for(const p of players) if(p.socket?.readyState===WebSocket.OPEN) p.socket.close(1000,'end of sample')
await wait(500)
console.log(JSON.stringify({n,b,mode,rates,outcomes,rooms:Object.fromEntries(rooms)},null,2))
