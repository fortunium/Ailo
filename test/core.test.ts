import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { providerEnv } from '../src/main/env';
import { redact } from '../src/main/redact';
import { Store } from '../src/main/store';
import { AiloService, foldersOverlap } from '../src/main/service';
import { claudeUsage } from '../src/main/providers/claude';
import { codexUsage, displayCommand, mapItem } from '../src/main/providers/codex';
import type { ProviderAdapter, RunParams } from '../src/main/providers/types';
import type { AccountConnection, MainEvent } from '../src/shared/types';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ailo-test-'));

describe('providerEnv', () => {
  const base = {
    PATH: '/bin',
    ANTHROPIC_API_KEY: 'sk-ant-x',
    CLAUDE_CODE_OAUTH_TOKEN: 't',
    CLAUDE_CONFIG_DIR: '/other',
    CODEX_HOME: '/other-codex',
    OPENAI_API_KEY: 'sk-x',
    CODEX_API_KEY: 'k',
    CLAUDECODE: '1',
    ORCA_X: '1'
  };
  it('zet precies één accountmap en verwijdert alles wat een andere identiteit kan kiezen', () => {
    const c = providerEnv('claude', '/acc/a', base);
    expect(c).toMatchObject({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/acc/a' });
    for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CODEX_HOME', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'CLAUDECODE', 'ORCA_X']) expect(c[k]).toBeUndefined();
    const x = providerEnv('codex', '/acc/b', base);
    expect(x.CODEX_HOME).toBe('/acc/b');
    expect(x.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(x.OPENAI_API_KEY).toBeUndefined();
  });
  it('weigert een lege accountmap', () => expect(() => providerEnv('codex', '')).toThrow());
});

describe('redact', () => {
  it('verbergt sleutels, tokens en OAuth-parameters', () => {
    const s = redact('key sk-ant-abc123456789 Bearer abcdefghijkl {"refresh_token":"r1"} https://x/?code=abc&state=def eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.abcdefghijk');
    expect(s).not.toMatch(/abc123456789|abcdefghijkl|"r1"|code=abc|state=def|eyJhbGci/);
  });
});

describe('foldersOverlap', () => {
  it('herkent dezelfde map en submappen', () => {
    const r = tmp();
    expect(foldersOverlap(r, r + path.sep)).toBe(true);
    expect(foldersOverlap(r, path.join(r, 'sub'))).toBe(true);
    expect(foldersOverlap(path.join(r, 'a'), path.join(r, 'ab'))).toBe(false);
  });
});

describe('Store herstel', () => {
  it('markeert onderbroken uitvoeringen en sluit open verzoeken', () => {
    const root = tmp();
    const s = new Store(root);
    const id = '11111111-1111-1111-1111-111111111111';
    s.state.conversations.push({ id, projectId: 'p', accountId: 'a', title: 't', status: 'awaiting_input', options: {}, archived: false, createdAt: '', updatedAt: '' });
    s.upsertItem(id, { kind: 'approval', id: 'ap', request: { title: 'x', allowSession: false }, at: '' });
    s.upsertItem(id, { kind: 'assistant', id: 'as', text: 'half', streaming: true, at: '' });
    s.saveState();
    s.flush();
    const s2 = new Store(root);
    expect(s2.recoverInterrupted()).toEqual([id]);
    expect(s2.state.conversations[0].status).toBe('interrupted');
    const items = new Store(root).transcript(id).items;
    expect(items.find((i) => i.id === 'ap')).toMatchObject({ resolution: 'cancelled' });
    expect(items.find((i) => i.id === 'as')).toMatchObject({ streaming: false });
    expect(items.at(-1)).toMatchObject({ kind: 'notice', level: 'warning' });
  });
});

// ---- service with a test-only adapter --------------------------------------

function fakeAdapter(id: 'claude' | 'codex', conn: AccountConnection, runs: RunParams[]) {
  let release: () => void = () => {};
  const adapter: ProviderAdapter = {
    id,
    initHome: (h) => fs.mkdirSync(h, { recursive: true }),
    checkAccount: async () => conn,
    startLogin: async () => ({ submitCode() {}, cancel() {}, done: Promise.resolve() }),
    logout: async () => {},
    runTurn: async (p) => {
      runs.push(p);
      p.cb.onSession('sess-' + runs.length);
      return {
        done: new Promise((r) => (release = () => r({ status: 'completed' }))),
        stop: async () => release()
      };
    },
    listModels: async () => ({ models: [{ id: 'test', label: 'Test model', efforts: ['low', 'high'], fast: true, isDefault: true }], fastNote: 'test' }),
    getUsage: async () => ({ windows: [{ label: '5-hour', usedPercent: 12 }], source: 'official', updatedAt: '' }),
    deleteSession: async () => true,
    dispose: async () => {}
  };
  return { adapter, finish: () => release() };
}

function setup(conn: AccountConnection = { state: 'connected', email: 'a@x', checkedAt: '' }) {
  const runs: RunParams[] = [];
  const events: MainEvent[] = [];
  const claude = fakeAdapter('claude', conn, runs);
  const codex = fakeAdapter('codex', conn, runs);
  const store = new Store(tmp());
  const svc = new AiloService(store, { claude: claude.adapter, codex: codex.adapter }, (e) => events.push(e));
  const folder = tmp();
  return { svc, runs, events, folder, store, claude, codex };
}

describe('AiloService', () => {
  it.each(['codex', 'claude'] as const)('persists unread completions for %s and clears them only when viewed', async (provider) => {
    const { svc, runs, store, events, codex, claude } = setup();
    const a = svc.addAccount({ provider, alias: 'Unread fixture', color: '#000' });
    const c = svc.createConversation({ accountId: a.id });
    const other = svc.createConversation({ accountId: a.id });
    try {
      svc.setViewedConversation(other.id);
      await svc.sendMessage(c.id, 'First turn');
      await vi.waitFor(() => expect(runs).toHaveLength(1));
      (provider === 'codex' ? codex : claude).finish();
      await vi.waitFor(() => expect(c.status).toBe('idle'));
      expect(c.unread).toBe(true);
      expect(new Store(store.root).state.conversations.find(x => x.id === c.id)?.unread).toBe(true);
      expect(events.filter(e => e.type === 'turn_finished')).toEqual([{ type: 'turn_finished', conversationId: c.id, outcome: 'completed' }]);
      const updatedAt = c.updatedAt;
      svc.setViewedConversation(c.id);
      expect(c.unread).toBe(false);
      expect(c.updatedAt).toBe(updatedAt);
      expect(new Store(store.root).state.conversations.find(x => x.id === c.id)?.unread).toBe(false);
      await svc.sendMessage(c.id, 'Second turn');
      await vi.waitFor(() => expect(runs).toHaveLength(2));
      (provider === 'codex' ? codex : claude).finish();
      await vi.waitFor(() => expect(c.status).toBe('idle'));
      expect(c.unread).toBe(false); // Already looking at this conversation.
      await svc.sendMessage(c.id, 'Third turn');
      await vi.waitFor(() => expect(runs).toHaveLength(3));
      svc.setViewedConversation(null); // Window lost focus or another page opened.
      (provider === 'codex' ? codex : claude).finish();
      await vi.waitFor(() => expect(c.status).toBe('idle'));
      expect(c.unread).toBe(true);
    } finally { await svc.dispose(); }
  });

  it('marks a failed background task unread, but does not announce a stopped task as complete', async () => {
    const { svc, events, codex } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'Failure fixture', color: '#000' });
    const c = svc.createConversation({ accountId: a.id });
    try {
      codex.adapter.runTurn = async () => ({ done: Promise.resolve({ status: 'failed', message: 'Fixture failure' }), stop: async () => {} });
      await svc.sendMessage(c.id, 'Fail', { wait: true });
      expect(c.unread).toBe(true);
      expect(events.filter(e => e.type === 'turn_finished')).toEqual([{ type: 'turn_finished', conversationId: c.id, outcome: 'failed' }]);
      svc.setViewedConversation(c.id); svc.setViewedConversation(null);
      codex.adapter.runTurn = async () => ({ done: Promise.resolve({ status: 'interrupted' }), stop: async () => {} });
      await svc.sendMessage(c.id, 'Stop', { wait: true });
      expect(c.unread).toBe(false);
      expect(events.filter(e => e.type === 'turn_finished')).toHaveLength(1);
    } finally { await svc.dispose(); }
  });

  it.each(['codex', 'claude'] as const)('persists automatic approvals for %s and can switch back to asking during a run', async (provider) => {
    const { svc, runs, store } = setup();
    const a = svc.addAccount({ provider, alias: 'Fixture', color: '#000' });
    const c = svc.createConversation({ accountId: a.id });
    try {
      expect(svc.state.settings.approvalMode).toBe('ask');
      svc.setSettings({ approvalMode: 'always' });
      expect(new Store(store.root).state.settings.approvalMode).toBe('always');
      await svc.sendMessage(c.id, 'Inspect the fixture');
      await vi.waitFor(() => expect(runs).toHaveLength(1));
      const cb = runs[0].cb;
      expect(await cb.requestApproval({ title: 'Command', allowSession: true })).toBe('approve');
      expect(await cb.requestApproval({ title: 'Change a file', allowSession: false, defaultToNo: true })).toBe('approve');
      expect(store.transcript(c.id).items.some(i => i.kind === 'approval')).toBe(false);
      expect(store.transcript(c.id).log.some(l => l.includes('Automatically approved: Command'))).toBe(true);
      svc.setSettings({ approvalMode: 'ask' });
      const decision = cb.requestApproval({ title: 'Ask again', allowSession: true });
      const approval = store.transcript(c.id).items.findLast(i => i.kind === 'approval')!;
      expect(c.status).toBe('awaiting_input');
      svc.respondApproval(c.id, approval.id, 'deny');
      expect(await decision).toBe('deny');
      expect(c.status).toBe('running');
      const abort = new AbortController(); abort.abort();
      svc.setSettings({ approvalMode: 'always' });
      expect(await cb.requestApproval({ title: 'Aborted', allowSession: false }, abort.signal)).toBe('cancelled');
      await svc.stop(c.id);
      expect(await cb.requestApproval({ title: 'Stopped', allowSession: false })).toBe('cancelled');
    } finally { await svc.dispose(); }
  });

  it('approves pending permissions across conversations when enabled, but keeps questions pending', async () => {
    const { svc, runs, store } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'Fixture A', color: '#000' });
    const b = svc.addAccount({ provider: 'claude', alias: 'Fixture B', color: '#000' });
    const c = svc.createConversation({ accountId: a.id });
    const d = svc.createConversation({ accountId: b.id });
    try {
      await svc.sendMessage(c.id, 'First fixture');
      await svc.sendMessage(d.id, 'Second fixture');
      await vi.waitFor(() => expect(runs).toHaveLength(2));
      const first = runs[0].cb.requestApproval({ title: 'First command', allowSession: true });
      const second = runs[1].cb.requestApproval({ title: 'Second command', allowSession: false });
      const answer = runs[0].cb.requestAnswers([{ id: 'choice', question: 'Which file?', options: [] }]);
      svc.setSettings({ approvalMode: 'always' });
      expect(await first).toBe('approve'); expect(await second).toBe('approve');
      expect(c.status).toBe('awaiting_input'); expect(d.status).toBe('running');
      const items = store.transcript(c.id).items;
      expect(items.find(i => i.kind === 'approval')).toMatchObject({ resolution: 'approved' });
      const question = items.find(i => i.kind === 'question')!;
      expect(question).not.toHaveProperty('resolution');
      svc.respondQuestion(c.id, question.id, { choice: 'example.ts' });
      expect(await answer).toEqual({ choice: 'example.ts' });
    } finally { await svc.dispose(); }
  });

  it('keeps report mode read only with automatic approvals and rejects invalid settings', async () => {
    const { svc, runs } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'Report fixture', color: '#000' });
    const c = svc.createConversation({ accountId: a.id }); c.executionMode = 'report';
    try {
      expect(() => svc.setSettings({ approvalMode: 'invalid' as any })).toThrow('Invalid approval mode');
      expect(svc.state.settings.approvalMode).toBe('ask');
      svc.setSettings({ approvalMode: 'always' });
      await svc.sendMessage(c.id, 'Read the fixture');
      await vi.waitFor(() => expect(runs).toHaveLength(1));
      expect(await runs[0].cb.requestApproval({ title: 'Write', allowSession: true })).toBe('deny');
    } finally { await svc.dispose(); }
  });

  it('marks unfinished checks as interrupted when the user stops a run', async () => {
    const { svc, codex, store } = setup();
    let started!: () => void;
    const ready = new Promise<void>(r => { started = r; });
    let finish!: () => void;
    codex.adapter.runTurn = async p => {
      p.cb.onItem({ kind: 'tool', id: 'long-check', title: 'Command', subtitle: 'long test', status: 'running', at: '' });
      p.cb.onItem({ kind: 'diff', id: 'pending-change', files: [], status: 'pending', at: '' });
      const done = new Promise<import('../src/main/providers/types').RunOutcome>(r => { finish = () => r({ status: 'interrupted' }); });
      started();
      return { done, stop: async () => finish() };
    };
    const a = svc.addAccount({ provider: 'codex', alias: 'Stop fixture', color: '#000' });
    const c = svc.createConversation({ accountId: a.id });
    try {
      const sent = svc.sendMessage(c.id, 'Run a check', { wait: true });
      await ready;
      await svc.stop(c.id);
      await sent;
      expect(svc.conversation(c.id).status).toBe('interrupted');
      expect(store.transcript(c.id).items.find(i => i.id === 'long-check')).toMatchObject({ status: 'interrupted' });
      expect(store.transcript(c.id).items.find(i => i.id === 'pending-change')).toMatchObject({ status: 'interrupted' });
    } finally { await svc.dispose(); }
  });
  it('gebruikt altijd het account van het gesprek, met een eigen map per account', async () => {
    const { svc, runs, folder, store } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'OpenAI privé', color: '#0a0' });
    const b = svc.addAccount({ provider: 'codex', alias: 'OpenAI opdrachtgever', color: '#00a' });
    const p = svc.addProject({ name: 'p', folders: [folder] });
    const ca = svc.createConversation({ projectId: p.id, accountId: a.id });
    const cb = svc.createConversation({ projectId: p.id, accountId: b.id });
    await svc.sendMessage(ca.id, 'hoi');
    await svc.sendMessage(cb.id, 'hoi', { acknowledgeConflicts: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(runs.map((r) => r.account.id)).toEqual([a.id, b.id]);
    expect(runs[0].home).toBe(store.accountHome(a.id));
    expect(runs[1].home).toBe(store.accountHome(b.id));
    expect(runs[0].home).not.toBe(runs[1].home);
    await svc.stopAll();
  });

  it('valt niet terug op een ander account als het gekozen account is afgemeld', async () => {
    const { svc, runs, folder, store } = setup({ state: 'signed_out', checkedAt: '' });
    const a = svc.addAccount({ provider: 'claude', alias: 'Claude privé', color: '#a00' });
    const p = svc.addProject({ name: 'p', folders: [folder] });
    const c = svc.createConversation({ projectId: p.id, accountId: a.id });
    await svc.sendMessage(c.id, 'hoi', { wait: true });
    expect(runs).toHaveLength(0);
    expect(svc.conversation(c.id).status).toBe('error');
    expect(store.transcript(c.id).items.at(-1)).toMatchObject({ kind: 'notice', level: 'error' });
  });

  it('signaleert gelijktijdige uitvoeringen in dezelfde map en start pas na bevestiging', async () => {
    const { svc, folder } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'A', color: '#000' });
    const b = svc.addAccount({ provider: 'claude', alias: 'B', color: '#000' });
    const p1 = svc.addProject({ name: 'p1', folders: [folder] });
    const p2 = svc.addProject({ name: 'p2', folders: [path.join(folder)] });
    const c1 = svc.createConversation({ projectId: p1.id, accountId: a.id });
    const c2 = svc.createConversation({ projectId: p2.id, accountId: b.id });
    expect((await svc.sendMessage(c1.id, 'eerste')).ok).toBe(true);
    const r = await svc.sendMessage(c2.id, 'tweede');
    expect(r.ok).toBe(false);
    expect(r.conflicts?.[0]).toMatchObject({ conversationId: c1.id });
    expect((await svc.sendMessage(c2.id, 'tweede', { acknowledgeConflicts: true })).ok).toBe(true);
    await svc.stopAll();
  });

  it('weigert een tweede beurt terwijl het gesprek nog loopt en hervat met dezelfde sessie', async () => {
    const { svc, runs, folder, codex } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'A', color: '#000' });
    const p = svc.addProject({ name: 'p', folders: [folder] });
    const c = svc.createConversation({ projectId: p.id, accountId: a.id });
    await svc.sendMessage(c.id, 'een');
    await new Promise((r) => setTimeout(r, 10));
    expect((await svc.sendMessage(c.id, 'twee')).ok).toBe(false);
    codex.finish();
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.conversation(c.id).status).toBe('idle');
    await svc.sendMessage(c.id, 'drie');
    await new Promise((r) => setTimeout(r, 10));
    expect(runs[1].sessionId).toBe('sess-1');
    await svc.stopAll();
  });

  it('stoppen beëindigt open toestemmingsverzoeken zonder goedkeuring', async () => {
    const { svc, folder, store } = setup();
    const a = svc.addAccount({ provider: 'claude', alias: 'A', color: '#000' });
    const p = svc.addProject({ name: 'p', folders: [folder] });
    const c = svc.createConversation({ projectId: p.id, accountId: a.id });
    let decision: unknown;
    (svc as any).adapters.claude.runTurn = async (prm: RunParams) => {
      let release!: () => void;
      const done = new Promise<any>((r) => (release = () => r({ status: 'interrupted' })));
      void prm.cb.requestApproval({ title: 'rm -rf', allowSession: false }).then((d) => (decision = d));
      return { done, stop: async () => release() };
    };
    await svc.sendMessage(c.id, 'doe iets');
    await new Promise((r) => setTimeout(r, 10));
    expect(svc.conversation(c.id).status).toBe('awaiting_input');
    await svc.stop(c.id);
    await new Promise((r) => setTimeout(r, 10));
    expect(decision).toBe('cancelled');
    expect(svc.conversation(c.id).status).toBe('interrupted');
    expect(store.transcript(c.id).items.find((i) => i.kind === 'approval')).toMatchObject({ resolution: 'cancelled' });
  });

  it('meldt bij verwijderen nooit af via een gekoppelde (link)map', async () => {
    const { svc, store } = setup();
    const a = svc.addAccount({ provider: 'claude', alias: 'Link', color: '#000' });
    const home = store.accountHome(a.id);
    const elsewhere = tmp();
    fs.rmSync(home, { recursive: true });
    fs.symlinkSync(elsewhere, home, 'junction');
    let loggedOut = false;
    (svc as any).adapters.claude.logout = async () => void (loggedOut = true);
    expect((await svc.removeAccount(a.id)).ok).toBe(true);
    expect(loggedOut).toBe(false);
    expect(fs.existsSync(elsewhere)).toBe(true);
  });

  it('accountaliassen zijn uniek', () => {
    const { svc } = setup();
    svc.addAccount({ provider: 'codex', alias: 'Werk', color: '#000' });
    expect(() => svc.addAccount({ provider: 'claude', alias: 'werk', color: '#000' })).toThrow();
  });
});

