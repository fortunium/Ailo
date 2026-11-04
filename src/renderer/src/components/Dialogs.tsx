import { useEffect, useMemo, useState } from 'react';
import type { Account, AppState, Conversation, Project } from '../../../shared/types';
import { PROVIDER_LABEL } from '../../../shared/types';
import { api } from '../api';
import { AccountForm, ConnectionInfo, LoginPanel, useClis } from './Accounts';
import { emptyTools, ToolPicker } from './ToolPicker';
import { AccountBadge, Dialog, StatusDot } from './ui';

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function AccountPicker({ accounts, value, onChange }: { accounts: Account[]; value?: string; onChange: (id: string) => void }) {
  return (
    <div className="acc-pick" role="radiogroup" aria-label="Account">
      {accounts.map((a) => (
        <label key={a.id} className={`acc-pick-opt ${value === a.id ? 'sel' : ''}`} style={{ ['--acc' as string]: a.color }}>
          <input type="radio" name="account" checked={value === a.id} onChange={() => onChange(a.id)} />
          <AccountBadge account={a} size="lg" />
          <span className="muted small">{PROVIDER_LABEL[a.provider]}</span>
          <ConnectionInfo account={a} />
        </label>
      ))}
    </div>
  );
}

export function NewConversationDialog({ open, onClose, app, projectId, onCreated }: { open: boolean; onClose: () => void; app: AppState; projectId?: string; onCreated: (c: Conversation) => void }) {
  const [pid, setPid] = useState(projectId ?? '');
  const [folder, setFolder] = useState<string>();
  const [tools, setTools] = useState(emptyTools);
  const project = app.projects.find((p) => p.id === pid);
  const [accountId, setAccountId] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    const p = projectId ?? '';
    setPid(p);
    setFolder(undefined);
    setTools(app.projects.find((x) => x.id === p)?.toolSelection ?? emptyTools());
    // Default account of the project is preselected; the user still sees and confirms it.
    setAccountId(app.projects.find((x) => x.id === p)?.defaultAccountId ?? app.accounts[0]?.id);
    setError(undefined);
  }, [open, projectId]);
  return (
    <Dialog open={open} onClose={onClose} title="New conversation">
      {(
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!accountId) return;
            try {
              onCreated(await api.createConversation({ projectId: pid || undefined, folders: !pid && folder ? [folder] : undefined, accountId, tools }));
            } catch (err) {
              setError(clean(err));
            }
          }}
        >
          <label className="field">
            <span>Project</span>
            <select className="input" value={pid} onChange={(e) => (setPid(e.target.value), setTools(app.projects.find((x) => x.id === e.target.value)?.toolSelection ?? emptyTools()), setAccountId(app.projects.find((x) => x.id === e.target.value)?.defaultAccountId ?? accountId))}>
              <option value="">Standalone conversation</option>
              {app.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {!pid && <div className="field"><span>Working folder</span><span className="muted small">{folder ?? 'A new empty folder, separate from your projects.'}</span><div className="row"><button type="button" className="btn small" onClick={async () => { const f = await api.pickFolder(); if (f) setFolder(f); }}>Choose folder…</button>{folder && <button type="button" className="link-btn" onClick={() => setFolder(undefined)}>Use empty folder</button>}</div></div>}
          <div className="field">
            <span>Account for this conversation</span>
            <AccountPicker accounts={app.accounts} value={accountId} onChange={(id) => { setAccountId(id); setTools(emptyTools()); }} />
            <span className="muted small">The account is fixed for this conversation. {project?.defaultAccountId === accountId && 'This is the project default.'}</span>
          </div>
          {error && <p className="composer-error">{error}</p>}
          <details><summary>Connections, skills and plugins</summary><ToolPicker app={app} accountId={accountId} provider={app.accounts.find((a) => a.id === accountId)?.provider} value={tools} onChange={setTools}/></details>
          <button className="btn primary" disabled={!accountId}>
            Start conversation
          </button>
        </form>
      )}
    </Dialog>
  );
}

