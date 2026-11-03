// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConversationLinkContext, Markdown } from '../src/renderer/src/components/Markdown';

const { preview, show, external } = vi.hoisted(() => ({ preview: vi.fn(), show: vi.fn(), external: vi.fn() }));
vi.mock('../src/renderer/src/api', () => ({ api: { previewConversationFile: preview, showConversationFile: show, openExternal: external } }));
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  preview.mockReset().mockResolvedValue({ path: 'C:/project/report.ps1', name: 'report.ps1', text: 'Write-Output "Example"' });
  show.mockReset().mockResolvedValue(undefined); external.mockReset().mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
async function link(text: string) {
  await act(async () => root.render(createElement(ConversationLinkContext.Provider, { value: 'conversation' }, createElement(Markdown, { text }))));
  const anchor = host.querySelector('a')!;
  await act(async () => anchor.click());
  return anchor;
}

it('keeps Windows file links clickable and shows their contents in a preview', async () => {
  const anchor = await link('[Report](C:/project/report.ps1)');
  expect(anchor.getAttribute('href')).toBe('C:/project/report.ps1');
  expect(preview).toHaveBeenCalledWith('conversation', 'C:/project/report.ps1');
  expect(host.querySelector('dialog')?.open).toBe(true);
  expect(host.textContent).toContain('Write-Output');
  const button = [...host.querySelectorAll('button')].find(b => b.textContent === 'Show in folder')!;
  await act(async () => button.click());
  expect(show).toHaveBeenCalledWith('conversation', 'C:/project/report.ps1');
  expect(external).not.toHaveBeenCalled();
});

it('routes web links to the browser and makes missing-file errors visible', async () => {
  await link('[Website](https://example.com)');
  expect(external).toHaveBeenCalledWith('https://example.com');
  expect(preview).not.toHaveBeenCalled();
  preview.mockRejectedValueOnce(new Error('File not found.'));
  await link('[Missing](missing.md)');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('File not found.');
});

it('does not pass javascript URLs through to the opener', async () => {
  await link('[Unsafe](javascript:alert%281%29)');
  expect(preview).not.toHaveBeenCalled();
  expect(external).not.toHaveBeenCalled();
});
