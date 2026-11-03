// Types shared between the main process and the renderer.
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

export type ProviderId = 'claude' | 'codex';

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex'
};

export type AccountConnection =
  | { state: 'unknown' }
  | { state: 'checking' }
  | { state: 'connected'; email?: string; plan?: string; organization?: string; checkedAt: string }
  | { state: 'signed_out'; checkedAt: string }
  | { state: 'error'; message: string; checkedAt: string };

/** One plan limit window, e.g. the 5-hour or weekly window. */
export interface UsageWindow {
  label: string;
  usedPercent: number;
  /** ISO timestamp. */
  resetsAt?: string;
}

export interface AccountUsage {
  windows: UsageWindow[];
  /** Extra info such as credit balance. */
  note?: string;
  /** "experimental" when the provider marks the source as unstable. */
  source: 'official' | 'experimental';
  updatedAt: string;
}

export interface Account {
  id: string;
  provider: ProviderId;
  alias: string;
  color: string;
  icon?: string;
  createdAt: string;
  connection: AccountConnection;
  usage?: AccountUsage;
}

export interface Project {
  id: string;
  name: string;
  /** First folder is the working directory; extra folders are passed as additional roots. */
  folders: string[];
  defaultAccountId?: string;
  toolSelection?: ToolSelection;
  createdAt: string;
}

export type ConversationStatus = 'idle' | 'running' | 'awaiting_input' | 'error' | 'interrupted';

/** Model settings for a conversation. Empty values mean "use the CLI default". */
export interface RunOptions {
  model?: string;
  effort?: string;
  fast?: boolean;
}

export interface ContextUsage {
  tokens: number;
  window?: number;
  costUsd?: number;
}

export interface Conversation {
  id: string;
  /** Absent for a standalone conversation. */
  projectId?: string;
  /** Folders for a standalone conversation (first = working folder). */
  folders?: string[];
  /** Fixed at creation. Never changes. */
  accountId: string;
  title: string;
  status: ConversationStatus;
  /** Provider-side session/thread id, set after the first turn starts. */
  providerSessionId?: string;
  options: RunOptions;
  context?: ContextUsage;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
  toolSnapshot?: ToolSnapshot;
  executionMode?: ExecutionMode;
  automationRunId?: string;
}

export interface Attachment {
  name: string;
  /** Absolute path of Ailo's own copy. */
  path: string;
  kind: 'image' | 'file';
  size: number;
}

/** Normalised transcript entries. Provider-specific raw events never reach the UI as chat content. */
export type ChatItem =
  | { kind: 'user'; id: string; text: string; attachments?: Attachment[]; delivery?: 'pending' | 'sent'; at: string }
  | { kind: 'assistant'; id: string; text: string; streaming?: boolean; at: string }
  | { kind: 'reasoning'; id: string; text: string; at: string }
  | {
      kind: 'tool';
      id: string;
      title: string;
      /** Short secondary label, e.g. the command or path. */
      subtitle?: string;
      detail?: string;
      output?: string;
      status: 'running' | 'done' | 'failed' | 'declined' | 'interrupted';
      exitCode?: number;
      at: string;
    }
  | { kind: 'diff'; id: string; files: { path: string; change: string; diff: string }[]; status: 'pending' | 'applied' | 'failed' | 'declined' | 'interrupted'; at: string }
  | { kind: 'approval'; id: string; request: ApprovalRequest; resolution?: 'approved' | 'approved_session' | 'denied' | 'cancelled'; at: string }
  | { kind: 'question'; id: string; questions: Question[]; answers?: Record<string, string>; resolution?: 'answered' | 'cancelled'; at: string }
  | { kind: 'notice'; id: string; level: 'info' | 'warning' | 'error'; text: string; detail?: string; at: string };

export interface ApprovalRequest {
  title: string;
  /** e.g. command line, file path, or a short description. */
  detail?: string;
  reason?: string;
  /** Whether the provider offers "allow for this session". */
  allowSession: boolean;
  /** Provider advises not to make approval a single keystroke. */
  defaultToNo?: boolean;
}

