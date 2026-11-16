/** Test-owned collector. Self-contained so the same factory runs in a page and fake-clock tests. */
export function createShotEvidence(now = () => performance.now()) {
  const phases = new Map(); let current = null, activeHit = null
  const same = (a,b) => a.shooter===b.shooter && a.shot===b.shot && a.victim===b.victim
  const add = (kind, triple) => {
    const p=phases.get(current)
    if(!p || triple.shooter!==p.shooter || triple.victim!==p.victim) return
    if(p.events.some(e=>e.kind===kind && same(e,triple))) return
    p.events.push({kind,...triple,at:now()})
  }
  return {
    begin(label,shooter,victim) {
      if(!phases.has(label)) phases.set(label,{label,shooter,victim,emitted:[],events:[],overflow:false})
      current=label
    },
    emitted(shot) {
      const p=phases.get(current); if(!p || p.emitted.includes(shot)) return
      if(p.emitted.length===6) {p.overflow=true;return}
      p.emitted.push(shot)
    },
    reported(triple) {add('report-attempt',triple)},
    snapshot(label=current) {
      const p=phases.get(label)
      return p ? {at:now(),...p,emitted:[...p.emitted],events:p.events.map(e=>({...e}))} : null
    },
    wrapText(original, parse=JSON.parse) {
      return function(...args) {
        let msg; try {msg=parse(args[0])} catch {}
        const previous=activeHit
        activeHit=msg?.type==='hit' ? {shooter:msg.shooter,shot:msg.shot,victim:msg.victim} : null
        // A repeated confirmation must not mint a fresh correlated sound.
        const p=phases.get(current)
        if(activeHit && p?.events.some(e=>e.kind==='accepted' && same(e,activeHit))) activeHit=null
        if(activeHit) add('accepted',activeHit)
        try { const result=Reflect.apply(original,this,args); if(activeHit) add('applied',activeHit); return result }
        finally {activeHit=previous}
      }
    },
    wrapAudio(original) {
      return function(...args) {
        const result=Reflect.apply(original,this,args)
        if(args[0]==='laserHit' && activeHit) add('sound',activeHit)
        return result
      }
    },
    // Records invocation only: Connection.send can return without writing to a socket.
    // A matching accepted hit is separate downstream evidence.
    wrapSend(original,selfId) {
      const collector=this
      return function(...args) {
        let msg; try {if(typeof args[0]==='string') msg=JSON.parse(args[0])} catch {}
        const result=Reflect.apply(original,this,args)
        if(msg?.type==='fire') collector.emitted(msg.shot.id)
        if(msg?.type==='hit') collector.reported({shooter:msg.shooter,shot:msg.shot,victim:msg.victim??selfId()})
        return result
      }
    },
  }
}

/** Immutable decision from already-frozen per-predicate samples. No wall-clock deadline. */
export function createShotDecision() {
  let result
  return {
    seal({originals,local,remote,score,scoreBefore,requireScore=false}) {
      if(result) return result
      const matching=[]
      if(local && remote && !remote.overflow && local.shooter===remote.shooter && local.victim===remote.victim) {
        for(const shot of remote.emitted) {
          const has=(s,kind)=>s.events.some(e=>e.kind===kind && e.shooter===remote.shooter && e.victim===remote.victim && e.shot===shot)
          if(has(local,'report-attempt') && has(remote,'accepted') && has(remote,'applied') && has(remote,'sound')) matching.push(shot)
        }
      }
      result=Object.freeze({ok:originals.length>0 && originals.every(Boolean) && matching.length>0 && (!requireScore || score===scoreBefore+1),matching:Object.freeze(matching)})
      return result
    },
  }
}
