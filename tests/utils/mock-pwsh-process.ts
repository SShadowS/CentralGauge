/**
 * Test helper that simulates a long-running child process compatible with
 * Deno.ChildProcess for use as a PwshContainerSession spawn target.
 * @module tests/utils/mock-pwsh-process
 */

export interface MockPwshProcess {
  /** The process-like object passed to PwshContainerSession via spawnFactory. */
  process: {
    stdin: WritableStream<Uint8Array>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    status: Promise<{ success: boolean; code: number }>;
    kill: (signal?: Deno.Signal) => void;
  };
  /** Returns text-decoded chunks written to stdin. */
  getStdinWrites: () => string[];
  /** Emits text on stdout. Test driver pushes data the session will read. */
  emitStdout: (text: string) => void;
  /** Emits text on stderr. */
  emitStderr: (text: string) => void;
  /** Resolves status with the given exit code. After this, no more output is consumed. */
  exit: (code: number) => void;
  /** True if kill() was called. */
  wasKilled: () => boolean;
}

export function createMockPwshProcess(): MockPwshProcess {
  const stdinWrites: string[] = [];
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stdin = new WritableStream<Uint8Array>({
    write(chunk) {
      stdinWrites.push(decoder.decode(chunk));
    },
  });

  // Use TransformStream so we can push to readable side from the test.
  const stdoutTransform = new TransformStream<Uint8Array, Uint8Array>();
  const stdoutWriter = stdoutTransform.writable.getWriter();
  const stderrTransform = new TransformStream<Uint8Array, Uint8Array>();
  const stderrWriter = stderrTransform.writable.getWriter();

  let resolveStatus: (s: { success: boolean; code: number }) => void;
  const status = new Promise<{ success: boolean; code: number }>((res) => {
    resolveStatus = res;
  });
  let killed = false;

  return {
    process: {
      stdin,
      stdout: stdoutTransform.readable,
      stderr: stderrTransform.readable,
      status,
      kill(_signal?: Deno.Signal) {
        killed = true;
        resolveStatus({ success: false, code: 137 });
        try {
          stdoutWriter.close();
        } catch {
          // ignore — already closed
        }
        try {
          stderrWriter.close();
        } catch {
          // ignore
        }
      },
    },
    getStdinWrites: () => [...stdinWrites],
    emitStdout(text) {
      stdoutWriter.write(encoder.encode(text)).catch(() => {
        // stream closed — ignore late emissions
      });
    },
    emitStderr(text) {
      stderrWriter.write(encoder.encode(text)).catch(() => {
        // stream closed — ignore late emissions
      });
    },
    exit(code) {
      resolveStatus({ success: code === 0, code });
      try {
        stdoutWriter.close();
      } catch {
        // ignore
      }
      try {
        stderrWriter.close();
      } catch {
        // ignore
      }
    },
    wasKilled: () => killed,
  };
}
