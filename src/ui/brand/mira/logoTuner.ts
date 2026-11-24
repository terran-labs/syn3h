/**
 * A panel of sliders for the lobby logo's settings (every parameter in the "Lobby logo" group),
 * shown when the address has ?tune=1 and loaded only then. It exists so the owner can tune the
 * metal shader by eye, on any build and any device, and send back the numbers.
 */
import { params } from '../../../../shared/params'

export function showLogoTuner(): void {
  const mine = params.all().filter(p => p.def.group === 'Lobby logo' && typeof p.def.default === 'number')
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;width:min(300px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;background:rgba(8,12,24,.86);color:#e6ecff;font:12px/1.3 system-ui,sans-serif;border:1px solid #2c3a63;border-radius:12px;padding:8px 10px;backdrop-filter:blur(6px)'
  const wake = () => { const g = (window as unknown as Record<string, { shell?: { galaxy?: { wake: number } } }>); for (const k of ['mira', 'syn3h']) if (g[k]?.shell?.galaxy) g[k].shell!.galaxy!.wake = 2 }
  const readout = () => JSON.stringify(Object.fromEntries(mine.map(p => [p.def.id.replace('lobby.logo.', ''), p.value])))
  el.innerHTML = `<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><b style="flex:1;font-size:13px">Logo controls</b><button data-a="gold">Gold</button><button data-a="white">White</button><button data-a="reset">Reset</button><button data-a="copy">Copy</button><button data-a="fold">Hide</button></div><div data-rows></div><textarea data-out readonly style="width:100%;height:54px;margin-top:6px;background:#060a14;color:#a9b6d6;border:1px solid #1d2742;border-radius:6px;font:10px ui-monospace,monospace"></textarea>`
  for (const b of el.querySelectorAll('button')) (b as HTMLElement).style.cssText = 'background:#18203a;color:#e6ecff;border:1px solid #2c3a63;border-radius:999px;padding:3px 8px;font:11px system-ui'
  const rows = el.querySelector('[data-rows]') as HTMLElement, out = el.querySelector('[data-out]') as HTMLTextAreaElement
  const draw = () => {
    rows.innerHTML = mine.map(p => `<label style="display:grid;grid-template-columns:1fr 46px;gap:2px 6px;align-items:center;margin:3px 0"><span>${p.def.label}</span><span data-v="${p.def.id}" style="text-align:right;color:#c9b48f">${Number(p.value).toFixed(3).replace(/\.?0+$/, '')}</span><input type="range" data-id="${p.def.id}" min="${p.def.min}" max="${p.def.max}" step="${p.def.step}" value="${p.value}" style="grid-column:1/-1;width:100%;margin:0"></label>`).join('')
    out.value = readout()
  }
  rows.addEventListener('input', event => {
    const input = event.target as HTMLInputElement, id = input.dataset.id
    if (!id) return
    params.set(id, Number(input.value), 'preset'); wake()
    const shown = rows.querySelector(`[data-v="${id}"]`); if (shown) shown.textContent = Number(input.value).toFixed(3).replace(/\.?0+$/, '')
    out.value = readout()
  })
  el.addEventListener('click', event => {
    const action = (event.target as HTMLElement).dataset?.a
    if (!action) return
    if (action === 'fold') { const hidden = rows.style.display === 'none'; rows.style.display = hidden ? '' : 'none'; out.style.display = hidden ? '' : 'none'; (event.target as HTMLElement).textContent = hidden ? 'Hide' : 'Show'; return }
    if (action === 'copy') { void navigator.clipboard?.writeText(readout()); return }
    if (action === 'reset') for (const p of mine) params.set(p.def.id, p.def.default, 'preset')
    if (action === 'gold') params.set('lobby.logo.white', 0, 'preset')
    if (action === 'white') { params.set('lobby.logo.white', 1, 'preset'); params.set('lobby.logo.colour', 0.6, 'preset') }
    wake(); draw()
  })
  draw(); document.body.append(el)
}
