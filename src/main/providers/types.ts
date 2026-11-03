import type { Account, AccountConnection, AccountUsage, ApprovalDecision, ApprovalRequest, Attachment, ChatItem, ConnectionCredentials, ContextUsage, ExecutionMode, LoginProgress, ModelCatalog, ProviderId, Question, RunOptions, ToolSnapshot } from '../../shared/types';

export interface RunCallbacks {
  openUrl?(url: string): void;
  /** Provider session/thread id, as soon as it is known. */
  onSession(sessionId: string): void;
  /** Add or replace a transcript item (matched by id). */
  onItem(item: ChatItem): void;
  /** Append streamed text to an existing assistant item. */
  onDelta(itemId: string, text: string): void;
  /** Technical log line; redacted by the caller. */
  onLog(line: string): void;
  /** Ask the user; resolves when they decide or the run is stopped. */
  requestApproval(req: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision | 'cancelled'>;
  requestAnswers(questions: Question[], signal?: AbortSignal): Promise<Record<string, string> | null>;
  /** Fresh plan-limit numbers for the account. */
  onUsage(usage: AccountUsage): void;
  /** Context/token usage of this conversation. */
  onContext(context: ContextUsage): void;
}

export type RunOutcome =
  | { status: 'completed' }
  | { status: 'interrupted' }
  | { status: 'failed'; message: string; authProblem?: boolean };

export interface RunParams {
  account: Account;
  home: string;
  cwd: string;
  extraDirs: string[];
  sessionId?: string;
  text: string;
  attachments: Attachment[];
  options: RunOptions;
  mode?: ExecutionMode;
  tools?: ToolSnapshot;
  credentials?: Record<string, ConnectionCredentials>;
  cb: RunCallbacks;
}

export interface RunHandle {
  done: Promise<RunOutcome>;
  stop(): Promise<void>;
}

export interface LoginHandle {
  submitCode(code: string): void;
  cancel(): void;
  done: Promise<void>;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  /** Prepare a fresh account directory (provider-specific config). */
  initHome(home: string): void;
  checkAccount(account: Account, home: string): Promise<AccountConnection>;
  startLogin(account: Account, home: string, onProgress: (p: LoginProgress) => void): Promise<LoginHandle>;
  logout(account: Account, home: string): Promise<void>;
  runTurn(params: RunParams): Promise<RunHandle>;
  listModels(account: Account, home: string): Promise<ModelCatalog>;
  getUsage(account: Account, home: string): Promise<AccountUsage | undefined>;
  /** Best effort: remove the provider's own copy of a session. Returns false if not supported. */
  deleteSession(account: Account, home: string, sessionId: string): Promise<boolean>;
  /** Release processes for one account, or all when omitted. */
  dispose(accountId?: string): Promise<void>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly authProblem = false
  ) {
    super(message);
  }
}

export function looksLikeAuthProblem(text: string): boolean {
  return /not logged in|please run \/login|log ?in expired|unauthori[sz]ed|\b401\b|invalid api key|authentication|token (has )?expired|refresh token/i.test(text);
}
