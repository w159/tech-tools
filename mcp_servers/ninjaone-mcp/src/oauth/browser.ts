// Cross-platform "open URL in default browser".
import { spawn } from "node:child_process";
import { platform } from "node:os";

export function openInBrowser(url: string): void {
  // Only ever hand http(s) URLs to the OS opener (the base URL can come from env).
  const { protocol, href } = new URL(url);
  if (protocol !== "https:" && protocol !== "http:") throw new Error(`Refusing to open non-http(s) URL: ${protocol}`);
  url = href;
  const p = platform();
  let cmd: string;
  let args: string[];
  if (p === "darwin") {
    cmd = "open";
    args = [url];
  } else if (p === "win32") {
    // rundll32 takes the URL as a plain argument; `cmd /c start` would let & | in it run commands.
    cmd = "rundll32";
    args = ["url.dll,FileProtocolHandler", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
  child.unref();
}
