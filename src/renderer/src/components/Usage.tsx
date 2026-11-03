import { useEffect, useState } from 'react';
import type { Account } from '../../../shared/types';
import { api } from '../api';

export function Usage({ account, compact = false }: { account: Account; compact?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const usage = account.usage;
  useEffect(() => {
    if (account.connection.state !== 'connected') return;
    const refresh = () => void api.refreshUsage(account.id).catch(() => {});
    if (!usage || Date.now() - Date.parse(usage.updatedAt) > 60000) refresh();
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [account.id, account.connection.state]);
  return <div className={`usage ${compact ? 'usage-compact' : ''}`} aria-label={`Usage for ${account.alias}`}>
    {usage?.windows.map((w, i) => <div className="usage-window" key={`${w.label}-${i}`} title={`${w.label}: ${Math.round(w.usedPercent)}% used. ${w.resetsAt ? `Resets ${new Date(w.resetsAt).toLocaleString()}` : 'Reset time unavailable'}`}>
      <span>{w.label}</span><meter min="0" max="100" low={50} high={80} optimum={0} value={w.usedPercent} aria-label={`${w.label} used`} /><strong>{Math.round(w.usedPercent)}%<span className={compact ? 'sr-only' : undefined}> used</span></strong>
      {!compact && w.resetsAt && <span className="muted">Resets {new Date(w.resetsAt).toLocaleString()}</span>}
    </div>)}
    {!usage?.windows.length && <span className="muted small">Usage unavailable</span>}
    {!compact && usage?.note && <span className="muted small">{usage.note}</span>}
    {usage?.source === 'experimental' && <span className="muted small" title="Claude's usage API is experimental and may change.">{compact ? 'Exp.' : 'Experimental'}</span>}
    <button className="link-btn small" disabled={loading || account.connection.state !== 'connected'} onClick={async () => {
      setLoading(true); setError(undefined);
      try { await api.refreshUsage(account.id); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
    }} aria-label={`Refresh usage for ${account.alias}`} title={usage ? `Refresh usage · Updated ${new Date(usage.updatedAt).toLocaleString()}` : 'Read plan limits from this account'}>{loading ? (compact ? '…' : 'Refreshing…') : (compact ? '↻' : '↻ Usage')}</button>
    {!compact && usage && <span className="usage-updated muted small">Updated {new Date(usage.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
    {error && <span className="composer-error" role="alert">{error}</span>}
  </div>;
}
