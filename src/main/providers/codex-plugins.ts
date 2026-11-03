import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { LocalPlugin } from '../../shared/types';
import { providerEnv } from '../env';
import { redact } from '../redact';

const exec = promisify(execFile);
const installations = new Map<string, Promise<void>>();
export const codexPluginId = (plugin: LocalPlugin) => `${plugin.name}@ailo-${plugin.id.replaceAll('-', '')}`;

async function command(bin: string, home: string, args: string[]) {
  try {
    const { stdout } = await exec(bin, args, { cwd: home, env: providerEnv('codex', home), windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (e) {
    const error = e as Error & { killed?: boolean; stderr?: string };
    const detail = error.killed ? 'Timed out after 60 seconds.' : error.stderr?.trim() || error.message;
    throw new Error(`Codex plugin setup failed (${args.join(' ')}): ${redact(detail)}`);
  }
}
export async function installCodexPlugins(bin: string, home: string, plugins: LocalPlugin[]): Promise<string[]> {
  // `plugin list` may contact remote marketplaces. A conversation with no
  // selected plugins must not depend on that network request succeeding.
  // The adapter disables the plugin feature for these conversations instead.
  if (!plugins.length) return [];
  for (const plugin of plugins) {
    const key = home + ':' + plugin.id + ':' + plugin.digest;
    let pending = installations.get(key);
    if (!pending) {
      pending = (async () => {
        await command(bin, home, ['plugin', 'marketplace', 'add', path.dirname(plugin.path), '--json']);
        await command(bin, home, ['plugin', 'add', codexPluginId(plugin), '--json']);
      })();
      installations.set(key, pending);
      pending.catch(() => installations.delete(key));
    }
    await pending;
  }
  const listed = await command(bin, home, ['plugin', 'list', '--json']);
  return (listed.installed ?? []).map((p: any) => p.pluginId as string);
}
