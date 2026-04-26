/**
 * Deterministic id generator, monotonic per call within a Svelte render pass.
 * Same call order on server and client → matching ids → no hydration mismatch.
 *
 * Use for label-input pairs, aria-describedby targets, and other places where
 * a stable but unique id is needed and the consumer doesn't supply one.
 */
let counter = 0;

export function useId(): string {
  counter += 1;
  return `cg-id-${counter}`;
}
