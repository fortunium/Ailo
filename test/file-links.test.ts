import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewConversationFile, resolveConversationFile } from '../src/main/file-links';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ailo-files-'));
  const project = path.join(root, 'project');
  await fs.mkdir(path.join(project, 'tools'), { recursive: true });
  const file = path.join(project, 'tools', 'Example report.ps1');
  await fs.writeFile(file, 'Write-Output "Example"');
  return { root, project, file };
}

it('previews absolute, relative and file-URL links without executing scripts', async () => {
  const { project, file } = await fixture();
  const targets = [file, 'tools/Example%20report.ps1#L3', pathToFileURL(file).href + '#L2', file + ':12:3'];
  if (process.platform === 'win32') targets.push('/' + file.replaceAll('\\', '/'));
  for (const target of targets) expect(await previewConversationFile(target, [project])).toMatchObject({ name: 'Example report.ps1', text: 'Write-Output "Example"' });
});

it('rejects missing files, outside paths, sibling-prefix paths and symlink escapes', async () => {
  const { root, project } = await fixture();
  const outside = path.join(root, 'project-backup'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'private.txt'), 'outside');
  await expect(resolveConversationFile('missing.md', [project])).rejects.toThrow('File not found');
  await expect(resolveConversationFile('../project-backup/private.txt', [project])).rejects.toThrow('outside');
  await expect(resolveConversationFile(path.join(outside, 'private.txt'), [project])).rejects.toThrow('outside');
  await fs.symlink(outside, path.join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await expect(resolveConversationFile('linked/private.txt', [project])).rejects.toThrow('outside');
});

it('rejects network links and unsupported protocols before accessing them', async () => {
  const { project } = await fixture();
  for (const target of ['https://example.com', 'javascript:alert(1)', 'file://server/share/example.txt', '\\\\server\\share\\example.txt', '%2F%2Fserver/share/example.txt', 'tools/%00bad']) {
    await expect(resolveConversationFile(target, [project])).rejects.toThrow();
  }
});

it('offers folder access for directories, large files and binary files', async () => {
  const { project } = await fixture();
  expect(await previewConversationFile('tools', [project])).toMatchObject({ directory: true });
  await fs.writeFile(path.join(project, 'large.txt'), 'x'.repeat(1024 * 1024 + 1));
  expect(await previewConversationFile('large.txt', [project])).toMatchObject({ message: expect.stringContaining('too large') });
  await fs.writeFile(path.join(project, 'binary'), Buffer.from([1, 0, 2]));
  expect(await previewConversationFile('binary', [project])).toMatchObject({ message: expect.stringContaining('binary') });
});
