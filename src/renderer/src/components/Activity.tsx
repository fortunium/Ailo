import { useEffect, useState } from 'react';
import type { ChatItem, ConversationStatus } from '../../../shared/types';

export function Activity({ items, status, startedAt }: { items: ChatItem[]; status: ConversationStatus; startedAt: string }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (status !== 'running' && status !== 'awaiting_input') return null;
  const active = items.filter((i) => i.kind === 'tool' && i.status === 'running' || i.kind === 'diff' && i.status === 'pending');
  const label = status === 'awaiting_input' ? 'Waiting for your response' : active.length ? `${active.length} active ${active.length === 1 ? 'action' : 'actions'}` : 'Working…';
  return <aside className="live-activity" aria-label="Current activity">
    <div className="activity-heading"><span className="activity-dot" aria-hidden="true"/><span role="status">{label}</span><span className="activity-time" aria-hidden="true">{Math.max(0, Math.floor((clock - Date.parse(startedAt)) / 1000))}s</span></div>
    {active.map((item) => <div className="activity-action" key={item.id}>{item.kind === 'tool' ? <><strong>{item.title}</strong>{item.subtitle && <span title={item.subtitle}> {item.subtitle}</span>}</> : item.kind === 'diff' ? `Editing ${item.files.map(f => f.path).join(', ')}` : null}</div>)}
  </aside>;
}
