import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimePath } from '../src/main/runtime-path';
import { providerEnv } from '../src/main/env';

it('adds existing user runtime directories without losing inherited PATH or changing account isolation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ailo-path-'));
  const bin = process.platform === 'win32' ? path.join(root, 'Programs', 'PowerShell', '7') : path.join(root, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const base = process.platform === 'win32' ? { LOCALAPPDATA: root, Path: 'existing-bin', CODEX_HOME: 'wrong' } : { HOME: root, PATH: 'existing-bin', CODEX_HOME: 'wrong' };
  expect(runtimePath(base).split(path.delimiter)).toEqual([bin, 'existing-bin']);
  const env = providerEnv('codex', 'account-home', base);
  expect(env.Path ?? env.PATH).toBe([bin, 'existing-bin'].join(path.delimiter));
  expect(env.CODEX_HOME).toBe('account-home');
  expect(base.CODEX_HOME).toBe('wrong');
});
