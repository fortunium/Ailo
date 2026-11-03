// Claude Code via the official Claude Agent SDK. Each account has its own
// CLAUDE_CONFIG_DIR (the documented way to stay signed in to several accounts).
// The SDK's `env` option replaces the subprocess environment entirely, so the
// process only sees that one config directory.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { query, type Query, type CanUseTool, type PermissionUpdate, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Account, AccountConnection, AccountUsage, LoginProgress, ModelCatalog, Question } from '../../shared/types';
import { attachmentPrompt, imageMime } from '../attachments';
import { claudeMcpConfig, connectionName, pluginMcpConfig } from '../integrations';
import { handleElicitation } from './elicitation';
import { detectCli } from '../cli';
import { claudeTaskActivity } from './claude-activity';
import { runtimeInstructions } from './runtime-instructions';
import { providerEnv } from '../env';
import { redact, stripAnsi } from '../redact';
import { looksLikeAuthProblem, ProviderError, TurnEndedError, type LiveInput, type LoginHandle, type ProviderAdapter, type RunHandle, type RunOutcome, type RunParams } from './types';
import { InputQueue } from './input-queue';

const now = () => new Date().toISOString();

export function claudeUsage(result: any): AccountUsage | undefined {
  if (!result?.rate_limits_available || !result.rate_limits) return undefined;
  const limits = result.rate_limits;
  const labels: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly', seven_day_opus: 'Weekly Opus', seven_day_sonnet: 'Weekly Sonnet', seven_day_oauth_apps: 'Weekly apps' };
  const windows = Object.entries(labels).flatMap(([key, label]) => Number.isFinite(limits[key]?.utilization) ? [{ label, usedPercent: limits[key].utilization, resetsAt: limits[key].resets_at ?? undefined }] : []);
  for (const row of limits.model_scoped ?? []) if (Number.isFinite(row.utilization)) windows.push({ label: `Weekly ${row.display_name}`, usedPercent: row.utilization, resetsAt: row.resets_at ?? undefined });
  return { windows, source: 'experimental', updatedAt: now() };
}

async function claudeBin(): Promise<string> {
  const cli = await detectCli('claude');
  if (!cli.found || !cli.path) throw new ProviderError(cli.error ?? 'Claude Code not found');
  return cli.path;
}

function runCli(bin: string, args: string[], home: string, timeoutMs = 20000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { env: providerEnv('claude', home), windowsHide: true });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on('error', (err) => {
      clearTimeout(t);
      resolve({ code: -1, stdout, stderr: err.message });
    });
    p.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

// Phrases for permission prompts: "Claude wants to …".
const TOOL_ACTIONS: Record<string, string> = {
  Bash: 'run a command',
  PowerShell: 'run a PowerShell command',
  Read: 'read a file',
  Write: 'write a file',
  Edit: 'edit a file',
  MultiEdit: 'edit a file',
  NotebookEdit: 'edit a notebook',
  WebFetch: 'fetch a web page',
  WebSearch: 'search the web'
};

const TOOL_TITLES: Record<string, string> = {
  Bash: 'Command',
  PowerShell: 'Command (PowerShell)',
  Read: 'Read file',
  Write: 'Write file',
  Edit: 'Edit file',
  MultiEdit: 'Edit file',
  NotebookEdit: 'Edit notebook',
  Glob: 'Find files',
  Grep: 'Search code',
  WebFetch: 'Fetch web page',
  WebSearch: 'Web search',
  TodoWrite: 'Update task list',
  Task: 'Subagent',
  Agent: 'Subagent'
};

function toolSubtitle(input: any): string | undefined {
  return input?.command ?? input?.file_path ?? input?.notebook_path ?? input?.pattern ?? input?.url ?? input?.query ?? input?.description;
}

