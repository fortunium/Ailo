// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { MainEvent } from '../src/shared/types';
import { emptyState } from '../src/main/store';
const fake = vi.hoisted(() => ({ app: null as any, viewed: vi.fn(), events: [] as ((e: MainEvent) => void)[] }));
vi.mock('../src/renderer/src/store', () => ({ startStore() {}, useView: () => ({ app: fake.app }) }));
vi.mock('../src/renderer/src/api', () => ({ api: {
  setViewedConversation: fake.viewed,
  onEvent: (cb: (e: MainEvent) => void) => { fake.events.push(cb); return () => { fake.events = fake.events.filter(x => x !== cb); }; }
} }));
vi.mock('../src/renderer/src/components/Sidebar', () => ({ Sidebar: (p: any) => createElement('button', { onClick: p.onAutomations }, 'Automations') }));
vi.mock('../src/renderer/src/components/ConversationView', () => ({ ConversationView: () => null }));
vi.mock('../src/renderer/src/components/Automations', () => ({ Automations: () => null }));
vi.mock('../src/renderer/src/components/Integrations', () => ({ Integrations: () => null }));
vi.mock('../src/renderer/src/components/Accounts', () => ({ AccountsDialog: () => null }));
vi.mock('../src/renderer/src/components/Dialogs', () => ({ NewConversationDialog: () => null, Onboarding: () => null, ProjectDialog: () => null, QuickSwitcher: () => null }));
import { App } from '../src/renderer/src/App';

let root: Root; let host: HTMLDivElement; let focused: boolean;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  focused = true; fake.viewed.mockReset().mockResolvedValue(undefined); fake.events = [];
  fake.app = emptyState(); fake.app.settings.onboardingDone = true;
  fake.app.conversations = ['first', 'second'].map(id => ({ id, title: id, status: 'idle', options: {}, archived: false, createdAt: '', updatedAt: '' }));
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('only marks a conversation viewed while the app is focused on its conversation page', async () => {
  await act(async () => root.render(createElement(App)));
  expect(fake.viewed).toHaveBeenLastCalledWith('first');
  focused = false;
  await act(async () => window.dispatchEvent(new Event('blur')));
  expect(fake.viewed).toHaveBeenLastCalledWith(null);
  focused = true;
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(fake.viewed).toHaveBeenLastCalledWith('first');
  await act(async () => host.querySelector('button')!.click());
  expect(fake.viewed).toHaveBeenLastCalledWith(null);
  await act(async () => fake.events.forEach(cb => cb({ type: 'open_conversation', conversationId: 'second' })));
  expect(fake.viewed).toHaveBeenLastCalledWith('second');
});
