import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppState, Attachment, Conversation, FolderConflict } from '../../../shared/types';
import { PROVIDER_LABEL } from '../../../shared/types';
import { api } from '../api';
import { loadTranscript, useView } from '../store';
import { TerminalTranscript } from './Transcript';
import { Activity } from './Activity';
import { AccountBadge, Dialog, shortPath, StatusDot } from './ui';
import { Composer } from './Composer';
import { RunControls } from './RunControls';
import { Usage } from './Usage';
import { emptyTools, ToolPicker } from './ToolPicker';

export function ConversationView({ app, conv, onOpenAccounts, renameSignal, onDeleted }: { app: AppState; conv: Conversation; onOpenAccounts: () => void; renameSignal: number; onDeleted: (note?: string) => void }) {
  const view = useView();
  const account = app.accounts.find((a) => a.id === conv.accountId);
  const project = app.projects.find((p) => p.id === conv.projectId);
  const folders = project?.folders ?? conv.folders ?? [];
  const items = view.transcripts[conv.id];
  const [showTools, setShowTools] = useState(false);
  const [tools, setTools] = useState(() => conv.toolSnapshot ? { connectionIds: conv.toolSnapshot.connections.map((c) => c.id), skillIds: conv.toolSnapshot.skills.map((s) => s.id), pluginIds: conv.toolSnapshot.plugins.map((p) => p.id) } : emptyTools());
  const [error, setError] = useState<string>();
  const [conflicts, setConflicts] = useState<FolderConflict[]>();
  const [showLog, setShowLog] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [title, setTitle] = useState(conv.title);
  const [liveConflicts, setLiveConflicts] = useState<FolderConflict[]>([]);
  const pendingConflict = useRef<((approved: boolean) => void) | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const scrollMetrics = useRef({ height: 0, viewport: 0 });
  const busy = conv.status === 'running' || conv.status === 'awaiting_input';

  useEffect(() => {
    void loadTranscript(conv.id).catch((e) => setError(e.message));
    return () => pendingConflict.current?.(false);
  }, [conv.id]);
  useEffect(() => setTitle(conv.title), [conv.title]);
  useEffect(() => { if (renameSignal) setEditing(true); }, [renameSignal]);
  useEffect(() => {
    let live = true;
    void api.folderConflicts(conv.id).then((c) => { if (live) setLiveConflicts(c); }).catch(() => {});
    return () => { live = false; };
  }, [conv.id, app.conversations]);
  useLayoutEffect(() => {
    const el = scroller.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      const previous = scrollMetrics.current;
      const wasAtBottom = previous.height - el.scrollTop - previous.viewport < 60;
      if (stick.current && wasAtBottom) el.scrollTop = el.scrollHeight;
      else if (!wasAtBottom) stick.current = false;
      scrollMetrics.current = { height: el.scrollHeight, viewport: el.clientHeight };
    });
    let frame: number | undefined;
    const onToggle = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; });
    };
    observer.observe(content); observer.observe(el);
    el.addEventListener('toggle', onToggle, true);
    return () => { observer.disconnect(); el.removeEventListener('toggle', onToggle, true); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [conv.id, items === undefined, !!items?.length]);

  async function send(text: string, attachments: Attachment[]): Promise<boolean> {
    setError(undefined);
    let result = await api.sendMessage(conv.id, text, { attachments });
    if (result.conflicts?.length) {
      setConflicts(result.conflicts);
      const approved = await new Promise<boolean>((resolve) => { pendingConflict.current = resolve; });
      pendingConflict.current = undefined;
      setConflicts(undefined);
      if (!approved) return false;
      result = await api.sendMessage(conv.id, text, { attachments, acknowledgeConflicts: true });
    }
    if (!result.ok) { setError(result.error); return false; }
    stick.current = true;
    return true;
  }

  const accountProblem = account && (account.connection.state === 'signed_out' || account.connection.state === 'error');
  return <main className="conv conv-terminal" aria-label={`Conversation ${conv.title}`}>
    <header className="conv-head">
      <div className="conv-title-row">
        {editing ? <form onSubmit={(e) => { e.preventDefault(); void api.renameConversation(conv.id, title); setEditing(false); }}>
          <input className="input title-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => { void api.renameConversation(conv.id, title); setEditing(false); }} onKeyDown={(e) => { if (e.key === 'Escape') { setTitle(conv.title); setEditing(false); } }} aria-label="Conversation name"/>
        </form> : <h1 className="conv-title" onDoubleClick={() => setEditing(true)} title="Double-click or press F2 to rename">{conv.title}</h1>}
        <StatusDot status={conv.status} withLabel/>
      </div>
      <div className="conv-meta">
        <AccountBadge account={account} size="lg" showProvider/>
        <button className="link-btn muted small working-folder" title={`Open in File Explorer\n${folders.join('\n')}`} aria-label="Open working folder in File Explorer" disabled={!folders.length} onClick={() => void api.openConversationFolder(conv.id).catch((e) => setError(e.message))}>⌁ {project?.name ?? 'Standalone'} · {shortPath(folders[0] ?? '')}{folders.length > 1 && ` +${folders.length - 1}`}</button>
        <span className="spacer"/>
        <button className="link-btn" onClick={() => setShowTools(true)}>Tools ({(conv.toolSnapshot?.connections.length ?? 0) + (conv.toolSnapshot?.skills.length ?? 0) + (conv.toolSnapshot?.plugins.length ?? 0)})</button>
        <button className="link-btn" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>Technical log</button>
        <button className="link-btn" onClick={() => void api.archiveConversation(conv.id, !conv.archived)} disabled={busy || deleteBusy}>{conv.archived ? 'Restore' : 'Archive'}</button>
        <button className="link-btn danger" onClick={() => setDeleting(true)} disabled={busy || deleteBusy}>Delete</button>
      </div>
      {accountProblem && <div className="banner banner-error" role="alert"><span><strong>{account.alias}</strong> is {account.connection.state === 'signed_out' ? 'not signed in' : 'not usable'}.</span><button className="btn small" onClick={onOpenAccounts}>Sign in again</button></div>}
      {!!liveConflicts.length && <div className="banner banner-warn" role="status">Shared working folder: {liveConflicts.map((c) => c.title).join(', ')}. Both conversations can change the same files.</div>}
    </header>
    {showLog && <section className="log-panel" aria-label="Technical log"><pre className="mono small">{(view.logs[conv.id] ?? []).join('\n') || 'No technical messages yet.'}</pre></section>}
    <div className="transcript term" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; scrollMetrics.current = { height: el.scrollHeight, viewport: el.clientHeight }; }}
      onClickCapture={(e) => { if (e.target instanceof Element && e.target.closest('summary')) stick.current = false; }}
      onKeyDownCapture={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.closest('summary')) stick.current = false; }}
      aria-live="polite" aria-busy={busy}>
      {items === undefined ? <p className="muted center">Loading…</p> : !items.length ? <div className="empty-conv"><p>New conversation with <strong>{account?.alias}</strong> ({account && PROVIDER_LABEL[account.provider]}).</p><p className="muted small">Paste text or images, attach files, and choose your model below.</p></div> : <TerminalTranscript conversationId={conv.id} items={items} live={busy}/>}
    </div>
    {conflicts && <div className="banner banner-warn conflict-ask" role="alertdialog" aria-label="Shared working folder"><div><strong>Another conversation is already working in this folder.</strong><ul>{conflicts.map((c) => <li key={c.conversationId}>{c.title} — {app.accounts.find((a) => a.id === c.accountId)?.alias} ({shortPath(c.folder)})</li>)}</ul><span className="small">Both conversations can change the same files.</span></div><div className="approval-actions"><button className="btn" onClick={() => pendingConflict.current?.(false)} autoFocus>Wait</button><button className="btn primary" onClick={() => pendingConflict.current?.(true)}>Start anyway</button></div></div>}
    {error && <div className="composer-error pad" role="alert">{error}</div>}
    <Activity items={items ?? []} status={conv.status} startedAt={conv.updatedAt}/>
    <Composer conv={conv} alias={account?.alias} disabled={conv.archived || !account || deleteBusy} onSend={send}/>
    {account && <div className="conversation-info" aria-label="Model and account usage">
      <RunControls conv={conv} busy={busy || deleteBusy} compact/>
      <Usage account={account} compact/>
      {conv.context && <span className="context-usage muted small" title={`Context: ${conv.context.tokens.toLocaleString()}${conv.context.window ? ` / ${conv.context.window.toLocaleString()}` : ''} tokens${conv.context.costUsd != null ? ` · API estimate $${conv.context.costUsd.toFixed(3)} (not a subscription charge)` : ''}`}>Context {conv.context.window ? `${Math.round(100 * conv.context.tokens / conv.context.window)}%` : `${(conv.context.tokens / 1000).toFixed(1)}k`}</span>}
    </div>}
    <Dialog open={showTools} onClose={() => setShowTools(false)} title="Conversation tools" wide>
      {conv.providerSessionId ? <><p className="muted small">This conversation keeps the tools and versions selected when it started. Start a new conversation to change them.</p><ul>{[...(conv.toolSnapshot?.connections ?? []).map((c) => `${c.name} ? ${c.identity}`), ...(conv.toolSnapshot?.skills ?? []).map((s) => s.name), ...(conv.toolSnapshot?.plugins ?? []).map((p) => `${p.name} ? ${p.version}`)].map((name, i) => <li key={i}>{name}</li>)}</ul></> : <><ToolPicker app={app} provider={account?.provider} value={tools} onChange={setTools} report={conv.executionMode === 'report'}/><button className="btn primary" disabled={busy} onClick={async () => { try { await api.setConversationTools(conv.id, tools); setShowTools(false); } catch (e) { setError((e as Error).message); } }}>Apply tools</button></>}
    </Dialog>
    <Dialog open={deleting} onClose={() => { if (!deleteBusy) setDeleting(false); }} title="Delete conversation?">
      <p>Delete “{conv.title}” and its attachments from Ailo? Working files stay on disk. Ailo also tries to remove the provider session.{account?.provider === 'claude' && ' Claude keeps its own session history.'}</p>
      <div className="row"><button className="btn" disabled={deleteBusy} onClick={() => setDeleting(false)} data-initial-focus>Cancel</button><button className="btn danger" disabled={deleteBusy} onClick={async () => {
        setDeleteBusy(true);
        try { const result = await api.deleteConversation(conv.id); if (!result.ok) setError(result.error); else onDeleted(result.note); setDeleting(false); }
        catch (e) { setError((e as Error).message); } finally { setDeleteBusy(false); }
      }}>{deleteBusy ? 'Deleting…' : 'Delete conversation'}</button></div>
    </Dialog>
  </main>;
}
