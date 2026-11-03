import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Attachment } from '../shared/types';

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function imageMime(data: Uint8Array): string | undefined {
  const b = Buffer.from(data);
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(b.subarray(0, 6).toString())) return 'image/gif';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
}

export function saveAttachment(folder: string, name: string, data: Uint8Array): Attachment {
  if (!data.byteLength || data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachments must be between 1 byte and 20 MB.');
  const kind = imageMime(data) ? 'image' : 'file';
  if (kind === 'image' && data.byteLength > 5 * 1024 * 1024) throw new Error('Images must be smaller than 5 MB.');
  const safeName = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(-120) || 'attachment';
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, `${randomUUID()}-${safeName}`);
  fs.writeFileSync(target, data, { flag: 'wx' });
  return { name: safeName, path: target, kind, size: data.byteLength };
}

/** Never trust renderer-supplied paths or metadata when sending attachments. */
export function validateAttachments(folder: string, attachments: Attachment[]): Attachment[] {
  if (!Array.isArray(attachments) || attachments.length > 10) throw new Error('Attach at most 10 files per message.');
  return attachments.map((a) => {
    const file = path.resolve(a.path);
    const stat = fs.lstatSync(file);
    if (path.dirname(file) !== path.resolve(folder) || stat.isSymbolicLink() || !stat.isFile() || fs.realpathSync(file) !== file) throw new Error('Attachment does not belong to this conversation.');
    if (!stat.size || stat.size > MAX_ATTACHMENT_BYTES) throw new Error('Invalid attachment size.');
    const data = fs.readFileSync(file);
    const kind = imageMime(data) ? 'image' : 'file';
    if (kind === 'image' && stat.size > 5 * 1024 * 1024) throw new Error('Images must be smaller than 5 MB.');
    return { name: path.basename(file).slice(37), path: file, kind, size: stat.size };
  });
}

export function attachmentPrompt(text: string, attachments: Attachment[]): string {
  const files = attachments.filter((a) => a.kind === 'file');
  return [text, files.length ? 'Attached files (read these local copies when needed):\n' + files.map((a) => JSON.stringify(a.path)).join('\n') : ''].filter(Boolean).join('\n\n');
}
