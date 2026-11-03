import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { Account, ConversationStatus } from '../../../shared/types';
import { PROVIDER_LABEL } from '../../../shared/types';

/** Modal built on the native <dialog>: focus trap, Esc to close, inert background. */
export function Dialog(props: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) {
      d.showModal();
      d.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    }
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog ref={ref} className={`dialog ${props.wide ? 'dialog-wide' : ''}`} aria-labelledby={titleId} onClose={props.onClose} onCancel={(e) => (e.preventDefault(), props.onClose())}>
      {props.open && (
        <>
          <header className="dialog-head">
            <h2 id={titleId}>{props.title}</h2>
            <button className="icon-btn" onClick={props.onClose} aria-label="Close">
              ✕
            </button>
          </header>
          <div className="dialog-body">{props.children}</div>
        </>
      )}
    </dialog>
  );
}

export const ACCOUNT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'];

export function initials(alias: string): string {
  const parts = alias.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function AccountBadge({ account, size = 'sm', showProvider = false }: { account: Account | undefined; size?: 'sm' | 'lg'; showProvider?: boolean }) {
  if (!account) return <span className="badge badge-missing">Account removed</span>;
  const signedOut = account.connection.state === 'signed_out' || account.connection.state === 'error';
  return (
    <span className={`badge badge-${size}`} style={{ ['--acc' as string]: account.color }} title={`${account.alias} · ${PROVIDER_LABEL[account.provider]}`}>
      <span className="badge-icon" aria-hidden="true">
        {account.icon || initials(account.alias)}
      </span>
      <span className="badge-text">
        {account.alias}
        {showProvider && <span className="badge-provider"> · {PROVIDER_LABEL[account.provider]}</span>}
      </span>
      {signedOut && <span className="badge-warn" title="Not signed in">!</span>}
    </span>
  );
}

const STATUS: Record<ConversationStatus, { label: string; cls: string; icon: string }> = {
  idle: { label: 'Ready', cls: 'st-idle', icon: '●' },
  running: { label: 'Working', cls: 'st-running', icon: '●' },
  awaiting_input: { label: 'Needs you', cls: 'st-await', icon: '◆' },
  error: { label: 'Error', cls: 'st-error', icon: '▲' },
  interrupted: { label: 'Stopped', cls: 'st-stopped', icon: '■' }
};

export function StatusDot({ status, withLabel = false }: { status: ConversationStatus; withLabel?: boolean }) {
  const s = STATUS[status];
  return (
    <span className={`status ${s.cls}`} role="status" aria-label={s.label} title={s.label}>
      <span aria-hidden="true" className="status-icon">
        {s.icon}
      </span>
      {withLabel && <span className="status-label">{s.label}</span>}
    </span>
  );
}

export function statusLabel(status: ConversationStatus): string {
  return STATUS[status].label;
}

export function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : p;
}
