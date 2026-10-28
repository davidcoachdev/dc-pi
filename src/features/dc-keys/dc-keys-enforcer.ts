import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const DEFAULT_KEYBINDINGS_PATH = path.join(os.homedir(), ".pi", "agent", "keybindings.json");

export function resolveKeybindingsPath(customPath?: string): string {
  if (customPath && customPath.trim().length > 0) return customPath.trim();
  if (process.env.PI_KEYBINDINGS_PATH && process.env.PI_KEYBINDINGS_PATH.trim().length > 0) {
    return process.env.PI_KEYBINDINGS_PATH.trim();
  }
  return DEFAULT_KEYBINDINGS_PATH;
}

/**
 * Asegura que Alt+F, Alt+B y Alt+Q queden libres de atajos por defecto de Pi (WSL/Windows),
 * permitiendo que Alt+F abra diff, Alt+B controle sidebar y Alt+Q cierre Pi limpiamente.
 */
export function enforceKeybindings(keybindingsFile?: string): boolean {
  try {
    const target = resolveKeybindingsPath(keybindingsFile);
    let cfg: Record<string, unknown> = {};

    if (fs.existsSync(target)) {
      try {
        cfg = JSON.parse(fs.readFileSync(target, "utf8"));
      } catch {
        cfg = {};
      }
    }

    const currentRight = cfg["tui.editor.cursorWordRight"];
    const needsUpdateRight =
      !currentRight ||
      (Array.isArray(currentRight) && currentRight.includes("alt+f")) ||
      currentRight === "alt+f";

    const currentLeft = cfg["tui.editor.cursorWordLeft"];
    const needsUpdateLeft =
      !currentLeft ||
      (Array.isArray(currentLeft) && currentLeft.includes("alt+b")) ||
      currentLeft === "alt+b";

    const currentDequeue = cfg["app.message.dequeue"];
    const needsUpdateDequeue =
      !currentDequeue ||
      (Array.isArray(currentDequeue) && currentDequeue.includes("alt+q")) ||
      currentDequeue === "alt+q";

    let changed = false;
    if (needsUpdateRight) {
      cfg["tui.editor.cursorWordRight"] = ["alt+right", "ctrl+right"];
      changed = true;
    }
    if (needsUpdateLeft) {
      cfg["tui.editor.cursorWordLeft"] = ["alt+left", "ctrl+left"];
      changed = true;
    }
    if (needsUpdateDequeue) {
      cfg["app.message.dequeue"] = "alt+up";
      changed = true;
    }

    if (changed) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + "\n", "utf8");
      return true;
    }
  } catch {
    /* best effort */
  }
  return false;
}
