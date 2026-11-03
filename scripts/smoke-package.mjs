// Exercise the packaged renderer + preload + main IPC with a fresh data directory.
// Never logs in, makes model calls, or reads the developer's Ailo account data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executable = process.argv[2];
assert(executable, 'Usage: node scripts/smoke-package.mjs <packaged executable>');
const home = await mkdtemp(path.join(os.tmpdir(), 'ailo-package-smoke-'));
const env = { ...process.env, AILO_DATA_DIR: home };
delete env.ELECTRON_RENDERER_URL;
delete env.ELECTRON_RUN_AS_NODE;
const args = ['--remote-debugging-port=0'];
if (process.env.AILO_SMOKE_CONTAINER === '1') args.push('--no-sandbox');
const child = spawn(path.resolve(executable), args, { env, windowsHide: true });
let log = '';
child.stderr.on('data', (chunk) => { log += chunk; });
child.on('error', (error) => { log += error.message; });
let ws;
try {
  let page;
  for (let i = 0; i < 150; i++) {
    const endpoint = log.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    if (endpoint) {
      const origin = new URL(endpoint).origin.replace('ws:', 'http:');
      const targets = await fetch(`${origin}/json`).then((r) => r.json()).catch(() => []);
      page = targets.find((t) => t.type === 'page' && t.url.startsWith('file:'));
      if (page) break;
    }
    if (child.exitCode !== null) throw new Error(`App exited: ${child.exitCode}\n${log}`);
    await delay(200);
  }
  assert(page, `Packaged file renderer did not start\n${log}`);
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((resolve) => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  // A loaded file URL alone does not prove the renderer/preload are ready.
  let ready = false;
  for (let i = 0; i < 50; i++) {
    const r = await send('Runtime.evaluate', { expression: "!!window.ailo && document.querySelector('#root')?.childElementCount > 0", returnByValue: true });
    if (r.result?.result?.value) { ready = true; break; }
    await delay(100);
  }
  assert(ready, `Renderer or preload not ready\n${log}`);
  const response = await send('Runtime.evaluate', {
    expression: `(async () => { const s = await window.ailo.getState(); const clis = await window.ailo.detectClis(); return { accounts: s.accounts.length, conversations: s.conversations.length, automations: s.automations.length, title: document.title, clis: clis.map(c => ({provider:c.provider, found:c.found})) }; })()`,
    awaitPromise: true, returnByValue: true
  });
  assert(!response.result?.exceptionDetails, JSON.stringify(response.result));
  const result = response.result.result.value;
  assert.equal(result.accounts, 0);
  assert.equal(result.conversations, 0);
  assert.equal(result.automations, 0);
  assert.equal(result.clis.length, 2);
  console.log(JSON.stringify({ ...result, dataDirectory: home }, null, 2));
  await Promise.race([send('Browser.close'), delay(2000)]);
} finally {
  ws?.close();
  if (child.exitCode === null) child.kill();
}
