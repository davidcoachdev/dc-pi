import { spawn } from "node:child_process";
import os from "node:os";

export type ClipboardBackend = "wl-copy" | "xclip" | "xsel" | "pbcopy" | "clip" | "osc52" | "none";

export interface ClipboardOptions {
  preferredBackend?: ClipboardBackend;
  suppressOsc52?: boolean;
}

/** Formats text as an OSC 52 terminal copy escape sequence (base64 encoded). */
export function formatOsc52(text: string): string {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  return `\x1b]52;c;${b64}\x07`;
}

export class DcClipboard {
  private detectedBackend?: ClipboardBackend;

  constructor(private readonly options: ClipboardOptions = {}) {}

  /** Auto-detect available system clipboard utility based on OS and environment. */
  detectBackend(): ClipboardBackend {
    if (this.options.preferredBackend) {
      return this.options.preferredBackend;
    }
    if (this.detectedBackend) {
      return this.detectedBackend;
    }

    const platform = os.platform();

    if (platform === "darwin") {
      this.detectedBackend = "pbcopy";
      return "pbcopy";
    }

    if (platform === "win32") {
      this.detectedBackend = "clip";
      return "clip";
    }

    // Linux / BSD detection
    if (process.env.WAYLAND_DISPLAY) {
      this.detectedBackend = "wl-copy";
      return "wl-copy";
    }

    if (process.env.DISPLAY) {
      this.detectedBackend = "xsel";
      return "xsel";
    }

    this.detectedBackend = "osc52";
    return "osc52";
  }

  /**
   * Copy text to the system clipboard asynchronously without throwing uncaught exceptions.
   * Returns true if a command was dispatched, or false on failure/unsupported.
   */
  async copy(text: string): Promise<boolean> {
    const backend = this.detectBackend();

    if (backend === "none") {
      return false;
    }

    if (backend === "osc52") {
      if (!this.options.suppressOsc52 && process.stdout.isTTY) {
        try {
          process.stdout.write(formatOsc52(text));
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let cmd: string;
      let args: string[] = [];

      switch (backend) {
        case "wl-copy":
          cmd = "wl-copy";
          break;
        case "xclip":
          cmd = "xclip";
          args = ["-selection", "clipboard"];
          break;
        case "xsel":
          cmd = "xsel";
          args = ["-b", "-i"];
          break;
        case "pbcopy":
          cmd = "pbcopy";
          break;
        case "clip":
          cmd = "clip.exe";
          break;
        default:
          resolve(false);
          return;
      }

      try {
        const child = spawn(cmd, args, {
          stdio: ["pipe", "ignore", "ignore"],
        });

        child.on("error", () => {
          // Fallback to OSC 52 if child fails to launch
          if (!this.options.suppressOsc52 && process.stdout.isTTY) {
            try {
              process.stdout.write(formatOsc52(text));
              resolve(true);
              return;
            } catch {
              /* ignore */
            }
          }
          resolve(false);
        });

        child.stdin.on("error", () => {
          resolve(false);
        });

        child.stdin.end(text, "utf8", () => {
          resolve(true);
        });
      } catch {
        resolve(false);
      }
    });
  }
}

export const dcClipboard = new DcClipboard();
