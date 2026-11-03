import { useState } from 'react';
import type { AppState, Conversation } from '../../../shared/types';
import { AccountBadge, StatusDot, statusLabel } from './ui';

export function Sidebar(props: {
  app: AppState;
  page: 'conversation' | 'automations' | 'integrations';
  onAutomations: () => void;
  onIntegrations: () => void;
  activeId?: string;
  onSelect: (id: string) => void;
  onNewConversation: (projectId?: string) => void;
  onNewProject: () => void;
  onEditProject: (id: string) => void;
  onOpenAccounts: () => void;
  onSearch: () => void;
  onToggleTheme: () => void;
  onToggleNotifications: () => void;
}) {
  const { app } = props;
  const latestRuns = new Map([...(app.automationRuns ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((r) => [r.automationId, r]));
  const attention = [...latestRuns.values()].filter((r) => app.automations?.some((a) => a.id === r.automationId) && ['needs_attention', 'blocked'].includes(r.status)).length;
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const byProject = (pid: string) =>
    app.conversations.filter((c) => c.projectId === pid && c.archived === showArchived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const standalone = app.conversations.filter(c => !c.projectId && c.archived === showArchived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const background = app.conversations.filter((c) => c.id !== props.activeId && (c.status === 'running' || c.status === 'awaiting_input'));
  const account = (c: Conversation) => app.accounts.find((a) => a.id === c.accountId);
  const unreadCount = (convs: Conversation[]) => convs.filter((c) => c.unread).length;
  const conversationButton = (c: Conversation) => {
    const active = c.id === props.activeId && props.page === 'conversation';
    return <button className={`conv-item ${active ? 'active' : ''} ${c.unread ? 'unread' : ''}`} onClick={() => props.onSelect(c.id)} aria-current={active ? 'page' : undefined} aria-label={`${c.title}, ${account(c)?.alias ?? 'no account'}, ${statusLabel(c.status)}${c.unread ? ', unread response' : ''}`}>
      <StatusDot status={c.status}/><span className="conv-name">{c.title}</span>
      {c.unread && <span className="unread-indicator" title="Unread response">New</span>}
      <AccountBadge account={account(c)}/>
    </button>;
  };

  return (
    <nav className="sidebar" aria-label="Projects and conversations">
      <div className="side-top">
        <span className="brand"><img src="./icon.png" alt="" width="28" height="28"/>Ailo</span>
        <button className="icon-btn" onClick={props.onSearch} title="Search (Ctrl+K)" aria-label="Search conversations" aria-keyshortcuts="Control+K">
          ⌕
        </button>
      </div>
      <button className="btn primary new-conv" onClick={() => props.onNewConversation()} aria-keyshortcuts="Control+N">
        + New conversation <kbd>Ctrl N</kbd>
      </button>

      <div className="side-tools"><button className={`side-nav-btn ${props.page === 'automations' ? 'sel' : ''}`} onClick={props.onAutomations}>&#9684; Automations <span>{attention || ''}</span></button><button className={`side-nav-btn ${props.page === 'integrations' ? 'sel' : ''}`} onClick={props.onIntegrations}>&#8984; Integrations</button></div>
      <div className="side-scroll">
        {standalone.length > 0 && <section className="proj">
          <div className="proj-head"><span className="proj-toggle">Standalone</span>{!!unreadCount(standalone) && <span className="unread-count" aria-label="Unread standalone conversations">{unreadCount(standalone)}</span>}</div>
          <ul className="conv-list">{standalone.map((c) => <li key={c.id}>{conversationButton(c)}</li>)}</ul>
        </section>}
        {app.projects.map((p) => {
          const convs = byProject(p.id);
          const isCollapsed = collapsed[p.id];
          return (
            <section key={p.id} className="proj">
              <div className="proj-head">
                <button className="proj-toggle" aria-expanded={!isCollapsed} onClick={() => setCollapsed({ ...collapsed, [p.id]: !isCollapsed })}>
                  <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span> {p.name}
                  {!!unreadCount(convs) && <span className="unread-count" aria-label={`${unreadCount(convs)} unread conversations`}>{unreadCount(convs)}</span>}
                </button>
                <button className="icon-btn small" onClick={() => props.onNewConversation(p.id)} title={`New conversation in ${p.name}`} aria-label={`New conversation in ${p.name}`}>
                  +
                </button>
                <button className="icon-btn small" onClick={() => props.onEditProject(p.id)} title="Project settings" aria-label={`Settings for ${p.name}`}>
                  ⋯
                </button>
              </div>
              {!isCollapsed && (
                <ul className="conv-list">
                  {convs.map((c) => (
                    <li key={c.id}>
                      {conversationButton(c)}
                    </li>
                  ))}
                  {convs.length === 0 && <li className="muted small pad">{showArchived ? 'No archived conversations' : 'No conversations yet'}</li>}
                </ul>
              )}
            </section>
          );
        })}
        <button className="link-btn pad" onClick={props.onNewProject}>
          + Add project
        </button>
      </div>

      {background.length > 0 && (
        <section className="background" aria-label="Active in the background">
          <h2 className="side-h">Active in the background</h2>
          {background.map((c) => (
            <button key={c.id} className="bg-item" onClick={() => props.onSelect(c.id)}>
              <StatusDot status={c.status} withLabel />
              <span className="conv-name">{c.title}</span>
              <AccountBadge account={account(c)} />
            </button>
          ))}
        </section>
      )}

      <div className="side-bottom">
        <button className="link-btn" onClick={props.onOpenAccounts}>
          Accounts ({app.accounts.length})
        </button>
        <button className="link-btn" onClick={() => setShowArchived((v) => !v)} aria-pressed={showArchived}>
          {showArchived ? 'Active conversations' : 'Archive'}
        </button>
        <button className="icon-btn" onClick={props.onToggleTheme} title={`Theme: ${app.settings.theme}`} aria-label="Switch theme">
          {app.settings.theme === 'dark' ? '☾' : app.settings.theme === 'light' ? '☀' : '◑'}
        </button>
        <button className="icon-btn notification-toggle" onClick={props.onToggleNotifications} aria-pressed={app.settings.notifications !== false} aria-label="Desktop notifications" title={`Desktop notifications: ${app.settings.notifications === false ? 'off' : 'on'}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>{app.settings.notifications === false && <path d="m3 3 18 18"/>}</svg>
        </button>
      </div>
    </nav>
  );
}
