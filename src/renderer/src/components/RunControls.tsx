import { useEffect, useState } from 'react';
import type { Conversation, ModelCatalog, RunOptions } from '../../../shared/types';
import { api } from '../api';

export function RunControls({ conv, busy, compact = false }: { conv: Conversation; busy: boolean; compact?: boolean }) {
  const [catalog, setCatalog] = useState<ModelCatalog>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    setError(undefined);
    void api.listModels(conv.accountId).then((c) => { if (live) setCatalog(c); }).catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [conv.accountId, reload]);
  const model = catalog?.models.find((m) => m.id === conv.options.model) ?? catalog?.models.find((m) => m.isDefault) ?? catalog?.models[0];
  async function save(options: RunOptions) {
    setSaving(true); setError(undefined);
    try { await api.setConversationOptions(conv.id, options); } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <div className={`run-controls ${compact ? 'run-controls-compact' : ''}`} aria-label="Model settings">
    <label><span className={compact ? 'sr-only' : undefined}>Model</span><select aria-label="Model" disabled={busy || saving || !catalog} value={conv.options.model ?? ''} onChange={(e) => void save({ model: e.target.value || undefined, fast: false })} title={`Model: ${model?.label ?? 'CLI default'}${model?.description ? ` — ${model.description}` : ''}`}>
      <option value="">{compact ? `Default · ${catalog?.models.find((m) => m.isDefault)?.label ?? 'model'}` : `CLI default${catalog && model ? ` (${catalog.models.find((m) => m.isDefault)?.label ?? 'automatic'})` : ''}`}</option>
      {catalog?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
    </select></label>
    <label><span className={compact ? 'sr-only' : undefined}>Reasoning</span><select aria-label="Reasoning" title="Reasoning effort" disabled={busy || saving || !model?.efforts.length} value={conv.options.effort ?? ''} onChange={(e) => void save({ ...conv.options, effort: e.target.value || undefined })}>
      <option value="">{compact && model?.defaultEffort ? `${model.defaultEffort} (default)` : `Default${model?.defaultEffort ? ` (${model.defaultEffort})` : ''}`}</option>
      {model?.efforts.map((e) => <option key={e} value={e}>{e}</option>)}
    </select></label>
    <label title={catalog?.fastNote}><span className={compact ? 'sr-only' : undefined}>Speed</span><select aria-label="Speed" title={catalog?.fastNote} disabled={busy || saving || !model?.fast} value={conv.options.fast ? 'fast' : 'standard'} onChange={(e) => void save({ ...conv.options, fast: e.target.value === 'fast' })}>
      <option value="standard">Standard</option><option value="fast">Fast</option>
    </select></label>
    {model?.fast && (compact ? <details className="speed-info"><summary aria-label="Speed and usage information" title="Speed and usage information">ⓘ</summary><div role="note">{catalog?.fastNote}</div></details> : <span className="speed-note muted small">{catalog?.fastNote}</span>)}
    {!catalog && !error && <span className="muted small">Loading models…</span>}
    {error && <span className="composer-error" role="alert">{error} <button className="link-btn" onClick={() => setReload((n) => n + 1)}>Retry</button></span>}
  </div>;
}
