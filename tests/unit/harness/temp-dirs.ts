/**
 * Kept for existing imports: fixtures put test secrets in these roots, so none
 * may outlive the run (M1-20a). The shared helper removes them at exit.
 */
export { testTempDir as tempDir } from "../../utils/temp-dir.ts";
