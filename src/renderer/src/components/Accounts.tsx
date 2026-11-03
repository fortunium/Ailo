import { useEffect, useState } from 'react';
import type { Account, AppState, CliInfo, ProviderId } from '../../../shared/types';
import { PROVIDER_LABEL } from '../../../shared/types';
import { api } from '../api';
import { Usage } from './Usage';
import { clearLogin, useView } from '../store';
import { ACCOUNT_COLORS, AccountBadge, Dialog } from './ui';

export function useClis(): CliInfo[] | undefined {
  const [clis, setClis] = useState<CliInfo[]>();
  useEffect(() => {
    void api.detectClis().then(setClis);
  }, []);
  return clis;
}

export function AccountForm({ onCreated, clis, submitLabel = 'Add account' }: { onCreated: (a: Account) => void; clis?: CliInfo[]; submitLabel?: string }) {
  const [provider, setProvider] = useState<ProviderId>('codex');
  const [alias, setAlias] = useState('');
  const [color, setColor] = useState(ACCOUNT_COLORS[0]);
  const [icon, setIcon] = useState('');
  const [error, setError] = useState<string>();
  const cli = clis?.find((c) => c.provider === provider);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        try {
          onCreated(await api.addAccount({ provider, alias, color, icon: icon || undefined }));
          setAlias('');
          setIcon('');
        } catch (err) {
          setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
        }
      }}
    >
      <fieldset className="seg" aria-label="Provider">
        {(['codex', 'claude'] as ProviderId[]).map((p) => (
          <label key={p} className={`seg-opt ${provider === p ? 'sel' : ''}`}>
            <input type="radio" name="provider" checked={provider === p} onChange={() => setProvider(p)} />
            {PROVIDER_LABEL[p]}
          </label>
        ))}
      </fieldset>
      {cli && !cli.found && (
        <p className="notice notice-error small" role="alert">
          {cli.error}
        </p>
      )}
      {cli?.found && (
        <p className="muted small">
          Found: {cli.version} ({cli.source})
        </p>
      )}
      <label className="field">
        <span>Alias</span>
        <input className="input" required value={alias} onChange={(e) => setAlias(e.target.value)} placeholder={provider === 'codex' ? 'e.g. OpenAI personal' : 'e.g. Claude personal'} maxLength={40} />
      </label>
      <div className="field">
        <span id="color-label">Color</span>
        <div className="swatches" role="radiogroup" aria-labelledby="color-label">
          {ACCOUNT_COLORS.map((c) => (
            <button type="button" key={c} role="radio" aria-checked={color === c} aria-label={c} className={`swatch ${color === c ? 'sel' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <label className="field">
        <span>Icon (optional, e.g. an emoji)</span>
        <input className="input narrow" value={icon} onChange={(e) => setIcon([...e.target.value].slice(0, 2).join(''))} placeholder="🏠" />
      </label>
      {alias && (
        <p className="muted small">
          Preview: <AccountBadge account={{ id: '', provider, alias, color, icon: icon || undefined, createdAt: '', connection: { state: 'unknown' } }} showProvider />
        </p>
      )}
      {error && (
        <p className="composer-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" type="submit" disabled={!alias.trim() || (cli && !cli.found)}>
        {submitLabel}
      </button>
    </form>
  );
}

export function ConnectionInfo({ account }: { account: Account }) {
  const c = account.connection;
  switch (c.state) {
    case 'connected':
      return (
        <span className="conn conn-ok">
          ✓ Connected{c.email ? ` as ${c.email}` : ''}
          {c.plan ? ` · ${c.plan}` : ''}
        </span>
      );
    case 'signed_out':
      return <span className="conn conn-off">Not signed in</span>;
    case 'error':
      return <span className="conn conn-err">Error: {c.message}</span>;
    case 'checking':
      return <span className="conn muted">Checking…</span>;
    default:
      return <span className="conn muted">Status unknown</span>;
  }
}

export function LoginPanel({ account }: { account: Account }) {
  const progress = useView().logins[account.id];
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const connected = account.connection.state === 'connected';
  if (!progress) {
    return (
      <button className={`btn small ${connected ? '' : 'primary'}`} onClick={() => void api.startLogin(account.id)}>
        {connected ? 'Sign in again' : 'Sign in'}
      </button>
    );
  }
  if (progress.stage === 'completed') {
    return (
      <p className="conn conn-ok" role="status">
        Signed in. <button className="link-btn" onClick={() => clearLogin(account.id)}>OK</button>
      </p>
    );
  }
  if (progress.stage === 'failed') {
    return (
      <div role="alert">
        <p className="conn conn-err">{progress.message}</p>
        <button className="btn small" onClick={() => (clearLogin(account.id), void api.startLogin(account.id))}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className="login-box" role="status">
      <p>
        Sign in with the account that belongs to “{account.alias}”. If your browser is already signed in to another account of this provider, copy the link and open it in a private window.
      </p>
      {progress.url && (
        <p className="small row wrap">
          <button className="btn small" onClick={() => void api.openExternal(progress.url!)}>
            Open in browser
          </button>
          <button className="btn small" onClick={() => void navigator.clipboard.writeText(progress.url!).then(() => setCopied(true))}>
            {copied ? 'Link copied' : 'Copy link (private window)'}
          </button>
        </p>
      )}
      {progress.acceptsCode && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void api.submitLoginCode(account.id, code);
            setCode('');
          }}
        >
          <input className="input small" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste code (only if the browser asks for it)" aria-label="Sign-in code" />
          <button className="btn small" disabled={!code.trim()}>
            Submit
          </button>
        </form>
      )}
      <button className="link-btn small" onClick={() => (void api.cancelLogin(account.id), clearLogin(account.id))}>
        Cancel
      </button>
    </div>
  );
}

function AccountRow({ account, app }: { account: Account; app: AppState }) {
  const [editing, setEditing] = useState(false);
  const [alias, setAlias] = useState(account.alias);
  const [error, setError] = useState<string>();
  const used = app.conversations.filter((c) => c.accountId === account.id).length;
  const email = account.connection.state === 'connected' ? account.connection.email : undefined;
  const duplicate = email ? app.accounts.find((o) => o.id !== account.id && o.provider === account.provider && o.connection.state === 'connected' && o.connection.email === email) : undefined;
  const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  return (
    <li className="acc-row">
      <div className="acc-main">
        {editing ? (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.updateAccount(account.id, { alias });
                setEditing(false);
                setError(undefined);
              } catch (err) {
                setError(clean(err));
              }
            }}
          >
            <input className="input small" value={alias} onChange={(e) => setAlias(e.target.value)} aria-label="Alias" autoFocus />
            <button className="btn small">Save</button>
          </form>
        ) : (
          <AccountBadge account={account} size="lg" showProvider />
        )}
        <ConnectionInfo account={account} />
        <Usage account={account}/>
        {duplicate && (
          <span className="conn conn-err" role="alert">
            Same identity as “{duplicate.alias}”. Sign in again with the right account.
          </span>
        )}
        {error && <span className="conn conn-err">{error}</span>}
      </div>
      <div className="swatches small" role="radiogroup" aria-label={`Color of ${account.alias}`}>
        {ACCOUNT_COLORS.map((c) => (
          <button key={c} role="radio" aria-checked={account.color === c} aria-label={c} className={`swatch ${account.color === c ? 'sel' : ''}`} style={{ background: c }} onClick={() => void api.updateAccount(account.id, { color: c })} />
        ))}
      </div>
      <div className="acc-actions">
        <LoginPanel account={account} />
        <button className="btn small" onClick={() => void api.checkAccount(account.id)}>
          Check status
        </button>
        <button className="btn small" onClick={() => setEditing((v) => !v)}>
          Rename
        </button>
        <button
          className="btn small danger"
          onClick={async () => {
            if (!confirm(`Remove account “${account.alias}”? Ailo signs it out and deletes its account folder.${used ? ` ${used} conversation(s) stay readable but can't continue.` : ''}`)) return;
            const r = await api.removeAccount(account.id);
            if (!r.ok) setError(r.error);
          }}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

export function AccountsDialog({ open, onClose, app }: { open: boolean; onClose: () => void; app: AppState }) {
  const clis = useClis();
  const [adding, setAdding] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title="Accounts" wide>
      <p className="muted small">Each account has its own isolated configuration folder. The CLI manages the credentials itself: Codex in Windows Credential Manager, Claude Code in its own account folder. Ailo never stores tokens.</p>
      <ul className="acc-list">
        {app.accounts.map((a) => (
          <AccountRow key={a.id} account={a} app={app} />
        ))}
        {app.accounts.length === 0 && <li className="muted">No accounts yet.</li>}
      </ul>
      {adding ? (
        <div className="card">
          <h3>Add account</h3>
          <AccountForm clis={clis} onCreated={(a) => (setAdding(false), void api.startLogin(a.id, { openBrowser: !app.accounts.some((o) => o.provider === a.provider) }))} submitLabel="Add and sign in" />
        </div>
      ) : (
        <button className="btn" onClick={() => setAdding(true)}>
          + Add account
        </button>
      )}
    </Dialog>
  );
}
