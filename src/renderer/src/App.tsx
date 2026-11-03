import { useEffect, useState } from 'react';
import type { Settings } from '../../shared/types';
import { api } from './api';
import { AccountsDialog } from './components/Accounts';
import { ConversationView } from './components/ConversationView';
import { NewConversationDialog, Onboarding, ProjectDialog, QuickSwitcher } from './components/Dialogs';
import { Automations } from './components/Automations';
import { Integrations } from './components/Integrations';
import { Sidebar } from './components/Sidebar';
import { startStore, useView } from './store';

const THEMES: Settings['theme'][] = ['system', 'light', 'dark'];

export function App() {
  const { app } = useView();
  const [activeId, setActiveId] = useState<string>();
  const [dialog, setDialog] = useState<null | 'accounts' | 'new' | 'project' | 'search'>(null);
  const [dialogProject, setDialogProject] = useState<string>();
  const [renameSignal, setRenameSignal] = useState(0);
  const [page, setPage] = useState<'conversation' | 'automations' | 'integrations'>('conversation');
  const [notice, setNotice] = useState<string>();

  useEffect(startStore, []);

  useEffect(() => api.onEvent((e) => {
    if (e.type === 'open_conversation') { setActiveId(e.conversationId); setPage('conversation'); }
  }), []);

  useEffect(() => {
    if (!app) return;
    const sync = () => {
      const id = page === 'conversation' && document.visibilityState !== 'hidden' && document.hasFocus() ? activeId ?? null : null;
      void api.setViewedConversation?.(id).catch(() => {});
    };
    sync();
    window.addEventListener('focus', sync); window.addEventListener('blur', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync); window.removeEventListener('blur', sync);
      document.removeEventListener('visibilitychange', sync);
      void api.setViewedConversation?.(null).catch(() => {});
    };
  }, [!!app, activeId, page]);

  // Apply theme: "system" follows the OS via prefers-color-scheme.
  useEffect(() => {
    if (!app) return;
    const root = document.documentElement;
    const apply = () => {
      const dark = app.settings.theme === 'dark' || (app.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [app?.settings.theme]);

  // Pick the most recent conversation on start.
  useEffect(() => {
    if (app && (!activeId || !app.conversations.some((c) => c.id === activeId))) {
      const recent = app.conversations.filter((c) => !c.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      setActiveId(recent?.id);
    }
  }, [app, activeId]);

  useEffect(() => {
    if (!app) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setDialogProject(undefined);
        setDialog('new');
      } else if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDialog('search');
      } else if (mod && e.key === ',') {
        e.preventDefault();
        setDialog('accounts');
      } else if (e.key === 'F2' && activeId) {
        e.preventDefault();
        setRenameSignal((n) => n + 1);
      } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const list = app.conversations.filter((c) => !c.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const i = list.findIndex((c) => c.id === activeId);
        const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
        if (next) setActiveId(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, activeId]);

  if (!app) return <div className="loading">Loading Ailo…</div>;

  const needsOnboarding = !app.settings.onboardingDone && (app.accounts.length === 0 || app.projects.length === 0 || app.conversations.length === 0);
  if (needsOnboarding) return <Onboarding app={app} onDone={(c) => c && setActiveId(c.id)} />;

  const active = app.conversations.find((c) => c.id === activeId);
  const close = () => setDialog(null);

  return (
    <div className="layout">
      <Sidebar
        app={app}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setPage('conversation'); }}
        page={page}
        onAutomations={() => setPage('automations')}
        onIntegrations={() => setPage('integrations')}
        onNewConversation={(pid) => (setDialogProject(pid), setDialog('new'))}
        onNewProject={() => (setDialogProject(undefined), setDialog('project'))}
        onEditProject={(id) => (setDialogProject(id), setDialog('project'))}
        onOpenAccounts={() => setDialog('accounts')}
        onSearch={() => setDialog('search')}
        onToggleTheme={() => void api.setSettings({ theme: THEMES[(THEMES.indexOf(app.settings.theme) + 1) % THEMES.length] })}
        onToggleNotifications={() => void api.setSettings({ notifications: app.settings.notifications === false }).catch((e) => setNotice((e as Error).message))}
      />
      {page === 'automations' ? <Automations app={app} onOpenConversation={(id) => { setActiveId(id); setPage('conversation'); }}/> : page === 'integrations' ? <Integrations app={app}/> : active ? (
        <ConversationView key={active.id} app={app} conv={active} onOpenAccounts={() => setDialog('accounts')} renameSignal={renameSignal} onDeleted={setNotice} />
      ) : (
        <main className="conv empty-main">
          <p>Pick a conversation or start a new one.</p>
          <button className="btn primary" onClick={() => (setDialogProject(undefined), setDialog('new'))}>
            + New conversation
          </button>
        </main>
      )}
      <AccountsDialog open={dialog === 'accounts'} onClose={close} app={app} />
      <NewConversationDialog open={dialog === 'new'} onClose={close} app={app} projectId={dialogProject} onCreated={(c) => (setActiveId(c.id), setPage('conversation'), close())} />
      <ProjectDialog open={dialog === 'project'} onClose={close} app={app} project={app.projects.find((p) => p.id === dialogProject)} />
      <QuickSwitcher open={dialog === 'search'} onClose={close} app={app} onSelect={(id) => (setActiveId(id), setPage('conversation'), close())} />
      {notice && <div className="app-notice banner" role="status"><span>{notice}</span><button className="icon-btn" aria-label="Dismiss notification" onClick={() => setNotice(undefined)}>×</button></div>}
    </div>
  );
}
