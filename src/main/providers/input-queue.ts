/** A closeable input stream. Closing discards unconsumed input on Stop. */
export class InputQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private wake?: () => void;
  private closed = false;
  push(value: T): void {
    if (this.closed) throw new Error('The input stream is closed.');
    this.values.push(value); this.wake?.(); this.wake = undefined;
  }
  close(): void { this.closed = true; this.values = []; this.wake?.(); this.wake = undefined; }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (!this.closed) {
      if (this.values.length) yield this.values.shift()!;
      else await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
}
