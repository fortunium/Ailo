import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dir = path.resolve('dist');
const files = (await readdir(dir)).filter((name) => /^Ailo-.*\.(exe|AppImage|tar\.gz)$/.test(name)).sort();
if (!files.length) throw new Error('No distribution files in dist/. Build a package first.');
const lines = [];
for (const name of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(dir, name))) hash.update(chunk);
  lines.push(`${hash.digest('hex')}  ${name}`);
}
await writeFile(path.join(dir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
console.log(`SHA256SUMS.txt: ${files.length} packages`);
