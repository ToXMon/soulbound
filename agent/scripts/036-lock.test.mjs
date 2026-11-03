import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../dist/memory/store.js';

test('lock from another process lifetime is recovered even when its pid is reused', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sb-lock-restart-'));
  const ns = { ownerId: 'synthetic-owner', characterId: '1' };
  const first = await MemoryStore.open(root, ns);
  const dir = first.dir;
  await first.close();
  await writeFile(join(dir, 'writer.lock'), JSON.stringify({ pid: process.pid, since: '2020-01-01T00:00:00Z', processIdentity: 'different-container-and-process' }), { mode: 0o600 });
  const recovered = await MemoryStore.open(root, ns);
  try {
    const lock = JSON.parse(await readFile(join(dir, 'writer.lock'), 'utf8'));
    assert.notEqual(lock.processIdentity, 'different-container-and-process');
    assert.ok(lock.processIdentity);
    await assert.rejects(() => MemoryStore.open(root, ns), /writer|lock/i);
  } finally { await recovered.close(); }
});

test('lock from a previous container is recovered even when its pid names an unreadable live process', { skip: process.platform !== 'linux' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sb-lock-container-'));
  const ns = { ownerId: 'synthetic-owner', characterId: '2' };
  const first = await MemoryStore.open(root, ns);
  const dir = first.dir;
  await first.close();
  // pid 1 is alive here but its /proc identity may be unreadable to this user.
  await writeFile(join(dir, 'writer.lock'), JSON.stringify({ pid: 1, since: '2020-01-01T00:00:00Z', processIdentity: 'old-boot-id:pid:[4026534386]:2626881' }), { mode: 0o600 });
  const recovered = await MemoryStore.open(root, ns);
  await recovered.close();
});
