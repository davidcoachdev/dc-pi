import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  type Component,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { DcProgressBar } from "../../ui/dc-progress-bar.ts";

export function openUrl(url: string): void {
  try {
    if (process.env.WSL_DISTRO_NAME || fs.existsSync("/mnt/c/Windows/System32/cmd.exe")) {
      spawn("/mnt/c/Windows/System32/cmd.exe", ["/c", "start", "", url], { cwd: "/tmp", stdio: "ignore", detached: true }).unref();
      return;
    }
  } catch {}

  const [cmd, args] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : ["xdg-open", [url]];

  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {}
}

export function openProjectDashboard(project?: string): void {
  const proj = project || path.basename(process.cwd());
  const url = `https://engram.davidcoach.dev/dashboard/projects/${encodeURIComponent(proj)}`;
  openUrl(url);
}

export interface EngramEnrollPanelOptions {
  projectName: string;
  theme: Pick<Theme, "fg" | "bg" | "bold">;
  requestRender: () => void;
  onDone?: () => void;
}

export class EngramEnrollPanel implements Component {
  public projectName: string;
  private theme: Pick<Theme, "fg" | "bg" | "bold">;
  private requestRender: () => void;
  private onDone?: () => void;
  private status: "running" | "success" | "error" = "running";
  private logs: string[] = [];
  private scrollY = 0;
  private progress = 5;
  private targetProgress = 10;
  private spinnerIdx = 0;
  private animTimer?: NodeJS.Timeout;
  public progressBar: DcProgressBar;

  constructor(options: EngramEnrollPanelOptions) {
    this.projectName = options.projectName;
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.onDone = options.onDone;
    this.progressBar = new DcProgressBar({
      pct: 5,
      label: "Sincronizando memorias...",
      barWidth: 16,
      animated: true,
      requestRender: options.requestRender,
    });
    this.startAnim();
    this.runEnrollAndSync();
  }

  private startAnim(): void {
    if (this.animTimer) clearInterval(this.animTimer);
    this.animTimer = setInterval(() => {
      this.spinnerIdx++;
      if (this.status === "running") {
        if (this.progress < this.targetProgress) {
          this.progress = Math.min(this.targetProgress, this.progress + 1.5);
          this.progressBar.setProgress(this.progress);
        }
        this.requestRender();
      }
    }, 90);
    this.animTimer.unref?.();
  }

