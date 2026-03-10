/**
 * File Transport for Logger
 *
 * Writes log events as JSONL (one JSON object per line) to a file.
 * Buffers writes in memory and flushes on demand.
 * Creates parent directories automatically.
 */

import { dirname } from "@std/path";
import { ensureDir } from "@std/fs";
import type { LogEvent, Transport } from "../types.ts";

/**
 * JSONL file transport that writes structured log events to disk.
 */
export class FileTransport implements Transport {
  readonly name = "file";
  private buffer: string[] = [];
  private dirEnsured = false;
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  write(event: LogEvent): void {
    const record = {
      timestamp: event.timestamp.toISOString(),
      level: event.level,
      namespace: event.namespace,
      message: event.message,
      ...(event.data && { data: event.data }),
    };
    this.buffer.push(JSON.stringify(record));
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    if (!this.dirEnsured) {
      await ensureDir(dirname(this.filePath));
      this.dirEnsured = true;
    }

    const content = this.buffer.join("\n") + "\n";
    this.buffer = [];

    await Deno.writeTextFile(this.filePath, content, { append: true });
  }
}
