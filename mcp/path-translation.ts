/**
 * Sandbox path translation with containment enforcement (finding M4).
 *
 * In sandbox mode the agent container sees only C:\workspace; MCP tool calls
 * carry container paths that must be mapped to the real host workspace
 * directory. Translation is segment-aware and the translated result is
 * resolved and verified to stay inside the host workspace root, so `..`
 * traversal, prefix confusion (C:\workspacefoo), and host-absolute
 * passthrough all throw instead of leaking host filesystem access.
 */

import { resolve } from "@std/path";

/** Container-to-host workspace mapping for sandbox mode. */
export interface WorkspaceMapping {
  containerPath: string;
  hostPath: string;
}

/** Thrown when a path cannot be safely translated into the workspace. */
export class PathContainmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathContainmentError";
  }
}

/** Normalize slashes to backslashes and strip trailing separators. */
function normalize(path: string): string {
  return path.replace(/\//g, "\\").replace(/\\+$/, "");
}

/**
 * Translate a container path to its host equivalent.
 *
 * - No mapping configured (non-sandbox mode): identity.
 * - With a mapping: the input MUST be the container root or a segment-aware
 *   child of it, and the resolved host path MUST stay inside the host root.
 *   Anything else throws {@link PathContainmentError} (fail closed — never
 *   pass an agent-supplied path through to the host untranslated).
 */
export function translatePath(
  inputPath: string,
  mapping: WorkspaceMapping | null,
): string {
  if (!mapping) return inputPath;

  const input = inputPath.replace(/\//g, "\\");
  const containerRoot = normalize(mapping.containerPath);
  const inputLower = input.toLowerCase().replace(/\\+$/, "");
  const rootLower = containerRoot.toLowerCase();

  const isRoot = inputLower === rootLower;
  const isChild = inputLower.startsWith(rootLower + "\\");
  if (!isRoot && !isChild) {
    throw new PathContainmentError(
      `Path '${inputPath}' is outside the sandbox workspace '${mapping.containerPath}'`,
    );
  }

  const relativePart = isRoot
    ? ""
    : input.replace(/\\+$/, "").substring(containerRoot.length);
  const hostRoot = resolve(normalize(mapping.hostPath));
  const translated = resolve(hostRoot + relativePart);

  const translatedLower = translated.toLowerCase();
  const hostRootLower = hostRoot.toLowerCase();
  if (
    translatedLower !== hostRootLower &&
    !translatedLower.startsWith(hostRootLower + "\\")
  ) {
    throw new PathContainmentError(
      `Path '${inputPath}' resolves to '${translated}', which escapes the workspace root '${hostRoot}'`,
    );
  }

  return translated;
}
