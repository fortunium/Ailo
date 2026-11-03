import { expect, it, vi } from 'vitest';
import os from 'node:os';
import { CodexServer } from '../src/main/providers/codex';
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
