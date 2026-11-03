import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ConnectionCredentials, ConnectionInput, ConnectionTest, LocalPlugin, McpConnection, ToolSnapshot } from '../shared/types';
import { redact } from './redact';

export function connectionName(id: string): string { return 'ailo_' + id.replaceAll('-', ''); }

export function validateConnection(input: ConnectionInput): void {
  if (!input.name?.trim() || !input.identity?.trim()) throw new Error('Give the connection a name and an external identity label.');
  if (!input.providers?.length || input.providers.some((p) => !['codex', 'claude'].includes(p))) throw new Error('Choose at least one supported provider.');
  if (input.transport === 'http') {
    const url = new URL(input.url ?? '');
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error('Use HTTPS, or HTTP on localhost. Put credentials in the credentials field.');
  } else if (input.transport === 'stdio') {
    if (!input.command?.trim() || input.args?.some((a) => typeof a !== 'string')) throw new Error('Provide an executable and an array of arguments.');
  } else throw new Error('Unsupported MCP transport.');
  if (input.enabledTools?.some((t) => typeof t !== 'string' || !t.trim())) throw new Error('Invalid tool names.');
  const creds = input.credentials;
  if (creds) {
    if (creds.bearerToken !== undefined && typeof creds.bearerToken !== 'string') throw new Error('Invalid bearer token.');
    for (const entries of [creds.env, creds.headers]) if (entries && (Array.isArray(entries) || Object.values(entries).some((v) => typeof v !== 'string'))) throw new Error('Credentials must contain string values.');
  }
}

export function secretValues(credentials: Record<string, ConnectionCredentials>): string[] {
  return Object.values(credentials).flatMap((c) => [c.bearerToken, c.oauth?.tokens?.access_token, c.oauth?.tokens?.refresh_token, c.oauth?.client && 'client_secret' in c.oauth.client ? String(c.oauth.client.client_secret) : undefined, ...Object.values(c.headers ?? {}), ...Object.values(c.env ?? {})]).filter((x): x is string => !!x).sort((a, b) => b.length - a.length);
}
export function hideSecrets(text: string, values: string[]): string {
  let result = text;
  for (const value of values) result = result.split(value).join('[secret]');
  return redact(result);
}

export async function probeConnection(connection: McpConnection, credentials: ConnectionCredentials): Promise<ConnectionTest> {
  const client = new Client({ name: 'ailo', version: '0.1.0' });
  const headers = { ...credentials.headers, ...(credentials.bearerToken ? { Authorization: `Bearer ${credentials.bearerToken}` } : {}) };
  const transport = connection.transport === 'http'
    ? new StreamableHTTPClientTransport(new URL(connection.url!), { requestInit: { headers } })
    : new StdioClientTransport({ command: connection.command!, args: connection.args, env: credentials.env, stderr: 'ignore' });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    await client.connect(transport, { timeout: 15000, signal: abort.signal });
    const tools: ConnectionTest['tools'] = [];
    let cursor: string | undefined;
    do {
      const result = await client.listTools({ cursor }, { timeout: 10000, signal: abort.signal });
      tools.push(...result.tools.map((t) => ({ name: t.name, description: t.description })));
      cursor = result.nextCursor;
    } while (cursor && tools.length < 1000);
    return { ok: true, tools, checkedAt: new Date().toISOString() };
  } catch (error) {
    return { ok: false, tools: [], error: hideSecrets((error as Error).message, secretValues({ test: credentials })), checkedAt: new Date().toISOString() };
  } finally { clearTimeout(timer); await client.close().catch(() => {}); await transport.close().catch(() => {}); }
}