describe('Codex item-mapping', () => {
  it('toont commando zonder shell-wrapper', () => {
    expect(displayCommand(String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command 'Get-Content -LiteralPath som.js'`)).toBe('Get-Content -LiteralPath som.js');
    expect(displayCommand(`/bin/bash -lc 'ls -la'`)).toBe('ls -la');
    expect(displayCommand('git status')).toBe('git status');
  });

  it('zet commando- en bestandsitems om naar leesbare items', () => {
    expect(mapItem({ type: 'commandExecution', id: 'c', command: 'npm test', cwd: '/x', status: 'completed', aggregatedOutput: 'ok', exitCode: 0 }, true)).toMatchObject({ kind: 'tool', subtitle: 'npm test', status: 'done', output: 'ok' });
    expect(mapItem({ type: 'fileChange', id: 'f', changes: [{ path: 'a.ts', kind: { type: 'update' }, diff: '-a\n+b' }], status: 'declined' }, true)).toMatchObject({ kind: 'diff', status: 'declined' });
    expect(mapItem({ type: 'userMessage', id: 'u' }, true)).toBeUndefined();
  });
});


describe('Standalone conversations, settings and attachments', () => {
  it('starts each standalone conversation in its own empty folder and survives restart', async () => {
    const { svc, store, folder, runs } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'A', color: '#000' });
    svc.addProject({ name: 'Demo', folders: [folder] });
    const c = svc.createConversation({ accountId: a.id });
    const other = svc.createConversation({ accountId: a.id });
    expect(c.projectId).toBeUndefined();
    expect(c.folders?.[0]).not.toBe(folder);
    expect(c.folders?.[0]).not.toBe(other.folders?.[0]);
    expect(fs.readdirSync(c.folders![0])).toEqual([]);
    expect(new Store(store.root).state.conversations[0]).toMatchObject({ folders: c.folders, options: {} });
    await svc.sendMessage(c.id, 'hello');
    await new Promise((r) => setTimeout(r, 15));
    expect(runs[0].cwd).toBe(c.folders![0]);
    expect(svc.folderConflicts(other.id)).toEqual([]);
    await svc.stopAll();
  });

  it('validates model capabilities, passes options to the right run and blocks changes during a turn', async () => {
    const { svc, runs } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'A', color: '#000' });
    const c = svc.createConversation({ accountId: a.id });
    await expect(svc.setConversationOptions(c.id, { model: 'missing' })).rejects.toThrow('unavailable');
    await expect(svc.setConversationOptions(c.id, { model: 'test', effort: 'impossible' })).rejects.toThrow('unavailable');
    await svc.setConversationOptions(c.id, { model: 'test', effort: 'high', fast: true });
    await svc.sendMessage(c.id, 'hello');
    await new Promise((r) => setTimeout(r, 15));
    expect(runs[0].options).toEqual({ model: 'test', effort: 'high', fast: true });
    await expect(svc.setConversationOptions(c.id, { model: 'test', effort: 'low' })).rejects.toThrow('finish');
    await svc.stopAll();
  });

  it('copies attachments, refuses cross-conversation paths and supports an attachment-only turn', async () => {
    const { svc, store, runs } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'A', color: '#000' });
    const c = svc.createConversation({ accountId: a.id });
    const other = svc.createConversation({ accountId: a.id });
    const file = svc.attachData(c.id, '../notes.txt', Buffer.from('notes'));
    expect(file.name).toBe('notes.txt');
    expect(fs.readFileSync(file.path, 'utf8')).toBe('notes');
    expect((await svc.sendMessage(other.id, 'steal', { attachments: [file] })).ok).toBe(false);
    expect((await svc.sendMessage(c.id, '', { attachments: [file] })).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 15));
    expect(runs[0].attachments[0]).toEqual(file);
    expect(runs[0].extraDirs).toContain(svc.attachmentFolder(c.id));
    expect(store.transcript(c.id).items[0]).toMatchObject({ kind: 'user', attachments: [file] });
    await svc.stopAll();
  });

  it('refuses symlinked attachment escapes and oversized image data', async () => {
    const { svc } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'A', color: '#000' });
    const c = svc.createConversation({ accountId: a.id });
    const file = svc.attachData(c.id, 'notes.txt', Buffer.from('notes'));
    const external = path.join(tmp(), 'file.txt');
    fs.writeFileSync(external, 'outside');
    fs.unlinkSync(file.path);
    // A linked parent is also refused, without reading the external file.
    fs.rmdirSync(svc.attachmentFolder(c.id));
    fs.symlinkSync(path.dirname(external), svc.attachmentFolder(c.id), 'junction');
    expect((await svc.sendMessage(c.id, 'escape', { attachments: [{ ...file, path: path.join(svc.attachmentFolder(c.id), 'file.txt') }] })).ok).toBe(false);
    const large = Buffer.alloc(6 * 1024 * 1024);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(large);
    const other = svc.createConversation({ accountId: a.id });
    expect(() => svc.attachData(other.id, 'large.png', large)).toThrow('5 MB');
  });

  it('deletes the transcript and copies, preserves working files, and refuses deletion during a run', async () => {
    const { svc, store, codex } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'A', color: '#000' });
    const c = svc.createConversation({ accountId: a.id });
    const file = svc.attachData(c.id, 'notes.txt', Buffer.from('notes'));
    const workFile = path.join(c.folders![0], 'work.txt');
    fs.writeFileSync(workFile, 'keep me');
    await svc.sendMessage(c.id, 'hello');
    await new Promise((r) => setTimeout(r, 15));
    expect((await svc.deleteConversation(c.id)).ok).toBe(false);
    codex.finish();
    await new Promise((r) => setTimeout(r, 15));
    store.flush();
    expect((await svc.deleteConversation(c.id)).ok).toBe(true);
    expect(svc.state.conversations).toHaveLength(0);
    expect(fs.existsSync(file.path)).toBe(false);
    expect(fs.readFileSync(workFile, 'utf8')).toBe('keep me');
    store.flush();
    expect(new Store(store.root).state.conversations).toHaveLength(0);
    expect(fs.readdirSync(path.join(store.root, 'transcripts'))).toEqual([]);
  });

  it('keeps usage and context on their respective account and conversation', async () => {
    const { svc, runs } = setup();
    const a = svc.addAccount({ provider: 'codex', alias: 'A', color: '#000' });
    const b = svc.addAccount({ provider: 'codex', alias: 'B', color: '#000' });
    const c = svc.createConversation({ accountId: a.id });
    await svc.refreshUsage(a.id);
    expect(a.usage?.windows[0].usedPercent).toBe(12);
    expect(b.usage).toBeUndefined();
    await svc.sendMessage(c.id, 'hello');
    await new Promise((r) => setTimeout(r, 15));
    runs[0].cb.onContext({ tokens: 400, window: 1000 });
    runs[0].cb.onUsage({ windows: [{ label: 'Weekly', usedPercent: 83 }], source: 'official', updatedAt: '' });
    expect(c.context).toEqual({ tokens: 400, window: 1000 });
    expect(a.usage?.windows[0].usedPercent).toBe(83);
    expect(b.usage).toBeUndefined();
    await svc.stopAll();
  });
});

describe('Provider usage normalization', () => {
  it('maps Codex percentages and Unix reset timestamps', () => {
    const u = codexUsage({ primary: { usedPercent: 2, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: 27, windowDurationMins: 10080 } });
    expect(u?.windows).toEqual([{ label: '5-hour', usedPercent: 2, resetsAt: new Date(1800000000000).toISOString() }, { label: 'Weekly', usedPercent: 27, resetsAt: undefined }]);
    expect(codexUsage(null)).toBeUndefined();
  });
  it('uses Claude usage API percentages directly and marks unavailable data', () => {
    expect(claudeUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 0.5, resets_at: null }, seven_day: { utilization: 83 } } })?.windows.map((w) => w.usedPercent)).toEqual([0.5, 83]);
    expect(claudeUsage({ rate_limits_available: false })).toBeUndefined();
  });
});
