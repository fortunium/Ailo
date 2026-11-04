import { useEffect, useState } from 'react';
import type { AccountMcpServer } from '../../../shared/types';
import { api } from '../api';

export function AccountMcp({ accountId, selected = [], onChange, disabled = false }: {
  accountId: string; selected?: string[]; onChange?: (names: string[]) => void; disabled?: boolean;
}) {
  const [servers, setServers] = useState<AccountMcpServer[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setServers([]); setError(undefined); setLoading(true);
    if (!api.listAccountMcp) { setError('Restart Ailo to discover account MCP servers.'); setLoading(false); return; }
    void api.listAccountMcp(accountId).then(result => { if (live) setServers(result); }).catch(e => { if (live) setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [accountId, reload]);
  const missing = !loading && !error ? selected.filter(name => !servers.some(s => s.name === name)) : [];
  return <fieldset className="account-mcp"><legend>Codex account MCP</legend>
    <p className="muted small">Connections configured in this Codex account use their existing configuration and sign-in.</p>
    {loading && <p className="muted small" role="status">Checking account connections…</p>}
    {error && <p className="composer-error" role="alert">{error}</p>}
    {servers.map(server => <label key={server.name}>
      {onChange && <input type="checkbox" disabled={disabled} checked={selected.includes(server.name)} onChange={e => onChange(e.target.checked ? [...selected, server.name] : selected.filter(name => name !== server.name))}/>}
      <span><strong>{server.name}</strong><small className="muted">{server.transport.toUpperCase()} · account configuration{!server.enabled ? ' · disabled by default' : ''}{!onChange && selected.includes(server.name) ? ' · selected for this conversation' : ''}</small></span>
    </label>)}
    {missing.map(name => <label key={name}><input type="checkbox" disabled={disabled || !onChange} checked onChange={() => onChange?.(selected.filter(n => n !== name))}/><span>{name}<small className="composer-error">No longer configured in this account</small></span></label>)}
    {!loading && !error && !servers.length && <p className="muted small">No MCP servers configured in this account.</p>}
    <button type="button" className="link-btn small" disabled={loading} onClick={() => setReload(n => n + 1)}>Refresh account connections</button>
  </fieldset>;
}
