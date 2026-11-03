import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { common, createLowlight } from 'lowlight';
import type { RootContent } from 'hast';

const syntax = createLowlight(common);

export function languageForPath(file: string): string | undefined {
  const extension = file.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase();
  const languages: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript', json: 'json', html: 'html', htm: 'html',
    xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', less: 'less',
    py: 'python', sh: 'bash', bash: 'bash', ps1: 'powershell', sql: 'sql', yaml: 'yaml', yml: 'yaml',
    toml: 'ini', ini: 'ini', md: 'markdown', cs: 'csharp', c: 'c', h: 'c',
    cpp: 'cpp', hpp: 'cpp', java: 'java', go: 'go', rs: 'rust', rb: 'ruby', php: 'php'
  };
  return extension ? languages[extension] : undefined;
}

// Render only text and spans from the highlighter, never HTML supplied by a model.
function token(node: RootContent, key: number): ReactNode {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return <span key={key} className={(node.properties.className as string[] | undefined)?.join(' ')}>{node.children.map(token)}</span>;
  return null;
}

export const CodeSyntax = memo(function CodeSyntax({ code, lang }: { code: string; lang?: string }) {
  return useMemo(() => {
    // Unknown languages and very large snippets remain readable without guessing or expensive parsing.
    if (!lang || !syntax.registered(lang.toLowerCase()) || code.length > 100000) return <>{code}</>;
    try { return <>{syntax.highlight(lang.toLowerCase(), code).children.map(token)}</>; }
    catch { return <>{code}</>; }
  }, [code, lang]);
});

export const CodeBlock = memo(function CodeBlock({ lang, code, label, children }: { lang?: string; code: string; label?: string; children?: ReactNode }) {
  const [copyState, setCopyState] = useState<'ready' | 'copied' | 'failed'>('ready');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <div className="code" aria-label={`${label ?? lang ?? 'Text'} code block`}>
    <div className="code-head"><span>{label ?? lang ?? 'text'}</span><button className="link-btn" onClick={async () => {
      clearTimeout(timer.current);
      try { await navigator.clipboard.writeText(code); setCopyState('copied'); }
      catch { setCopyState('failed'); }
      timer.current = setTimeout(() => setCopyState('ready'), 1800);
    }} aria-label="Copy code">{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}</button></div>
    {children ?? <div className="code-body">
      <pre className="code-gutter" aria-hidden="true">{Array.from({ length: code.replace(/\n$/, '').split('\n').length }, (_, i) => i + 1).join('\n')}</pre>
      <pre className="code-source"><code className={lang ? `language-${lang}` : undefined}><CodeSyntax code={code} lang={lang}/></code></pre>
    </div>}
  </div>;
});
