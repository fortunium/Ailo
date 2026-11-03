import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { commandOutputNotice } from '../src/shared/command-diagnostics';
import { mapItem } from '../src/main/providers/codex';
import { runtimeInstructions } from '../src/main/providers/runtime-instructions';
import { TerminalTranscript } from '../src/renderer/src/components/Transcript';
import type { ChatItem } from '../src/shared/types';

vi.mock('../src/renderer/src/api', () => ({ api: {} }));

it('shows a warning when an earlier native command failed inside a successful combined command', () => {
  const item = mapItem({ type: 'commandExecution', id: 'fixture', command: 'combined check', status: 'completed', exitCode: 0, aggregatedOutput: 'rg: optional-dir: Missing path (os error 2)\nLater command succeeded.' }, true)!;
  expect(item).toMatchObject({ status: 'done', exitCode: 0 });
  const html = renderToStaticMarkup(createElement(TerminalTranscript, { conversationId: 'fixture', items: [item] }));
  expect(html).toContain('completed; check output');
  expect(html).toContain('exit 0');
  expect(html).toContain('Output contains error diagnostics');
});

it('honors a nonzero process exit even when a provider labels execution completed', () => {
  expect(mapItem({ type: 'commandExecution', id: 'fixture', command: 'check', status: 'completed', exitCode: 2 }, true)).toMatchObject({ status: 'failed', exitCode: 2 });
});

it('distinguishes reported diagnostics, dependency warnings, and ordinary output', () => {
  expect(commandOutputNotice('Get-CimInstance:\nLine |\n 2 | Query\nAccess denied')).toContain('error diagnostics');
  expect(commandOutputNotice('CategoryInfo : NotSpecified\nFullyQualifiedErrorId : PermissionDenied')).toContain('error diagnostics');
  expect(commandOutputNotice('project.csproj : warning NU1903: dependency advisory')).toContain('warnings');
  expect(commandOutputNotice('Error count: 0\nconst error = new Error("example");')).toBeUndefined();
});

it('shows a stopped check without asserting that it failed or passed', () => {
  const item: ChatItem = { kind: 'tool', id: 'fixture', title: 'Command', subtitle: 'test', status: 'interrupted', at: '' };
  const html = renderToStaticMarkup(createElement(TerminalTranscript, { conversationId: 'fixture', items: [item] }));
  expect(html).toContain('Stopped · no final result');
  expect(html).not.toContain('aria-label="failed"');
});

it('gives Windows-specific execution guidance without prescribing it on Linux', () => {
  expect(runtimeInstructions('win32')).toContain('Get-Command pwsh');
  expect(runtimeInstructions('win32')).toContain('$LASTEXITCODE');
  expect(runtimeInstructions('win32')).toContain('do not bypass restrictions');
  expect(runtimeInstructions('linux')).not.toContain('PowerShell');
});
