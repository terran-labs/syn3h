import { chromium } from 'playwright-core'
import { readFile, writeFile } from 'node:fs/promises'
// Deterministic canvas layout preserves the supplied mark without repainting it.
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  const logo = `data:image/png;base64,${(await readFile('public/brand/syn3h.png')).toString('base64')}`
  const font = (await readFile('public/fonts/Lato-Thin.ttf')).toString('base64')
  const assets = await page.evaluate(async ({ logo, font }) => {
    const image = new Image(); image.src = logo; await image.decode()
    const face = new FontFace('Syn3h', `url(data:font/ttf;base64,${font})`); await face.load(); document.fonts.add(face)
    const make = (w, h, icon = false) => {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d'), gradient = ctx.createRadialGradient(w*.5,h*.35,0,w*.5,h*.5,w*.7)
      gradient.addColorStop(0,'#172540'); gradient.addColorStop(1,'#03060c'); ctx.fillStyle = gradient; ctx.fillRect(0,0,w,h)
      let seed = 83117
      const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296 }
      for(let i=0;i<(icon?45:260);i++) { ctx.fillStyle=`rgba(180,211,255,${.15+random()*.6})`; ctx.beginPath();ctx.arc(random()*w,random()*h,.4+random()*(icon?w/500:1.1),0,Math.PI*2);ctx.fill() }
      ctx.shadowColor='#428bff';ctx.shadowBlur=w*.025
      const width = w*(icon?.9:.78);ctx.drawImage(image,(w-width)/2,icon?(h-width/2)/2:h*.035,width,width/2);ctx.shadowBlur=0
      if(!icon) { ctx.textAlign='center';ctx.fillStyle='#edf3ff';ctx.font='38px Syn3h';ctx.fillText('Explore. Create. Connect.',w/2,492);ctx.fillStyle='#a9bed9';ctx.font='23px Syn3h';ctx.fillText('From the creator of Mars Explorer',w/2,550) }
      return canvas.toDataURL().split(',')[1]
    }
    return { 'share.png':make(1200,630), 'icon-512.png':make(512,512,true), 'icon-192.png':make(192,192,true), 'apple-touch-icon.png':make(180,180,true), 'favicon-32.png':make(32,32,true) }
  }, {logo,font})
  for(const [name,data] of Object.entries(assets)) await writeFile(`public/brand/${name}`,Buffer.from(data,'base64'))
} finally { await browser.close() }
