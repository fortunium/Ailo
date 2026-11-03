import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ApprovalDecision, ChatItem } from '../../../shared/types';
import { commandOutputNotice } from '../../../shared/command-diagnostics';
import { api } from '../api';
import { DiffText, FileChangeCode, Markdown } from './Markdown';

type Step = Extract<ChatItem, { kind: 'tool' } | { kind: 'reasoning' }>;
type Block = { type: 'steps'; id: string; steps: Step[] } | { type: 'item'; item: ChatItem };

/** Consecutive tool/reasoning items collapse into one compact progress block. */
function group(items: ChatItem[]): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    if (item.kind === 'tool' || item.kind === 'reasoning') {
      const last = out.at(-1);
      if (last?.type === 'steps') last.steps.push(item);
      else out.push({ type: 'steps', id: `g-${item.id}`, steps: [item] });
    } else out.push({ type: 'item', item });
  }
  return out;
}

const TOOL_STATUS: Record<string, string> = { running: 'running', done: 'done', failed: 'failed', declined: 'declined', interrupted: 'stopped' };
const DIFF_STATUS = { pending: 'proposed', applied: 'applied', failed: 'failed', declined: 'declined', interrupted: 'stopped' } as const;
const APPROVAL_RESULT = { approved: 'Allowed', approved_session: 'Allowed for this session', denied: 'Denied', cancelled: 'Expired' } as const;

function StepRow({ step }: { step: Step }) {
  if (step.kind === 'reasoning') {
    return (
      <details className="step">
        <summary>
          <span className="step-icon" aria-hidden="true">
            💭
          </span>
          <span className="step-title">Reasoning</span>
          <span className="step-sub">{step.text.split('\n')[0].slice(0, 100)}</span>
        </summary>
        <div className="step-body">
          <Markdown text={step.text} />
        </div>
      </details>
    );
  }
  return (
    <details className={`step step-${step.status}`}>
      <summary>
        <span className="step-icon" aria-hidden="true">
          {step.status === 'running' ? '◐' : step.status === 'done' ? '✓' : step.status === 'declined' ? '⊘' : '✕'}
        </span>
        <span className="step-title">{step.title}</span>
        {step.subtitle && <code className="step-sub">{step.subtitle}</code>}
        <span className="sr-only">, {TOOL_STATUS[step.status]}</span>
      </summary>
      <div className="step-body">
        {step.detail && <pre className="mono small">{step.detail}</pre>}
        {step.output ? <pre className="mono small output">{step.output}</pre> : step.status !== 'running' && <p className="muted small">No output.</p>}
      </div>
    </details>
  );
}

function Steps({ steps, live }: { steps: Step[]; live: boolean }) {
  const running = steps.filter((s) => s.kind === 'tool' && s.status === 'running').length;
  const failed = steps.filter((s) => s.kind === 'tool' && s.status === 'failed').length;
  const last = steps.at(-1)!;
  const lastLabel = last.kind === 'tool' ? `${last.title}${last.subtitle ? `: ${last.subtitle}` : ''}` : 'Reasoning';
  return (
    <details className="steps">
      <summary>
        <span className={`steps-pulse ${live && running ? 'on' : ''}`} aria-hidden="true" />
        <span>
          {steps.length} {steps.length === 1 ? 'step' : 'steps'}
          {failed > 0 && <span className="warn-text"> · {failed} failed</span>}
        </span>
        <span className="steps-last">{live && running ? lastLabel : ''}</span>
      </summary>
      <div className="steps-list">
        {steps.map((s) => (
          <StepRow key={s.id} step={s} />
        ))}
      </div>
    </details>
  );
}

function DiffCard({ item }: { item: Extract<ChatItem, { kind: 'diff' }> }) {
  const small = item.files.reduce((n, f) => n + f.diff.split('\n').length, 0) < 40;
  return (
    <details className={`diffcard diff-${item.status}`} open={small && item.status !== 'declined'}>
      <summary>
        <span className="diff-label">Change {DIFF_STATUS[item.status]}</span>
        <span className="diff-files">{item.files.map((f) => f.path.split(/[\\/]/).pop()).join(', ')}</span>
      </summary>
      {item.files.map((f) => (
        <div key={f.path} className="diff-file">
          <div className="diff-path" title={f.path}>
            {f.change === 'add' ? 'New: ' : f.change === 'delete' ? 'Deleted: ' : ''}
            {f.path}
          </div>
          <DiffText diff={f.diff} />
        </div>
      ))}
    </details>
  );
}

