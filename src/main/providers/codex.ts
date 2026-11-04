// OpenAI Codex via `codex app-server` (JSON-RPC over stdio).
// One app-server process per account, each with its own CODEX_HOME. Credentials
// are kept in the OS credential store (cli_auth_credentials_store = "keyring").

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Account, AccountConnection, AccountMcpServer, AccountUsage, ApprovalDecision, ChatItem, LoginProgress, ModelCatalog, Question } from '../../shared/types';
import { attachmentPrompt } from '../attachments';
import { codexMcpConfig, connectionName } from '../integrations';
import { codexPluginId, installCodexPlugins } from './codex-plugins';
import { handleElicitation } from './elicitation';
import { runtimeInstructions } from './runtime-instructions';
import { detectCli } from '../cli';
import { providerEnv } from '../env';
import { redact, stripAnsi } from '../redact';
import { JsonRpcPeer } from './jsonrpc';
import { looksLikeAuthProblem, ProviderError, TurnEndedError, type LoginHandle, type ProviderAdapter, type RunCallbacks, type RunHandle, type RunOutcome, type RunParams } from './types';

const KEYRING_ARGS = ['-c', 'cli_auth_credentials_store="keyring"'];
const now = () => new Date().toISOString();

export function codexUsage(snapshot: any): AccountUsage | undefined {
  if (!snapshot) return undefined;
  const windows = [snapshot.primary, snapshot.secondary].filter((w) => w && Number.isFinite(w.usedPercent)).map((w) => ({
    label: w.windowDurationMins === 10080 ? 'Weekly' : w.windowDurationMins ? `${w.windowDurationMins / 60}-hour` : 'Plan limit',
    usedPercent: Math.max(0, Math.min(100, w.usedPercent)),
    resetsAt: w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : undefined
  }));
  return { windows, source: 'official', updatedAt: now(), note: snapshot.credits?.unlimited ? 'Unlimited credits' : snapshot.credits?.balance != null ? `Credits: ${snapshot.credits.balance}` : undefined };
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

interface ActiveTurn {
  threadId: string;
  turnId?: string;
  cb: RunCallbacks;
  abort: AbortController;
  finish(outcome: RunOutcome): void;
  /** Accumulated command output per item id. */
  output: Map<string, string>;
  items: Map<string, ChatItem>;
}

export class CodexServer {
  private proc: ChildProcessWithoutNullStreams;
  readonly rpc: JsonRpcPeer;
  readonly ready: Promise<void>;
  private turns = new Map<string, ActiveTurn>(); // by threadId
  private loaded = new Set<string>(); // threads loaded in this process
  private loginWaiters = new Map<string, (r: { success: boolean; error: string | null }) => void>();
  private exited = false;
  private sandboxReady = false;
  log: (line: string) => void = () => {};
  onUsage: (usage: AccountUsage) => void = () => {};

  constructor(
    bin: string,
    readonly home: string,
    private onExit: () => void
  ) {
    this.proc = spawn(bin, ['app-server', ...KEYRING_ARGS], { env: providerEnv('codex', home), windowsHide: true, stdio: 'pipe' });
    this.proc.stderr.on('data', (d) => this.emitLog(stripAnsi(String(d)).trim()));
    this.rpc = new JsonRpcPeer(this.proc.stdout, this.proc.stdin, {
      onNotification: (m, p) => this.onNotification(m, p),
      onRequest: (id, m, p) => void this.onRequest(id, m, p),
      onParseError: (l) => this.emitLog(`non-JSON output: ${l.slice(0, 200)}`)
    });
    const exited = new Promise<never>((_, reject) => {
      this.proc.on('error', (err) => reject(new ProviderError(`Codex could not be started: ${err.message}`)));
      this.proc.on('exit', (code) => reject(new ProviderError(`Codex process exited (code ${code}) during startup`)));
    });
    this.proc.on('exit', (code, signal) => {
      this.exited = true;
      this.rpc.close('Codex process stopped');
      for (const t of this.turns.values()) t.finish({ status: 'failed', message: `The Codex process stopped unexpectedly (code ${code ?? signal}).` });
      this.turns.clear();
      this.onExit();
    });
    this.ready = Promise.race([this.handshake(), exited]);
    this.ready.catch(() => this.kill());
  }

  get alive(): boolean {
    return !this.exited;
  }
  hasThread(id: string): boolean { return this.loaded.has(id); }

  private emitLog(line: string): void {
    if (!line) return;
    const red = redact(line);
    this.log(red);
    for (const t of this.turns.values()) t.cb.onLog(red);
  }

  private async handshake(): Promise<void> {
    const init = await this.rpc.request('initialize', { clientInfo: { name: 'ailo', title: 'Ailo', version: '0.1.0' } });
    // Isolation check: the server must report exactly this account's home.
    if (!init?.codexHome || !samePath(init.codexHome, this.home)) {
      throw new ProviderError(`Isolation check failed: Codex is using "${init?.codexHome}" instead of the account directory.`);
    }
    this.rpc.notify('initialized');
  }

  async account(): Promise<{ account: any; requiresOpenaiAuth: boolean }> {
    await this.ready;
    return this.rpc.request('account/read', {});
  }

  async ensureSandbox(cb: RunCallbacks): Promise<void> {
    if (process.platform !== 'win32' || this.sandboxReady) return;
    const r = await this.rpc.request('windowsSandbox/readiness', {}).catch(() => ({ status: 'ready' }));
    if (r.status === 'ready') {
      this.sandboxReady = true;
      return;
    }
    const noticeId = randomUUID();
    cb.onItem({ kind: 'notice', id: noticeId, level: 'info', text: 'Setting up the Codex sandbox for this account (one time)…', at: now() });
    const completed = new Promise<{ success: boolean; error: string | null }>((resolve) => this.loginWaiters.set('__sandbox', resolve));
    await this.rpc.request('windowsSandbox/setupStart', { mode: 'unelevated' });
    const res = await completed;
    if (!res.success) throw new ProviderError(`The Codex sandbox could not be set up: ${res.error ?? 'unknown error'}`);
    this.sandboxReady = true;
    cb.onItem({ kind: 'notice', id: noticeId, level: 'info', text: 'Codex sandbox ready.', at: now() });
  }

  async login(onProgress: (p: LoginProgress) => void): Promise<LoginHandle> {
    await this.ready;
    const res = await this.rpc.request('account/login/start', { type: 'chatgpt' });
    const loginId: string = res.loginId;
    const done = new Promise<void>((resolve, reject) => {
      this.loginWaiters.set(loginId, (r) => (r.success ? resolve() : reject(new ProviderError(r.error ?? 'Sign-in failed'))));
    });
    onProgress({ stage: 'started', url: res.authUrl, acceptsCode: false });
    return {
      done,
      submitCode: () => {},
      cancel: () => {
        void this.rpc.request('account/login/cancel', { loginId }).catch(() => {});
        this.loginWaiters.get(loginId)?.({ success: false, error: 'Cancelled' });
      }
    };
  }

  async logout(): Promise<void> {
    await this.ready;
    await this.rpc.request('account/logout', {});
  }

  async startTurn(p: RunParams, pluginIds: string[] = []): Promise<RunHandle> {
    await this.ready;
    const { cb } = p;
    await this.ensureSandbox(cb);
    const config: Record<string, unknown> = p.extraDirs.length ? { 'sandbox_workspace_write.writable_roots': p.extraDirs } : {};
    const selectedPlugins = new Set(p.mode === 'report' ? [] : p.tools?.plugins.map(codexPluginId));
    if (p.tools || p.mode === 'report') {
      config['features.plugins'] = selectedPlugins.size > 0;
      const effective = await this.rpc.request('config/read', { includeLayers: false, cwd: p.cwd });
      const accountMcp = p.mode === 'report' ? [] : p.tools?.accountMcpNames ?? [];
      const inherited = effective.config?.mcp_servers ?? {};
      for (const name of accountMcp) if (!Object.hasOwn(inherited, name)) throw new ProviderError(`Selected account MCP server "${name}" is no longer configured for this account.`);
      const selectedConnections = new Set(p.mode === 'report' ? [] : [...(p.tools?.connections.map((c) => connectionName(c.id)) ?? []), ...accountMcp]);
      // RPC override paths split on dots; TOML quotes become literal characters.
      // Nested maps preserve exact names and the transport fields of disabled servers.
      config.mcp_servers = configValues(Object.fromEntries(Object.entries(inherited).map(([name, server]) => [name, { ...server as object, enabled: selectedConnections.has(name) }])));
      config.plugins = configValues(Object.fromEntries([...new Set([...pluginIds, ...Object.keys(effective.config?.plugins ?? {})])].map(id => [id, { ...effective.config?.plugins?.[id], enabled: selectedPlugins.has(id) }])));
      if (p.mode !== 'report' && p.tools) Object.assign(config, codexMcpConfig(p.tools, p.credentials ?? {}));
    }
    if (p.mode === 'report') Object.assign(config, { 'features.hooks': false, 'features.apps': false, 'features.computer_use': false, 'features.browser_use': false });
    const instructions = [runtimeInstructions(), ...(p.tools?.skills ?? []).map((s) => `Skill: ${s.name}\n${s.instructions}`)].join('\n\n');
    const threadOpts = {
      cwd: p.cwd,
      approvalPolicy: 'on-request',
      sandbox: p.mode === 'report' ? 'read-only' : 'workspace-write',
      developerInstructions: instructions || undefined,
      config
    };
    let threadId = p.sessionId;
    if (!threadId) {
      const r = await this.rpc.request('thread/start', threadOpts);
      threadId = r.thread.id as string;
      this.loaded.add(threadId);
      cb.onSession(threadId);
    } else if (!this.loaded.has(threadId)) {
      try {
        await this.rpc.request('thread/resume', { threadId, ...threadOpts });
      } catch (err) {
        throw new ProviderError(`This Codex conversation could not be resumed: ${(err as Error).message}`);
      }
      this.loaded.add(threadId);
    }
    if (this.turns.has(threadId)) throw new ProviderError('A turn is already running in this conversation.');

    let finish!: (o: RunOutcome) => void;
    const done = new Promise<RunOutcome>((resolve) => (finish = resolve));
    const turn: ActiveTurn = {
      threadId,
      cb,
      abort: new AbortController(),
      output: new Map(),
      items: new Map(),
      finish: (o) => {
        this.turns.delete(threadId!);
        turn.abort.abort();
        finish(o);
      }
    };
    this.turns.set(threadId, turn);
    try {
      const r = await this.rpc.request('turn/start', {
        threadId,
        input: [
          { type: 'text', text: attachmentPrompt(p.text, p.attachments ?? []), text_elements: [] },
          ...(p.attachments ?? []).filter((a) => a.kind === 'image').map((a) => ({ type: 'localImage', path: a.path }))
        ],
        model: p.options?.model,
        effort: p.options?.effort,
        serviceTier: p.options?.fast ? 'priority' : 'default',
        ...(p.tools || p.mode === 'report' ? { disabledPluginIds: pluginIds.filter((id) => !selectedPlugins.has(id)) } : {})
      });
      turn.turnId = r.turn.id;
      cb.onInputAccepted?.();
    } catch (err) {
      turn.finish({ status: 'failed', message: (err as Error).message, authProblem: looksLikeAuthProblem((err as Error).message) });
    }
    return {
      done,
      send: async (input) => {
        if (this.turns.get(threadId!) !== turn || turn.abort.signal.aborted || !turn.turnId) throw new TurnEndedError('The turn has finished.');
        try {
          await this.rpc.request('turn/steer', {
            threadId, expectedTurnId: turn.turnId, clientUserMessageId: input.id,
            input: [
              { type: 'text', text: attachmentPrompt(input.text, input.attachments), text_elements: [] },
              ...input.attachments.filter(a => a.kind === 'image').map(a => ({ type: 'localImage', path: a.path }))
            ]
          });
          cb.onInputAccepted?.(input.id);
        } catch (error) {
          if ((error as { code?: number }).code === -32602 && /no active turn|turn.*(mismatch|does not match|not found|not active)|no turn.*(running|progress)/i.test((error as Error).message)) throw new TurnEndedError((error as Error).message);
          throw error;
        }
      },
      stop: async () => {
        if (!this.turns.has(threadId!)) return;
        turn.abort.abort();
        if (turn.turnId) await this.rpc.request('turn/interrupt', { threadId, turnId: turn.turnId }).catch(() => {});
      }
    };
  }

  kill(): void {
    if (!this.exited) this.proc.kill();
  }

  // ---- events -------------------------------------------------------------

  private onNotification(method: string, params: any): void {
    if (method === 'account/rateLimits/updated') {
      const usage = codexUsage(params.rateLimits);
      if (usage) this.onUsage(usage);
      return;
    }
    if (method === 'account/login/completed') {
      const w = this.loginWaiters.get(params.loginId) ?? [...this.loginWaiters.entries()].find(([k]) => k !== '__sandbox')?.[1];
      if (w) {
        this.loginWaiters.delete(params.loginId);
        w({ success: params.success, error: params.error });
      }
      return;
    }
    if (method === 'windowsSandbox/setupCompleted') {
      this.loginWaiters.get('__sandbox')?.({ success: params.success, error: params.error });
      this.loginWaiters.delete('__sandbox');
      return;
    }
    const turn = params?.threadId ? this.turns.get(params.threadId) : undefined;
    if (!turn) return;
    const { cb } = turn;
    switch (method) {
      case 'thread/tokenUsage/updated':
        cb.onContext({ tokens: params.tokenUsage?.last?.totalTokens ?? 0, window: params.tokenUsage?.modelContextWindow ?? undefined });
        break;
      case 'turn/started':
        cb.onInputAccepted?.();
        turn.turnId = params.turn?.id ?? turn.turnId;
        break;
      case 'item/started':
      case 'item/completed': {
        const item = mapItem(params.item, method === 'item/completed', turn);
        if (item) { turn.items.set(item.id, item); cb.onItem(item); }
        break;
      }
      case 'item/agentMessage/delta':
        cb.onDelta(params.itemId, params.delta);
        break;
      case 'item/commandExecution/outputDelta':
        turn.output.set(params.itemId, ((turn.output.get(params.itemId) ?? '') + (params.delta ?? '')).slice(-20000));
        {
          const item = turn.items.get(params.itemId);
          if (item?.kind === 'tool' && item.status === 'running') cb.onItem({ ...item, output: redact(turn.output.get(params.itemId) ?? '') });
        }
        break;
      case 'item/reasoning/summaryTextDelta':
      case 'item/plan/delta': {
        if (!turn.items.has(params.itemId)) {
          const item: ChatItem = { kind: 'reasoning', id: params.itemId, text: '', at: now() };
          turn.items.set(item.id, item); cb.onItem(item);
        }
        cb.onDelta(params.itemId, params.delta ?? '');
        break;
      }
      case 'error':
        if (params.willRetry) cb.onLog(redact(`retrying: ${params.error?.message} ${params.error?.additionalDetails ?? ''}`));
        else cb.onItem({ kind: 'notice', id: randomUUID(), level: 'error', text: params.error?.message ?? 'Unknown error', detail: redact(params.error?.additionalDetails ?? ''), at: now() });
        break;
      case 'warning':
      case 'configWarning':
      case 'guardianWarning':
        cb.onItem({ kind: 'notice', id: randomUUID(), level: 'warning', text: redact(String(params.message ?? params.summary ?? JSON.stringify(params))), at: now() });
        break;
      case 'turn/completed': {
        const t = params.turn;
        if (t.status === 'completed') turn.finish({ status: 'completed' });
        else if (t.status === 'interrupted') turn.finish({ status: 'interrupted' });
        else {
          const msg = [t.error?.message, t.error?.additionalDetails].filter(Boolean).join(' — ') || 'The turn failed.';
          turn.finish({ status: 'failed', message: redact(msg), authProblem: looksLikeAuthProblem(msg) || t.error?.codexErrorInfo?.responseStreamDisconnected?.httpStatusCode === 401 });
        }
        break;
      }
      default:
        cb.onLog(`${method}`);
    }
  }

  private async onRequest(id: number | string, method: string, params: any): Promise<void> {
    const turn = params?.threadId ? this.turns.get(params.threadId) : undefined;
    const signal = turn?.abort.signal;
    try {
      switch (method) {
        case 'item/commandExecution/requestApproval': {
          if (!turn) return this.rpc.respond(id, { decision: 'decline' });
          const d = await turn.cb.requestApproval(
            { title: 'Codex wants to run a command', detail: params.command ? displayCommand(params.command) : undefined, reason: [params.reason, params.cwd && `in ${params.cwd}`].filter(Boolean).join(' · ') || undefined, allowSession: true },
            signal
          );
          return this.rpc.respond(id, { decision: toCodexDecision(d) });
        }
        case 'item/fileChange/requestApproval': {
          if (!turn) return this.rpc.respond(id, { decision: 'decline' });
          const d = await turn.cb.requestApproval({ title: 'Codex wants to change files', detail: params.grantRoot ? `Write access to ${params.grantRoot}` : 'See the proposed changes above.', reason: params.reason ?? undefined, allowSession: true }, signal);
          return this.rpc.respond(id, { decision: toCodexDecision(d) });
        }
        case 'item/permissions/requestApproval': {
          if (!turn) return this.rpc.respond(id, { permissions: {}, scope: 'turn' });
          const d = await turn.cb.requestApproval({ title: 'Codex requests additional permissions', detail: JSON.stringify(params.permissions, null, 2), reason: params.reason ?? undefined, allowSession: true }, signal);
          const granted = d === 'approve' || d === 'approve_session' ? stripNulls(params.permissions) : {};
          return this.rpc.respond(id, { permissions: granted, scope: d === 'approve_session' ? 'session' : 'turn' });
        }
        case 'item/tool/requestUserInput': {
          if (!turn) return this.rpc.respond(id, { answers: {} });
          const questions: Question[] = (params.questions ?? []).map((q: any) => ({ id: q.id, header: q.header, question: q.question, options: q.options ?? [] }));
          const a = await turn.cb.requestAnswers(questions, signal);
          const answers: Record<string, { answers: string[] }> = {};
          for (const q of questions) if (a?.[q.id]) answers[q.id] = { answers: [a[q.id]] };
          return this.rpc.respond(id, { answers });
        }
        case 'mcpServer/elicitation/request':
          return this.rpc.respond(id, turn ? await handleElicitation(params, turn.cb, signal) : { action: 'decline' });
        case 'execCommandApproval':
        case 'applyPatchApproval': {
          // Legacy protocol; handled the same way as the v2 approvals.
          if (!turn) return this.rpc.respond(id, { decision: 'denied' });
          const d = await turn.cb.requestApproval({ title: method === 'execCommandApproval' ? 'Codex wants to run a command' : 'Codex wants to change files', detail: Array.isArray(params.command) ? params.command.join(' ') : undefined, reason: params.reason ?? undefined, allowSession: true }, signal);
          return this.rpc.respond(id, { decision: d === 'approve' ? 'approved' : d === 'approve_session' ? 'approved_for_session' : d === 'cancelled' ? 'abort' : 'denied' });
        }
        default:
          turn?.cb.onLog(`unsupported request from Codex: ${method}`);
          return this.rpc.respondError(id, -32601, `Ailo does not support ${method}`);
      }
    } catch (err) {
      this.rpc.respondError(id, -32603, (err as Error).message);
    }
  }
}

/** config/read includes null defaults; TOML overrides cannot represent null. */
function configValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(configValues);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v != null).map(([k, v]) => [k, configValues(v)]));
  return value;
}

