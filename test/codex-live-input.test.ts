import { expect, it, vi } from 'vitest';
import os from 'node:os';
import { CodexAdapter, CodexServer } from '../src/main/providers/codex';
import { TurnEndedError, type RunCallbacks, type RunParams } from '../src/main/providers/types';

function fixture() {
  const request = vi.fn(async (method: string, _params: any): Promise<any> => {
    if (method === 'thread/start') return { thread: { id: 'thread' } };
    if (method === 'turn/start') return { turn: { id: 'turn' } };
    return {};
  });
  const server = Object.assign(Object.create(CodexServer.prototype), { ready: Promise.resolve(), rpc: { request }, turns: new Map(), loaded: new Set(), ensureSandbox: async () => {} }) as CodexServer;
  const accepted = vi.fn();
  const cb: RunCallbacks = { onInputAccepted: accepted, onSession() {}, onItem() {}, onDelta() {}, onLog() {}, onUsage() {}, onContext() {}, requestApproval: async () => 'deny', requestAnswers: async () => null };
  const params = { cwd: os.tmpdir(), extraDirs: [], options: {}, text: 'Original question', attachments: [], cb } as unknown as RunParams;
  return { server, request, accepted, params };
}

it('steers the existing turn with its exact id, stable message id and attachments', async () => {
  const { server, request, accepted, params } = fixture();
  const run = await server.startTurn(params);
  await run.send!({ id: 'followup', text: 'Use the proposed name', attachments: [{ name: 'example.png', path: '/example.png', size: 10, kind: 'image' }] });
  expect(request).toHaveBeenLastCalledWith('turn/steer', {
    threadId: 'thread', expectedTurnId: 'turn', clientUserMessageId: 'followup',
    input: [{ type: 'text', text: expect.stringContaining('Use the proposed name'), text_elements: [] }, { type: 'localImage', path: '/example.png' }]
  });
  expect(accepted).toHaveBeenCalledWith('followup');
  expect(request.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1);
  (server as any).onNotification('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } });
  expect(await run.done).toEqual({ status: 'completed' });
  await expect(run.send!({ id: 'late', text: 'Too late', attachments: [] })).rejects.toBeInstanceOf(TurnEndedError);
});

it('only classifies a definite no-active-turn rejection as safe to defer', async () => {
  const { server, request, params } = fixture();
  const run = await server.startTurn(params);
  request.mockRejectedValueOnce(Object.assign(Error('no active turn'), { code: -32602 }));
  await expect(run.send!({ id: 'late', text: 'Follow-up', attachments: [] })).rejects.toBeInstanceOf(TurnEndedError);
  request.mockRejectedValueOnce(Object.assign(Error('Permission denied'), { code: -32602 }));
  await expect(run.send!({ id: 'blocked', text: 'Follow-up', attachments: [] })).rejects.not.toBeInstanceOf(TurnEndedError);
  await run.stop();
  await expect(run.send!({ id: 'stopped', text: 'Stop', attachments: [] })).rejects.toBeInstanceOf(TurnEndedError);
});

it('preserves exact MCP/plugin names and transports while disabling unselected integrations', async () => {
  const { server, request, params } = fixture();
  const effective = {
    mcp_servers: { datadog: { url: 'https://example.invalid/mcp', tool_timeout_sec: null, http_headers: null }, 'team.docs': { command: 'fixture', args: [], enabled: true } },
    plugins: { 'plugin.with.dots@example': { enabled: true, optional: null } }
  };
  request.mockImplementation(async method => {
    if (method === 'config/read') return { config: effective };
    if (method === 'thread/start') return { thread: { id: 'thread' } };
    return { turn: { id: 'turn' } };
  });
  params.tools = { connections: [], skills: [], plugins: [], accountMcpNames: ['datadog'] };
  await server.startTurn(params);
  const config = request.mock.calls.find(([method]) => method === 'thread/start')![1].config;
  expect(config.mcp_servers).toEqual({ datadog: { url: 'https://example.invalid/mcp', enabled: true }, 'team.docs': { command: 'fixture', args: [], enabled: false } });
  expect(config.plugins).toEqual({ 'plugin.with.dots@example': { enabled: false } });
  expect(Object.keys(config).some(key => key.includes('"'))).toBe(false);
  expect(effective.mcp_servers.datadog.tool_timeout_sec).toBeNull(); // No mutation of the account config.
});

it('rejects an account MCP selection that does not exist in that account', async () => {
  const { server, params } = fixture();
  params.tools = { connections: [], skills: [], plugins: [], accountMcpNames: ['another-account-server'] };
  await expect(server.startTurn(params)).rejects.toThrow('no longer configured for this account');
});

it('returns only native MCP metadata to the UI, without endpoint or credentials', async () => {
  const adapter = new CodexAdapter();
  (adapter as any).server = async () => ({ rpc: { request: async () => ({ config: { mcp_servers: {
    remote: { url: 'https://example.invalid/private', http_headers: { Authorization: 'fixture-private-value' }, enabled: true },
    local: { command: 'fixture', env: { PRIVATE_VALUE: 'fixture-private-value' }, enabled: false }
  } } }) } });
  const result = await adapter.listAccountMcp({} as any, os.tmpdir());
  expect(result).toEqual([{ name: 'local', transport: 'stdio', enabled: false }, { name: 'remote', transport: 'http', enabled: true }]);
  expect(JSON.stringify(result)).not.toMatch(/fixture-private-value|private|Authorization|PRIVATE_VALUE/);
});
