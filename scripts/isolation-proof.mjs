#!/usr/bin/env node
// Isolation proof: two accounts of the same provider work side by side without
// overwriting each other's credentials or sessions. Uses the accounts you added
// and signed in to in Ailo. Talks to the real CLIs; no mocks.
//
//   npm run proof                 # uses %APPDATA%/Ailo/data
//   AILO_DATA_DIR=... npm run proof
//
// Read-only for credentials: it never logs in or out and never copies tokens.

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const appData = process.env.APPDATA ?? path.join(os.homedir(), '.config');
const dataDir = process.env.AILO_DATA_DIR ? path.join(process.env.AILO_DATA_DIR, 'data') : path.join(appData, 'Ailo', 'data');
const statePath = path.join(dataDir, 'state.json');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function cleanEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(ANTHROPIC_|CLAUDE|CODEX_|OPENAI_|ORCA_|ELECTRON_)/i.test(k)) env[k] = v;
  return { ...env, ...extra };
}
const home = (id) => path.join(dataDir, 'accounts', id, 'home');

function findFiles(dir, needle, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFiles(p, needle, out);
    else if (e.name.includes(needle)) out.push(p);
  }
  return out;
}
const fingerprint = (file) => (fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12) : 'ontbreekt');

// ---- Claude -----------------------------------------------------------------

function claudeStatus(h) {
  const r = spawnSync('claude', ['auth', 'status'], { env: cleanEnv({ CLAUDE_CONFIG_DIR: h }), encoding: 'utf8' });
  try {
    return JSON.parse(r.stdout);
  } catch {
    return { loggedIn: false };
  }
}

function claudeRun(h, prompt, cwd, resume) {
  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--tools', '', '--permission-mode', 'default'];
    if (resume) args.push('--resume', resume);
    const p = spawn('claude', args, { env: cleanEnv({ CLAUDE_CONFIG_DIR: h }), cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    const t0 = Date.now();
    p.on('close', () => {
      const ev = out.split('\n').flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      const init = ev.find((e) => e.type === 'system' && e.subtype === 'init');
      const res = ev.find((e) => e.type === 'result');
      resolve({ session: init?.session_id ?? res?.session_id, text: res?.result ?? '', error: !res || res.is_error, apiKeySource: init?.apiKeySource, t0, t1: Date.now() });
    });
  });
}

async function proveClaude(a, b, cwd) {
  console.log(`\nClaude: "${a.alias}" en "${b.alias}"`);
  const [ha, hb] = [home(a.id), home(b.id)];
  const sa = claudeStatus(ha);
  const sb = claudeStatus(hb);
  ok('beide accounts aangemeld', sa.loggedIn && sb.loggedIn, `${sa.email ?? '-'} / ${sb.email ?? '-'}`);
  if (!sa.loggedIn || !sb.loggedIn) return;
  ok('verschillende identiteiten', sa.email !== sb.email || sa.orgId !== sb.orgId, sa.email === sb.email ? 'zelfde e-mailadres: dit bewijst alleen mapscheiding' : '');
  const credA = path.join(ha, '.credentials.json');
  const credB = path.join(hb, '.credentials.json');
  const before = { a: fingerprint(credA), b: fingerprint(credB) };

  const [ra, rb] = await Promise.all([claudeRun(ha, 'Onthoud: het codewoord is APPEL-7. Antwoord alleen met: ok', cwd), claudeRun(hb, 'Onthoud: het codewoord is PEER-3. Antwoord alleen met: ok', cwd)]);
  ok('gelijktijdig gesprek gevoerd', !ra.error && !rb.error && ra.t0 < rb.t1 && rb.t0 < ra.t1, `${ra.session?.slice(0, 8)} / ${rb.session?.slice(0, 8)}`);
  ok('geen API-sleutel gebruikt (abonnement)', ra.apiKeySource === 'none' && rb.apiKeySource === 'none');
  ok('sessiebestand A alleen in map A', findFiles(path.join(ha, 'projects'), ra.session).length > 0 && findFiles(path.join(hb, 'projects'), ra.session).length === 0);
  ok('sessiebestand B alleen in map B', findFiles(path.join(hb, 'projects'), rb.session).length > 0 && findFiles(path.join(ha, 'projects'), rb.session).length === 0);

  const [qa, qb] = await Promise.all([claudeRun(ha, 'Wat is het codewoord? Alleen het woord.', cwd, ra.session), claudeRun(hb, 'Wat is het codewoord? Alleen het woord.', cwd, rb.session)]);
  ok('A hervat eigen gesprek', qa.text.includes('APPEL-7') && !qa.text.includes('PEER-3'), qa.text.trim());
  ok('B hervat eigen gesprek', qb.text.includes('PEER-3') && !qb.text.includes('APPEL-7'), qb.text.trim());
  const cross = await claudeRun(hb, 'Wat is het codewoord?', cwd, ra.session);
  ok('B kan sessie van A niet openen', cross.error || !cross.text.includes('APPEL-7'), cross.text.slice(0, 80));

  const after = { a: fingerprint(credA), b: fingerprint(credB) };
  ok('inloggegevens nog aanwezig in beide mappen', after.a !== 'ontbreekt' && after.b !== 'ontbreekt', `A ${before.a}→${after.a}, B ${before.b}→${after.b} (wijziging door eigen tokenverversing is normaal)`);
  const s2a = claudeStatus(ha);
  const s2b = claudeStatus(hb);
  ok('identiteiten ongewijzigd na afloop', s2a.email === sa.email && s2b.email === sb.email);
}

