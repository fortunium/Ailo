import type { ChatItem } from '../shared/types';

type UserItem = Extract<ChatItem, { kind: 'user' }>;

export function pendingInput(items: ChatItem[], hasSession: boolean): UserItem[] {
  return items.filter((item, index): item is UserItem => {
    if (item.kind !== 'user' || item.delivery === 'sent') return false;
    if (item.delivery === 'pending' || item.delivery === 'queued' || !hasSession) return true;
    // Repair legacy setup failures even when a later retry established a session.
    for (let i = index + 1; i < items.length; i++) {
      const next = items[i];
      if (next.kind === 'user' || next.kind === 'assistant') break;
      if (next.kind === 'notice' && next.level === 'error' && next.text.startsWith('Codex plugin setup failed')) return true;
    }
    return false;
  });
}

export function inputText(messages: UserItem[]): string {
  if (messages.length === 1) return messages[0].text;
  return 'Earlier user messages below have not yet been confirmed as delivered. Use them as conversation context, then respond to the current user message.\n\n'
    + messages.map((m, i) => `${i === messages.length - 1 ? 'Current user message' : `Earlier undelivered user message ${i + 1}`}:\n${m.text}`).join('\n\n');
}
