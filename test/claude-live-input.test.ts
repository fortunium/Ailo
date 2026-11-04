import { beforeEach, expect, it, vi } from 'vitest';
import os from 'node:os';
import { InputQueue } from '../src/main/providers/input-queue';
import { ClaudeAdapter } from '../src/main/providers/claude';
import { TurnEndedError, type RunCallbacks, type RunParams } from '../src/main/providers/types';

const fake = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: fake.query }));
vi.mock('../src/main/cli', () => ({ detectCli: async () => ({ found: true, path: 'fixture-cli' }) }));
let messages: any[], events: InputQueue<any>;
let close = vi.fn<() => void>(), accepted = vi.fn<(id?: string) => void>(), context = vi.fn<(usage: unknown) => void>();
beforeEach(() => {
  messages = []; events = new InputQueue(); close = vi.fn(() => events.close()); accepted = vi.fn<(id?: string) => void>(); context = vi.fn<(usage: unknown) => void>();
  fake.query.mockReset().mockImplementation(({ prompt, options }) => {
    void (async () => { for await (const input of prompt) messages.push(input); })();
    options.abortController.signal.addEventListener('abort', () => events.close(), { once: true });
    return { [Symbol.asyncIterator]: () => events[Symbol.asyncIterator](), close, interrupt: async () => undefined };
  });
});
function params(): RunParams {
  const cb: RunCallbacks = { onInputAccepted: accepted, onContext: context, onSession() {}, onItem() {}, onDelta() {}, onLog() {}, onUsage() {}, requestApproval: async () => 'deny', requestAnswers: async () => null };
  return { account: { provider: 'claude', connection: { state: 'connected' } }, home: os.tmpdir(), cwd: os.tmpdir(), extraDirs: [], options: {}, text: 'Original question', attachments: [], cb } as unknown as RunParams;
}
const result = (ids?: string[]) => ({ type: 'result', subtype: 'success', result: 'Done', ...(ids ? { user_message_uuid: ids.at(-1), user_message_uuids: ids } : {}) });

it('keeps the query alive after the first result until the follow-up also finishes', async () => {
  const run = await new ClaudeAdapter().runTurn(params());
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  const first = messages[0].uuid;
  await run.send!({ id: 'followup', text: 'Use the proposed name', attachments: [] });
  await vi.waitFor(() => expect(messages).toHaveLength(2));
  expect(messages[1]).toMatchObject({ uuid: 'followup', message: { content: [{ type: 'text', text: 'Use the proposed name' }] } });
  let finished = false; void run.done.then(() => { finished = true; });
  events.push(result([first]));
  await vi.waitFor(() => expect(context).toHaveBeenCalledTimes(1));
  expect(finished).toBe(false); expect(close).not.toHaveBeenCalled();
  events.push(result(['followup']));
  expect(await run.done).toEqual({ status: 'completed' });
  expect(accepted).toHaveBeenCalledWith('followup'); expect(close).toHaveBeenCalledOnce();
  await expect(run.send!({ id: 'late', text: 'Late', attachments: [] })).rejects.toBeInstanceOf(TurnEndedError);
});

it('handles several user messages merged into one provider result', async () => {
  const run = await new ClaudeAdapter().runTurn(params());
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  await run.send!({ id: 'followup', text: 'A clarification', attachments: [] });
  events.push(result([messages[0].uuid, 'followup']));
  expect(await run.done).toEqual({ status: 'completed' });
  expect(accepted).toHaveBeenCalledWith('followup');
});

it('supports older results without message ids and closes queued input on Stop', async () => {
  const run = await new ClaudeAdapter().runTurn(params());
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  await run.send!({ id: 'followup', text: 'A clarification', attachments: [] });
  events.push(result());
  await vi.waitFor(() => expect(context).toHaveBeenCalledOnce());
  await run.stop(); expect(await run.done).toEqual({ status: 'interrupted' });
  expect(accepted).not.toHaveBeenCalledWith('followup');
});
