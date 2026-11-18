import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serveStable } from './serve-stable.mjs';

test('pins snapshot, serves cache policy and rejects escaped files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'syn3h-stable-test-'));
  let app;
  try {
    for (const id of ['a', 'b']) {
      const dir = join(root, id);
      await mkdir(join(dir, 'dist/assets'), { recursive: true });
      await mkdir(join(dir, 'server'));
      await writeFile(join(dir, 'package.json'), '{"type":"module"}');
      await writeFile(join(dir, 'tsconfig.json'), '{}');
      await writeFile(join(dir, 'dist/index.html'), id);
      await writeFile(join(dir, 'dist/build.json'), JSON.stringify({ id }));
      await writeFile(join(dir, 'dist/assets/test-12345678.js'), 'export default 1');
      await writeFile(join(dir, 'server/room.ts'), 'export class Room {}');
      await writeFile(join(dir, 'server/util.ts'), 'export const roomName = (name: string) => name');
      await symlink(resolve('node_modules'), join(dir, 'node_modules'));
    }
    await writeFile(join(root, 'secret.txt'), 'not public');
    await symlink(join(root, 'secret.txt'), join(root, 'a/dist/escape.txt'));
    const current = join(root, 'current');
    await symlink('a', current);
    app = await serveStable({ dir: current, port: 0 });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    let response = await fetch(base);
    assert.equal(await response.text(), 'a');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await unlink(current); await symlink('b', current);
    assert.equal(await (await fetch(base)).text(), 'a');
    response = await fetch(base + '/build.json');
    assert.deepEqual(await response.json(), { id: 'a' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    response = await fetch(base + '/assets/test-12345678.js', { method: 'HEAD' });
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal(await response.text(), '');
    assert.equal((await fetch(base + '/escape.txt')).status, 403);
    assert.equal((await fetch(base + '/%ZZ')).status, 400);
    assert.equal((await fetch(base + '/missing')).status, 404);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/ws')).status, 426);
    // The lobby's presence poll gets an empty snapshot, not a 404 the smoke counts as an error.
    response = await fetch(base + '/presence');
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).byRecipe, []);
  } finally { if (app) await app.close(); await rm(root, { recursive: true, force: true }); }
});
