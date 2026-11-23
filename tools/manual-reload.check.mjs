import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { patchReloads } from './manual-reload.mjs';
test('installed Vite reload paths become notices; unknown clients fail closed', async () => {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('vite/package.json'));
  const code = await readFile(join(root, 'dist/client/client.mjs'), 'utf8');
  const patched = patchReloads(code);
  assert.equal((patched.match(/new CustomEvent\("mira:new-build"\)/g) ?? []).length, 3);
  assert.equal(patched.includes('location.reload()'), false);
  assert.ok(patched.includes('hmrClient.queueUpdate(update)'));
  assert.throws(() => patchReloads('changed client'), /Vite client changed/);
});
