// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccountMcp } from '../src/renderer/src/components/AccountMcp';

const fake = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../src/renderer/src/api', () => ({ api: { listAccountMcp: fake.list } }));
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  fake.list.mockReset().mockResolvedValue([{ name: 'datadog', transport: 'http', enabled: true }]);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });

it('shows native account connections and permits explicit selection without another OAuth login', async () => {
  const change = vi.fn();
  await act(async () => root.render(createElement(AccountMcp, { accountId: 'account-a', onChange: change })));
  expect(fake.list).toHaveBeenCalledWith('account-a');
  expect(host.textContent).toContain('datadog'); expect(host.textContent).toContain('existing configuration and sign-in');
  await act(async () => host.querySelector<HTMLInputElement>('input')!.click());
  expect(change).toHaveBeenCalledExactlyOnceWith(['datadog']);
});

it('does not show stale results from a previously selected account', async () => {
  let first!: (value: unknown) => void;
  fake.list.mockImplementationOnce(() => new Promise(resolve => { first = resolve; }));
  await act(async () => root.render(createElement(AccountMcp, { accountId: 'account-a' })));
  fake.list.mockResolvedValueOnce([{ name: 'other-server', transport: 'stdio', enabled: true }]);
  await act(async () => root.render(createElement(AccountMcp, { accountId: 'account-b' })));
  await act(async () => first([{ name: 'datadog', transport: 'http', enabled: true }]));
  expect(host.textContent).toContain('other-server'); expect(host.textContent).not.toContain('datadog');
});

it('keeps selection disabled in report mode and shows discovery errors with a retry', async () => {
  await act(async () => root.render(createElement(AccountMcp, { accountId: 'account-a', disabled: true, onChange() {} })));
  expect(host.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
  fake.list.mockRejectedValueOnce(new Error('Unable to read account configuration.'));
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Unable to read account configuration.');
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).toContain('datadog');
});