function editDiff(name: string, input: any): { path: string; change: string; diff: string }[] | undefined {
  const lines = (s: string, sign: string) => (s ?? '').split('\n').map((l) => sign + l).join('\n');
  if (name === 'Edit') return [{ path: input.file_path, change: 'update', diff: `${lines(input.old_string, '-')}\n${lines(input.new_string, '+')}` }];
  if (name === 'MultiEdit') return [{ path: input.file_path, change: 'update', diff: (input.edits ?? []).map((e: any) => `${lines(e.old_string, '-')}\n${lines(e.new_string, '+')}`).join('\n@@\n') }];
  if (name === 'Write') return [{ path: input.file_path, change: 'add', diff: lines(input.content, '+') }];
  return undefined;
}

function resultText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n');
  return '';
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly id = 'claude' as const;
  private logins = new Map<string, () => void>();

  initHome(home: string): void {
    fs.mkdirSync(home, { recursive: true });
  }

  async checkAccount(_account: Account, home: string): Promise<AccountConnection> {
    const checkedAt = now();
    try {
      const bin = await claudeBin();
      this.initHome(home);
      const r = await runCli(bin, ['auth', 'status'], home);
      let j: any;
      try {
        j = JSON.parse(r.stdout);
      } catch {
        return { state: 'error', message: redact(stripAnsi(r.stderr || r.stdout).trim()) || 'Unknown status', checkedAt };
      }
      if (!j.loggedIn) return { state: 'signed_out', checkedAt };
      if (j.authMethod && j.authMethod !== 'claude.ai') {
        return { state: 'error', message: `Unexpected sign-in method "${j.authMethod}" in the account directory. Ailo only uses claude.ai subscriptions.`, checkedAt };
      }
      const plan = j.subscriptionType ? `Claude ${j.subscriptionType[0].toUpperCase()}${j.subscriptionType.slice(1)}` : undefined;
      return { state: 'connected', email: j.email, plan, organization: j.orgName, checkedAt };
    } catch (err) {
      return { state: 'error', message: (err as Error).message, checkedAt };
    }
  }

  async startLogin(account: Account, home: string, onProgress: (p: LoginProgress) => void): Promise<LoginHandle> {
    const bin = await claudeBin();
    this.initHome(home);
    const p = spawn(bin, ['auth', 'login', '--claudeai'], { env: providerEnv('claude', home), windowsHide: true });
    let buf = '';
    let announced = false;
    const onData = (d: Buffer) => {
      buf += stripAnsi(String(d));
      const url = buf.match(/https:\/\/\S+/)?.[0];
      if (url && !announced) {
        announced = true;
        onProgress({ stage: 'started', url, acceptsCode: true });
      }
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    const done = new Promise<void>((resolve, reject) => {
      p.on('error', (err) => reject(new ProviderError(err.message)));
      p.on('close', (code) => {
        this.logins.delete(account.id);
        if (code === 0) resolve();
        else reject(new ProviderError(redact(buf.split('\n').filter((l) => /error|fail|invalid/i.test(l)).join(' ').trim()) || `Sign-in aborted (code ${code})`));
      });
    });
    const cancel = () => p.kill();
    this.logins.set(account.id, cancel);
    return { done, cancel, submitCode: (code) => p.stdin.write(code.trim() + '\n') };
  }

  async logout(_account: Account, home: string): Promise<void> {
    const bin = await claudeBin();
    await runCli(bin, ['auth', 'logout'], home);
  }

  /** Hold input open without sending a prompt: these control requests make no model call. */
  private async metadata<T>(home: string, read: (q: Query) => Promise<T>): Promise<T> {
    const bin = await claudeBin();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    async function* empty(): AsyncGenerator<SDKUserMessage> { await held; }
    const abort = new AbortController();
    const q = query({ prompt: empty(), options: { env: providerEnv('claude', home), pathToClaudeCodeExecutable: bin, permissionMode: 'default', abortController: abort } });
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([read(q), new Promise<never>((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('Claude metadata request timed out.')); }, 20000); })]);
    } finally { clearTimeout(timer); release(); q.close(); }
  }

  async listModels(_account: Account, home: string): Promise<ModelCatalog> {
    return this.metadata(home, async (q) => ({
      models: (await q.supportedModels()).map((m, i) => ({ id: m.value, label: m.displayName, description: m.description, efforts: m.supportedEffortLevels ?? [], fast: !!m.supportsFastMode, isDefault: i === 0 })),
      fastNote: 'Claude Fast may incur additional usage charges and requires account eligibility. Check your Claude plan before enabling.'
    }));
  }

  async getUsage(_account: Account, home: string): Promise<AccountUsage | undefined> {
    return this.metadata(home, async (q) => claudeUsage(await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })));
  }

  async deleteSession(): Promise<boolean> {
    // The SDK's filesystem deletion API does not accept a per-account env.
    // Do not let it search the global Claude profile.
    return false;
  }

  async runTurn(p: RunParams): Promise<RunHandle> {
    const bin = await claudeBin();
    const { cb } = p;
    const abort = new AbortController();
    const inputId = randomUUID();
    const inputs = new InputQueue<SDKUserMessage>();
    const pendingResults = new Set<string>([inputId]);
    let closed = false;
    const finishInput = () => { closed = true; inputs.close(); };

    function message(input: LiveInput): SDKUserMessage {
      const content: any[] = [{ type: 'text', text: attachmentPrompt(input.text, input.attachments) || 'Please inspect the attached image.' }];
      for (const a of input.attachments) if (a.kind === 'image') {
        const data = fs.readFileSync(a.path);
        content.push({ type: 'image', source: { type: 'base64', media_type: imageMime(data), data: data.toString('base64') } });
      }
      return { type: 'user', uuid: input.id, message: { role: 'user', content }, parent_tool_use_id: null } as SDKUserMessage;
    }
    inputs.push(message({ id: inputId, text: p.text, attachments: p.attachments ?? [] }));

    const canUseTool: CanUseTool = async (toolName, toolInput, opts) => {
      if (p.mode === 'report' && !['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'AskUserQuestion'].includes(toolName)) return { behavior: 'deny', message: 'Report mode only permits reading and searching.' };
      const connection = p.tools?.connections.find((c) => toolName.startsWith(`mcp__${connectionName(c.id)}__`));
      if (connection?.enabledTools?.length && !connection.enabledTools.includes(toolName.slice(`mcp__${connectionName(connection.id)}__`.length))) return { behavior: 'deny', message: 'This tool is not enabled for the selected connection.' };
      if (toolName === 'AskUserQuestion') {
        const qs: Question[] = ((toolInput as any).questions ?? []).map((q: any, i: number) => ({ id: q.question ?? String(i), header: q.header, question: q.question, multiSelect: q.multiSelect, options: q.options ?? [] }));
        const answers = await cb.requestAnswers(qs, opts.signal);
        if (!answers) return { behavior: 'deny', message: 'The user closed the question without answering.' };
        return { behavior: 'allow', updatedInput: { ...toolInput, answers } };
      }
      const suggestions = (opts.suggestions ?? []) as PermissionUpdate[];
      const allowSession = suggestions.length > 0 && !opts.suppressAlwaysAllowRule;
      const decision = await cb.requestApproval(
        {
          title: `Claude wants to ${TOOL_ACTIONS[toolName] ?? `use the tool ${opts.displayName ?? toolName}`}`,
          // The CLI's own prompt sentence is kept as context.
          detail: toolSubtitle(toolInput) ?? JSON.stringify(toolInput, null, 2),
          reason: [opts.title, opts.description, opts.decisionReason, opts.blockedPath && `path: ${opts.blockedPath}`].filter(Boolean).join(' · ') || undefined,
          allowSession,
          defaultToNo: opts.defaultToNo
        },
        opts.signal
      );
      if (decision === 'approve') return { behavior: 'allow', updatedInput: toolInput };
      if (decision === 'approve_session') {
        // Only for this session: never write rules into the user's project files.
        return { behavior: 'allow', updatedInput: toolInput, updatedPermissions: suggestions.map((s) => ({ ...s, destination: 'session' }) as PermissionUpdate) };
      }
      return { behavior: 'deny', message: decision === 'cancelled' ? 'Run stopped by the user.' : 'The user declined this action.' };
    };

    const q = query({
      prompt: inputs,
      options: {
        cwd: p.cwd,
        additionalDirectories: p.extraDirs,
        resume: p.sessionId,
        model: p.options?.model,
        effort: p.options?.effort as any,
        settings: { fastMode: !!p.options?.fast, ...(p.mode === 'report' ? { disableAllHooks: true } : {}) },
        systemPrompt: { type: 'preset', preset: 'claude_code', append: [runtimeInstructions(), ...(p.tools?.skills ?? []).map((s) => `Skill: ${s.name}\n${s.instructions}`)].join('\n\n') },
        ...(p.tools ? {
          strictMcpConfig: true,
          mcpServers: p.mode === 'report' ? {} : { ...pluginMcpConfig(p.tools.plugins), ...claudeMcpConfig(p.tools, p.credentials ?? {}) },
          pluginDelivery: 'initialize' as const,
          plugins: p.mode === 'report' ? [] : p.tools.plugins.map((plugin) => ({ type: 'local' as const, path: plugin.path, skipMcpDiscovery: true })),
          settingSources: []
        } : {}),
        ...(p.mode === 'report' ? { tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'AskUserQuestion'], disallowedTools: ['Bash', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task', 'mcp__*'] } : {}),
        env: providerEnv('claude', p.home),
        pathToClaudeCodeExecutable: bin,
        // Explicit: without it Claude Code may start in auto mode, where a classifier approves actions.
        permissionMode: 'default',
        includePartialMessages: true,
        abortController: abort,
        hooks: p.tools ? { PreToolUse: [{ hooks: [async (input) => {
          if (input.hook_event_name !== 'PreToolUse') return {};
          const connection = p.tools?.connections.find((c) => input.tool_name.startsWith(`mcp__${connectionName(c.id)}__`));
          if (connection?.enabledTools?.length && !connection.enabledTools.includes(input.tool_name.slice(`mcp__${connectionName(connection.id)}__`.length))) return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: 'This tool is not enabled for the selected connection.' } };
          return {};
        }] }] } : undefined,
        canUseTool,
        onElicitation: (request, options) => handleElicitation(request, cb, options.signal),
        stderr: (d: string) => {
          const line = stripAnsi(d).trim();
          if (line) cb.onLog(redact(line));
        }
      }
    });

    const expectedEmail = p.account.connection.state === 'connected' ? p.account.connection.email : undefined;
    let stopped = false;
    const toolInputs = new Map<string, { name: string; input: any }>();
    const finishedTools = new Set<string>();
    let contextTokens = 0;
    let activeModel: string | undefined;

    const done = (async (): Promise<RunOutcome> => {
      // message id -> streaming assistant item ids not yet finalised
      const streaming = new Map<string, string[]>();
      let currentMsg = '';
      let currentItem: string | undefined;
      const partialTools = new Map<string, { id: string; name: string; json: string }>();
      try {
        for await (const m of q as AsyncIterable<SDKMessage>) {
          const msg = m as any;
          const consumed: string[] = msg.user_message_uuids ? [...msg.user_message_uuids] : (msg.user_message_uuid ? [msg.user_message_uuid] : []);
          if (msg.type === 'user' && pendingResults.has(msg.uuid)) consumed.push(msg.uuid);
          for (const id of consumed) if (pendingResults.has(id)) cb.onInputAccepted?.(id === inputId ? undefined : id);
          switch (msg.type) {
            case 'system':
              {
                const activity = claudeTaskActivity(msg);
                if (activity) cb.onItem(activity);
              }
              if (msg.subtype === 'init') {
                activeModel = msg.model;
                cb.onSession(msg.session_id);
                cb.onLog(`session ${msg.session_id} · model ${msg.model} · folder ${msg.cwd} · permission mode ${msg.permissionMode}`);
                if (msg.apiKeySource && msg.apiKeySource !== 'none') {
                  throw new ProviderError(`Isolation check failed: Claude is using an API key (${msg.apiKeySource}) instead of the linked subscription.`, true);
                }
                const info = await q.accountInfo().catch(() => undefined);
                if (info && expectedEmail && info.email && info.email !== expectedEmail) {
                  throw new ProviderError(`Account check failed: Claude is signed in as ${info.email}, but this account is linked to ${expectedEmail}.`, true);
                }
              } else if (msg.subtype === 'compact_boundary') {
                cb.onItem({ kind: 'notice', id: randomUUID(), level: 'info', text: 'The conversation was compacted to stay within the context limit.', at: now() });
              } else {
                cb.onLog(`system: ${msg.subtype ?? ''}`);
              }
              break;
            case 'stream_event': {
              const ev = msg.event;
              const blockKey = `${msg.parent_tool_use_id ?? 'main'}:${ev.index}`;
              if (ev.type === 'message_start') { cb.onInputAccepted?.(); currentMsg = ev.message?.id ?? ''; }
              else if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') {
                currentItem = randomUUID();
                streaming.set(currentMsg, [...(streaming.get(currentMsg) ?? []), currentItem]);
                cb.onItem({ kind: 'assistant', id: currentItem, text: ev.content_block.text ?? '', streaming: true, at: now() });
              } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && currentItem) {
                cb.onDelta(currentItem, ev.delta.text);
              } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
                const block = ev.content_block;
                partialTools.set(blockKey, { id: block.id, name: block.name, json: '' });
                toolInputs.set(block.id, { name: block.name, input: block.input ?? {} });
                cb.onItem({ kind: 'tool', id: block.id, title: TOOL_TITLES[block.name] ?? block.name, status: 'running', at: now() });
              } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
                const tool = partialTools.get(blockKey);
                if (tool) tool.json += ev.delta.partial_json;
              } else if (ev.type === 'content_block_stop') {
                currentItem = undefined;
                const tool = partialTools.get(blockKey);
                if (tool) {
                  partialTools.delete(blockKey);
                  let input = {};
                  try { input = JSON.parse(tool.json); } catch { /* Final assistant event provides authoritative input. */ }
                  toolInputs.set(tool.id, { name: tool.name, input });
                  cb.onItem({ kind: 'tool', id: tool.id, title: TOOL_TITLES[tool.name] ?? tool.name, subtitle: toolSubtitle(input), detail: JSON.stringify(input, null, 2), status: 'running', at: now() });
                }
              }
              break;
            }
            case 'assistant': {
              cb.onInputAccepted?.();
              const u = msg.message?.usage;
              if (u) contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0);
              const id: string = msg.message?.id ?? '';
              for (const block of msg.message?.content ?? []) {
                if (block.type === 'text') {
                  const pending = streaming.get(id) ?? [];
                  const itemId = pending.shift() ?? randomUUID();
                  cb.onItem({ kind: 'assistant', id: itemId, text: block.text, streaming: false, at: now() });
                } else if (block.type === 'tool_use') {
                  const diff = editDiff(block.name, block.input);
                  if (diff) cb.onItem({ kind: 'diff', id: block.id, files: diff, status: 'pending', at: now() });
                  else cb.onItem({ kind: 'tool', id: block.id, title: TOOL_TITLES[block.name] ?? block.name, subtitle: toolSubtitle(block.input), detail: JSON.stringify(block.input, null, 2), status: 'running', at: now() });
                  toolInputs.set(block.id, { name: block.name, input: block.input });
                }
              }
              if (msg.error) cb.onLog(`assistant error: ${msg.error}`);
              break;
            }
            case 'user': {
              const content = msg.message?.content;
              if (!Array.isArray(content)) break;
              for (const block of content) {
                if (block.type !== 'tool_result') continue;
                finishedTools.add(block.tool_use_id);
                const t = toolInputs.get(block.tool_use_id);
                if (!t) continue;
                const output = redact(resultText(block.content)).slice(0, 20000);
                const diff = editDiff(t.name, t.input);
                if (diff) cb.onItem({ kind: 'diff', id: block.tool_use_id, files: diff, status: block.is_error ? (/denied|declined|rejected/i.test(output) ? 'declined' : 'failed') : 'applied', at: now() });
                else cb.onItem({ kind: 'tool', id: block.tool_use_id, title: TOOL_TITLES[t.name] ?? t.name, subtitle: toolSubtitle(t.input), detail: JSON.stringify(t.input, null, 2), output, status: block.is_error ? 'failed' : 'done', at: now() });
              }
              break;
            }
            case 'tool_progress': {
              if (finishedTools.has(msg.tool_use_id)) break;
              const tool = toolInputs.get(msg.tool_use_id);
              cb.onItem({ kind: 'tool', id: msg.tool_use_id, title: TOOL_TITLES[msg.tool_name] ?? msg.tool_name, subtitle: tool ? toolSubtitle(tool.input) : undefined, output: `Running for ${Math.floor(msg.elapsed_time_seconds ?? 0)}s`, status: 'running', at: now() });
              break;
            }
            case 'rate_limit_event':
              if (msg.rate_limit_info?.status === 'rejected') cb.onItem({ kind: 'notice', id: randomUUID(), level: 'warning', text: 'The usage limit of this Claude subscription has been reached.', at: now() });
              break;
            case 'result': {
              const modelUsage = msg.modelUsage?.[activeModel ?? ''] ?? Object.values(msg.modelUsage ?? {})[0] as any;
              cb.onContext({ tokens: contextTokens, window: modelUsage?.contextWindow, costUsd: msg.total_cost_usd });
              if (stopped) return { status: 'interrupted' };
              const text: string = msg.result ?? (msg.errors ?? []).join('; ');
              if (msg.is_error || msg.subtype !== 'success') {
                return { status: 'failed', message: redact(text || msg.subtype), authProblem: looksLikeAuthProblem(text) };
              }
              // Each streamed user message may have its own result. Do not close
              // the session on the original result while a follow-up is pending.
              const completed = consumed.length ? consumed : [pendingResults.values().next().value].filter((id): id is string => !!id);
              for (const id of completed) {
                if (pendingResults.delete(id)) cb.onInputAccepted?.(id === inputId ? undefined : id);
              }
              if (pendingResults.size) break;
              finishInput();
              return { status: 'completed' };
            }
            default:
              break;
          }
        }
        return stopped ? { status: 'interrupted' } : { status: 'failed', message: 'Claude stopped without a result.' };
      } catch (err) {
        if (stopped || abort.signal.aborted) return { status: 'interrupted' };
        const e = err as ProviderError;
        return { status: 'failed', message: redact(e.message), authProblem: e.authProblem || looksLikeAuthProblem(e.message) };
      } finally {
        finishInput();
        q.close();
      }
    })();

    return {
      done,
      send: async (input) => {
        if (closed || stopped || abort.signal.aborted) throw new TurnEndedError('The turn has finished.');
        const next = message(input);
        pendingResults.add(input.id);
        inputs.push(next);
      },
      stop: async () => {
        stopped = true;
        finishInput();
        try {
          await Promise.race([q.interrupt(), new Promise((r) => setTimeout(r, 4000))]);
        } catch {
          /* fall through to abort */
        }
        abort.abort(); // Also stop SDK-side queued follow-ups from starting after Stop.
      }
    };
  }

  async dispose(accountId?: string): Promise<void> {
    for (const [id, cancel] of this.logins) if (!accountId || id === accountId) cancel();
  }
}
