import { Logger } from "../logger/mod.ts";

const log = Logger.create("container:docker-inspect");

/** The two facts we read straight from Docker, no BCH involved. */
export interface ContainerInspection {
  /** Value of the container's `artifactUrl` env entry, if present. */
  artifactUrl: string | undefined;
  /** Docker's own view of whether the container is running. */
  running: boolean;
}

/**
 * Parse `docker inspect <name>` output.
 *
 * Split out from the subprocess call so it is unit-testable without Docker.
 */
export function parseInspectJson(raw: string): ContainerInspection | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const entry = parsed[0] as {
    Config?: { Env?: unknown };
    State?: { Running?: unknown };
  };
  const env = Array.isArray(entry.Config?.Env)
    ? entry.Config.Env as string[]
    : [];
  const hit = env.find((e) =>
    typeof e === "string" && e.startsWith("artifactUrl=")
  );
  return {
    artifactUrl: hit ? hit.slice("artifactUrl=".length) : undefined,
    running: entry.State?.Running === true,
  };
}

/**
 * Read a container's artifact URL and running state directly from Docker.
 *
 * This is exactly what `Get-BcContainerArtifactUrl` does
 * (`Get-NavContainerArtifactUrl.ps1:19-23`: `docker inspect | ConvertFrom-Json`,
 * then the `artifactUrl=` env entry), so it is an exact substitute rather than
 * an approximation — at roughly 0.36 s against ~5 s for a cold pwsh plus
 * `bcchImport()`. Works on stopped containers.
 *
 * Returns `undefined` when the container does not exist or `docker` fails;
 * callers treat that as "cannot adopt" and fall back to a rebuild.
 */
export async function inspectContainer(
  containerName: string,
): Promise<ContainerInspection | undefined> {
  try {
    const cmd = new Deno.Command("docker", {
      args: ["inspect", containerName],
      stdout: "piped",
      stderr: "null",
    });
    const { code, stdout } = await cmd.output();
    if (code !== 0) return undefined;
    return parseInspectJson(new TextDecoder().decode(stdout));
  } catch (error) {
    log.warn(`docker inspect failed for ${containerName}: ${error}`);
    return undefined;
  }
}