export function ProjectDialog({ open, onClose, app, project, onSaved }: { open: boolean; onClose: () => void; app: AppState; project?: Project; onSaved?: (p: Project) => void }) {
  const [name, setName] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [def, setDef] = useState<string>('');
  const [tools, setTools] = useState(emptyTools);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setFolders(project?.folders ?? []);
    setDef(project?.defaultAccountId ?? '');
    setTools(project?.toolSelection ?? emptyTools());
    setError(undefined);
  }, [open, project?.id]);
  const add = async () => {
    const f = await api.pickFolder();
    if (f && !folders.includes(f)) {
      setFolders([...folders, f]);
      if (!name) setName(f.split(/[\\/]/).filter(Boolean).pop() ?? '');
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={project ? 'Project settings' : 'Add project'}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            if (project) {
              await api.updateProject(project.id, { name, folders, defaultAccountId: def || undefined, toolSelection: tools });
              onSaved?.(project);
            } else { const created = await api.addProject({ name, folders, defaultAccountId: def || undefined }); await api.updateProject(created.id, { toolSelection: tools }); onSaved?.(created); }
            onClose();
          } catch (err) {
            setError(clean(err));
          }
        }}
      >
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" />
        </label>
        <div className="field">
          <span>Working folders</span>
          <ul className="folder-list">
            {folders.map((f, i) => (
              <li key={f}>
                <code title={f}>{f}</code>
                {i === 0 ? <span className="muted small">working folder</span> : <span className="muted small">extra folder</span>}
                <button type="button" className="icon-btn small" aria-label={`Remove ${f}`} onClick={() => setFolders(folders.filter((x) => x !== f))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn small" onClick={add}>
            {folders.length ? '+ Extra folder' : 'Choose folder…'}
          </button>
          {folders.length > 1 && <span className="muted small">The first folder is the working folder. Extra folders are given to the assistant as additional workspace (Claude: --add-dir, Codex: writable root in the sandbox).</span>}
        </div>
        <label className="field">
          <span>Default account (preselected for new conversations)</span>
          <select className="input" value={def} onChange={(e) => setDef(e.target.value)}>
            <option value="">None</option>
            {app.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.alias} — {PROVIDER_LABEL[a.provider]}
              </option>
            ))}
          </select>
        </label>
        <details><summary>Default tools for new conversations</summary><ToolPicker app={app} accountId={def} provider={app.accounts.find((a) => a.id === def)?.provider} value={tools} onChange={setTools}/></details>
        {error && <p className="composer-error">{error}</p>}
        <div className="row">
          <button className="btn primary" disabled={!folders.length}>
            Save
          </button>
          {project && (
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                if (!confirm(`Remove project “${project.name}” and its conversations from Ailo? Files in the working folder are left untouched.`)) return;
                const r = await api.removeProject(project.id);
                if (r.ok) onClose();
                else setError(r.error);
              }}
            >
              Remove project
            </button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

export function QuickSwitcher({ open, onClose, app, onSelect }: { open: boolean; onClose: () => void; app: AppState; onSelect: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (open) setQ(''), setIdx(0);
  }, [open]);
  const results = useMemo(() => {
    const s = q.toLowerCase();
    return app.conversations
      .filter((c) => {
        const p = app.projects.find((x) => x.id === c.projectId)?.name ?? '';
        const a = app.accounts.find((x) => x.id === c.accountId)?.alias ?? '';
        return !s || `${c.title} ${p} ${a}`.toLowerCase().includes(s);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30);
  }, [q, app]);
  return (
    <Dialog open={open} onClose={onClose} title="Find conversation">
      <input
        className="input"
        autoFocus
        value={q}
        placeholder="Title, project or account…"
        aria-label="Search"
        aria-controls="qs-results"
        aria-activedescendant={results[idx] ? `qs-${results[idx].id}` : undefined}
        onChange={(e) => (setQ(e.target.value), setIdx(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') e.preventDefault(), setIdx((i) => Math.min(i + 1, results.length - 1));
          if (e.key === 'ArrowUp') e.preventDefault(), setIdx((i) => Math.max(i - 1, 0));
          if (e.key === 'Enter' && results[idx]) onSelect(results[idx].id);
        }}
      />
      <ul id="qs-results" className="qs-list" role="listbox">
        {results.map((c, i) => (
          <li key={c.id} id={`qs-${c.id}`} role="option" aria-selected={i === idx} className={i === idx ? 'sel' : ''} onClick={() => onSelect(c.id)}>
            <StatusDot status={c.status} />
            <span className="conv-name">
              {c.title}
              {c.archived && <span className="muted small"> (archived)</span>}
            </span>
            <span className="muted small">{app.projects.find((p) => p.id === c.projectId)?.name}</span>
            <AccountBadge account={app.accounts.find((a) => a.id === c.accountId)} />
          </li>
        ))}
        {results.length === 0 && <li className="muted">Nothing found.</li>}
      </ul>
    </Dialog>
  );
}

export function Onboarding({ app, onDone }: { app: AppState; onDone: (conv?: Conversation) => void }) {
  const clis = useClis();
  const [chosenAccount, setAccountId] = useState<string>();
  const [chosenProject, setProject] = useState<Project>();
  const [error, setError] = useState<string>();
  // Follow live state: accounts/projects may be added or signed in from elsewhere.
  const account = app.accounts.find((a) => a.id === chosenAccount) ?? app.accounts[0];
  const accountId = account?.id;
  const project = app.projects.find((p) => p.id === chosenProject?.id) ?? app.projects[0];
  const step = !account || account.connection.state !== 'connected' ? 1 : !project ? 2 : 3;
  return (
    <main className="onboarding">
      <h1>Welcome to Ailo</h1>
      <p className="muted">One workspace for your AI coding assistants. Three steps and you're ready.</p>
      <ol className="steps-ob">
        <li className={step === 1 ? 'cur' : 'done'}>
          <h2>1. Connect an account</h2>
          {!account ? (
            <AccountForm clis={clis} onCreated={(a) => (setAccountId(a.id), void api.startLogin(a.id))} submitLabel="Add and sign in" />
          ) : (
            <div className="row wrap">
              <AccountBadge account={account} size="lg" showProvider />
              <ConnectionInfo account={account} />
              {account.connection.state !== 'connected' && <LoginPanel account={account} />}
            </div>
          )}
          {clis && clis.every((c) => !c.found) && <p className="notice notice-error small">No supported CLI found. Install Codex or Claude Code, then restart Ailo.</p>}
        </li>
        <li className={step === 2 ? 'cur' : step > 2 ? 'done' : ''}>
          <h2>2. Choose a working folder</h2>
          {project ? (
            <p>
              📁 <code>{project.folders[0]}</code>
            </p>
          ) : (
            step === 2 && (
              <button
                className="btn primary"
                onClick={async () => {
                  const f = await api.pickFolder();
                  if (!f) return;
                  try {
                    setProject(await api.addProject({ name: f.split(/[\\/]/).filter(Boolean).pop() ?? 'Project', folders: [f], defaultAccountId: accountId }));
                  } catch (err) {
                    setError(clean(err));
                  }
                }}
              >
                Choose folder…
              </button>
            )
          )}
        </li>
        <li className={step === 3 ? 'cur' : ''}>
          <h2>3. First conversation</h2>
          {step === 3 && (
            <button
              className="btn primary"
              onClick={async () => {
                const c = await api.createConversation({ projectId: project!.id, accountId: accountId! });
                await api.setSettings({ onboardingDone: true });
                onDone(c);
              }}
            >
              Start a conversation with {account?.alias}
            </button>
          )}
        </li>
      </ol>
      {error && <p className="composer-error">{error}</p>}
      <button className="link-btn" onClick={() => (void api.setSettings({ onboardingDone: true }), onDone())}>
        Skip
      </button>
    </main>
  );
}
