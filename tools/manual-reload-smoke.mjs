/** Exercise CSS, accepted JS, full reload and server restart against installed Vite. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { manualReload } from './manual-reload.mjs';
const root=await mkdtemp(join(tmpdir(),'mira-hmr-'));
const start=async()=>{const s=await createServer({root,configFile:false,plugins:[manualReload()],server:{host:'127.0.0.1',port:5186,strictPort:true}});await s.listen();return s;};
let server,browser;
try {
  await writeFile(join(root,'index.html'),'<html><body><link rel="stylesheet" href="/style.css"><script type="module" src="/accepted.js"></script></body></html>');
  await writeFile(join(root,'style.css'),'body { background: rgb(10, 20, 30) }');
  const js=n=>`window.hmrValue=${n}; if(import.meta.hot) import.meta.hot.accept();`;
  await writeFile(join(root,'accepted.js'),js(1));
  server=await start();browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5186/');await page.waitForFunction(()=>window.hmrValue===1);
  await page.evaluate(()=>window.pageIdentity=12345);
  await writeFile(join(root,'style.css'),'body { background: rgb(40, 50, 60) }');
  await page.waitForFunction(()=>getComputedStyle(document.body).backgroundColor==='rgb(40, 50, 60)');
  await writeFile(join(root,'accepted.js'),js(2));await page.waitForFunction(()=>window.hmrValue===2);
  assert.equal(await page.evaluate(()=>window.pageIdentity),12345);
  console.log('PASS CSS and accepted JavaScript update without reload');
  await writeFile(join(root,'accepted.js'),js(3)+"\n// from 'three/tsl'");
  await page.waitForSelector('#mira-build-notice');
  assert.equal(await page.evaluate(()=>window.hmrValue),2);
  const bounds=await page.locator('#mira-build-notice').boundingBox();
  assert.ok(bounds.y > 600 && bounds.x > 600, 'Notice stays in the bottom-right corner');
  await page.screenshot({path:'/tmp/syn3h-reload-bottom-corner.png'});
  console.log('PASS material source change requests manual reload');
  await page.evaluate(()=>document.getElementById('mira-build-notice').remove());
  await server.close();server=await start();
  await page.waitForSelector('#mira-build-notice',{timeout:30000});
  assert.equal(await page.evaluate(()=>window.pageIdentity),12345);
  assert.deepEqual(errors,[]);
  console.log('PASS server restart shows notice and preserves page; zero page errors');
} finally {await browser?.close();await server?.close();await rm(root,{recursive:true,force:true});}
