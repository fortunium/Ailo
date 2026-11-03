import fs from 'node:fs';
import path from 'node:path';

/** GUI launches may have an old or minimal PATH. Never change the OS setting. */
export function runtimePath(env: NodeJS.ProcessEnv = process.env): string {
  const inherited = env.PATH ?? (process.platform === 'win32' ? Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] : undefined) ?? '';
  const extras = process.platform === 'win32'
    ? [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'PowerShell', '7'), env.ProgramFiles && path.join(env.ProgramFiles, 'PowerShell', '7')]
    : [env.HOME && path.join(env.HOME, '.local', 'bin'), env.HOME && path.join(env.HOME, '.npm-global', 'bin')];
  return [...new Set([...extras.filter((p): p is string => !!p && fs.existsSync(p)), ...inherited.split(path.delimiter)])].filter(Boolean).join(path.delimiter);
}
