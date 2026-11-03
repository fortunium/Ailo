// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TerminalTranscript } from '../src/renderer/src/components/Transcript';
import { Composer } from '../src/renderer/src/components/Composer';
import type { ChatItem, Conversation } from '../src/shared/types';

const { respond } = vi.hoisted(() => ({ respond: vi.fn() }));
vi.mock('../src/renderer/src/api', () => ({ api: { respondApproval: respond } }));
let root: Root;
let host: HTMLDivElement;
const request = (id = 'approval', changes = {}): ChatItem => ({ kind: 'approval', id, request: { title: 'Codex wants to run a command', reason: 'May I inspect the example data?', detail: 'example command', allowSession: true, ...changes }, at: '' });
async function render(items: ChatItem[], composer = false) {
  const conv = { id: 'fixture', status: 'awaiting_input' } as Conversation;
  await act(async () => root.render(createElement(Fragment, null,
    createElement(TerminalTranscript, { conversationId: 'fixture', items }),
    composer && createElement(Composer, { conv, disabled: false, onSend: async () => false })
  )));
}
async function key(value: string, target: EventTarget = document.body, extra: KeyboardEventInit = {}) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra })); });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  respond.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });

it.each([['y', 'approve'], ['a', 'approve_session'], ['n', 'deny']])('handles %s outside the button row', async (shortcut, decision) => {
  await render([request()]);
  await key(shortcut);
  expect(respond).toHaveBeenCalledExactlyOnceWith('fixture', 'approval', decision);
});

it('keeps the question and buttons visible while technical details are collapsed', async () => {
  await render([request()], true);
  expect(host.querySelector('details.t-permission-details')?.hasAttribute('open')).toBe(false);
  expect(host.querySelector('.t-approval')?.textContent).toContain('May I inspect the example data?');
  expect(document.activeElement?.textContent).toBe('[n] Deny');
});

it('does not interpret text input, repeated keys, composition or modified keys as approval', async () => {
  const field = document.createElement('textarea'); field.value = 'draft'; document.body.append(field); field.focus();
  await render([request()]);
  expect(document.activeElement).toBe(field);
  await key('y', field);
  await key('y', document.body, { repeat: true });
  await key('y', document.body, { isComposing: true });
  await key('a', document.body, { ctrlKey: true });
  expect(respond).not.toHaveBeenCalled();
});

it('sends only one decision with concurrent requests and ignores duplicate presses', async () => {
  await render([request('first'), request('second')]);
  await key('y'); await key('y');
  expect(respond).toHaveBeenCalledExactlyOnceWith('fixture', 'first', 'approve');
  await render([{ ...request('first'), resolution: 'approved' } as ChatItem, request('second')]);
  await key('n');
  expect(respond).toHaveBeenLastCalledWith('fixture', 'second', 'deny');
});

it('pauses shortcuts while a dialog is open and respects single-key restrictions', async () => {
  await render([request('restricted', { defaultToNo: true })]);
  await key('y'); await key('a');
  expect(respond).not.toHaveBeenCalled();
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); document.body.append(dialog);
  await key('n'); expect(respond).not.toHaveBeenCalled();
  dialog.remove(); await key('n');
  expect(respond).toHaveBeenCalledExactlyOnceWith('fixture', 'restricted', 'deny');
});

it('shows a delivery error and lets the user retry the decision', async () => {
  respond.mockRejectedValueOnce(new Error('Connection lost'));
  await render([request()]);
  await key('y');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Connection lost');
  expect(host.querySelector<HTMLButtonElement>('.primary')?.disabled).toBe(false);
  await key('n');
  expect(respond).toHaveBeenLastCalledWith('fixture', 'approval', 'deny');
  expect(respond).toHaveBeenCalledTimes(2);
});