/** Allow / Allow for session / Deny. Deny gets focus so a stray Enter never approves. */
function ApprovalActions({ conversationId, item, terminal }: { conversationId: string; item: Extract<ChatItem, { kind: 'approval' }>; terminal?: boolean }) {
  const denyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => denyRef.current?.focus(), []);
  const decide = (d: ApprovalDecision) => void api.respondApproval(conversationId, item.id, d);
  const cls = terminal ? 'term-btn' : 'btn';
  const onKeyDown = (e: KeyboardEvent) => {
    if (!terminal || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === 'y') decide('approve');
    else if (k === 'a' && item.request.allowSession) decide('approve_session');
    else if (k === 'n') decide('deny');
  };
  return (
    <div className="approval-actions" onKeyDown={onKeyDown}>
      <button className={`${cls} primary`} onClick={() => decide('approve')}>
        {terminal ? '[y] Allow' : 'Allow'}
      </button>
      {item.request.allowSession && (
        <button className={cls} onClick={() => decide('approve_session')}>
          {terminal ? '[a] Allow for session' : 'Allow for this session'}
        </button>
      )}
      <button ref={denyRef} className={`${cls} danger`} onClick={() => decide('deny')}>
        {terminal ? '[n] Deny' : 'Deny'}
      </button>
    </div>
  );
}

function ApprovalCard({ conversationId, item }: { conversationId: string; item: Extract<ChatItem, { kind: 'approval' }> }) {
  const pending = !item.resolution;
  return (
    <section className={`approval ${pending ? 'pending' : ''}`} aria-label="Permission request">
      <div className="approval-head">
        <span aria-hidden="true">🔐</span> {item.request.title}
      </div>
      {item.request.detail && <pre className="mono approval-detail">{item.request.detail}</pre>}
      {item.request.reason && <p className="muted small">{item.request.reason}</p>}
      {pending ? <ApprovalActions conversationId={conversationId} item={item} /> : <p className={`approval-result res-${item.resolution}`}>{APPROVAL_RESULT[item.resolution!]}</p>}
    </section>
  );
}

function QuestionCard({ conversationId, item, terminal }: { conversationId: string; item: Extract<ChatItem, { kind: 'question' }>; terminal?: boolean }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const pending = !item.resolution;
  const complete = item.questions.every((q) => answers[q.id] || other[q.id]);
  const submit = () => {
    const out: Record<string, string> = {};
    for (const q of item.questions) out[q.id] = other[q.id]?.trim() || answers[q.id];
    void api.respondQuestion(conversationId, item.id, out);
  };
  return (
    <section className={`${terminal ? 'term-question' : 'approval question'} ${pending ? 'pending' : ''}`} aria-label="Question from the assistant">
      {item.questions.map((q) => (
        <fieldset key={q.id} disabled={!pending}>
          <legend>
            {q.header && <span className="q-header">{q.header}</span>} {q.question}
          </legend>
          {q.options.map((o) => {
            const selected = q.multiSelect ? (answers[q.id] ?? '').split(', ').includes(o.label) : answers[q.id] === o.label;
            return (
              <label key={o.label} className={`q-opt ${selected ? 'sel' : ''}`}>
                <input
                  type={q.multiSelect ? 'checkbox' : 'radio'}
                  name={`${item.id}-${q.id}`}
                  checked={pending ? selected : (item.answers?.[q.id] ?? '').split(', ').includes(o.label)}
                  onChange={() => {
                    if (!q.multiSelect) return setAnswers({ ...answers, [q.id]: o.label });
                    const cur = new Set((answers[q.id] ?? '').split(', ').filter(Boolean));
                    if (cur.has(o.label)) cur.delete(o.label);
                    else cur.add(o.label);
                    setAnswers({ ...answers, [q.id]: [...cur].join(', ') });
                  }}
                />
                <span>
                  <strong>{o.label}</strong>
                  {o.description && <span className="muted"> — {o.description}</span>}
                </span>
              </label>
            );
          })}
          {pending && <input className="input small" placeholder="Or type your own answer" aria-label="Your own answer" value={other[q.id] ?? ''} onChange={(e) => setOther({ ...other, [q.id]: e.target.value })} />}
        </fieldset>
      ))}
      {pending ? (
        <div className="approval-actions">
          <button className={terminal ? 'term-btn primary' : 'btn primary'} disabled={!complete} onClick={submit}>
            Send answer
          </button>
          <button className={terminal ? 'term-btn' : 'btn'} onClick={() => void api.respondQuestion(conversationId, item.id, null)}>
            Skip
          </button>
        </div>
      ) : (
        <p className="approval-result">{item.resolution === 'answered' ? 'Answered' : 'Skipped'}</p>
      )}
    </section>
  );
}

function Notice({ item }: { item: Extract<ChatItem, { kind: 'notice' }> }) {
  return (
    <div className={`notice notice-${item.level}`} role={item.level === 'error' ? 'alert' : undefined}>
      <span aria-hidden="true">{item.level === 'info' ? 'ℹ' : '⚠'}</span>
      <div>
        <div>{item.text}</div>
        {item.detail && <div className="muted small">{item.detail}</div>}
      </div>
    </div>
  );
}

export function Transcript({ conversationId, items, live }: { conversationId: string; items: ChatItem[]; live: boolean }) {
  const blocks = group(items);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'steps') return <Steps key={b.id} steps={b.steps} live={live && i === blocks.length - 1} />;
        const it = b.item;
        switch (it.kind) {
          case 'user':
            return (
              <div key={it.id} className="msg msg-user">
                <div className="bubble">{it.text}</div>
              </div>
            );
          case 'assistant':
            return (
              <div key={it.id} className="msg msg-assistant">
                <Markdown text={it.text} />
                {it.streaming && <span className="cursor" aria-hidden="true" />}
              </div>
            );
          case 'diff':
            return <DiffCard key={it.id} item={it} />;
          case 'approval':
            return <ApprovalCard key={it.id} conversationId={conversationId} item={it} />;
          case 'question':
            return <QuestionCard key={it.id} conversationId={conversationId} item={it} />;
          case 'notice':
            return <Notice key={it.id} item={it} />;
          default:
            return null;
        }
      })}
    </>
  );
}

