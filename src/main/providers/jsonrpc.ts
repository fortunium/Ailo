// Minimal JSON-RPC 2.0 peer over newline-delimited JSON (Codex app-server stdio).
// The app-server omits the "jsonrpc" header on the wire; we do the same.

import type { Readable, Writable } from 'node:stream';
import readline from 'node:readline';

export interface RpcMessage {
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number
  ) {
    super(message);
  }
}

export class JsonRpcPeer {
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private closed = false;

  constructor(
    input: Readable,
    private output: Writable,
    private handlers: {
      onNotification(method: string, params: any): void;
      onRequest(id: number | string, method: string, params: any): void;
      onParseError(line: string): void;
    }
  ) {
    const rl = readline.createInterface({ input, crlfDelay: Infinity });
    rl.on('line', (line) => this.receive(line));
  }

  request<T = any>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new RpcError('Connection to the provider is closed', -1));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.send(params === undefined ? { method } : { method, params });
  }

  respond(id: number | string, result: unknown): void {
    this.send({ id, result });
  }

  respondError(id: number | string, code: number, message: string): void {
    this.send({ id, error: { code, message } });
  }

  close(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new RpcError(reason, -1));
    this.pending.clear();
  }

  private send(msg: RpcMessage): void {
    if (this.closed) return;
    this.output.write(JSON.stringify(msg) + '\n');
  }

  private receive(line: string): void {
    if (!line.trim()) return;
    let msg: RpcMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      this.handlers.onParseError(line);
      return;
    }
    if (msg.method && msg.id !== undefined) {
      this.handlers.onRequest(msg.id, msg.method, msg.params);
    } else if (msg.method) {
      this.handlers.onNotification(msg.method, msg.params);
    } else if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new RpcError(msg.error.message, msg.error.code));
      else p.resolve(msg.result);
    }
  }
}
