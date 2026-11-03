import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeBlock } from '../src/renderer/src/components/CodeBlock';
import { FileChangeCode, Markdown } from '../src/renderer/src/components/Markdown';

vi.mock('../src/renderer/src/api', () => ({ api: { openExternal: vi.fn() } }));

describe('Code rendering', () => {
  it('renders fenced code and inline code alongside normal text', () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: 'Use `canvas`:\n\n```javascript\nconst size = 50;\n```\n\nDone.' }));
    expect(html).toContain('class="inline">canvas');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('Copy code');
    expect(html).not.toContain('```');
    expect(html).toContain('Done.');
  });

  it('treats HTML in code as inert text, also for unknown languages', () => {
    for (const lang of ['html', 'unknown-language']) {
      const html = renderToStaticMarkup(createElement(CodeBlock, { lang, code: '<script>alert(1)</script>\n<img src=x onerror=alert(1)>' }));
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<img');
      expect(html).toContain('&lt;');
      expect(html).toContain('alert');
    }
  });

  it('shows a created JavaScript file as highlighted source without requiring diff markers', () => {
    const html = renderToStaticMarkup(createElement(FileChangeCode, { path: 'C:\\project\\canvas.js', change: 'add', diff: 'const canvas = document.createElement("canvas");\ncanvas.width = 50;' }));
    expect(html).toContain('javascript code block');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('1\n2');
    expect(html).toContain('createElement');
  });

  it('keeps added and removed lines distinguishable in an edit', () => {
    const html = renderToStaticMarkup(createElement(FileChangeCode, { path: 'canvas.js', change: 'update', diff: '@@ -1 +1 @@\n-const size = 20;\n+const size = 50;' }));
    expect(html).toContain('d-hunk');
    expect(html).toContain('d-del');
    expect(html).toContain('d-add');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('Copy code');
  });
});
