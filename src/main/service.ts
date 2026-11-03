// Application logic, independent of Electron so it can be tested.
// Accounts, projects, conversations and runs. Every run uses exactly the
// account the conversation was created with; there is no fallback.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Account,
  AccountConnection,
  AccountUsage,
  ConnectionInput,
  ConnectionCredentials,
  McpConnection,
  ToolSelection,
  ToolSnapshot,
  Attachment,
  NewConversationInput,
  RunOptions,
  ApprovalDecision,
  ApprovalRequest,
  ChatItem,
  Conversation,
  FolderConflict,
  LoginProgress,
  MainEvent,
  Project,
  ProviderId,
  Question,
  Settings,
  StartTurnResult
} from '../shared/types';
import type { LoginHandle, ProviderAdapter, RunHandle } from './providers/types';
import { ProviderError } from './providers/types';
import { redact } from './redact';
import type { Store } from './store';
import { MAX_ATTACHMENT_BYTES, saveAttachment, validateAttachments } from './attachments';
import { AutomationManager } from './automations';
import { hideSecrets, importLocalPlugin, probeConnection, secretValues, validateConnection } from './integrations';
import { authorizeMcp, refreshMcpToken, withAccessToken } from './oauth';
import type { SecretVault } from './secrets';

const DEFAULT_TITLE = 'New conversation';
const now = () => new Date().toISOString();