// ---- terminal view ---------------------------------------------------------

/** Native disclosure keeps the user's choice while live output is updated. */
function TermOutput({ text, live }: { text: string; live: boolean }) {
  const count = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
  return (
    <details className="term-output">
      <summary>Output <span className="t-dim">· {count} {count === 1 ? 'line' : 'lines'}{live ? ' · live' : ''}</span></summary>
      <div className="t-out">{text}</div>
    </details>
  );
}

const TOOL_MARK: Record<string, string> = { running: '…', done: '✓', failed: '✗', declined: '⊘', interrupted: '■' };

function TermLine({ conversationId, item }: { conversationId: string; item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="t-user">
          <span className="t-prompt" aria-hidden="true">
            ❯{' '}
          </span>
          {item.text}
          {item.delivery === 'pending' && <span className="t-delivery"> · not yet delivered</span>}
          {item.attachments?.map((a) => <div className="attachment-chip" key={a.path} title={`${a.name} · ${Math.ceil(a.size / 1024)} KB`}>[{a.kind}: {a.name}]</div>)}
        </div>
      );
    case 'assistant':
      return (
        <div className="t-assistant">
          <Markdown text={item.text}/>
          {item.streaming && <span className="t-cursor" aria-hidden="true" />}
        </div>
      );
    case 'reasoning':
      return (
        <details className="t-dim">
          <summary>· reasoning: {item.text.split('\n')[0].slice(0, 120)}</summary>
          <div className="t-out">{item.text}</div>
        </details>
      );
    case 'tool': {
      const isCommand = item.title.startsWith('Command');
      const notice = isCommand ? commandOutputNotice(item.output) : undefined;
      const outputWarning = !!notice && item.status === 'done';
      return (
        <div className={`t-tool t-${item.status} ${outputWarning ? 't-output-warning' : ''}`}>
          <div className="t-tool-head" title={item.detail}>
            <span className="t-mark" aria-label={outputWarning ? 'completed; check output' : TOOL_STATUS[item.status]}>
              {outputWarning ? '⚠' : TOOL_MARK[item.status]}
            </span>{' '}
            {isCommand ? <span className="t-cmd">$ {item.subtitle}</span> : <>
                <span className="t-toolname">{item.title}</span> {item.subtitle && <span className="t-dim">{item.subtitle}</span>}
              </>}
          </div>
          {item.exitCode != null && <div className="t-exit">exit {item.exitCode}</div>}
          {item.status === 'interrupted' && <div className="t-exit">Stopped · no final result</div>}
          {notice && <div className="t-diagnostic">{notice}</div>}
          {item.output && <TermOutput text={item.output} live={item.status === 'running'} />}
        </div>
      );
    }
    case 'diff':
      return (
        <div className={`t-diff t-diff-${item.status}`}>
          {item.files.map((f) => (
            <div key={f.path}>
              <div className="t-tool-head">
                <span className="t-mark">✎</span> <span className="t-toolname">{f.change === 'add' ? 'create' : f.change === 'delete' ? 'delete' : 'edit'}</span> {f.path} <span className="t-dim">({DIFF_STATUS[item.status]})</span>
              </div>
              <FileChangeCode path={f.path} change={f.change} diff={f.diff}/>
            </div>
          ))}
        </div>
      );
    case 'approval':
      return (
        <div className={`t-approval ${item.resolution ? '' : 'pending'}`} role="group" aria-label="Permission request">
          <div>
            <span className="t-ask">?</span> {item.request.title}
          </div>
          {item.request.detail && <div className="t-cmd t-indent">{item.request.detail}</div>}
          {item.request.reason && <div className="t-dim t-indent">{item.request.reason}</div>}
          {item.resolution ? <div className={`t-indent res-${item.resolution}`}>→ {APPROVAL_RESULT[item.resolution]}</div> : <ApprovalActions conversationId={conversationId} item={item} terminal />}
        </div>
      );
    case 'question':
      return <QuestionCard conversationId={conversationId} item={item} terminal />;
    case 'notice':
      return (
        <div className={`t-notice t-notice-${item.level}`} role={item.level === 'error' ? 'alert' : undefined}>
          {item.level === 'error' ? '✗ error: ' : item.level === 'warning' ? '! ' : '· '}
          {item.text}
          {item.detail && <div className="t-dim t-indent">{item.detail}</div>}
        </div>
      );
  }
}

export function TerminalTranscript({ conversationId, items }: { conversationId: string; items: ChatItem[] }) {
  return (
    <div className="term-log">
      {items.map((it) => (
        <TermLine key={it.id} conversationId={conversationId} item={it} />
      ))}
    </div>
  );
}