export interface Question {
  id: string;
  header?: string;
  question: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

export type ApprovalDecision = 'approve' | 'approve_session' | 'deny';

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  efforts: string[];
  defaultEffort?: string;
  /** Provider offers a faster, more expensive speed for this model. */
  fast: boolean;
  isDefault?: boolean;
}

export interface ModelCatalog {
  models: ModelOption[];
  /** Explains what "fast" costs for this provider. */
  fastNote: string;
}

export interface Transcript {
  conversationId: string;
  items: ChatItem[];
  /** Technical log lines (redacted). Shown only on request. */
  log: string[];
}

export interface CliInfo {
  provider: ProviderId;
  found: boolean;
  path?: string;
  version?: string;
  source?: string;
  error?: string;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  onboardingDone: boolean;
}

export interface AppState {
  accounts: Account[];
  projects: Project[];
  conversations: Conversation[];
  settings: Settings;
  connections: McpConnection[];
  skills: AiloSkill[];
  plugins: LocalPlugin[];
  automations: Automation[];
  automationRuns: AutomationRun[];
}

export interface McpConnection {
  id: string;
  name: string;
  identity: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  /** An immutable encrypted credential record; never the credential itself. */
  credentialId?: string;
  providers: ProviderId[];
  enabledTools?: string[];
  createdAt: string;
}
export interface ConnectionCredentials {
  bearerToken?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  oauth?: { client?: OAuthClientInformationMixed; tokens?: OAuthTokens; redirectUri: string; expiresAt?: number };
}
export type ConnectionInput = Omit<McpConnection, 'id' | 'createdAt' | 'credentialId'> & { id?: string; credentials?: ConnectionCredentials; clearCredentials?: boolean };
export interface ConnectionTest { ok: boolean; tools: { name: string; description?: string }[]; error?: string; checkedAt: string }
export interface AiloSkill { id: string; name: string; instructions: string; createdAt: string }
export interface LocalPlugin { id: string; name: string; version: string; description: string; path: string; providers: ProviderId[]; components: string[]; digest: string; createdAt: string }
export interface ToolSelection { connectionIds: string[]; skillIds: string[]; pluginIds: string[] }
export interface ToolSnapshot { connections: McpConnection[]; skills: AiloSkill[]; plugins: LocalPlugin[] }
export type ExecutionMode = 'workspace' | 'report' | 'worktree';
export interface AutomationSchedule { frequency: 'manual' | 'daily' | 'weekdays' | 'weekly'; time: string; timeZone: string; weekday: number }
export interface Automation {
  id: string;
  name: string;
  prompt: string;
  accountId: string;
  projectId?: string;
  folders?: string[];
  options: RunOptions;
  tools: ToolSelection;
  mode: ExecutionMode;
  schedule: AutomationSchedule;
  enabled: boolean;
  timeoutMinutes: number;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}
export type AutomationInput = Omit<Automation, 'id' | 'nextRunAt' | 'createdAt' | 'updatedAt'> & { id?: string };
export interface AutomationRun {
  id: string;
  automationId: string;
  definition: Automation;
  tools?: ToolSnapshot;
  trigger: 'manual' | 'scheduled';
  scheduledAt?: string;
  status: 'queued' | 'running' | 'needs_attention' | 'completed' | 'failed' | 'interrupted' | 'blocked' | 'missed';
  conversationId?: string;
  worktreePath?: string;
  branch?: string;
  message?: string;
  summary?: string;
  startedAt: string;
  finishedAt?: string;
}

/** Another run in the same folder; used for the shared-folder warning. */
export interface FolderConflict {
  conversationId: string;
  title: string;
  accountId: string;
  folder: string;
}

export type LoginProgress =
  | { stage: 'started'; url?: string; userCode?: string; acceptsCode: boolean }
  | { stage: 'completed' }
  | { stage: 'failed'; message: string };

export type MainEvent =
  | { type: 'state'; state: AppState }
  | { type: 'transcript'; conversationId: string; items: ChatItem[] }
  | { type: 'item'; conversationId: string; item: ChatItem }
  | { type: 'delta'; conversationId: string; itemId: string; text: string }
  | { type: 'log'; conversationId: string; line: string }
  | { type: 'login'; accountId: string; progress: LoginProgress };

