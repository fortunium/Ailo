// Local persistence: one state file plus one transcript file per conversation.
// Writes are atomic (temp file + rename) so a crash never leaves a half-written file.
// No secrets are stored here; provider credentials live in the provider's own
// OS-backed store inside each account directory.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppState, ChatItem, Transcript } from '../shared/types';

const MAX_LOG_LINES = 2000;

function writeAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    // Keep the unreadable file for inspection instead of overwriting it.
    try {
      fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      /* ignore */
    }
    return undefined;
  }
}

export function emptyState(): AppState {
  return { accounts: [], projects: [], conversations: [], connections: [], skills: [], plugins: [], automations: [], automationRuns: [], settings: { theme: 'system', onboardingDone: false } };
}

export class Store {
  readonly root: string;
  state: AppState;
  private transcripts = new Map<string, Transcript>();
  private dirty = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(root: string) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
    const loaded = readJson<AppState>(this.statePath);
    this.state = { ...emptyState(), ...loaded, settings: { ...emptyState().settings, ...loaded?.settings } };
    for (const c of this.state.conversations) c.options ??= {};
  }

  get statePath(): string {
    return path.join(this.root, 'state.json');
  }

  accountHome(accountId: string): string {
    if (!/^[0-9a-f-]{36}$/.test(accountId)) throw new Error('Invalid account id');
    return path.join(this.root, 'accounts', accountId, 'home');
  }

  saveState(): void {
    writeAtomic(this.statePath, JSON.stringify(this.state, null, 2));
  }

  transcript(conversationId: string): Transcript {
    let t = this.transcripts.get(conversationId);
    if (!t) {
      t = readJson<Transcript>(this.transcriptPath(conversationId)) ?? { conversationId, items: [], log: [] };
      this.transcripts.set(conversationId, t);
    }
    return t;
  }

  upsertItem(conversationId: string, item: ChatItem): void {
    const t = this.transcript(conversationId);
    const i = t.items.findIndex((x) => x.id === item.id);
    if (i >= 0) t.items[i] = item;
    else t.items.push(item);
    this.markDirty(conversationId);
  }

  appendDelta(conversationId: string, itemId: string, text: string): ChatItem | undefined {
    const item = this.transcript(conversationId).items.find((x) => x.id === itemId);
    if (item && (item.kind === 'assistant' || item.kind === 'reasoning')) {
      item.text += text;
      this.markDirty(conversationId);
    }
    return item;
  }

  appendLog(conversationId: string, line: string): void {
    const t = this.transcript(conversationId);
    t.log.push(line);
    if (t.log.length > MAX_LOG_LINES) t.log.splice(0, t.log.length - MAX_LOG_LINES);
    this.markDirty(conversationId);
  }

  deleteTranscript(conversationId: string): void {
    this.dirty.delete(conversationId);
    this.transcripts.delete(conversationId);
    fs.rmSync(this.transcriptPath(conversationId), { force: true });
  }

  /** Flush pending transcript writes now (used on quit and after each turn). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const id of this.dirty) {
      const t = this.transcripts.get(id);
      if (t) writeAtomic(this.transcriptPath(id), JSON.stringify(t));
    }
    this.dirty.clear();
  }

  /**
   * After a crash or forced quit, runs that were in progress can't continue:
   * the provider process is gone. Mark them interrupted and close open prompts,
   * so the user sees what happened and can continue the conversation.
   */
  recoverInterrupted(now = new Date().toISOString()): string[] {
    const recovered: string[] = [];
    for (const c of this.state.conversations) {
      if (c.status !== 'running' && c.status !== 'awaiting_input') continue;
      c.status = 'interrupted';
      c.updatedAt = now;
      const t = this.transcript(c.id);
      for (const item of t.items) {
        if (item.kind === 'assistant' && item.streaming) item.streaming = false;
        if (item.kind === 'tool' && item.status === 'running') item.status = 'failed';
        if (item.kind === 'approval' && !item.resolution) item.resolution = 'cancelled';
        if (item.kind === 'question' && !item.resolution) item.resolution = 'cancelled';
      }
      t.items.push({
        kind: 'notice',
        id: randomUUID(),
        level: 'warning',
        text: 'The previous run was cut off because Ailo was closed. Send a new message to continue; the conversation resumes where the provider supports it.',
        at: now
      });
      this.markDirty(c.id);
      recovered.push(c.id);
    }
    if (recovered.length) {
      this.saveState();
      this.flush();
    }
    return recovered;
  }

  private transcriptPath(id: string): string {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid conversation id');
    return path.join(this.root, 'transcripts', `${id}.json`);
  }

  private markDirty(id: string): void {
    this.dirty.add(id);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 400);
  }
}
