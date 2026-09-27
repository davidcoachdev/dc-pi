import { spawnSync } from "node:child_process";

export interface EnvironmentCheck {
  name: string;
  ok: boolean;
  message: string;
  hint?: string;
}

export function checkNodeVersion(current = process.version, minRequired = "20.6.0"): EnvironmentCheck {
  const parse = (v: string): number[] =>
    v.replace(/^v/, "").split(".").map((p) => Number.parseInt(p, 10)).map((n) => (Number.isFinite(n) ? n : 0));

  const curr = parse(current);
  const min = parse(minRequired);

  let isAtLeast = true;
  for (let i = 0; i < Math.max(curr.length, min.length); i++) {
    const a = curr[i] ?? 0;
    const b = min[i] ?? 0;
    if (a > b) break;
    if (a < b) {
      isAtLeast = false;
      break;
    }
  }

  return {
    name: "Node.js Version",
    ok: isAtLeast,
    message: `${current} (mínimo requerido: v${minRequired})`,
    hint: isAtLeast ? undefined : `Actualizá Node.js a v${minRequired} o superior para compatibilidad completa.`,
  };
}

export function checkGitHubCli(): EnvironmentCheck {
  try {
    const res = spawnSync("gh", ["auth", "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (res.status === 0) {
      return {
        name: "GitHub CLI (gh)",
        ok: true,
        message: "Autenticado y disponible",
      };
    }

    const versionCheck = spawnSync("gh", ["--version"], { encoding: "utf8" });
    if (versionCheck.status === 0) {
      return {
        name: "GitHub CLI (gh)",
        ok: false,
        message: "Instalado pero no autenticado",
        hint: "Ejecutá `gh auth login` para habilitar automatizaciones de PRs e issues.",
      };
    }

    return {
      name: "GitHub CLI (gh)",
      ok: false,
      message: "No instalado o no disponible en PATH",
      hint: "Instalá `gh` para interactuar con repositorios y pull requests en GitHub.",
    };
  } catch {
    return {
      name: "GitHub CLI (gh)",
      ok: false,
      message: "Error al invocar `gh`",
      hint: "Asegurate de que GitHub CLI esté instalado en el sistema.",
    };
  }
}

export function checkGitRepository(cwd = process.cwd()): EnvironmentCheck {
  try {
    const rootCheck = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" });
    if (rootCheck.status !== 0) {
      return {
        name: "Git Repository",
        ok: false,
        message: "El directorio actual no es un repositorio Git",
      };
    }

    const statusCheck = spawnSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" });
    const isDirty = (statusCheck.stdout ?? "").trim().length > 0;

    return {
      name: "Git Repository",
      ok: true,
      message: isDirty ? "Repo detectado (con cambios no commiteados)" : "Repo detectado (worktree limpio)",
    };
  } catch {
    return {
      name: "Git Repository",
      ok: false,
      message: "Git no disponible o falló la verificación",
    };
  }
}

export function runEnvironmentChecks(cwd = process.cwd()): EnvironmentCheck[] {
  return [
    checkNodeVersion(),
    checkGitHubCli(),
    checkGitRepository(cwd),
  ];
}