  public destroy(): void {
    this.progressBar.destroy();
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = undefined;
    }
  }

  public invalidate(): void {
    // Component lifecycle
  }

  public getFooterText(): string {
    if (this.status === "running") {
      return ` ${this.progressBar.format("Sincronizando memorias...")}`;
    } else if (this.status === "success") {
      return " \x1b[38;2;80;220;100m✓ Sincronizado\x1b[0m · Enter: Re-ejecutar · Clic/o: Dashboard · Esc: Cerrar";
    } else {
      return " \x1b[38;2;255;77;77m✗ Error en proceso\x1b[0m · Enter: Reintentar · Esc: Cerrar";
    }
  }

  public openDashboard(): void {
    openProjectDashboard(this.projectName);
    this.addLog(`🌐 Abriendo dashboard en navegador: https://engram.davidcoach.dev/dashboard/projects/${encodeURIComponent(this.projectName)}`);
    this.requestRender();
  }

  private addLog(line: string): void {
    this.logs.push(line);
    this.requestRender();
  }

  public runEnrollAndSync(): void {
    this.status = "running";
    this.logs = [];
    this.scrollY = 0;
    this.progress = 8;
    this.targetProgress = 45;
    this.progressBar.setProgress(8);
    this.startAnim();

    this.addLog(`▶ [1/2] Enrolando: engram cloud enroll "${this.projectName}"...`);
    execFile("engram", ["cloud", "enroll", this.projectName], (enrollErr, stdout, stderr) => {
      if (enrollErr) {
        this.addLog(`  ✗ Error en enroll: ${enrollErr.message}`);
        if (stderr && stderr.trim()) this.addLog(`    ${stderr.trim()}`);
        this.status = "error";
        this.progress = 100;
        this.progressBar.setProgress(100);
        this.requestRender();
        return;
      }

      if (stdout && stdout.trim()) {
        for (const line of stdout.trim().split("\n")) {
          if (line.trim()) this.addLog(`  ✓ ${line.trim()}`);
        }
      }
      this.progress = 50;
      this.targetProgress = 92;
      this.progressBar.setProgress(50);
      this.addLog("─".repeat(50));
      this.addLog(`▶ [2/2] Subiendo memorias: engram sync --cloud --project "${this.projectName}"...`);

      execFile("engram", ["sync", "--cloud", "--project", this.projectName], (syncErr, syncOut, syncErrOut) => {
        if (syncErr) {
          this.addLog(`  ✗ Error en sync: ${syncErr.message}`);
          if (syncErrOut && syncErrOut.trim()) this.addLog(`    ${syncErrOut.trim()}`);
          this.status = "error";
          this.progress = 100;
          this.requestRender();
          return;
        }

        if (syncOut && syncOut.trim()) {
          for (const line of syncOut.trim().split("\n")) {
            if (line.trim()) this.addLog(`  ✓ ${line.trim()}`);
          }
        }

        this.addLog("─".repeat(50));
        this.addLog(`✨ ¡Proyecto "${this.projectName}" enrolado y memorias sincronizadas!`);
        this.status = "success";
        this.progress = 100;
        this.progressBar.setProgress(100);
        this.requestRender();
      });
    });
  }

  render(width: number): string[] {
    const bloodBright = (t: string) => `\x1b[38;2;255;77;77m${t}\x1b[0m`;
    const bloodSoft = (t: string) => `\x1b[38;2;255;120;120m${t}\x1b[0m`;
    const green = (t: string) => `\x1b[38;2;80;220;100m${t}\x1b[0m`;
    const dim = (t: string) => `\x1b[2m${t}\x1b[22m`;
    const bold = (t: string) => `\x1b[1m${t}\x1b[22m`;

    const out: string[] = [];
    const innerW = Math.max(20, width - 2);

    let statusLine = "";
    if (this.status === "running") {
      statusLine = bloodBright(bold("⏳ ENROLANDO PROYECTO Y SUBIENDO MEMORIAS..."));
    } else if (this.status === "success") {
      statusLine = green(bold("✓ ENROLADO Y SINCRONIZADO EN CLOUD"));
    } else {
      statusLine = bloodBright(bold("✗ ERROR EN LA OPERACIÓN"));
    }

    out.push(` ${statusLine}`);
    out.push(` ${dim("Proyecto:")} ${bold(this.projectName)}`);
    out.push(` ${dim("Cloud:")}    ${bloodBright(bold(`🌐 Engram - ${this.projectName}`))} ${dim("[↗ abrir]")}`);
    out.push(` ${dim("─".repeat(Math.max(1, innerW - 2)))}`);

    const maxLogLines = 10;
    const total = this.logs.length;
    const maxScroll = Math.max(0, total - maxLogLines);
    if (this.status === "running") {
      this.scrollY = maxScroll;
    } else {
      this.scrollY = Math.max(0, Math.min(this.scrollY, maxScroll));
    }

    const slice = this.logs.slice(this.scrollY, this.scrollY + maxLogLines);
    for (const log of slice) {
      out.push(` ${truncateToWidth(log, innerW - 1, "…")}`);
    }

    while (out.length < maxLogLines + 3) {
      out.push("");
    }

    out.push(` ${dim("─".repeat(Math.max(1, innerW - 2)))}`);
    if (this.status === "running") {
      out.push(` ${dim("Procesando comandos en segundo plano...")}`);
    } else {
      out.push(
        ` ${bloodBright(bold("[ ⚡ Reintentar ]"))}  ${bloodSoft(bold("[ 🌐 Dashboard ]"))}  ${dim("[ ✕ Cerrar ]")}`,
      );
    }

    return out;
  }

  handleInput(data: string): boolean {
    if (data === "o" || data === "O") {
      this.openDashboard();
      return true;
    }
    if (this.status !== "running" && (data === "\r" || data === " ")) {
      this.runEnrollAndSync();
      return true;
    }
    if (matchesKey(data, Key.up)) {
      this.scrollY = Math.max(0, this.scrollY - 1);
      this.requestRender();
      return true;
    }
    if (matchesKey(data, Key.down)) {
      this.scrollY += 1;
      this.requestRender();
      return true;
    }
    return false;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type === "wheel") {
      const delta = event.wheelDelta ?? 1;
      this.scrollY = Math.max(0, this.scrollY + (delta > 0 ? 1 : -1));
      this.requestRender();
      return { handled: true };
    }
    if (event.button === "left" && event.type === "click") {
      if (event.y === 2) {
        this.openDashboard();
        return { handled: true };
      }
      if (event.y === 14 || event.y === 15) {
        if (this.status === "running") return { handled: true };

        const btn1End = 18;
        const btn2End = 36;
        if (event.x >= 1 && event.x <= btn1End) {
          this.runEnrollAndSync();
          return { handled: true };
        } else if (event.x > btn1End && event.x <= btn2End) {
          this.openDashboard();
          return { handled: true };
        } else if (event.x > btn2End) {
          this.onDone?.();
          return { handled: true };
        }
      }
    }
    return undefined;
  }
}
