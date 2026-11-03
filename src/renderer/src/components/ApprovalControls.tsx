import { useState } from 'react';
import type { Settings } from '../../../shared/types';
import { api } from '../api';

export function ApprovalControls({ settings, report = false }: { settings: Settings; report?: boolean }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const mode = settings.approvalMode === 'always' ? 'always' : 'ask';
  const description = report
    ? 'Report mode only permits reading and searching, regardless of this setting.'
    : 'Applies to all conversations, including running tasks. Always allow automatically approves commands, file changes and other tool permissions. Questions still need an answer.';
  return <div className={`approval-controls ${mode === 'always' && !report ? 'auto-approve' : ''}`}>
    <label title={description}>
      <span>Permissions</span>
      <select aria-label="Permissions for all conversations" aria-description={description} disabled={saving || report} value={report ? 'report' : mode} onChange={async (e) => {
        const approvalMode = e.target.value as Settings['approvalMode'];
        setSaving(true); setError(undefined);
        try { await api.setSettings({ approvalMode }); }
        catch (e) { setError((e as Error).message); }
        finally { setSaving(false); }
      }}>
        {report ? <option value="report">Read only</option> : <><option value="ask">Ask</option><option value="always">Always allow</option></>}
      </select>
    </label>
    {error && <span className="composer-error" role="alert">{error}</span>}
  </div>;
}