function normFolder(p: string): string {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

/** True when one folder contains (or equals) the other. */
export function foldersOverlap(a: string, b: string): boolean {
  const x = normFolder(a);
  const y = normFolder(b);
  return x === y || x.startsWith(y + path.sep) || y.startsWith(x + path.sep);
}

interface ActiveRun {
  handle?: RunHandle;
  stopping: boolean;
  /** Pending user prompts by transcript item id. */
  prompts: Map<string, (value: any) => void>;
}

export class AiloService {
  readonly automations: AutomationManager;
  private runs = new Map<string, ActiveRun>();
  private logins = new Map<string, LoginHandle>();
  private loginBusy: string | undefined;
  private authorizing = new Set<string>();
  private refreshing = new Map<string, Promise<ConnectionCredentials>>();
  private deleting = new Set<string>();
  private modelCatalogs = new Map<string, { at: number; catalog: Awaited<ReturnType<ProviderAdapter['listModels']>> }>();

  constructor(
    readonly store: Store,
    private adapters: Record<ProviderId, ProviderAdapter>,
    private emit: (e: MainEvent) => void,
    private openUrl: (url: string) => void = () => {},
    private vault?: SecretVault
  ) { this.automations = new AutomationManager(this, () => this.publish()); }

  get state() {
    return this.store.state;
  }

  private publish(): void {
    this.store.saveState();
    this.emit({ type: 'state', state: this.state });
  }

  async saveConnection(input: ConnectionInput): Promise<McpConnection> {
    validateConnection(input);
    const existing = input.id ? this.state.connections.find((c) => c.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Connection not found.');
    let credentialId = input.clearCredentials ? undefined : existing?.credentialId;
    if (input.credentials) {
      if (!this.vault) throw new Error('Encrypted credential storage is unavailable.');
      credentialId = await this.vault.put(input.credentials);
    }
    if (existing && !this.state.connections.includes(existing)) throw new Error('This connection changed while saving. Try again.');
    const connection: McpConnection = { id: existing?.id ?? randomUUID(), name: input.name.trim(), identity: input.identity.trim(), transport: input.transport,
      command: input.transport === 'stdio' ? input.command?.trim() : undefined, args: input.transport === 'stdio' ? input.args ?? [] : undefined,
      url: input.transport === 'http' ? input.url : undefined, providers: [...input.providers], enabledTools: input.enabledTools?.length ? [...input.enabledTools] : undefined,
      credentialId, createdAt: existing?.createdAt ?? now() };
    if (existing) this.state.connections[this.state.connections.indexOf(existing)] = connection;
    else this.state.connections.push(connection);
    this.publish(); return connection;
  }

  removeConnection(id: string): void { this.state.connections = this.state.connections.filter((c) => c.id !== id); this.publish(); }
  async testConnection(id: string) {
    const connection = this.state.connections.find((c) => c.id === id);
    if (!connection) throw new Error('Connection not found.');
    return probeConnection(connection, await this.connectionCredentials(connection));
  }
  private async connectionCredentials(c: McpConnection): Promise<ConnectionCredentials> {
    const current = this.state.connections.find((x) => x.id === c.id);
    if (!current) throw new Error(`Connection "${c.name}" was removed. Start a new conversation with another selection.`);
    if (current.credentialId !== c.credentialId) throw new Error(`Credentials for ${c.name} changed. Start a new conversation to select the new identity.`);
    if (!c.credentialId) return {};
    if (!this.vault) throw new Error('Encrypted credential storage is unavailable.');
    const credentials = await this.vault.get(c.credentialId);
    if (credentials.oauth?.expiresAt && credentials.oauth.expiresAt <= Date.now() + 60000) {
      let refreshing = this.refreshing.get(c.credentialId);
      if (!refreshing) {
        const credentialId = c.credentialId;
        refreshing = refreshMcpToken(c.url!, credentials).then(async (updated) => { await this.vault!.update(credentialId, updated); return updated; }).finally(() => this.refreshing.delete(credentialId));
        this.refreshing.set(credentialId, refreshing);
      }
      return withAccessToken(await refreshing);
    }
    return withAccessToken(credentials);
  }
  async authorizeConnection(id: string): Promise<void> {
    const connection = this.state.connections.find((c) => c.id === id);
    if (!connection || connection.transport !== 'http') throw new Error('OAuth sign-in requires an HTTP connection.');
    if (!this.vault) throw new Error('Encrypted credential storage is unavailable.');
    if (this.authorizing.has(id)) throw new Error('A sign-in for this connection is already in progress.');
    this.authorizing.add(id);
    try {
      const previous = connection.credentialId ? await this.vault.get(connection.credentialId) : {};
      const credentials = await authorizeMcp(connection.url!, previous, this.openUrl);
      if (!this.state.connections.includes(connection)) throw new Error('The connection changed while signing in. Try again.');
      connection.credentialId = await this.vault.put(credentials); this.publish();
    } finally { this.authorizing.delete(id); }
  }
  saveSkill(input: { id?: string; name: string; instructions: string }) {
    if (!input.name.trim() || !input.instructions.trim()) throw new Error('Give the skill a name and instructions.');
    const existing = input.id ? this.state.skills.find((s) => s.id === input.id) : undefined;
    if (input.id && !existing) throw new Error('Skill not found.');
    const skill = { id: existing?.id ?? randomUUID(), name: input.name.trim(), instructions: input.instructions, createdAt: existing?.createdAt ?? now() };
    if (existing) this.state.skills[this.state.skills.indexOf(existing)] = skill; else this.state.skills.push(skill);
    this.publish(); return skill;
  }
  removeSkill(id: string): void { this.state.skills = this.state.skills.filter((s) => s.id !== id); this.publish(); }
  importPlugin(folder: string) { const plugin = importLocalPlugin(this.store.root, folder); this.state.plugins.push(plugin); this.publish(); return plugin; }
  removePlugin(id: string): void { this.state.plugins = this.state.plugins.filter((p) => p.id !== id); this.publish(); }

  snapshotTools(selection: ToolSelection = { connectionIds: [], skillIds: [], pluginIds: [] }, provider: ProviderId): ToolSnapshot {
    const take = <T extends { id: string }>(ids: string[], items: T[], type: string): T[] => [...new Set(ids)].map((id) => {
      const item = items.find((i) => i.id === id);
      if (!item) throw new Error(`Selected ${type} no longer exists.`);
      return structuredClone(item);
    });
    const connections = take(selection.connectionIds, this.state.connections, 'connection');
    const plugins = take(selection.pluginIds, this.state.plugins, 'plugin');
    if ([...connections, ...plugins].some((i) => !i.providers.includes(provider))) throw new Error('One of the selected integrations does not support this AI provider.');
    return { connections, skills: take(selection.skillIds, this.state.skills, 'skill'), plugins };
  }
  setConversationTools(id: string, selection: ToolSelection): void {
    const c = this.conversation(id);
    if (c.executionMode === 'report' && (selection.connectionIds.length || selection.pluginIds.length)) throw new Error('Report mode cannot enable MCP connections or plugins.');
    if (c.providerSessionId || this.isRunning(id)) throw new Error('Tools are fixed once a conversation starts. Start a new conversation to change them.');
    c.toolSnapshot = this.snapshotTools(selection, this.account(c.accountId).provider); this.publish();
  }

  // ---- accounts -----------------------------------------------------------

  account(id: string): Account {
    const a = this.state.accounts.find((x) => x.id === id);
    if (!a) throw new Error('Account not found');
    return a;
  }

  addAccount(input: { provider: ProviderId; alias: string; color: string; icon?: string }): Account {
    const alias = input.alias.trim();
    if (!alias) throw new Error('Give the account an alias');
    if (this.state.accounts.some((a) => a.alias.toLowerCase() === alias.toLowerCase())) throw new Error(`An account with the alias "${alias}" already exists`);
    const account: Account = { id: randomUUID(), provider: input.provider, alias, color: input.color, icon: input.icon, createdAt: now(), connection: { state: 'unknown' } };
    this.adapters[account.provider].initHome(this.store.accountHome(account.id));
    this.state.accounts.push(account);
    this.publish();
    return account;
  }

  updateAccount(id: string, patch: Partial<Pick<Account, 'alias' | 'color' | 'icon'>>): void {
    const a = this.account(id);
    if (patch.alias !== undefined) {
      const alias = patch.alias.trim();
      if (!alias) throw new Error('Alias cannot be empty');
      if (this.state.accounts.some((x) => x.id !== id && x.alias.toLowerCase() === alias.toLowerCase())) throw new Error(`An account with the alias "${alias}" already exists`);
      a.alias = alias;
    }
    if (patch.color !== undefined) a.color = patch.color;
    if (patch.icon !== undefined) a.icon = patch.icon || undefined;
    this.publish();
  }

  async removeAccount(id: string): Promise<{ ok: boolean; error?: string }> {
    const a = this.account(id);
    if (this.state.conversations.some((c) => c.accountId === id && this.runs.has(c.id))) return { ok: false, error: 'Stop the running conversations of this account first.' };
    const home = this.store.accountHome(id);
    // Only sign out through a real directory that Ailo owns; a link could point at another login.
    const owned = fs.existsSync(home) && !fs.lstatSync(home).isSymbolicLink() && fs.realpathSync(home).startsWith(fs.realpathSync(this.store.root));
    if (owned) {
      try {
        await this.adapters[a.provider].logout(a, home);
      } catch {
        /* already signed out or CLI missing; the directory is removed anyway */
      }
    }
    await this.adapters[a.provider].dispose(id);
    fs.rmSync(path.dirname(home), { recursive: true, force: true });
    this.state.accounts = this.state.accounts.filter((x) => x.id !== id);
    for (const p of this.state.projects) if (p.defaultAccountId === id) p.defaultAccountId = undefined;
    this.publish();
    return { ok: true };
  }

  async checkAccount(id: string): Promise<AccountConnection> {
    const a = this.account(id);
    a.connection = { state: 'checking' };
    this.emit({ type: 'state', state: this.state });
    const c = await this.adapters[a.provider].checkAccount(a, this.store.accountHome(id));
    a.connection = c;
    this.publish();
    if (c.state === 'connected') void this.refreshUsage(id).catch(() => {});
    return c;
  }

  async refreshUsage(id: string): Promise<AccountUsage | undefined> {
    const a = this.account(id);
    const usage = await this.adapters[a.provider].getUsage(a, this.store.accountHome(id));
    if (this.state.accounts.includes(a)) {
      a.usage = usage;
      this.publish();
    }
    return usage;
  }

  async listModels(id: string) {
    const a = this.account(id);
    const cached = this.modelCatalogs.get(id);
    if (cached && Date.now() - cached.at < 60000) return cached.catalog;
    const catalog = await this.adapters[a.provider].listModels(a, this.store.accountHome(id));
    this.modelCatalogs.set(id, { at: Date.now(), catalog });
    return catalog;
  }

  async startLogin(id: string, opts: { openBrowser?: boolean } = {}): Promise<void> {
    const a = this.account(id);
    // Browser logins use a fixed local callback; run one at a time.
    if (this.loginBusy && this.loginBusy !== id) {
      this.emit({ type: 'login', accountId: id, progress: { stage: 'failed', message: 'A sign-in for another account is in progress. Finish that one first.' } });
      return;
    }
    this.logins.get(id)?.cancel();
    this.loginBusy = id;
    const progress = (p: LoginProgress) => {
      if (p.stage === 'started' && p.url && a.provider === 'codex' && opts.openBrowser !== false) this.openUrl(p.url);
      this.emit({ type: 'login', accountId: id, progress: p });
    };
    try {
      const h = await this.adapters[a.provider].startLogin(a, this.store.accountHome(id), progress);
      this.logins.set(id, h);
      await h.done;
      const c = await this.checkAccount(id);
      progress(c.state === 'connected' ? { stage: 'completed' } : { stage: 'failed', message: 'Sign-in seemed to succeed, but the account is not connected yet.' });
    } catch (err) {
      progress({ stage: 'failed', message: redact((err as Error).message) });
    } finally {
      this.logins.delete(id);
      if (this.loginBusy === id) this.loginBusy = undefined;
    }
  }

  submitLoginCode(id: string, code: string): void {
    this.logins.get(id)?.submitCode(code);
  }

  cancelLogin(id: string): void {
    this.logins.get(id)?.cancel();
  }

  // ---- projects -----------------------------------------------------------

  project(id: string): Project {
    const p = this.state.projects.find((x) => x.id === id);
    if (!p) throw new Error('Project not found');
    return p;
  }

  addProject(input: { name: string; folders: string[]; defaultAccountId?: string }): Project {
    const folders = this.validateFolders(input.folders);
    const p: Project = { id: randomUUID(), name: input.name.trim() || path.basename(folders[0]), folders, defaultAccountId: input.defaultAccountId, createdAt: now() };
    this.state.projects.push(p);
    this.publish();
    return p;
  }

  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'folders' | 'defaultAccountId' | 'toolSelection'>>): void {
    const p = this.project(id);
    if (patch.name !== undefined && patch.name.trim()) p.name = patch.name.trim();
    if (patch.folders !== undefined) p.folders = this.validateFolders(patch.folders);
    if ('defaultAccountId' in patch) p.defaultAccountId = patch.defaultAccountId || undefined;
    if (patch.toolSelection) { if (p.defaultAccountId) this.snapshotTools(patch.toolSelection, this.account(p.defaultAccountId).provider); p.toolSelection = structuredClone(patch.toolSelection); }
    this.publish();
  }

  removeProject(id: string): { ok: boolean; error?: string } {
    const convs = this.state.conversations.filter((c) => c.projectId === id);
    if (convs.some((c) => this.runs.has(c.id))) return { ok: false, error: 'Stop the running conversations in this project first.' };
    for (const c of convs) this.store.deleteTranscript(c.id);
    this.state.conversations = this.state.conversations.filter((c) => c.projectId !== id);
    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    this.publish();
    return { ok: true };
  }

  validateFolders(folders: string[]): string[] {
    const out = [...new Set(folders.map((f) => f.trim()).filter(Boolean))];
    if (!out.length) throw new Error('Choose at least one working folder');
    for (const f of out) if (!fs.existsSync(f) || !fs.statSync(f).isDirectory()) throw new Error(`Folder does not exist: ${f}`);
    return out;
  }

  // ---- conversations ------------------------------------------------------

  conversation(id: string): Conversation {
    const c = this.state.conversations.find((x) => x.id === id);
    if (!c) throw new Error('Conversation not found');
    return c;
  }

  createConversation(input: NewConversationInput): Conversation {
    if (input.projectId) this.project(input.projectId);
    this.account(input.accountId); // explicit choice; must exist
    const id = randomUUID();
    let folders: string[] | undefined;
    if (!input.projectId) {
      const scratch = path.join(this.store.root, 'scratch', id);
      if (!input.folders?.length) fs.mkdirSync(scratch, { recursive: true });
      folders = this.validateFolders(input.folders?.length ? input.folders : [scratch]);
    }
    const c: Conversation = {
      id,
      projectId: input.projectId,
      folders,
      options: input.options ?? {},
      toolSnapshot: this.snapshotTools(input.tools ?? (input.projectId ? this.project(input.projectId).toolSelection : undefined), this.account(input.accountId).provider),
      accountId: input.accountId,
      title: input.title?.trim() || DEFAULT_TITLE,
      status: 'idle',
      archived: false,
      createdAt: now(),
      updatedAt: now()
    };
    this.state.conversations.push(c);
    this.publish();
    return c;
  }

  folders(c: Conversation): string[] {
    return c.projectId ? this.project(c.projectId).folders : c.folders ?? [];
  }

  attachmentFolder(id: string): string {
    this.conversation(id);
    return path.join(this.store.root, 'attachments', id);
  }

  attachData(id: string, name: string, data: Uint8Array): Attachment {
    return saveAttachment(this.attachmentFolder(id), name, data);
  }

  attachFiles(id: string, paths: string[]): Attachment[] {
    if (paths.length > 10) throw new Error('Choose at most 10 files.');
    return paths.map((file) => {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > MAX_ATTACHMENT_BYTES) throw new Error('Choose files smaller than 20 MB.');
      return this.attachData(id, path.basename(file), fs.readFileSync(file));
    });
  }

  async setConversationOptions(id: string, options: RunOptions): Promise<void> {
    const c = this.conversation(id);
    if (this.runs.has(id) || this.deleting.has(id)) throw new Error('Wait for the conversation to finish before changing the model.');
    const catalog = await this.listModels(c.accountId);
    const model = options.model ? catalog.models.find((m) => m.id === options.model) : catalog.models.find((m) => m.isDefault) ?? catalog.models[0];
    if (!model) throw new Error('Selected model is unavailable.');
    if (options.effort && !model.efforts.includes(options.effort)) throw new Error('This reasoning level is unavailable for the selected model.');
    if (options.fast && !model.fast) throw new Error('Fast speed is unavailable for the selected model.');
    if (this.conversation(id) !== c || this.runs.has(id) || this.deleting.has(id)) throw new Error('Wait for the conversation to finish before changing the model.');
    c.options = { model: model.id, effort: options.effort || model.defaultEffort, fast: !!options.fast };
    this.publish();
  }

  async deleteConversation(id: string): Promise<{ ok: boolean; error?: string; note?: string }> {
    const c = this.conversation(id);
    if (this.runs.has(id)) return { ok: false, error: 'Stop the conversation before deleting it.' };
    if (this.deleting.has(id)) return { ok: false, error: 'This conversation is already being deleted.' };
    this.deleting.add(id);
    try {
      let note: string | undefined;
      const a = this.state.accounts.find((a) => a.id === c.accountId);
      if (c.providerSessionId) {
        const deleted = a && await this.adapters[a.provider].deleteSession(a, this.store.accountHome(a.id), c.providerSessionId).catch(() => false);
        if (!deleted) note = 'Deleted from Ailo. The provider may still keep its own session history.';
      }
      if (this.runs.has(id)) return { ok: false, error: 'Stop the conversation before deleting it.' };
      this.store.deleteTranscript(id);
      const ownedAttachments = this.attachmentFolder(id);
      fs.rmSync(ownedAttachments, { recursive: true, force: true });
      // Working folders (including standalone scratch folders) may contain user work: keep them.
      this.state.conversations = this.state.conversations.filter((c) => c.id !== id);
      this.publish();
      return { ok: true, note };
    } finally { this.deleting.delete(id); }
  }

  renameConversation(id: string, title: string): void {
    const c = this.conversation(id);
    if (title.trim()) c.title = title.trim().slice(0, 120);
    this.publish();
  }

  archiveConversation(id: string, archived: boolean): void {
    const c = this.conversation(id);
    if (archived && this.runs.has(id)) throw new Error('Stop the conversation before archiving it.');
    c.archived = archived;
    this.publish();
  }

  /** Other running conversations whose folders overlap this conversation's project folders. */
  folderConflicts(conversationId: string): FolderConflict[] {
    const c = this.conversation(conversationId);
    const folders = this.folders(c);
    const out: FolderConflict[] = [];
    for (const other of this.state.conversations) {
      if (other.id === c.id || !this.runs.has(other.id)) continue;
      const otherFolders = this.folders(other);
      const hit = folders.find((f) => otherFolders.some((g) => foldersOverlap(f, g)));
      if (hit) out.push({ conversationId: other.id, title: other.title, accountId: other.accountId, folder: hit });
    }
    return out;
  }

  // ---- runs ---------------------------------------------------------------

  isRunning(id: string): boolean {
    return this.runs.has(id);
  }

  private item(conversationId: string, item: ChatItem): void {
    this.store.upsertItem(conversationId, item);
    this.emit({ type: 'item', conversationId, item });
  }

  private setStatus(c: Conversation, status: Conversation['status'], lastError?: string): void {
    c.status = status;
    c.lastError = lastError;
    c.updatedAt = now();
    this.automations.conversationChanged(c);
    this.publish();
  }

  async sendMessage(conversationId: string, text: string, opts: { acknowledgeConflicts?: boolean; wait?: boolean; attachments?: Attachment[] } = {}): Promise<StartTurnResult> {
    const c = this.conversation(conversationId);
    if (this.deleting.has(c.id)) return { ok: false, error: 'This conversation is being deleted.' };
    const body = text;
    let attachments: Attachment[];
    try { attachments = validateAttachments(this.attachmentFolder(c.id), opts.attachments ?? []); }
    catch (err) { return { ok: false, error: (err as Error).message }; }
    if (!body.trim() && !attachments.length) return { ok: false, error: 'Message is empty' };
    if (this.runs.has(c.id)) return { ok: false, error: 'This conversation is still running. Wait, or stop the run first.' };
    if (c.archived) return { ok: false, error: 'This conversation is archived. Restore it to continue.' };
    const account = this.state.accounts.find((a) => a.id === c.accountId);
    if (!account) return { ok: false, error: 'The account of this conversation no longer exists. Start a new conversation with another account.' };
    const folders = this.folders(c);
    if (!folders.length) return { ok: false, error: 'No working folder configured.' };
    const missing = folders.find((f) => !fs.existsSync(f));
    if (missing) return { ok: false, error: `Working folder not found: ${missing}` };
    const conflicts = this.folderConflicts(c.id);
    if (conflicts.length && !opts.acknowledgeConflicts) return { ok: false, conflicts };

    const run: ActiveRun = { stopping: false, prompts: new Map() };
    this.runs.set(c.id, run);
    if (c.title === DEFAULT_TITLE) c.title = (body.trim() || attachments[0]?.name || DEFAULT_TITLE).split('\n')[0].slice(0, 60);
    this.item(c.id, { kind: 'user', id: randomUUID(), text: body, attachments, at: now() });
    if (conflicts.length) {
      this.item(c.id, {
        kind: 'notice',
        id: randomUUID(),
        level: 'warning',
        text: `Started while ${conflicts.length === 1 ? 'another conversation is' : `${conflicts.length} other conversations are`} running in the same folder. Both can change the same files.`,
        at: now()
      });
    }
    this.setStatus(c, 'running');
    const finished = this.execute(c, account, folders, body, attachments, run);
    if (opts.wait) await finished;
    return { ok: true };
  }

  private async execute(c: Conversation, account: Account, folders: string[], body: string, attachments: Attachment[], run: ActiveRun): Promise<void> {
    const adapter = this.adapters[account.provider];
    const home = this.store.accountHome(account.id);
    let secrets: string[] = [];
    const sanitize = <T>(value: T): T => {
      if (typeof value === 'string') return hideSecrets(value, secrets) as T;
      if (Array.isArray(value)) return value.map(sanitize) as T;
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)])) as T;
      return value;
    };
    const log = (line: string) => {
      const l = `${new Date().toLocaleTimeString()} ${hideSecrets(line, secrets)}`;
      this.store.appendLog(c.id, l);
      this.emit({ type: 'log', conversationId: c.id, line: l });
    };
    log(`start · account "${account.alias}" (${account.provider}) · folder ${folders.join(', ')}`);

    const prompt = <T>(item: ChatItem, signal?: AbortSignal): Promise<T> =>
      new Promise<T>((resolve) => {
        const finish = (v: T) => {
          run.prompts.delete(item.id);
          if (!run.prompts.size && c.status === 'awaiting_input') this.setStatus(c, 'running');
          resolve(v);
        };
        run.prompts.set(item.id, finish);
        this.item(c.id, item);
        this.setStatus(c, 'awaiting_input');
        signal?.addEventListener('abort', () => run.prompts.has(item.id) && this.resolvePrompt(c.id, item.id, null), { once: true });
      });

    try {
      if (account.connection.state !== 'connected') {
        const conn = await this.checkAccount(account.id);
        if (conn.state !== 'connected') {
          throw new ProviderError(
            conn.state === 'error' ? `Account "${account.alias}" cannot be used: ${conn.message}` : `Account "${account.alias}" is not signed in. Sign in again from Accounts; Ailo never switches to another account.`,
            true
          );
        }
      }
      if (run.stopping) throw new ProviderError('Stopped before the run started.');
      const tools = c.toolSnapshot;
      const credentials = Object.fromEntries(await Promise.all((tools?.connections ?? []).map(async (connection) => [connection.id, await this.connectionCredentials(connection)] as const)));
      secrets = secretValues(credentials);
      run.handle = await adapter.runTurn({
        account,
        home,
        cwd: folders[0],
        extraDirs: [...folders.slice(1), ...(attachments.some((a) => a.kind === 'file') ? [this.attachmentFolder(c.id)] : [])],
        sessionId: c.providerSessionId,
        text: body,
        attachments,
        options: c.options,
        mode: c.executionMode,
        tools, credentials,
        cb: {
          openUrl: this.openUrl,
          onUsage: (usage) => { account.usage = usage; this.publish(); },
          onContext: (context) => { c.context = context; this.publish(); },
          onSession: (sid) => {
            if (c.providerSessionId !== sid) {
              c.providerSessionId = sid;
              this.publish();
            }
          },
          onItem: (item) => this.item(c.id, sanitize(item)),
          onDelta: (itemId, delta) => {
            delta = hideSecrets(delta, secrets);
            if (this.store.appendDelta(c.id, itemId, delta)) this.emit({ type: 'delta', conversationId: c.id, itemId, text: delta });
          },
          onLog: log,
          requestApproval: (request: ApprovalRequest, signal) => c.executionMode === 'report' ? Promise.resolve('deny') : prompt<ApprovalDecision | 'cancelled'>({ kind: 'approval', id: randomUUID(), request: sanitize(request), at: now() }, signal),
          requestAnswers: (questions: Question[], signal) => prompt<Record<string, string> | null>({ kind: 'question', id: randomUUID(), questions: sanitize(questions), at: now() }, signal)
        }
      });
      if (run.stopping) void run.handle.stop();
      const outcome = await run.handle.done;
      this.finishOpenItems(c.id);
      if (outcome.status === 'completed') this.setStatus(c, 'idle');
      else if (outcome.status === 'interrupted') {
        this.item(c.id, { kind: 'notice', id: randomUUID(), level: 'info', text: 'Run stopped.', at: now() });
        this.setStatus(c, 'interrupted');
      } else {
        this.failRun(c, hideSecrets(outcome.message, secrets), outcome.authProblem);
      }
    } catch (err) {
      this.finishOpenItems(c.id);
      const e = err as ProviderError;
      this.failRun(c, hideSecrets(e.message, secrets), e.authProblem);
    } finally {
      for (const resolve of run.prompts.values()) resolve(null);
      this.runs.delete(c.id);
      void this.refreshUsage(account.id).catch(() => {});
      log('end');
      this.store.flush();
      this.publish();
    }
  }

  private failRun(c: Conversation, message: string, authProblem?: boolean): void {
    const msg = redact(message);
    if (authProblem) {
      const a = this.state.accounts.find((x) => x.id === c.accountId);
      if (a) a.connection = { state: 'signed_out', checkedAt: now() };
    }
    this.item(c.id, {
      kind: 'notice',
      id: randomUUID(),
      level: 'error',
      text: authProblem ? `Sign-in required: ${msg}` : msg,
      detail: authProblem ? 'Open Accounts and choose "Sign in again" for this account. The conversation stays linked to this account.' : undefined,
      at: now()
    });
    this.setStatus(c, 'error', msg);
  }

  /** Close streaming/running items so nothing appears to be in progress after a run ends. */
  private finishOpenItems(conversationId: string): void {
    for (const item of this.store.transcript(conversationId).items) {
      let changed = false;
      if (item.kind === 'assistant' && item.streaming) (item.streaming = false), (changed = true);
      if (item.kind === 'tool' && item.status === 'running') (item.status = 'failed'), (changed = true);
      if (item.kind === 'diff' && item.status === 'pending') (item.status = 'failed'), (changed = true);
      if (changed) this.emit({ type: 'item', conversationId, item });
    }
  }

  async stop(conversationId: string): Promise<void> {
    const run = this.runs.get(conversationId);
    if (!run) return;
    run.stopping = true;
    for (const id of [...run.prompts.keys()]) this.resolvePrompt(conversationId, id, null);
    await run.handle?.stop();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.runs.keys()].map((id) => this.stop(id)));
  }

  respondApproval(conversationId: string, itemId: string, decision: ApprovalDecision): void {
    this.resolvePrompt(conversationId, itemId, decision);
  }

  respondQuestion(conversationId: string, itemId: string, answers: Record<string, string> | null): void {
    this.resolvePrompt(conversationId, itemId, answers);
  }

  private resolvePrompt(conversationId: string, itemId: string, value: any): void {
    const run = this.runs.get(conversationId);
    const resolve = run?.prompts.get(itemId);
    if (!resolve) return;
    const item = this.store.transcript(conversationId).items.find((x) => x.id === itemId);
    if (item?.kind === 'approval') item.resolution = value === 'approve' ? 'approved' : value === 'approve_session' ? 'approved_session' : value === 'deny' ? 'denied' : 'cancelled';
    if (item?.kind === 'question') {
      item.resolution = value ? 'answered' : 'cancelled';
      item.answers = value ?? undefined;
    }
    if (item) this.item(conversationId, item);
    resolve(value ?? (item?.kind === 'approval' ? 'cancelled' : null));
  }

  setSettings(patch: Partial<Settings>): void {
    Object.assign(this.state.settings, patch);
    this.publish();
  }

  async dispose(): Promise<void> {
    this.automations.shutdown();
    await this.stopAll();
    for (const l of this.logins.values()) l.cancel();
    await Promise.all(Object.values(this.adapters).map((a) => a.dispose()));
    this.store.flush();
  }
}
