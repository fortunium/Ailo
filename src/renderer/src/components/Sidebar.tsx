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
}) {
  const { app } = props;
  const latestRuns = new Map([...(app.automationRuns ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map((r) => [r.automationId, r]));
  const attention = [...latestRuns.values()].filter((r) => app.automations?.some((a) => a.id === r.automationId) && ['needs_attention', 'blocked'].includes(r.status)).length;
  const [showArchived, setShowArchived] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const byProject = (pid: string) =>
    app.conversations.filter((c) => c.projectId === pid && c.archived === showArchived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const background = app.conversations.filter((c) => c.id !== props.activeId && (c.status === 'running' || c.status === 'awaiting_input'));
  const account = (c: Conversation) => app.accounts.find((a) => a.id === c.accountId);

  return (
    <nav className="sidebar" aria-label="Projects and conversations">
      <div className="side-top">
        <span className="brand">Ailo</span>
        <button className="icon-btn" onClick={props.onSearch} title="Search (Ctrl+K)" aria-label="Search conversations" aria-keyshortcuts="Control+K">
          ⌕
        </button>
      </div>
      <button className="btn primary new-conv" onClick={() => props.onNewConversation()} aria-keyshortcuts="Control+N">
        + New conversation <kbd>Ctrl N</kbd>
      </button>

      <div className="side-tools"><button className={`side-nav-btn ${props.page === 'automations' ? 'sel' : ''}`} onClick={props.onAutomations}>&#9684; Automations <span>{attention || ''}</span></button><button className={`side-nav-btn ${props.page === 'integrations' ? 'sel' : ''}`} onClick={props.onIntegrations}>&#8984; Integrations</button></div>
      <div className="side-scroll">
        {app.conversations.some((c) => !c.projectId && c.archived === showArchived) && <section className="proj">
          <div className="proj-head"><span className="proj-toggle">Standalone</span></div>
          <ul className="conv-list">{app.conversations.filter((c) => !c.projectId && c.archived === showArchived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((c) => <li key={c.id}><button className={`conv-item ${c.id === props.activeId ? 'active' : ''}`} onClick={() => props.onSelect(c.id)} aria-current={c.id === props.activeId ? 'page' : undefined}><StatusDot status={c.status}/><span className="conv-name">{c.title}</span><AccountBadge account={account(c)}/></button></li>)}</ul>
        </section>}
        {app.projects.map((p) => {
          const convs = byProject(p.id);
          const isCollapsed = collapsed[p.id];
          return (
            <section key={p.id} className="proj">
              <div className="proj-head">
                <button className="proj-toggle" aria-expanded={!isCollapsed} onClick={() => setCollapsed({ ...collapsed, [p.id]: !isCollapsed })}>
                  <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span> {p.name}
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
                      <button className={`conv-item ${c.id === props.activeId ? 'active' : ''}`} onClick={() => props.onSelect(c.id)} aria-current={c.id === props.activeId ? 'page' : undefined} aria-label={`${c.title}, ${account(c)?.alias ?? 'no account'}, ${statusLabel(c.status)}`}>
                        <StatusDot status={c.status} />
                        <span className="conv-name">{c.title}</span>
                        <AccountBadge account={account(c)} />
                      </button>
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
      </div>
    </nav>
  );
}
