// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Sidebar } from '../src/renderer/src/components/Sidebar';
import { emptyState } from '../src/main/store';
import type { Conversation } from '../src/shared/types';

let root: Root; let host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });

it('distinguishes unread responses from Ready and keeps the project counter when collapsed', async () => {
  const app = emptyState();
  const conv = (id: string, unread: boolean, projectId?: string): Conversation => ({ id, title: id, accountId: 'fixture', projectId, unread, status: 'idle', options: {}, archived: false, createdAt: '', updatedAt: '' });
  app.projects = [{ id: 'project', name: 'Example', folders: [], createdAt: '' }];
  app.conversations = [conv('Standalone response', true), conv('Project response', true, 'project'), conv('Read response', false, 'project')];
  const onSelect = vi.fn(), onToggleNotifications = vi.fn();
  await act(async () => root.render(createElement(Sidebar, {
    app, page: 'conversation', activeId: 'Read response', onSelect, onToggleNotifications,
    onAutomations() {}, onIntegrations() {}, onNewConversation() {}, onNewProject() {}, onEditProject() {}, onOpenAccounts() {}, onSearch() {}, onToggleTheme() {}
  })));
  expect(host.querySelectorAll('.conv-item.unread')).toHaveLength(2);
  expect(host.querySelectorAll('.unread-indicator')).toHaveLength(2);
  expect(host.querySelectorAll('.conv-item [aria-label="Ready"]')).toHaveLength(3);
  const unread = host.querySelector<HTMLButtonElement>('button[aria-label^="Project response"]')!;
  expect(unread.getAttribute('aria-label')).toContain('unread response');
  await act(async () => unread.click()); expect(onSelect).toHaveBeenCalledWith('Project response');
  const toggle = host.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  await act(async () => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(toggle.querySelector('.unread-count')?.textContent).toBe('1');
  const bell = host.querySelector<HTMLButtonElement>('[aria-label="Desktop notifications"]')!;
  expect(bell.getAttribute('aria-pressed')).toBe('true');
  await act(async () => bell.click()); expect(onToggleNotifications).toHaveBeenCalledOnce();
});
