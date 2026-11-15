/** Opt-in page replacement for Vite 8. Does not disable CSS or accepted JS HMR.
 * vite.config.ts: import { manualReload } from './tools/manual-reload.mjs'
 * plugins: [roomServer(), manualReload()]
 *
 * Vite has no public option to suppress every automatic reload while retaining HMR.
 * beforeFullReload is a notification, not a cancellable event. This narrow transform
 * replaces the installed client's reload calls, including reconnection/error paths.
 * Recheck the browser test when updating Vite; fail closed if the client shape changes.
 */
export function patchReloads(code) {
  const calls = code.match(/\blocation\.reload\(\)/g) ?? [];
  if (calls.length !== 3) throw new Error(`Vite client changed: expected 3 automatic reload sites, found ${calls.length}. Review manual-reload.mjs before serving live demos.`);
  return code.replace(/\blocation\.reload\(\)/g, 'window.dispatchEvent(new CustomEvent("syn3h:new-build"))');
}
const notice = `
window.addEventListener('syn3h:new-build', () => {
  if (document.getElementById('syn3h-build-notice')) return;
  const button = document.createElement('button');
  button.id = 'syn3h-build-notice';
  button.type = 'button';
  button.textContent = 'New build available. Press to reload';
  button.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:10000;background:#172633;color:#fff;border:1px solid #49e6ff;border-radius:8px;padding:10px 16px;font:14px system-ui;cursor:pointer';
  button.addEventListener('click', () => location.reload());
  document.body.append(button);
});`;
export function manualReload() {
  return {
    name: 'syn3h-manual-reload', apply: 'serve', enforce: 'post',
    transform(code, id) {
      if (/\/vite\/dist\/client\/client\.m?js(?:\?|$)/.test(id.replaceAll('\\', '/'))) return { code: patchReloads(code), map: null };
    },
    transformIndexHtml: { order: 'post', handler() { return [{ tag: 'script', children: notice, injectTo: 'body' }]; } },
    async handleHotUpdate(context) {
      // Materials retain GPU resources. Replacing their module in place is unsafe.
      if (/\.(glsl|wgsl|tsl)$/.test(context.file) || (/\.[jt]s$/.test(context.file) && /from\s*['"]three\/tsl['"]|\b\w+NodeMaterial\b/.test(await context.read()))) {
        context.server.ws.send({ type: 'full-reload' });
        return [];
      }
    },
  };
}
