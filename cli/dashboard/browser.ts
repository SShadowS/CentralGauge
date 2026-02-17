/**
 * Cross-platform browser opener
 * @module cli/dashboard/browser
 */

/**
 * Open a URL in the default browser.
 * Silently swallows errors (user can navigate manually).
 */
export function openBrowser(url: string): void {
  try {
    const os = Deno.build.os;
    let cmd: string[];

    if (os === "windows") {
      cmd = ["cmd", "/c", "start", url];
    } else if (os === "darwin") {
      cmd = ["open", url];
    } else {
      cmd = ["xdg-open", url];
    }

    const process = new Deno.Command(cmd[0]!, {
      args: cmd.slice(1),
      stdout: "null",
      stderr: "null",
    });

    const child = process.spawn();
    // Don't await - let the browser open in the background
    child.status.catch(() => {});
  } catch {
    // Silently ignore - user can navigate to URL manually
  }
}
