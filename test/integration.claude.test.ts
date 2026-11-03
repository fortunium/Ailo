// Real-provider integration test (no mocks). Runs only when AILO_IT_CLAUDE_HOME
// points to a signed-in Claude config directory.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Account, ApprovalRequest, ChatItem } from '../src/shared/types';
import { ClaudeAdapter } from '../src/main/providers/claude';
import type { RunCallbacks } from '../src/main/providers/types';

const home = process.env.AILO_IT_CLAUDE_HOME;
const suite = home ? describe : describe.skip;

function collector(onApproval: (r: ApprovalRequest) => 'approve' | 'deny' = () => 'deny') {
  const items = new Map<string, ChatItem>();
  const approvals: ApprovalRequest[] = [];
  let session: string | undefined;
  const cb: RunCallbacks = {
    onSession: (s) => (session = s),
    onItem: (i) => items.set(i.id, i),
    onDelta: (id, t) => {
      const i = items.get(id);
      if (i && i.kind === 'assistant') i.text += t;
    },
    onLog: () => {},
    onUsage: () => {},
    onContext: () => {},
    requestApproval: async (r) => {
      approvals.push(r);
      return onApproval(r);
    },
    requestAnswers: async () => null
  };
  return { cb, items, approvals, session: () => session, text: () => [...items.values()].filter((i) => i.kind === 'assistant').map((i: any) => i.text).join('\n') };
}

suite('Claude adapter (echte CLI)', () => {
  const adapter = new ClaudeAdapter();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ailo-it-'));
  let account: Account;

  it('leest de accountstatus uit de opgegeven map', async () => {
    const c = await adapter.checkAccount({} as Account, home!);
    expect(c.state).toBe('connected');
    account = { id: 'x', provider: 'claude', alias: 'test', color: '#000', createdAt: '', connection: c };
  }, 30000);

  let sessionId: string | undefined;
  it('streamt een antwoord en levert een sessie-id', async () => {
    const col = collector();
    const h = await adapter.runTurn({ account, home: home!, cwd, extraDirs: [], attachments: [], options: {}, text: 'Onthoud het codewoord PAARS-42. Antwoord alleen met: begrepen', cb: col.cb });
    const out = await h.done;
    expect(out).toEqual({ status: 'completed' });
    sessionId = col.session();
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(col.text().toLowerCase()).toContain('begrepen');
  }, 120000);

  it('hervat hetzelfde gesprek', async () => {
    const col = collector();
    const h = await adapter.runTurn({ account, home: home!, cwd, extraDirs: [], attachments: [], options: {}, sessionId, text: 'Wat was het codewoord? Antwoord alleen met het codewoord.', cb: col.cb });
    expect(await h.done).toEqual({ status: 'completed' });
    expect(col.text()).toContain('PAARS-42');
    expect(col.session()).toBe(sessionId);
  }, 120000);

  it('vraagt toestemming voor een bestandswijziging en respecteert weigeren', async () => {
    const col = collector(() => 'deny');
    const h = await adapter.runTurn({ account, home: home!, cwd, extraDirs: [], attachments: [], options: {}, text: 'Maak het bestand hallo.txt aan met de tekst hoi. Gebruik de Write-tool. Probeer het maar één keer.', cb: col.cb });
    await h.done;
    expect(col.approvals.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(cwd, 'hallo.txt'))).toBe(false);
  }, 180000);

  it('kan een lopende uitvoering stoppen', async () => {
    const col = collector();
    const h = await adapter.runTurn({ account, home: home!, cwd, extraDirs: [], attachments: [], options: {}, text: 'Schrijf een heel lang verhaal van 2000 woorden over een vuurtoren.', cb: col.cb });
    await new Promise((r) => setTimeout(r, 6000));
    const t0 = Date.now();
    await h.stop();
    const out = await h.done;
    expect(out.status).toBe('interrupted');
    expect(Date.now() - t0).toBeLessThan(15000);
  }, 120000);
});
