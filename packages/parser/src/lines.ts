/**
 * Incremental line assembly.
 *
 * The same code path serves both milestones: feeding whole-file chunks as fast
 * as the disk allows is a batch parse, and feeding the bytes appended since
 * the last poll is a live tail. Chunk boundaries land mid-line and mid-UTF-8
 * sequence constantly, so both are carried across pushes — realm names carry
 * accented characters and splitting one would corrupt a player's identity.
 */
export class LineAssembler {
  private readonly decoder = new TextDecoder('utf-8');
  private partial = '';
  /** Lines emitted since construction, for progress reporting. */
  lineCount = 0;

  /**
   * Decodes `chunk` and invokes `onLine` for each complete line. A trailing
   * fragment is held until the next push — important for live tail, where the
   * game may well have flushed half a line.
   */
  push(chunk: Uint8Array, onLine: (line: string) => void): void {
    this.consume(this.partial + this.decoder.decode(chunk, { stream: true }), onLine);
  }

  /** Text-mode entry point, for tests and for the browser's File.text(). */
  pushText(text: string, onLine: (line: string) => void): void {
    this.consume(this.partial + text, onLine);
  }

  private consume(text: string, onLine: (line: string) => void): void {
    let start = 0;
    for (;;) {
      const index = text.indexOf('\n', start);
      if (index === -1) break;
      let end = index;
      if (end > start && text.charCodeAt(end - 1) === 13 /* \r */) end--;
      if (end > start) {
        this.lineCount++;
        onLine(text.slice(start, end));
      }
      start = index + 1;
    }
    this.partial = text.slice(start);
  }

  /**
   * Flushes a trailing line with no newline. Call at end of file; never call
   * while tailing, or a half-written line will be parsed as a whole one.
   */
  end(onLine: (line: string) => void): void {
    const rest = this.partial;
    this.partial = '';
    if (rest.length > 0) {
      this.lineCount++;
      onLine(rest);
    }
  }

  reset(): void {
    this.partial = '';
    this.lineCount = 0;
  }
}
