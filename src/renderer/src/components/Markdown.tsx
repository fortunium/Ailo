import { createContext, memo, useContext, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';
import { CodeBlock, CodeSyntax, languageForPath } from './CodeBlock';
import { Dialog } from './ui';
import { isLocalFileLink, type LocalFilePreview } from '../../../shared/file-links';

export const ConversationLinkContext = createContext<string | undefined>(undefined);

export function DiffText({ diff, lang }: { diff: string; lang?: string }) {
  return (
    <pre className="diff" aria-label="Changes">
      {diff.split('\n').map((line, i) => {
        const cls = line.startsWith('+++') || line.startsWith('---') ? 'd-meta' : line.startsWith('+') ? 'd-add' : line.startsWith('-') ? 'd-del' : line.startsWith('@@') ? 'd-hunk' : '';
        return (
          <span key={i} className={cls}>
            {cls === 'd-meta' || cls === 'd-hunk' ? line : <>{cls ? line[0] : ''}<CodeSyntax code={(cls ? line.slice(1) : line) || ' '} lang={lang}/></>}
            {'\n'}
          </span>
        );
      })}
    </pre>
  );
}

/** Providers send either a unified patch or the full source of a newly created file. */
export function FileChangeCode({ path, change, diff }: { path: string; change: string; diff: string }) {
  const lang = languageForPath(path);
  const lines = diff.split('\n');
  const unified = /^(?:@@(?: |$)|diff --git |--- |\+\+\+ )/m.test(diff) ||
    (lines.some((l) => /^[+-](?![+-])/.test(l)) && lines.every((l) => !l || /^[ +\-]/.test(l)));
  if (change === 'add' && unified && !lines.some((l) => /^-(?!-- )/.test(l))) {
    const code = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++ ')).map((l) => l.slice(1)).join('\n');
    return <CodeBlock code={code} lang={lang}/>;
  }
  if (unified) return <CodeBlock code={diff} lang={lang} label={`${lang ?? 'text'} · diff`}><DiffText diff={diff} lang={lang}/></CodeBlock>;
  return <CodeBlock code={diff} lang={lang}/>;
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const conversationId = useContext(ConversationLinkContext);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<LocalFilePreview>();
  const [error, setError] = useState<string>();
  const request = useRef(0);
  const close = () => { request.current++; setOpen(false); };
  async function follow(href: string) {
    if (/^https?:/i.test(href)) {
      try { await api.openExternal(href); } catch (e) { setError((e as Error).message); setOpen(true); }
      return;
    }
    const current = ++request.current;
    setOpen(true); setLoading(true); setPreview(undefined); setError(undefined);
    try {
      if (!isLocalFileLink(href)) throw new Error('This link type is not supported.');
      if (!conversationId) throw new Error('Open this file from its conversation.');
      if (!api.previewConversationFile) throw new Error('Restart Ailo to enable local file previews.');
      const file = await api.previewConversationFile(conversationId, href);
      if (request.current === current) setPreview(file);
    } catch (e) { if (request.current === current) setError((e as Error).message); }
    finally { if (request.current === current) setLoading(false); }
  }
  return (
    <>
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url, key) => key === 'href' && isLocalFileLink(url) ? url : defaultUrlTransform(url)}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                void follow(href ?? '');
              }}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const text = String(children ?? '');
            const lang = /language-(\S+)/.exec(className ?? '')?.[1];
            if (!lang && !text.includes('\n')) return <code className="inline">{children}</code>;
            const code = text.replace(/\n$/, '');
            return lang === 'diff' ? <CodeBlock lang="diff" code={code}><DiffText diff={code}/></CodeBlock> : <CodeBlock lang={lang} code={code} />;
          }
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
      <Dialog open={open} onClose={close} title={preview?.name ?? 'File preview'} wide>
        {loading && <p>Loading file…</p>}
        {error && <p className="file-preview-error" role="alert">{error}</p>}
        {preview && <>
          <p className="file-preview-path">{preview.path}</p>
          <button className="btn" onClick={() => {
            if (!api.showConversationFile) { setError('Restart Ailo to enable opening file locations.'); return; }
            void api.showConversationFile(conversationId!, preview.path).catch((e) => setError(e.message));
          }}>Show in folder</button>
          {preview.message && <p>{preview.message}</p>}
          {preview.text !== undefined && <CodeBlock code={preview.text} lang={languageForPath(preview.path)}/>}
        </>}
      </Dialog>
    </>
  );
});
