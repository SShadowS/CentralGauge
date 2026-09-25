/** In-memory DockerCli for unit tests. Images are stored by immutable id; tags point at ids. */

import {
  type Capture,
  type DockerCli,
  EXECUTION_LABEL,
} from "../../../src/harness/sandbox.ts";

export interface RunCall {
  args: string[];
  name: string;
  image: string;
  network: string | null;
  isolation: string | null;
  command: string[];
  mounts: Map<string, { src: string; readonly: boolean }>;
  env: Map<string, string>;
  labels: Map<string, string>;
}

export function parseRunArgs(args: string[]): RunCall {
  const at = args.findIndex((a) => a.startsWith("sha256:"));
  const imageAt = at >= 0 ? at : args.length - 1;
  const call: RunCall = {
    args,
    name: "",
    image: args[imageAt]!,
    network: null,
    isolation: null,
    command: args.slice(imageAt + 1),
    mounts: new Map(),
    env: new Map(),
    labels: new Map(),
  };
  for (let i = 1; i < imageAt; i++) {
    const a = args[i]!;
    const v = args[i + 1]!;
    if (a === "--name") call.name = v;
    else if (a === "--network") call.network = v;
    else if (a === "--isolation") call.isolation = v;
    else if (a === "--label") {
      call.labels.set(v.split("=")[0]!, v.slice(v.indexOf("=") + 1));
    } else if (a === "-e") {
      call.env.set(v.split("=")[0]!, v.slice(v.indexOf("=") + 1));
    } else if (a === "--mount") {
      const parts = Object.fromEntries(
        v.split(",").map((p) => p.includes("=") ? p.split("=") : [p, "true"]),
      );
      call.mounts.set(parts.dst, {
        src: parts.src,
        readonly: parts.readonly === "true",
      });
    } else continue;
    i++;
  }
  return call;
}

export interface RunIO {
  stdout(line: string): Promise<void>;
  /** Resolves when `docker kill` or `docker rm -f` hits this container. */
  killed: Promise<void>;
}
export type RunBehavior = (call: RunCall, io: RunIO) => Promise<number>;

const never = <T>() => new Promise<T>(() => {});

export class FakeDocker implements DockerCli {
  runs: RunCall[] = [];
  kills: string[] = [];
  removed: string[] = [];
  paused: string[] = [];
  builds: string[][] = [];
  owned: string[] = [];
  /** Immutable id -> inspect object; tag -> id. */
  images = new Map<string, unknown>();
  tags = new Map<string, string>();
  rmFails = new Set<string>();
  /** Containers `state` still reports as present after rm. */
  lingering = new Set<string>();
  killFails = false;
  killHangs = false;
  rmHangs = false;
  /** `docker run` never returns even after kill (a wedged daemon). */
  wedged = false;
  /** Fails before the spawn (capture file, spawn error). */
  runError: Error | null = null;
  /** Fails after the spawn (capture broke mid-run). */
  failAfterStart: Error | null = null;
  behavior: RunBehavior = () => Promise.resolve(0);
  /** Existing containers: name -> execution label (null when unlabeled). */
  containers = new Map<string, string | null>();
  /** The last capture handed to run (its abort signal is observable). */
  lastCapture: Capture | null = null;
  private deleted = new Set<string>();
  private stoppers = new Map<string, () => void>();

  addImage(
    tag: string,
    id: string,
    labels: Record<string, string>,
    layers: string[] = [id],
  ): void {
    this.images.set(id, {
      Id: id,
      Config: { Labels: labels },
      RootFS: { Layers: layers },
    });
    this.tags.set(tag, id);
  }

  async run(args: string[], c: Capture): Promise<number> {
    if (this.runError) throw this.runError;
    const out = await Deno.open(c.stdoutPath, { write: true, createNew: true });
    await Deno.writeTextFile(c.stderrPath, "", { createNew: true });
    const call = parseRunArgs(args);
    this.lastCapture = c;
    c.onStarted();
    if (this.containers.has(call.name)) {
      out.close();
      return 125; // Conflict. The container name is already in use.
    }
    this.runs.push(call);
    this.containers.set(call.name, call.labels.get(EXECUTION_LABEL) ?? null);
    const killed = new Promise<void>((r) => this.stoppers.set(call.name, r));
    let written = 0;
    try {
      if (this.failAfterStart) throw this.failAfterStart;
      const code = await this.behavior(call, {
        stdout: async (line) => {
          const bytes = new TextEncoder().encode(line + "\n");
          if (written + bytes.length > c.maxBytes) {
            c.onOverflow();
            return;
          }
          written += bytes.length;
          await out.write(bytes);
        },
        killed,
      });
      if (this.wedged) await never();
      return code;
    } finally {
      out.close();
    }
  }
  kill(name: string): Promise<number> {
    this.kills.push(name);
    if (this.killHangs) return never();
    if (this.killFails) return Promise.resolve(1);
    this.stoppers.get(name)?.();
    return Promise.resolve(0);
  }
  rm(name: string): Promise<{ code: number; stderr: string }> {
    this.removed.push(name);
    if (this.rmHangs) return never();
    if (this.rmFails.has(name)) {
      return Promise.resolve({ code: 1, stderr: "Error: device busy" });
    }
    this.stoppers.get(name)?.();
    const existed = this.containers.delete(name);
    if (!existed && !this.owned.includes(name)) {
      return Promise.resolve({
        code: 1,
        stderr: `Error response from daemon: No such container: ${name}`,
      });
    }
    this.deleted.add(name);
    return Promise.resolve({ code: 0, stderr: "" });
  }
  pause(name: string): Promise<number> {
    this.paused.push(name);
    return Promise.resolve(0);
  }
  unpause(_name: string): Promise<number> {
    return Promise.resolve(0);
  }
  state(
    name: string,
  ): Promise<{ running: boolean; execution: string | null } | null> {
    const execution = this.containers.get(name) ?? null;
    if (
      this.lingering.has(name) || this.rmFails.has(name) ||
      this.containers.has(name) ||
      (this.owned.includes(name) && !this.deleted.has(name))
    ) {
      return Promise.resolve({ running: true, execution });
    }
    return Promise.resolve(null);
  }
  listOwned(_owner: string): Promise<string[]> {
    return Promise.resolve([...this.owned]);
  }
  inspectImage(ref: string): Promise<unknown | null> {
    return Promise.resolve(
      this.images.get(this.tags.get(ref) ?? ref) ?? null,
    );
  }
  build(args: string[]): Promise<number> {
    this.builds.push(args);
    return Promise.resolve(0);
  }
}
