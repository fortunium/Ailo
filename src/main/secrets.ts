import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConnectionCredentials } from '../shared/types';

export class SecretVault {
  constructor(private root: string, private encrypt: (text: string) => Buffer | Promise<Buffer>, private decrypt: (data: Buffer) => string | Promise<string>) {}
  async put(credentials: ConnectionCredentials): Promise<string> {
    const id = randomUUID();
    const directory = path.join(this.root, 'secrets');
    const encrypted = await this.encrypt(JSON.stringify(credentials));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, id + '.bin'), encrypted, { flag: 'wx' });
    return id;
  }
  async get(id: string): Promise<ConnectionCredentials> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid credential reference.');
    return JSON.parse(await this.decrypt(fs.readFileSync(path.join(this.root, 'secrets', id + '.bin'))));
  }
  async update(id: string, credentials: ConnectionCredentials): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid credential reference.');
    const file = path.join(this.root, 'secrets', id + '.bin');
    const temp = file + '.' + randomUUID() + '.tmp';
    fs.writeFileSync(temp, await this.encrypt(JSON.stringify(credentials)), { flag: 'wx' });
    fs.renameSync(temp, file);
  }
}
