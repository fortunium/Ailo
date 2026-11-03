// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ApprovalControls } from '../src/renderer/src/components/ApprovalControls';
import type { Settings } from '../src/shared/types';

const { setSettings } = vi.hoisted(() => ({ setSettings: vi.fn() }));
vi.mock('../src/renderer/src/api', () => ({ api: { setSettings } }));
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  setSettings.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
async function render(approvalMode?: Settings['approvalMode'], report = false) {
  await act(async () => root.render(createElement(ApprovalControls, { settings: { theme: 'system', onboardingDone: true, approvalMode }, report })));
  return host.querySelector('select')!;
}
async function choose(select: HTMLSelectElement, mode: string) {
  await act(async () => { select.value = mode; select.dispatchEvent(new Event('change', { bubbles: true })); });
}

it('defaults to Ask, explains the scope and saves the persistent choice', async () => {
  const select = await render();
  expect(select.value).toBe('ask');
  expect(select.getAttribute('aria-description')).toContain('all conversations');
  await choose(select, 'always');
  expect(setSettings).toHaveBeenCalledExactlyOnceWith({ approvalMode: 'always' });
  await render('always');
  expect(host.querySelector('.auto-approve')).not.toBeNull();
  await choose(select, 'ask');
  expect(setSettings).toHaveBeenLastCalledWith({ approvalMode: 'ask' });
});

it('shows errors and lets the user retry saving', async () => {
  setSettings.mockRejectedValueOnce(new Error('Unable to save settings.'));
  const select = await render();
  await choose(select, 'always');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Unable to save settings.');
  expect(select.disabled).toBe(false);
  await choose(select, 'always');
  expect(setSettings).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('shows read-only permissions for report conversations even when Always allow is enabled', async () => {
  const select = await render('always', true);
  expect(select.disabled).toBe(true);
  expect(select.selectedOptions[0].textContent).toBe('Read only');
  expect(host.querySelector('.auto-approve')).toBeNull();
});
