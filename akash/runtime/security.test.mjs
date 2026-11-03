import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(resolve('app/package.json'));
const ts = require('typescript');
const { NextRequest } = require('next/server');
function load(path) {
  const filename = resolve(path);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = new Module(filename);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(resolve('app'));
  mod._compile(output, filename);
  return mod.exports;
}
const gate = load('app/middleware.ts').middleware;
const route = load('app/app/api/token/route.ts').GET;
const names = ['NODE_ENV','DEMO_ACCESS_USER','DEMO_ACCESS_PASSWORD','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','LIVEKIT_PUBLIC_URL','DEMO_ROOM'];
const saved = Object.fromEntries(names.map(n=>[n,process.env[n]]));
test.after(()=>{ for(const n of names) saved[n] === undefined ? delete process.env[n] : process.env[n]=saved[n]; });
test('production gate fails closed, rejects bad credentials, admits correct credentials', () => {
  process.env.NODE_ENV='production';
  delete process.env.DEMO_ACCESS_USER; delete process.env.DEMO_ACCESS_PASSWORD;
  assert.equal(gate(new NextRequest('https://demo.invalid/')).status,503);
  process.env.DEMO_ACCESS_USER='operator'; process.env.DEMO_ACCESS_PASSWORD='test-only-long-password-1234567890';
  assert.equal(gate(new NextRequest('https://demo.invalid/api/token')).status,401);
  assert.equal(gate(new NextRequest('https://demo.invalid/',{headers:{authorization:'Basic !!!'}})).status,401);
  const auth='Basic '+Buffer.from('operator:'+process.env.DEMO_ACCESS_PASSWORD).toString('base64');
  const response=gate(new NextRequest('https://demo.invalid/',{headers:{authorization:auth}}));
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control'),/no-store/);
});
test('token route rejects other rooms and insecure production signaling', async () => {
  process.env.NODE_ENV='production';process.env.DEMO_ROOM='soulbound';
  process.env.LIVEKIT_API_KEY='testkey'; process.env.LIVEKIT_API_SECRET='test-only-secret-at-least-32-characters';
  process.env.LIVEKIT_PUBLIC_URL='ws://insecure.invalid';
  assert.equal((await route(new NextRequest('https://demo.invalid/api/token?room=other'))).status,403);
  assert.equal((await route(new NextRequest('https://demo.invalid/api/token?room=soulbound'))).status,503);
});
test('token is bounded, no-store, server-identified and has data grants', async () => {
  process.env.LIVEKIT_PUBLIC_URL='wss://rtc.invalid';
  const response=await route(new NextRequest('https://demo.invalid/api/token?room=soulbound&name=owner'));
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control'),/no-store/);
  const data=await response.json();
  assert.equal(data.url,'wss://rtc.invalid');
  const claims=JSON.parse(Buffer.from(data.token.split('.')[1],'base64url'));
  assert.match(claims.sub,/^guest-/);assert.notEqual(claims.sub,'owner');
  assert.ok(claims.exp-claims.nbf<=610);
  assert.equal(claims.video.room,'soulbound');assert.equal(claims.video.canPublishData,true);
});
