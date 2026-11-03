import { beforeEach, expect, it, vi } from 'vitest';
import type { AiloService } from '../src/main/service';
import type { BrowserWindow } from 'electron';
const fake = vi.hoisted(() => {
  const instances: any[] = [];
  const supported = vi.fn(() => true);
  class NativeNotification {
    static isSupported = supported;
    listeners: Record<string, (() => void)[]> = {};
    show = vi.fn(); close = vi.fn();
    constructor(public options: any) { instances.push(this); }
    on(name: string, fn: () => void) { (this.listeners[name] ??= []).push(fn); return this; }
    emit(name: string) { for (const fn of this.listeners[name] ?? []) fn(); }
  }
  return { instances, supported, NativeNotification };
});
vi.mock('electron', () => ({ Notification: fake.NativeNotification, app: {}, shell: {} }));
import { CompletionNotifications } from '../src/main/notifications';

function fixture() {
  const c = { id: 'conversation', title: 'Example task', unread: true };
  const state = { settings: { notifications: true }, conversations: [c] };
  const win = { isDestroyed: vi.fn(() => false), isFocused: vi.fn(() => false), isMinimized: vi.fn(() => true), restore: vi.fn(), show: vi.fn(), focus: vi.fn(), flashFrame: vi.fn(), webContents: { send: vi.fn() } };
  const notifier = new CompletionNotifications({ state } as unknown as AiloService, () => win as unknown as BrowserWindow, 'icon.png');
  const finished = { type: 'turn_finished', conversationId: c.id, outcome: 'completed' } as const;
  return { c, state, win, notifier, finished };
}
beforeEach(() => { fake.instances.length = 0; fake.supported.mockReset().mockReturnValue(true); });

it('notifies once and clicking restores the window and opens the correct conversation', () => {
  const { notifier, finished, win } = fixture();
  notifier.handle(finished);
  const n = fake.instances[0];
  expect(n.options).toEqual({ title: 'Ailo — response ready', body: 'Example task', icon: 'icon.png' });
  expect(n.show).toHaveBeenCalledOnce(); expect(win.flashFrame).toHaveBeenCalledWith(true);
  n.emit('click');
  expect(win.restore).toHaveBeenCalledOnce(); expect(win.focus).toHaveBeenCalledOnce();
  expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith('ailo:event', { type: 'open_conversation', conversationId: 'conversation' });
  notifier.dismiss('conversation'); expect(n.close).toHaveBeenCalledOnce();
});

it('replaces old notifications and clears outstanding notifications when disabled', () => {
  const { notifier, finished } = fixture();
  notifier.handle(finished); notifier.handle(finished);
  expect(fake.instances[0].close).toHaveBeenCalledOnce();
  notifier.clear(); expect(fake.instances[1].close).toHaveBeenCalledOnce();
});

it('suppresses notifications for read responses, disabled notifications and unrelated state changes', () => {
  const { notifier, c, state, finished, win } = fixture();
  c.unread = false; notifier.handle(finished);
  c.unread = true; state.settings.notifications = false; notifier.handle(finished);
  notifier.handle({ type: 'open_conversation', conversationId: c.id });
  expect(fake.instances).toHaveLength(0); expect(win.flashFrame).not.toHaveBeenCalled();
});

it('keeps unread state when the OS does not support notifications or delivery fails', () => {
  const { notifier, c, finished } = fixture();
  fake.supported.mockReturnValue(false); notifier.handle(finished);
  expect(fake.instances).toHaveLength(0); expect(c.unread).toBe(true);
  fake.supported.mockReturnValue(true); notifier.handle({ ...finished, outcome: 'failed' });
  expect(fake.instances[0].options.title).toContain('task failed');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { fake.instances[0].emit('failed'); expect(c.unread).toBe(true); }
  finally { warning.mockRestore(); }
});

it('does not focus a destroyed window or navigate to a deleted conversation', () => {
  const { notifier, finished, state, win } = fixture();
  notifier.handle(finished); state.conversations = [];
  fake.instances[0].emit('click'); expect(win.focus).not.toHaveBeenCalled();
  win.isDestroyed.mockReturnValue(true); notifier.handle(finished);
  expect(fake.instances).toHaveLength(1);
});