// ---- Codex ------------------------------------------------------------------

function codexBin() {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['codex'], { encoding: 'utf8' });
  for (const hit of r.stdout.split(/\r?\n/).filter(Boolean)) {
    if (hit.toLowerCase().endsWith('.exe')) return hit;
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const triple = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`;
    const p = path.join(path.dirname(hit), 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${arch}`, 'vendor', triple, 'bin', 'codex.exe');
    if (fs.existsSync(p)) return p;
    if (process.platform !== 'win32') return hit;
  }
  throw new Error('codex niet gevonden');
}

class Codex {
  constructor(h) {
    this.p = spawn(codexBin(), ['app-server', '-c', 'cli_auth_credentials_store="keyring"'], { env: cleanEnv({ CODEX_HOME: h }) });
    this.pending = new Map();
    this.waiters = [];
    this.id = 0;
    readline.createInterface({ input: this.p.stdout }).on('line', (l) => {
      const m = JSON.parse(l);
      if (m.id !== undefined && this.pending.has(m.id)) {
        this.pending.get(m.id)(m);
        this.pending.delete(m.id);
      } else if (m.id !== undefined && m.method) {
        this.send({ id: m.id, result: { decision: 'decline' } }); // never auto-approve
      } else this.waiters.forEach((w) => w(m));
    });
  }
  send(m) {
    this.p.stdin.write(JSON.stringify(m) + '\n');
  }
  req(method, params) {
    return new Promise((r) => {
      const id = ++this.id;
      this.pending.set(id, r);
      this.send({ id, method, params });
    });
  }
  async init() {
    const r = await this.req('initialize', { clientInfo: { name: 'ailo_proof', title: 'Ailo proof', version: '0.1.0' } });
    this.send({ method: 'initialized' });
    return r.result;
  }
  turn(threadId, text) {
    return new Promise(async (resolve) => {
      let reply = '';
      const w = (m) => {
        if (m.params?.threadId !== threadId) return;
        if (m.method === 'item/completed' && m.params.item.type === 'agentMessage') reply = m.params.item.text;
        if (m.method === 'turn/completed') {
          this.waiters = this.waiters.filter((x) => x !== w);
          resolve({ status: m.params.turn.status, reply, error: m.params.turn.error?.message });
        }
      };
      this.waiters.push(w);
      await this.req('turn/start', { threadId, input: [{ type: 'text', text, text_elements: [] }] });
    });
  }
  close() {
    this.p.kill();
  }
}

