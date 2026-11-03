import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AiloService } from '../src/main/service';
import { Store } from '../src/main/store';
import { pendingInput } from '../src/main/pending-input';
import type { ProviderAdapter, RunParams } from '../src/main/providers/types';

it.each(['beforeSession', 'afterSession', 'afterAccept'])('preserves undelivered inputs across restart (%s)', async (failure) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailo-receipts-'));
  const calls: RunParams[] = [];
  const adapter: ProviderAdapter = {
    id: 'codex', initHome: h => fs.mkdirSync(h, { recursive: true }),
    checkAccount: async () => ({ state: 'connected', checkedAt: '' }),
    startLogin: async () => ({ submitCode() {}, cancel() {}, done: Promise.resolve() }),
    logout: async () => {}, listModels: async () => ({ models: [], fastNote: '' }),
    getUsage: async () => undefined, deleteSession: async () => true, dispose: async () => {},
    runTurn: async p => {
      calls.push(p);
      if (calls.length === 1) {
        if (failure !== 'beforeSession') p.cb.onSession('fixture-session');
        if (failure === 'afterAccept') p.cb.onInputAccepted?.();
        throw Error('Fixture startup failure');
      }
      p.cb.onSession('fixture-session');
      p.cb.onInputAccepted?.();
      return { done: Promise.resolve({ status: 'completed' }), stop: async () => {} };
    }
  };
  const create = () => new AiloService(new Store(root), { codex: adapter, claude: adapter }, () => {});
  let svc = create();
  const a = svc.addAccount({ provider: 'codex', alias: 'Fixture', color: '#000' });
  const c = svc.createConversation({ accountId: a.id });
  const attachment = svc.attachData(c.id, 'example.txt', new TextEncoder().encode('fixture'));
  await svc.sendMessage(c.id, 'Please inventory this project.', { attachments: [attachment], wait: true });
  await svc.dispose();
  svc = create();
  try {
    await svc.sendMessage(c.id, 'Please try again.', { wait: true });
    expect(calls[1].account.id).toBe(a.id);
    expect(calls[1].sessionId).toBe(failure === 'beforeSession' ? undefined : 'fixture-session');
    if (failure === 'afterAccept') {
      expect(calls[1].text).toBe('Please try again.');
      expect(calls[1].attachments).toEqual([]);
    } else {
      expect(calls[1].text).toContain('Please inventory this project.');
      expect(calls[1].text).toContain('Current user message:\nPlease try again.');
      expect(calls[1].attachments).toEqual([attachment]);
    }
    await svc.sendMessage(c.id, 'Next question.', { wait: true });
    expect(calls[2].text).toBe('Next question.');
    expect(svc.conversation(c.id).status).toBe('idle');
  } finally { await svc.dispose(); }
});

it('repairs the original legacy plugin-setup failure even after a later retry created a session', () => {
  expect(pendingInput([
    { kind: 'user', id: 'original', text: 'Inventory this project', at: '' },
    { kind: 'notice', id: 'error', level: 'error', text: 'Codex plugin setup failed: Command failed', at: '' },
    { kind: 'user', id: 'retry', text: 'Try again', at: '' },
    { kind: 'assistant', id: 'answer', text: 'Which action?', at: '' },
    { kind: 'user', id: 'current', text: 'The first question', delivery: 'pending', at: '' }
  ], true).map(i => i.id)).toEqual(['original', 'current']);
});
