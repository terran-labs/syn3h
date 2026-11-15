/** Summarize the existing soak JSON without running another browser. */
import { readFile, writeFile } from 'node:fs/promises';
const dir=process.argv[2]??'/tmp/syn3h-phone-soak';
const results=JSON.parse(await readFile(`${dir}/summary.json`,'utf8'));
const mb=n=>Number.isFinite(n)?(n/1048576).toFixed(1):'unavailable';
const summary=[];
for(const r of results){
 const samples=r.samples??[],first=samples[0],last=samples.at(-1),heaps=samples.map(s=>s.heap).filter(Number.isFinite);
 const controls=r.touch?.flatMap(t=>t.controls.map(c=>({...c,phase:t.phase})))??[];
 const issues=controls.filter(c=>!c.reachable||!c.inViewport||c.overlaps.some(s=>!s.includes('hud-navigation')));
 summary.push({case:r.id,seconds:r.elapsedSeconds,ttiMs:r.timeToInteractiveMs,quality:[r.initial?.quality,r.final?.quality],backend:r.initial?.backend,medianMs:r.frameMedian,p95Ms:r.frameP95,heapMiB:{first:mb(first?.heap),last:mb(last?.heap),min:mb(Math.min(...heaps)),max:mb(Math.max(...heaps))},rendererTrackedMiB:[mb(first?.renderer?.total),mb(last?.renderer?.total)],textureTrackedMiB:[mb(first?.renderer?.texturesSize),mb(last?.renderer?.texturesSize)],nativeAudioNodes:[first?.audioNativeNodes,last?.audioNativeNodes],peakNativeAudioNodes:Math.max(0,...samples.map(s=>s.audioNativeNodes)),engineNodes:[first?.audio?.engineNodes,last?.audio?.engineNodes],botCounts:[...new Set(samples.filter(s=>s.mode===1).map(s=>s.bots))],crashFlagSeen:samples.some(s=>s.loadingFlag!==null),touchIssues:issues,failure:r.failure,errors:r.errors});
}
await writeFile(`${dir}/report.json`,JSON.stringify(summary,null,2));
console.log('| Case | Seconds | TTI s | Quality | Frame median / p95 ms | Heap first / last MiB | Audio nodes first / last |');
console.log('|---|---:|---:|---|---|---|---|');
for(const r of summary)console.log(`| ${r.case} | ${r.seconds?.toFixed(0)??'failed'} | ${(r.ttiMs/1000).toFixed(2)} | ${r.quality.join(' to ')} | ${r.medianMs?.toFixed(1)} / ${r.p95Ms?.toFixed(1)} | ${r.heapMiB.first} / ${r.heapMiB.last} | ${r.nativeAudioNodes.join(' / ')} |`);
console.log(JSON.stringify(summary,null,2));
