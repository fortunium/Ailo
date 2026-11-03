import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../api';
import { CodeBlock, CodeSyntax, languageForPath } from './CodeBlock';

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
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) void api.openExternal(href);
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
  );
});
