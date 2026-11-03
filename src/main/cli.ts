// Locates the provider CLIs. On Windows the npm `codex` command is a .cmd shim;
// we resolve the real codex.exe so stopping a run reaches the actual process.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import type { CliInfo, ProviderId } from '../shared/types';

const isWin = process.platform === 'win32';

function which(cmd: string): string[] {
  const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  const out: string[] = [];
  // Desktop launchers on Linux often omit the user's CLI install directories.
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.npm-global', 'bin')];
  if (isWin && process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm'));
  for (const dir of new Set(dirs)) {
    if (!dir) continue;
    for (const ext of isWin ? ['', ...exts] : ['']) {
      const p = path.join(dir, cmd + ext);
      try {
        if (fs.statSync(p).isFile()) out.push(p);
      } catch {
        /* not here */
      }
    }
  }
  return out;
}

function version(bin: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 15000, windowsHide: true }, (err, stdout) => {
      resolve(err ? undefined : stdout.trim().split('\n')[0]);
    });
  });
}

function codexVendorBinary(shimPath: string): string | undefined {
  // <prefix>/codex(.cmd) -> <prefix>/node_modules/@openai/codex/...
  const pkgRoot = path.join(path.dirname(shimPath), 'node_modules', '@openai', 'codex');
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const triple = { win32: `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`, darwin: `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`, linux: `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl` }[process.platform as 'win32'];
  const candidates = [
    path.join(pkgRoot, 'node_modules', '@openai', `codex-${process.platform}-${arch}`, 'vendor', triple, 'bin', isWin ? 'codex.exe' : 'codex'),
    path.join(pkgRoot, 'vendor', triple, 'codex', isWin ? 'codex.exe' : 'codex')
  ];
  return candidates.find((c) => fs.existsSync(c));
}

function bundledClaude(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const dir = path.dirname(require.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`));
    const p = path.join(dir, isWin ? 'claude.exe' : 'claude');
    return fs.existsSync(p) ? p : undefined;
  } catch {
    return undefined;
  }
}

async function detectCodex(): Promise<CliInfo> {
  const override = process.env.AILO_CODEX_PATH;
  const hits = override ? [override] : which('codex');
  for (const hit of hits) {
    // Prefer the native binary behind an npm launcher; a direct .exe is used as-is.
    const bin = hit.toLowerCase().endsWith('.exe') ? hit : codexVendorBinary(hit) ?? (isWin ? undefined : hit);
    if (!bin) continue;
    const v = await version(bin);
    if (v) return { provider: 'codex', found: true, path: bin, version: v, source: override ? 'AILO_CODEX_PATH' : 'PATH' };
  }
  return {
    provider: 'codex',
    found: false,
    error: 'Codex CLI not found. Install it with: npm install -g @openai/codex — then restart Ailo.'
  };
}

async function detectClaude(): Promise<CliInfo> {
  const override = process.env.AILO_CLAUDE_PATH;
  const hits = override ? [override] : which('claude').filter((h) => !isWin || h.toLowerCase().endsWith('.exe'));
  for (const hit of hits) {
    const v = await version(hit);
    if (v) return { provider: 'claude', found: true, path: hit, version: v, source: override ? 'AILO_CLAUDE_PATH' : 'PATH' };
  }
  const bundled = bundledClaude();
  if (bundled) {
    const v = await version(bundled);
    if (v) return { provider: 'claude', found: true, path: bundled, version: v, source: 'bundled with the Agent SDK' };
  }
  return {
    provider: 'claude',
    found: false,
    error: 'Claude Code not found. Install it from https://code.claude.com/docs/en/setup, then restart Ailo.'
  };
}

const cache = new Map<ProviderId, Promise<CliInfo>>();

export function detectCli(provider: ProviderId, refresh = false): Promise<CliInfo> {
  if (refresh || !cache.has(provider)) cache.set(provider, provider === 'codex' ? detectCodex() : detectClaude());
  return cache.get(provider)!;
}