function stripNulls(o: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o ?? {})) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

function toCodexDecision(d: ApprovalDecision | 'cancelled'): string {
  return d === 'approve' ? 'accept' : d === 'approve_session' ? 'acceptForSession' : d === 'cancelled' ? 'cancel' : 'decline';
}

/** Strip the shell wrapper Codex adds (powershell -Command '…', bash -lc '…') for display. */
export function displayCommand(cmd: string): string {
  const m = /^\s*(?:"([^"]+)"|(\S+))\s+(?:-NoProfile\s+)?(?:-Command|-lc|-c|\/c)\s+(['"])([\s\S]*)\3\s*$/i.exec(cmd);
  const shell = m?.[1] ?? m?.[2] ?? '';
  if (!m || !/(?:^|[\\/])(?:powershell|pwsh|bash|zsh|sh|cmd)(?:\.exe)?$/i.test(shell)) return cmd;
  return m[3] === "'" ? m[4].replace(/''/g, "'") : m[4];
}

const statusMap: Record<string, 'running' | 'done' | 'failed' | 'declined'> = { inProgress: 'running', completed: 'done', failed: 'failed', declined: 'declined' };

export function mapItem(item: any, completed: boolean, turn?: Pick<ActiveTurn, 'output'>): ChatItem | undefined {
  const at = now();
  switch (item?.type) {
    case 'agentMessage':
      return { kind: 'assistant', id: item.id, text: item.text ?? '', streaming: !completed, at };
    case 'reasoning': {
      const text = (item.summary ?? []).join('\n\n').trim();
      return completed && text ? { kind: 'reasoning', id: item.id, text, at } : undefined;
    }
    case 'commandExecution':
      return {
        kind: 'tool',
        id: item.id,
        title: 'Command',
        subtitle: displayCommand(item.command ?? ''),
        detail: item.cwd ? `${item.command}
folder: ${item.cwd}${item.exitCode != null ? ` · exit code ${item.exitCode}` : ''}` : undefined,
        output: redact(item.aggregatedOutput ?? turn?.output.get(item.id) ?? ''),
        exitCode: item.exitCode ?? undefined,
        status: item.status === 'declined' ? 'declined' : item.exitCode != null && item.exitCode !== 0 ? 'failed' : statusMap[item.status] ?? (completed ? 'done' : 'running'),
        at
      };
    case 'fileChange':
      return {
        kind: 'diff',
        id: item.id,
        files: (item.changes ?? []).map((c: any) => ({ path: c.path, change: c.kind?.type ?? 'update', diff: c.diff ?? '' })),
        status: item.status === 'completed' ? 'applied' : item.status === 'failed' ? 'failed' : item.status === 'declined' ? 'declined' : 'pending',
        at
      };
    case 'mcpToolCall':
      return {
        kind: 'tool',
        id: item.id,
        title: `MCP: ${item.server}/${item.tool}`,
        detail: JSON.stringify(item.arguments, null, 2),
        output: item.error ? JSON.stringify(item.error) : item.result ? redact(JSON.stringify(item.result, null, 2)).slice(0, 20000) : undefined,
        status: statusMap[item.status] ?? (completed ? 'done' : 'running'),
        at
      };
    case 'webSearch':
      return { kind: 'tool', id: item.id, title: 'Web search', subtitle: item.query ?? item.action?.query, status: completed ? 'done' : 'running', at };
    case 'dynamicToolCall':
      return { kind: 'tool', id: item.id, title: `Tool: ${item.tool}`, detail: JSON.stringify(item.arguments, null, 2), status: statusMap[item.status] ?? 'running', at };
    case 'collabAgentToolCall':
      return { kind: 'tool', id: item.id, title: `Agent: ${item.tool ?? 'background task'}`, subtitle: item.prompt, output: item.agentsStates ? JSON.stringify(item.agentsStates, null, 2) : undefined, status: statusMap[item.status] ?? (completed ? 'done' : 'running'), at };
    case 'contextCompaction':
      return { kind: 'tool', id: item.id, title: 'Compacting conversation', status: completed ? 'done' : 'running', at };
    case 'plan':
      return completed ? { kind: 'reasoning', id: item.id, text: item.text, at } : undefined;
    default:
      return undefined; // userMessage (we show our own), hooks, etc.
  }
}