/** Snapshot a reviewed local plugin. Updates are new imports; running tasks keep the old version. */
export function importLocalPlugin(root: string, source: string): LocalPlugin {
  const sourceRoot = fs.realpathSync(source);
  const claudeManifest = path.join(sourceRoot, '.claude-plugin', 'plugin.json');
  const codexManifest = path.join(sourceRoot, '.codex-plugin', 'plugin.json');
  const manifestFile = [claudeManifest, codexManifest, path.join(sourceRoot, 'plugin.json')].find((p) => fs.existsSync(p));
  if (!manifestFile) throw new Error('Choose a plugin folder containing a plugin.json manifest.');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(manifest.name ?? '')) throw new Error('The plugin needs a valid name in its manifest.');
  const hash = createHash('sha256');
  let size = 0;
  function inspect(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const file = path.join(dir, entry.name);
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Plugin snapshots cannot contain symbolic links.');
      if (entry.isDirectory()) inspect(file);
      else if (entry.isFile()) {
        size += fs.statSync(file).size;
        if (size > 50 * 1024 * 1024) throw new Error('Plugin snapshots must be smaller than 50 MB.');
        hash.update(path.relative(sourceRoot, file)); hash.update(fs.readFileSync(file));
      } else throw new Error('Unsupported entry in plugin folder.');
    }
  }
  inspect(sourceRoot);
  const id = randomUUID();
  const marketplaceRoot = path.join(root, 'plugins', id);
  const target = path.join(marketplaceRoot, 'package');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(sourceRoot, target, { recursive: true, filter: (p) => path.basename(p) !== '.git' });
  fs.mkdirSync(path.join(marketplaceRoot, '.agents', 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(marketplaceRoot, '.agents', 'plugins', 'marketplace.json'), JSON.stringify({ name: 'ailo-' + id.replaceAll('-', ''), plugins: [{ name: manifest.name, source: { source: 'local', path: './package' } }] }));
  const components = ['skills', 'commands', 'agents', 'hooks', '.mcp.json'].filter((name) => fs.existsSync(path.join(target, name)) || manifest[name] || (name === '.mcp.json' && manifest.mcpServers));
  return { id, name: manifest.name, version: String(manifest.version ?? 'unversioned'), description: String(manifest.description ?? ''), path: target,
    providers: fs.existsSync(claudeManifest) ? ['claude', 'codex'] : ['codex'], components, digest: hash.digest('hex'), createdAt: new Date().toISOString() };
}

export function codexMcpConfig(tools: ToolSnapshot, credentials: Record<string, ConnectionCredentials>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const c of tools.connections) {
    const secret = credentials[c.id] ?? {};
    config[`mcp_servers.${connectionName(c.id)}`] = c.transport === 'stdio'
      ? { command: c.command, args: c.args ?? [], env: secret.env ?? {}, enabled: true, required: true, ...(c.enabledTools?.length ? { enabled_tools: c.enabledTools } : {}) }
      : { url: c.url, http_headers: { ...secret.headers, ...(secret.bearerToken ? { Authorization: `Bearer ${secret.bearerToken}` } : {}) }, enabled: true, required: true, ...(c.enabledTools?.length ? { enabled_tools: c.enabledTools } : {}) };
  }
  return config;
}

export function claudeMcpConfig(tools: ToolSnapshot, credentials: Record<string, ConnectionCredentials>) {
  return Object.fromEntries(tools.connections.map((c) => {
    const secret = credentials[c.id] ?? {};
    return [connectionName(c.id), c.transport === 'stdio'
      ? { type: 'stdio' as const, command: c.command!, args: c.args ?? [], env: secret.env }
      : { type: 'http' as const, url: c.url!, headers: { ...secret.headers, ...(secret.bearerToken ? { Authorization: `Bearer ${secret.bearerToken}` } : {}) } }];
  }));
}

export function pluginMcpConfig(plugins: LocalPlugin[]): Record<string, any> {
  const servers: Record<string, any> = {};
  for (const plugin of plugins) {
    const manifestPath = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'plugin.json'].map((p) => path.join(plugin.path, p)).find((p) => fs.existsSync(p));
    const manifest = manifestPath ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
    const declarations = manifest.mcpServers ?? (fs.existsSync(path.join(plugin.path, '.mcp.json')) ? './.mcp.json' : undefined);
    const expand = (value: any): any => typeof value === 'string' ? value.replaceAll('${CLAUDE_PLUGIN_ROOT}', plugin.path).replaceAll('${CODEX_PLUGIN_ROOT}', plugin.path).replaceAll('${PLUGIN_ROOT}', plugin.path) : Array.isArray(value) ? value.map(expand) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)])) : value;
    for (const declaration of Array.isArray(declarations) ? declarations : declarations ? [declarations] : []) {
      let config = declaration;
      if (typeof declaration === 'string') {
        const file = path.resolve(plugin.path, declaration);
        if (!file.startsWith(path.resolve(plugin.path) + path.sep)) throw new Error('Plugin MCP configuration must stay inside its pinned folder.');
        config = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
      for (const [name, server] of Object.entries(config.mcpServers ?? config)) servers[`plugin_${plugin.name}_${name}`] = expand(server);
    }
  }
  return servers;
}
