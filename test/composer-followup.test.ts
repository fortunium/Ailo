// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Composer } from '../src/renderer/src/components/Composer';
import type { Conversation } from '../src/shared/types';

const fake = vi.hoisted(() => ({ stop: vi.fn() }));
vi.mock('../src/renderer/src/api', () => ({ api: { stop: fake.stop } }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fake.stop.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
async function render(status: Conversation['status'], send: (text: string, attachments: any[]) => Promise<boolean>) {
  const conv = { id: `followup-${status}`, status, archived: false } as Conversation;
  await act(async () => root.render(createElement(Composer, { conv, disabled: false, onSend: send })));
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Use the proposed branch name');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}

it.each(['running', 'awaiting_input'] as const)('sends a follow-up with Enter while %s and keeps Stop available', async status => {
  const send = vi.fn().mockResolvedValue(true);
  const input = await render(status, send);
  expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Send' && !b.disabled)).toBe(true);
  expect([...host.querySelectorAll('button')].some(b => b.textContent?.includes('Stop'))).toBe(true);
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(send).toHaveBeenCalledExactlyOnceWith('Use the proposed branch name', []);
  expect(input.value).toBe(''); expect(fake.stop).not.toHaveBeenCalled();
});

it('keeps the draft when sending fails and handles Escape only once', async () => {
  const send = vi.fn().mockResolvedValue(false);
  const input = await render('running', send);
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === 'Send')!;
  await act(async () => button.click());
  expect(input.value).toBe('Use the proposed branch name');
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(fake.stop).toHaveBeenCalledExactlyOnceWith('followup-running');
});