export class CodexAdapter implements ProviderAdapter {
  readonly id = 'codex' as const;
  async listAccountMcp(account: Account, home: string): Promise<AccountMcpServer[]> {
    const server = await this.server(account, home);
    const result = await server.rpc.request('config/read', { includeLayers: false, cwd: home });
    return Object.entries(result.config?.mcp_servers ?? {}).map(([name, value]) => {
      const config = value as { command?: string; url?: string; enabled?: boolean };
      return { name, transport: config.url ? 'http' as const : 'stdio' as const, enabled: config.enabled !== false };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  private servers = new Map<string, CodexServer>();

  initHome(home: string): void {
    fs.mkdirSync(home, { recursive: true });
    const cfg = path.join(home, 'config.toml');
    if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, '# Managed by Ailo: credentials are kept in the operating system credential store.\ncli_auth_credentials_store = "keyring"\n');
  }

  private async server(account: Account, home: string, profile = ''): Promise<CodexServer> {
    const key = account.id + ':' + profile;
    let s = this.servers.get(key);
    if (s?.alive) return s;
    const cli = await detectCli('codex');
    if (!cli.found || !cli.path) throw new ProviderError(cli.error ?? 'Codex CLI not found');
    this.initHome(home);
    s = new CodexServer(cli.path, home, () => this.servers.get(key) === s && this.servers.delete(key));
    this.servers.set(key, s);
    await s.ready;
    return s;
  }

  async checkAccount(account: Account, home: string): Promise<AccountConnection> {
    const checkedAt = now();
    try {
      const s = await this.server(account, home);
      const r = await s.account();
      if (!r.account) return { state: 'signed_out', checkedAt };
      const a = r.account;
      if (a.type === 'chatgpt') return { state: 'connected', email: a.email ?? undefined, plan: a.planType ? `ChatGPT ${a.planType}` : 'ChatGPT', organization: a.workspaceName ?? undefined, checkedAt };
      if (a.type === 'apiKey') return { state: 'connected', plan: 'API key (billed separately)', checkedAt };
      return { state: 'connected', plan: a.type, checkedAt };
    } catch (err) {
      return { state: 'error', message: (err as Error).message, checkedAt };
    }
  }

  async startLogin(account: Account, home: string, onProgress: (p: LoginProgress) => void): Promise<LoginHandle> {
    const s = await this.server(account, home);
    return s.login(onProgress);
  }

  async logout(account: Account, home: string): Promise<void> {
    const s = await this.server(account, home);
    await s.logout();
  }

  async runTurn(p: RunParams): Promise<RunHandle> {
    const cli = await detectCli('codex');
    if (!cli.path) throw new ProviderError('Codex CLI not found.');
    const pluginIds = p.tools || p.mode === 'report' ? await installCodexPlugins(cli.path, p.home, p.mode === 'report' ? [] : p.tools?.plugins ?? []) : [];
    const profile = p.tools ? createHash('sha256').update(JSON.stringify([p.tools, p.credentials, p.mode])).digest('hex').slice(0, 20) : '';
    const s = await this.server(p.account, p.home, profile);
    s.onUsage = p.cb.onUsage;
    const r = await s.account();
    if (!r.account) throw new ProviderError(`Account "${p.account.alias}" is not signed in to OpenAI. Sign in again from Accounts.`, true);
    const expected = p.account.connection.state === 'connected' ? p.account.connection.email : undefined;
    if (expected && r.account.email && r.account.email !== expected) {
      throw new ProviderError(`Account check failed: this account is now signed in as ${r.account.email}, but it was linked to ${expected}. Check the account before continuing.`, true);
    }
    return s.startTurn(p, pluginIds);
  }

  async listModels(account: Account, home: string): Promise<ModelCatalog> {
    const s = await this.server(account, home);
    const models: ModelCatalog['models'] = [];
    let cursor: string | undefined;
    do {
      const r = await s.rpc.request('model/list', { cursor, limit: 100 });
      for (const m of r.data ?? []) if (!m.hidden) models.push({
        id: m.model ?? m.id, label: m.displayName, description: m.description,
        efforts: (m.supportedReasoningEfforts ?? []).map((e: any) => e.reasoningEffort),
        defaultEffort: m.defaultReasoningEffort,
        fast: (m.serviceTiers ?? []).some((t: any) => ['fast', 'priority'].includes(t.id)) || (m.additionalSpeedTiers ?? []).some((t: string) => ['fast', 'priority'].includes(t)),
        isDefault: m.isDefault
      });
      cursor = r.nextCursor || undefined;
    } while (cursor);
    return { models, fastNote: 'Fast uses 2.5× included subscription usage; purchased credits cost 2× standard. Availability depends on your plan.' };
  }

  async getUsage(account: Account, home: string): Promise<AccountUsage | undefined> {
    const s = await this.server(account, home);
    const r = await s.rpc.request('account/rateLimits/read', {});
    return codexUsage(r.rateLimits);
  }

  async deleteSession(account: Account, home: string, sessionId: string): Promise<boolean> {
    const s = [...this.servers.values()].find((server) => server.alive && samePath(server.home, home) && server.hasThread(sessionId)) ?? await this.server(account, home);
    await s.rpc.request('thread/delete', { threadId: sessionId });
    return true;
  }

  async dispose(accountId?: string): Promise<void> {
    for (const [id, s] of this.servers) {
      if (accountId && !id.startsWith(accountId + ':')) continue;
      s.kill();
      this.servers.delete(id);
    }
  }
}
