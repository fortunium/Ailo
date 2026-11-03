import { useEffect, useRef, useState } from 'react';
import type { Attachment, Conversation } from '../../../shared/types';
import { api } from '../api';

// Preserve unsent input while moving between conversations in this app session.
const drafts = new Map<string, { text: string; attachments: Attachment[] }>();

export function Composer({ conv, alias, disabled, onSend }: {
  conv: Conversation; alias?: string; disabled: boolean;
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
}) {
  const [text, setText] = useState(drafts.get(conv.id)?.text ?? '');
  const [attachments, setAttachments] = useState<Attachment[]>(drafts.get(conv.id)?.attachments ?? []);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const attachmentLock = useRef(false);
  const sendLock = useRef(false);
  const busy = conv.status === 'running' || conv.status === 'awaiting_input';
  useEffect(() => { drafts.set(conv.id, { text, attachments }); }, [conv.id, text, attachments]);
  useEffect(() => { if (!document.querySelector('[data-approval-actions="pending"]')) input.current?.focus(); }, []);
  useEffect(() => {
    const el = input.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(230, Math.max(44, el.scrollHeight))}px`; }
  }, [text, collapsed]);

  async function addFiles(files: File[] | string[]) {
    if (!files.length || attachmentLock.current || disabled) return;
    if (attachments.length + files.length > 10) { setError('Attach at most 10 files per message.'); return; }
    attachmentLock.current = true; setUploading(true); setError(undefined);
    try {
      // Convert the full batch before changing state, so failed files are visible as an error.
      const added: Attachment[] = [];
      for (const file of files) {
        if (typeof file === 'string') added.push(...await api.attachFiles(conv.id, [file]));
        else {
          if (file.size > 20 * 1024 * 1024) throw new Error('Files must be smaller than 20 MB.');
          const filePath = api.pathForFile(file);
          if (filePath) added.push(...await api.attachFiles(conv.id, [filePath]));
          else added.push(await api.attachData(conv.id, file.name || 'pasted-image.png', new Uint8Array(await file.arrayBuffer())));
        }
      }
      setAttachments((prev) => [...prev, ...added]);
    } catch (e) { setError((e as Error).message); } finally { attachmentLock.current = false; setUploading(false); }
  }

  async function send() {
    if (busy || disabled || attachmentLock.current || sendLock.current || (!text.trim() && !attachments.length)) return;
    sendLock.current = true; setSending(true); setError(undefined);
    const submittedText = text;
    const submitted = attachments;
    try {
      if (await onSend(submittedText, submitted)) {
        setText(''); setAttachments([]); setCollapsed(false);
        drafts.delete(conv.id);
      }
    } catch (e) { setError((e as Error).message); } finally { sendLock.current = false; setSending(false); if (!document.querySelector('[data-approval-actions="pending"]')) input.current?.focus(); }
  }

  return <footer className={`composer terminal-composer ${dragging ? 'dragging' : ''}`} onKeyDown={(e) => { if (e.key === 'Escape' && busy) { e.preventDefault(); void api.stop(conv.id); } }}
    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
    onDrop={(e) => { e.preventDefault(); setDragging(false); void addFiles(Array.from(e.dataTransfer.files)); }}>
    {error && <div className="composer-error" role="alert">{error}</div>}
    {!!attachments.length && <div className="attachments" aria-label="Pending attachments">{attachments.map((a) => <span className="attachment-chip" key={a.path} title={`${a.name} · ${Math.ceil(a.size / 1024)} KB`}>
      {a.kind === 'image' ? '▧' : '⌁'} {a.name} <span className="muted">{Math.ceil(a.size / 1024)} KB</span><button className="icon-btn small" aria-label={`Remove ${a.name}`} disabled={sending} onClick={() => setAttachments((prev) => prev.filter((x) => x.path !== a.path))}>×</button>
    </span>)}</div>}
    {collapsed && <button className="paste-summary" onClick={() => { setCollapsed(false); setTimeout(() => input.current?.focus(), 0); }}>[Pasted text · {text.split('\n').length} lines · {text.length.toLocaleString()} characters] — click to edit</button>}
    <div className="composer-row">
      <span className="t-prompt composer-prompt" aria-hidden="true">❯</span>
      <textarea ref={input} className="composer-input" rows={1} hidden={collapsed}
        placeholder={conv.archived ? 'Archived conversation' : `Message ${alias ?? 'account'}…`}
        value={text} disabled={disabled || sending} aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files);
          if (files.length) { e.preventDefault(); void addFiles(files); return; }
          const pasted = e.clipboardData.getData('text/plain');
          if (pasted.length > 1800 || pasted.split('\n').length > 12) {
            e.preventDefault(); const el = e.currentTarget;
            setText(text.slice(0, el.selectionStart) + pasted + text.slice(el.selectionEnd)); setCollapsed(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
          else if (e.key === 'Escape' && busy) { e.preventDefault(); void api.stop(conv.id); }
        }}/>
      {collapsed && <span className="spacer"/>}
      {busy ? <button className="btn danger" onClick={() => void api.stop(conv.id)}>■ Stop</button> : <button className="btn primary" disabled={disabled || sending || uploading || (!text.trim() && !attachments.length)} onClick={() => void send()}>{sending ? 'Sending…' : 'Send'}</button>}
    </div>
    <div className="composer-hints"><button className="link-btn" disabled={disabled || sending || uploading} onClick={() => void api.pickFiles().then(addFiles).catch((e) => setError(e.message))}>{uploading ? 'Attaching…' : '+ Attach files'}</button>
      <span className="muted small">Paste images or drop files · Enter to send · Shift+Enter for a new line{busy ? ' · Esc to stop' : ''}</span>
      {text.length > 1800 && !collapsed && <button className="link-btn small" onClick={() => setCollapsed(true)}>Collapse text</button>}
    </div>
  </footer>;
}
