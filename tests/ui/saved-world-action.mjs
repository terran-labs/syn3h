import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
import { serverUrl } from './lib/server.mjs'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/saved-action-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }))
  await page.goto(`${serverUrl('saved-world-action')}saved-action-fixture`)
  const result = await page.evaluate(async () => {
    const { Inspector } = await import('/src/ui/inspector/Inspector.ts')
    const { defineParam } = await import('/shared/params.ts')
    defineParam({ id:'test.saved', group:'World', label:'Saved fixture', scope:'world', default:1, min:0, max:2 })
    window.miraNet = { canEditWorld:false }
    let saves = 0
    const options = { summary:()=>'', vehicles:()=>({options:[],current:''}), onVehicle:()=>{} }
    const plain = new Inspector(document.body, options)
    const absent = plain.element.querySelectorAll('[data-wi=save-world]').length
    plain.dispose()
    const inspector = new Inspector(document.body, { ...options, onSaveWorld:()=>{ saves++ } })
    inspector.update()
    const button = inspector.element.querySelector('[data-wi=save-world]')
    const locked = inspector.element.classList.contains('is-locked')
    const enabled = !button.disabled
    const section = button.closest('.wi-card').dataset.section
    button.click()
    const status = inspector.element.querySelector('.wi-status').textContent
    inspector.dispose()
    return { absent, saves, locked, enabled, section, status }
  })
  assert.deepEqual(result, { absent:0, saves:1, locked:true, enabled:true, section:'world', status:'' })
  console.log('Save action: optional mount, locked guest capture and caller-owned feedback passed')
} finally { await browser.close() }
