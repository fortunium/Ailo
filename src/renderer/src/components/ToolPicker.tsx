import { useEffect, useState } from 'react';
import type { AppState, ProviderId, RunOptions, ToolSelection } from '../../../shared/types';
import { api } from '../api';
import type { ModelCatalog } from '../../../shared/types';

export const emptyTools = (): ToolSelection => ({ connectionIds: [], skillIds: [], pluginIds: [] });
export const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export function ToolPicker({ app, provider, value, onChange, report = false }: { app: AppState; provider?: ProviderId; value: ToolSelection; onChange: (value: ToolSelection) => void; report?: boolean }) {
  const toggle = (key: keyof ToolSelection, id: string, checked: boolean) => onChange({ ...value, [key]: checked ? [...value[key], id] : value[key].filter((x) => x !== id) });
  return <div className="tool-picker">
    <p className="muted small">Select the external identities and workflows for this conversation or task. The AI login is separate from each service login.</p>
    {report && <p className="banner small">Report mode uses built-in reading and searching tools. MCP connections and plugins are disabled in this mode.</p>}
    <fieldset><legend>MCP connections</legend>{(app.connections ?? []).map((c) => <label key={c.id}><input type="checkbox" disabled={report || (!!provider && !c.providers.includes(provider))} checked={value.connectionIds.includes(c.id)} onChange={(e) => toggle('connectionIds', c.id, e.target.checked)}/><span><strong>{c.name}</strong> · {c.identity}<small className="muted">{c.transport.toUpperCase()} · {c.providers.join(', ')}{c.credentialId ? ' · credentials saved' : ''}</small></span></label>)}{!app.connections?.length && <p className="muted small">Add a connection in Integrations.</p>}</fieldset>
    <fieldset><legend>Skills</legend>{(app.skills ?? []).map((s) => <label key={s.id}><input type="checkbox" checked={value.skillIds.includes(s.id)} onChange={(e) => toggle('skillIds', s.id, e.target.checked)}/><span>{s.name}</span></label>)}{!app.skills?.length && <p className="muted small">Add reusable instructions in Integrations.</p>}</fieldset>
    <fieldset><legend>Local plugins</legend>{(app.plugins ?? []).map((p) => <label key={p.id}><input type="checkbox" disabled={report || (!!provider && !p.providers.includes(provider))} checked={value.pluginIds.includes(p.id)} onChange={(e) => toggle('pluginIds', p.id, e.target.checked)}/><span><strong>{p.name}</strong> · {p.version}<small className="muted">{p.providers.join(', ')} · {p.components.join(', ') || 'instructions'} · {p.digest.slice(0, 8)}</small></span></label>)}{!app.plugins?.length && <p className="muted small">Import a reviewed local plugin in Integrations.</p>}</fieldset>
  </div>;
}

export function ModelFields({ accountId, options, onChange }: { accountId?: string; options: RunOptions; onChange: (o: RunOptions) => void }) {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true; setCatalog(undefined); setError(undefined);
    if (accountId) void api.listModels(accountId).then((c) => { if (live) setCatalog(c); }).catch((e) => { if (live) setError(cleanError(e)); });
    return () => { live = false; };
  }, [accountId]);
  const model = catalog?.models.find((m) => m.id === options.model) ?? catalog?.models.find((m) => m.isDefault) ?? catalog?.models[0];
  return <><div className="form-columns"><label className="field"><span>Model</span><select className="input" aria-label="Task model" value={options.model ?? ''} onChange={(e) => onChange({ model: e.target.value || undefined, fast: false })}><option value="">Account default</option>{catalog?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label><label className="field"><span>Reasoning</span><select className="input" value={options.effort ?? ''} onChange={(e) => onChange({ ...options, effort: e.target.value || undefined })}><option value="">Model default</option>{model?.efforts.map((e) => <option key={e} value={e}>{e}</option>)}</select></label><label className="field" title={catalog?.fastNote}><span>Speed</span><select className="input" disabled={!model?.fast} value={options.fast ? 'fast' : 'standard'} onChange={(e) => onChange({ ...options, fast: e.target.value === 'fast' })}><option value="standard">Standard</option><option value="fast">Fast</option></select></label></div>{options.fast && <p className="muted small">{catalog?.fastNote}</p>}{error && <p className="composer-error">Model catalog: {error}</p>}</>;
}