async function proveCodex(a, b, cwd) {
  console.log(`\nCodex: "${a.alias}" en "${b.alias}"`);
  const [ha, hb] = [home(a.id), home(b.id)];
  const ca = new Codex(ha);
  const cb = new Codex(hb);
  try {
    const [ia, ib] = await Promise.all([ca.init(), cb.init()]);
    ok('elk proces rapporteert de eigen accountmap', path.resolve(ia.codexHome).toLowerCase() === path.resolve(ha).toLowerCase() && path.resolve(ib.codexHome).toLowerCase() === path.resolve(hb).toLowerCase());
    const [aa, ab] = await Promise.all([ca.req('account/read', {}), cb.req('account/read', {})]);
    const ea = aa.result?.account;
    const eb = ab.result?.account;
    ok('beide accounts aangemeld', !!ea && !!eb, `${ea?.email ?? ea?.type ?? '-'} / ${eb?.email ?? eb?.type ?? '-'}`);
    if (!ea || !eb) return;
    ok('verschillende identiteiten', ea.email !== eb.email, ea.email === eb.email ? 'zelfde e-mailadres: dit bewijst alleen mapscheiding' : '');
    ok('geen auth.json met platte tekst', !fs.existsSync(path.join(ha, 'auth.json')) && !fs.existsSync(path.join(hb, 'auth.json')));
    const opts = { cwd, approvalPolicy: 'on-request', sandbox: 'read-only' };
    const [ta, tb] = await Promise.all([ca.req('thread/start', opts), cb.req('thread/start', opts)]);
    const [idA, idB] = [ta.result.thread.id, tb.result.thread.id];
    const [ra, rb] = await Promise.all([ca.turn(idA, 'Onthoud: het codewoord is APPEL-7. Antwoord alleen met: ok'), cb.turn(idB, 'Onthoud: het codewoord is PEER-3. Antwoord alleen met: ok')]);
    ok('gelijktijdig gesprek gevoerd', ra.status === 'completed' && rb.status === 'completed', ra.error ?? rb.error ?? '');
    ok('sessie A alleen in map A', findFiles(path.join(ha, 'sessions'), idA).length > 0 && findFiles(path.join(hb, 'sessions'), idA).length === 0);
    ok('sessie B alleen in map B', findFiles(path.join(hb, 'sessions'), idB).length > 0 && findFiles(path.join(ha, 'sessions'), idB).length === 0);
    const [qa, qb] = await Promise.all([ca.turn(idA, 'Wat is het codewoord? Alleen het woord.'), cb.turn(idB, 'Wat is het codewoord? Alleen het woord.')]);
    ok('A onthoudt eigen gesprek', qa.reply.includes('APPEL-7') && !qa.reply.includes('PEER-3'), qa.reply);
    ok('B onthoudt eigen gesprek', qb.reply.includes('PEER-3') && !qb.reply.includes('APPEL-7'), qb.reply);
    const cross = await cb.req('thread/resume', { threadId: idA });
    ok('B kan sessie van A niet openen', !!cross.error, cross.error?.message?.slice(0, 80) ?? 'onverwacht geopend');
    const [a2, b2] = await Promise.all([ca.req('account/read', {}), cb.req('account/read', {})]);
    ok('identiteiten ongewijzigd na afloop', a2.result?.account?.email === ea.email && b2.result?.account?.email === eb.email);
  } finally {
    ca.close();
    cb.close();
  }
}

// ---- main -------------------------------------------------------------------

if (!fs.existsSync(statePath)) {
  console.error(`Geen Ailo-gegevens gevonden in ${dataDir}. Start Ailo en voeg eerst accounts toe.`);
  process.exit(2);
}
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ailo-proof-'));
console.log(`Ailo-gegevens: ${dataDir}\nWerkmap voor de proef: ${cwd}`);
let ran = false;
for (const provider of ['codex', 'claude']) {
  const accs = state.accounts.filter((a) => a.provider === provider);
  if (accs.length < 2) {
    console.log(`\n${provider}: ${accs.length} account(s) in Ailo — voeg een tweede ${provider === 'codex' ? 'OpenAI' : 'Claude'}-account toe en meld aan om dit te bewijzen.`);
    continue;
  }
  ran = true;
  await (provider === 'codex' ? proveCodex : proveClaude)(accs[0], accs[1], cwd);
}
const failed = results.filter((r) => !r.pass).length;
console.log(ran ? `\n${results.length - failed}/${results.length} controles geslaagd.` : '\nNiets te bewijzen: er zijn nog geen twee accounts van dezelfde aanbieder.');
process.exit(failed ? 1 : ran ? 0 : 3);
