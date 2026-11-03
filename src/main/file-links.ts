import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalFileLink, type LocalFilePreview } from '../shared/file-links';

const LIMIT = 1024 * 1024;
const BINARY = /\.(?:pdf|png|jpe?g|gif|webp|ico|zip|gz|7z|exe|dll|docx?|xlsx?|pptx?|mp[34]|wav)$/i;

export async function resolveConversationFile(target: string, roots: string[]): Promise<string> {
  if (typeof target !== 'string' || !isLocalFileLink(target) || /[\x00-\x1f]/.test(target)) throw new Error('Unsupported file link.');
  let value: string;
  if (/^file:/i.test(target)) {
    const url = new URL(target);
    if (url.hostname && url.hostname !== 'localhost') throw new Error('Network file links are not supported.');
    url.hash = ''; url.search = '';
    value = fileURLToPath(url);
  } else {
    try { value = decodeURIComponent(target.split(/[?#]/, 1)[0]); }
    catch { throw new Error('The file link has invalid encoding.'); }
    if (/^\/[a-z]:[\\/]/i.test(value)) value = value.slice(1);
  }
  if (/^(?:\\\\|\/\/)/.test(value)) throw new Error('Network file links are not supported.');
  if (/[\x00-\x1f]/.test(value)) throw new Error('Unsupported file link.');
  value = value.replace(/:\d+(?::\d+)?$/, '');
  if (process.platform !== 'win32' && /^[a-z]:[\\/]/i.test(value)) throw new Error('This Windows file path cannot be opened on this system.');
  const realRoots = (await Promise.all(roots.map(r => fs.realpath(r).catch(() => undefined)))).filter((r): r is string => !!r);
  const candidates = path.isAbsolute(value) ? [value] : roots.map(r => path.resolve(r, value));
  let outside = false;
  for (const candidate of candidates) {
    const real = await fs.realpath(candidate).catch(() => undefined);
    if (!real) continue;
    if (realRoots.some(root => {
      const relative = path.relative(root, real);
      return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
    })) return real;
    outside = true;
  }
  if (outside) throw new Error('This file is outside the working folders of this conversation.');
  throw new Error('File not found. It may have been moved, deleted, or not created yet.');
}

export async function previewConversationFile(target: string, roots: string[]): Promise<LocalFilePreview> {
  const real = await resolveConversationFile(target, roots);
  const info = await fs.stat(real);
  const result = { path: real, name: path.basename(real) };
  if (info.isDirectory()) return { ...result, directory: true, message: 'This link points to a folder.' };
  if (!info.isFile()) throw new Error('This link does not point to a regular file.');
  if (info.size > LIMIT) return { ...result, message: 'This file is too large to preview. Show it in its folder to open it.' };
  if (BINARY.test(real)) return { ...result, message: 'Preview is unavailable for this file type. Show it in its folder to open it.' };
  const handle = await fs.open(real, 'r');
  try {
    const buffer = Buffer.alloc(LIMIT + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > LIMIT) return { ...result, message: 'This file is too large to preview.' };
    const data = buffer.subarray(0, bytesRead);
    if (data.includes(0)) return { ...result, message: 'Preview is unavailable for this binary file.' };
    return { ...result, text: data.toString('utf8').replace(/^\uFEFF/, '') };
  } finally { await handle.close(); }
}
