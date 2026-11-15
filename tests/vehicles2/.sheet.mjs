import {chromium} from 'playwright-core'
import {readFile,writeFile} from 'node:fs/promises'
const [out,cols,...files]=process.argv.slice(2)
const b=await chromium.launch({channel:'chrome',headless:true});const page=await b.newPage()
const tiles=await Promise.all(files.map(async f=>({f:f.split('/').pop(),d:(await readFile(f)).toString('base64')})))
const png=await page.evaluate(async({tiles,cols})=>{const w=800,h=450,c=document.createElement('canvas');c.width=cols*w;c.height=Math.ceil(tiles.length/cols)*h;const x=c.getContext('2d');for(let i=0;i<tiles.length;i++){const im=new Image();im.src='data:image/png;base64,'+tiles[i].d;await im.decode();x.drawImage(im,i%cols*w,Math.floor(i/cols)*h,w,h);x.fillStyle='#fff';x.font='16px monospace';x.fillText(tiles[i].f,i%cols*w+8,Math.floor(i/cols)*h+h-10)}return c.toDataURL('image/jpeg',.9).split(',')[1]},{tiles,cols:+cols})
await writeFile(out,Buffer.from(png,'base64'));await b.close()
