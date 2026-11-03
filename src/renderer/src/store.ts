// Renderer-side view of main-process state. Main is the source of truth;
// this mirrors it and applies streamed events.
import { useSyncExternalStore } from 'react';
import type { AppState, ChatItem, LoginProgress, MainEvent } from '../../shared/types';
import { api } from './api';

interface View {
  app: AppState | null;
  transcripts: Record<string, ChatItem[]>;
  logs: Record<string, string[]>;
  logins: Record<string, LoginProgress | undefined>;
}

let view: View = { app: null, transcripts: {}, logs: {}, logins: {} };
const listeners = new Set<() => void>();

function set(next: Partial<View>): void {
  view = { ...view, ...next };
  for (const l of listeners) l();
}

function upsert(items: ChatItem[], item: ChatItem): ChatItem[] {
  const i = items.findIndex((x) => x.id === item.id);
  if (i < 0) return [...items, item];
  const copy = items.slice();
  copy[i] = item;
  return copy;
}

function onEvent(e: MainEvent): void {
  switch (e.type) {
    case 'state':
      set({ app: e.state });
      break;
    case 'item': {
      const cur = view.transcripts[e.conversationId];
      if (cur) set({ transcripts: { ...view.transcripts, [e.conversationId]: upsert(cur, e.item) } });
      break;
    }
    case 'delta': {
      const cur = view.transcripts[e.conversationId];
      if (!cur) break;
      const i = cur.findIndex((x) => x.id === e.itemId);
      if (i < 0) break;
      const it = cur[i];
      if (it.kind !== 'assistant' && it.kind !== 'reasoning') break;
      const copy = cur.slice();
      copy[i] = { ...it, text: it.text + e.text };
      set({ transcripts: { ...view.transcripts, [e.conversationId]: copy } });
      break;
    }
    case 'log': {
      const cur = view.logs[e.conversationId];
      if (cur) set({ logs: { ...view.logs, [e.conversationId]: [...cur.slice(-1999), e.line] } });
      break;
    }
    case 'login':
      set({ logins: { ...view.logins, [e.accountId]: e.progress } });
      break;
  }
}

let started = false;
export function startStore(): void {
  if (started) return;
  started = true;
  api.onEvent(onEvent);
  void api.getState().then((app) => set({ app }));
}

export async function loadTranscript(id: string): Promise<void> {
  if (view.transcripts[id]) return;
  const t = await api.getTranscript(id);
  set({ transcripts: { ...view.transcripts, [id]: t.items }, logs: { ...view.logs, [id]: t.log } });
}

export function clearLogin(accountId: string): void {
  set({ logins: { ...view.logins, [accountId]: undefined } });
}

export function useView(): View {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => view
  );
}