export interface StartTurnResult {
  ok: boolean;
  error?: string;
  conflicts?: FolderConflict[];
}

export interface NewConversationInput {
  accountId: string;
  /** Use an existing project ... */
  projectId?: string;
  /** ... or these folders (standalone). Neither: a fresh empty folder. */
  folders?: string[];
  title?: string;
  options?: RunOptions;
  tools?: ToolSelection;
}

/** API exposed to the renderer via the preload bridge. */
export interface AiloApi {
  authorizeConnection(id: string): Promise<void>;
  saveConnection(input: ConnectionInput): Promise<McpConnection>;
  removeConnection(id: string): Promise<void>;
  testConnection(id: string): Promise<ConnectionTest>;
  saveSkill(input: { id?: string; name: string; instructions: string }): Promise<AiloSkill>;
  removeSkill(id: string): Promise<void>;
  importPlugin(folder: string): Promise<LocalPlugin>;
  removePlugin(id: string): Promise<void>;
  setConversationTools(id: string, tools: ToolSelection): Promise<void>;
  saveAutomation(input: AutomationInput): Promise<Automation>;
  removeAutomation(id: string): Promise<void>;
  runAutomation(id: string): Promise<AutomationRun>;
  stopAutomationRun(id: string): Promise<void>;
  removeAutomationRun(id: string): Promise<void>;
  getState(): Promise<AppState>;
  detectClis(): Promise<CliInfo[]>;
  addAccount(input: { provider: ProviderId; alias: string; color: string; icon?: string }): Promise<Account>;
  updateAccount(id: string, patch: Partial<Pick<Account, 'alias' | 'color' | 'icon'>>): Promise<void>;
  removeAccount(id: string): Promise<{ ok: boolean; error?: string }>;
  checkAccount(id: string): Promise<AccountConnection>;
  refreshUsage(id: string): Promise<AccountUsage | undefined>;
  listModels(accountId: string): Promise<ModelCatalog>;
  startLogin(id: string, opts?: { openBrowser?: boolean }): Promise<void>;
  submitLoginCode(id: string, code: string): Promise<void>;
  cancelLogin(id: string): Promise<void>;
  pickFolder(): Promise<string | null>;
  addProject(input: { name: string; folders: string[]; defaultAccountId?: string }): Promise<Project>;
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'folders' | 'defaultAccountId' | 'toolSelection'>>): Promise<void>;
  removeProject(id: string): Promise<{ ok: boolean; error?: string }>;
  createConversation(input: NewConversationInput): Promise<Conversation>;
  renameConversation(id: string, title: string): Promise<void>;
  archiveConversation(id: string, archived: boolean): Promise<void>;
  deleteConversation(id: string): Promise<{ ok: boolean; error?: string; note?: string }>;
  setConversationOptions(id: string, options: RunOptions): Promise<void>;
  getTranscript(id: string): Promise<Transcript>;
  /** Copy files into the conversation's attachment folder. */
  attachFiles(conversationId: string, paths: string[]): Promise<Attachment[]>;
  attachData(conversationId: string, name: string, data: Uint8Array): Promise<Attachment>;
  pickFiles(): Promise<string[]>;
  /** Path of a dropped/pasted File (Electron webUtils). */
  pathForFile(file: File): string;
  sendMessage(id: string, text: string, opts?: { acknowledgeConflicts?: boolean; attachments?: Attachment[] }): Promise<StartTurnResult>;
  stop(id: string): Promise<void>;
  respondApproval(conversationId: string, itemId: string, decision: ApprovalDecision): Promise<void>;
  respondQuestion(conversationId: string, itemId: string, answers: Record<string, string> | null): Promise<void>;
  folderConflicts(conversationId: string): Promise<FolderConflict[]>;
  setSettings(patch: Partial<Settings>): Promise<void>;
  openExternal(url: string): Promise<void>;
  openConversationFolder(id: string): Promise<void>;
  onEvent(cb: (e: MainEvent) => void): () => void;
}
