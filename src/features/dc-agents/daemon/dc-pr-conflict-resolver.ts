import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import { getDcAgentsPaths } from "../../../core/dc-paths.ts";
import { dcIssueNotifier } from "./dc-issue-notifier.ts";
import { leaseTaxi, releaseTaxi } from "../core/dc-taxi-dispatcher.ts";
import { isVipAccount } from "../core/dc-taxi-accounts.ts";
import { DEFAULT_DC_AGENTS_CONFIG } from "../core/dc-ephemeral-types.ts";

const execFileAsync = promisify(execFile);

const CONFLICT_MARKER_RE = /^(?:<{7}|={7}|>{7})/m;

export interface ConflictResolutionRequest {
  prNumber: number;
  repoNwo: string;
  headBranch: string;
  baseBranch?: string; // default "master"
  authorLogin: string;
  worktreePath?: string;
}

export interface ConflictResolutionResult {
  ok: boolean;
  prNumber: number;
  conflictedFiles: string[];
  resolvedFiles: string[];
  message: string;
  pushed: boolean;
  leasedAccount?: string;
}

export type ConflictResolverExecCommand = (
  file: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface ConflictResolverPiSpawnResult {
  exitCode: number;
  timedOut?: boolean;
  error?: string;
}

export type ConflictResolverPiSpawner = (params: {
  cwd: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}) => Promise<ConflictResolverPiSpawnResult>;

export interface ConflictResolverTaxiLease {
  account: string;
  modelRef: string;
  sessionId: string;
  plate: string;
}

export type ConflictResolverLeaseTaxi = (params: {
  prNumber: number;
  sessionId: string;
  plate: string;
  baseModel: string;
  provider: string;
}) => ConflictResolverTaxiLease | null;

export type ConflictResolverReleaseTaxi = (lease: ConflictResolverTaxiLease) => boolean;

export type ConflictResolverNotifier = (
  target: { repoRoot: string; repoNwo?: string; issueNumber: number },
  message: string,
) => Promise<void>;

export interface ConflictResolverOptions {
  execCommand?: ConflictResolverExecCommand;
  spawnPi?: ConflictResolverPiSpawner;
  leaseTaxi?: ConflictResolverLeaseTaxi;
  releaseTaxi?: ConflictResolverReleaseTaxi;
  notify?: ConflictResolverNotifier;
  worktreeBaseDir?: string;
  repoRoot?: string;
  piTimeoutMs?: number;
  baseModel?: string;
  provider?: string;
}

const defaultExecCommand: ConflictResolverExecCommand = async (file, args, options) => {
  const { stdout, stderr } = await execFileAsync(file, args, options);
  return {
    stdout: String(stdout ?? ""),
    stderr: String(stderr ?? ""),
  };
};

const defaultSpawnPi: ConflictResolverPiSpawner = ({ cwd, args, env, timeoutMs }) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (res: ConflictResolverPiSpawnResult) => {
      if (settled) return;
      settled = true;
      resolve(res);
    };

    const child = spawn("pi", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    const timeoutHandle = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* defensive */
      }
      finish({ exitCode: 1, timedOut: true, error: "Pi background resolver timeout" });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      finish({ exitCode: typeof code === "number" ? code : 1 });
    });

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
      finish({ exitCode: 1, error: err.message });
    });
  });

const defaultLeaseTaxi: ConflictResolverLeaseTaxi = ({ prNumber, sessionId, plate, baseModel, provider }) => {
  const leased = leaseTaxi({
    type: "subagent",
    sessionId,
    pid: process.pid,
    agentName: "dc-super-agent-99-conflict-resolver",
    model: baseModel,
    taskLabel: `PR #${prNumber} conflict resolution`,
    plate,
  });

  if (!leased) return null;

  // Protección estricta: nunca tocar cuentas VIP para workers en segundo plano
  if (leased.unit.tier === "vip" || isVipAccount(leased.account)) {
    releaseTaxi(leased.account, sessionId, undefined, undefined, undefined, { plate });
    return null;
  }

  return {
    account: leased.account,
    modelRef: `${provider}/${leased.account}/${baseModel}`,
    sessionId,
    plate: leased.unit.passenger?.plate || plate,
  };
};

const defaultReleaseTaxi: ConflictResolverReleaseTaxi = (lease) =>
  releaseTaxi(lease.account, lease.sessionId, undefined, undefined, undefined, {
    plate: lease.plate,
  });

const defaultNotify: ConflictResolverNotifier = async (target, message) => {
  await dcIssueNotifier.notifyIssue(target, message);
};

function detectPackageManager(worktreeDir: string): string {
  if (fs.existsSync(path.join(worktreeDir, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(worktreeDir, "bun.lock")) || fs.existsSync(path.join(worktreeDir, "bun.lockb"))) {
    return "bun";
  }
  if (fs.existsSync(path.join(worktreeDir, "yarn.lock"))) return "yarn";
  return "npm";
}

function findRemainingConflictMarkers(worktreeDir: string, files: string[]): string[] {
  const remaining: string[] = [];
  for (const file of files) {
    const fullPath = path.join(worktreeDir, file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, "utf8");
      if (CONFLICT_MARKER_RE.test(content)) {
        remaining.push(file);
      }
    }
  }
  return remaining;
}

/**
 * Orquestador autónomo de resolución de conflictos para la Super-Agente #99.
 * Monta un Git Worktree aislado, ejecuta rebase sobre la rama base,
 * arrienda un Taxi estándar de la Flota, spawnea una sesión autónoma de Pi en segundo plano,
 * corre verificación determinista estricta (build + tests exit code 0) y entrega con --force-with-lease.
 */
export class DcPrConflictResolver {
  private static instance?: DcPrConflictResolver;
  private readonly defaults: ConflictResolverOptions;

  constructor(options?: ConflictResolverOptions) {
    this.defaults = options ?? {};
  }

  public static getInstance(): DcPrConflictResolver {
    if (!DcPrConflictResolver.instance) {
      DcPrConflictResolver.instance = new DcPrConflictResolver();
    }
    return DcPrConflictResolver.instance;
  }

  public async resolve(
    req: ConflictResolutionRequest,
    callOptions?: ConflictResolverOptions,
  ): Promise<ConflictResolutionResult> {
    const execCommand = callOptions?.execCommand ?? this.defaults.execCommand ?? defaultExecCommand;
    const spawnPi = callOptions?.spawnPi ?? this.defaults.spawnPi ?? defaultSpawnPi;
    const leaseFleetTaxi = callOptions?.leaseTaxi ?? this.defaults.leaseTaxi ?? defaultLeaseTaxi;
    const releaseFleetTaxi = callOptions?.releaseTaxi ?? this.defaults.releaseTaxi ?? defaultReleaseTaxi;
    const notify = callOptions?.notify ?? this.defaults.notify ?? defaultNotify;
    const repoRoot = callOptions?.repoRoot ?? this.defaults.repoRoot ?? process.cwd();
    const worktreeBaseDir =
      callOptions?.worktreeBaseDir ??
      this.defaults.worktreeBaseDir ??
      getDcAgentsPaths().worktreesDir;
    const piTimeoutMs = callOptions?.piTimeoutMs ?? this.defaults.piTimeoutMs ?? 180_000;
    const baseModel =
      callOptions?.baseModel ??
      this.defaults.baseModel ??
      DEFAULT_DC_AGENTS_CONFIG.routing.defaultSubagentModel;
    const provider = callOptions?.provider ?? this.defaults.provider ?? "cpam";

    const baseBranch = req.baseBranch || "master";
    const repoSlug = req.repoNwo.replace(/[/\\:]/g, "-");
    const worktreeDir =
      req.worktreePath ?? path.join(worktreeBaseDir, repoSlug, `pr-${req.prNumber}-resolve-conflict`);

    const targetNotify = {
      repoRoot,
      repoNwo: req.repoNwo,
      issueNumber: req.prNumber,
    };

    const safeAbortRebase = async () => {
      try { await execCommand("git", ["rebase", "--abort"], { cwd: worktreeDir }); } catch {}
    };

    const abortAndFail = async (
      message: string,
      notifyMsg: string,
      conflictedFiles: string[] = [],
      leasedAccount?: string,
    ): Promise<ConflictResolutionResult> => {
      await safeAbortRebase();
      await notify(targetNotify, notifyMsg);
      return { ok: false, prNumber: req.prNumber, conflictedFiles, resolvedFiles: [], message, pushed: false, leasedAccount };
    };

    // 1. Preparar directorio de worktrees y limpiar residuo previo
    fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
    try { await execCommand("git", ["worktree", "remove", "--force", worktreeDir], { cwd: repoRoot }); } catch {}
    if (fs.existsSync(worktreeDir)) {
      try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch {}
    }

    await notify(
      targetNotify,
      `🕵️‍♀️ **DC Super-Agent 99**: 🛠 Montando quirófano en Git worktree aislado para resolver conflictos del PR #${req.prNumber} con \`${baseBranch}\`...`,
    );

    // 2. Fetch y checkout de la rama del PR en worktree temporal
    for (const ref of [`${req.headBranch}:${req.headBranch}`, req.headBranch, `pull/${req.prNumber}/head:${req.headBranch}`]) {
      try {
        await execCommand("git", ["fetch", "origin", ref], { cwd: repoRoot });
        break;
      } catch {}
    }

    try {
      await execCommand("git", ["worktree", "add", worktreeDir, req.headBranch], { cwd: repoRoot });
    } catch (err: any) {
      return {
        ok: false,
        prNumber: req.prNumber,
        conflictedFiles: [],
        resolvedFiles: [],
        message: `No se pudo montar el worktree: ${err?.message || String(err)}`,
        pushed: false,
      };
    }

    try {
      // 3. Iniciar el rebase sobre origin/<baseBranch>
      await execCommand("git", ["fetch", "origin", baseBranch], { cwd: worktreeDir });

      let hasConflict = false;
      try {
        await execCommand("git", ["rebase", `origin/${baseBranch}`], { cwd: worktreeDir });
      } catch {
        hasConflict = true;
      }

      if (!hasConflict) {
        await execCommand("git", ["push", "--force-with-lease", "origin", req.headBranch], { cwd: worktreeDir });
        await notify(
          targetNotify,
          `🕵️‍♀️ **DC Super-Agent 99**: ✔ El PR #${req.prNumber} no requirió intervención manual. Rama rebasada limpiamente contra \`origin/${baseBranch}\` y actualizada en GitHub.`,
        );
        return { ok: true, prNumber: req.prNumber, conflictedFiles: [], resolvedFiles: [], message: "Rebase limpio sin conflictos", pushed: true };
      }

      // 4. Identificar archivos con conflictos
      const { stdout: diffFiles } = await execCommand("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: worktreeDir });
      const conflicted = diffFiles.split("\n").map((f) => f.trim()).filter(Boolean);

      if (conflicted.length === 0) {
        return abortAndFail(
          "Git reportó fallo en rebase pero no se encontraron archivos en conflicto.",
          `🕵️‍♀️ **DC Super-Agent 99**: ❌ Fallo de rebase sin archivos en conflicto detectados para PR #${req.prNumber}. Rebase abortado.`,
        );
      }

      await notify(
        targetNotify,
        `🕵️‍♀️ **DC Super-Agent 99**: ⚠️ Se detectaron conflictos en ${conflicted.length} archivo(s): \`${conflicted.join(", ")}\`.\nArrendando Taxi estándar de la Flota e iniciando sesión autónoma de Pi en segundo plano...`,
      );

      // 5. Arrendar Taxi estándar de la Flota (nunca VIP) y lanzar Pi en background
      const sessionId = `pr-conflict-${req.prNumber}-${randomUUID().slice(0, 8)}`;
      const plate = `DC-PR${req.prNumber}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const leasedTaxi = leaseFleetTaxi({ prNumber: req.prNumber, sessionId, plate, baseModel, provider });

      if (!leasedTaxi || isVipAccount(leasedTaxi.account)) {
        if (leasedTaxi) {
          try { releaseFleetTaxi(leasedTaxi); } catch {}
        }
        return abortAndFail(
          "No hay taxis estándar disponibles en la Flota de Taxis.",
          `🕵️‍♀️ **DC Super-Agent 99**: ❌ No hay taxis estándar disponibles en la Flota para resolver el PR #${req.prNumber} en segundo plano. Rebase abortado de forma segura sin modificar la rama remota.`,
          conflicted,
        );
      }

      let piRes: ConflictResolverPiSpawnResult;
      try {
        piRes = await this.spawnBackgroundPiResolver(
          worktreeDir, req.prNumber, conflicted, baseBranch, leasedTaxi.modelRef, spawnPi, piTimeoutMs,
        );
      } finally {
        try { releaseFleetTaxi(leasedTaxi); } catch {}
      }

      if (piRes.exitCode !== 0 || piRes.timedOut) {
        return abortAndFail(
          piRes.error || `Falló la sesión autónoma de Pi (exit ${piRes.exitCode}).`,
          `🕵️‍♀️ **DC Super-Agent 99**: ❌ La sesión autónoma de Pi falló (${piRes.timedOut ? "timeout" : `exit ${piRes.exitCode}`}). Rebase abortado de forma segura para preservar el código original.`,
          conflicted,
          leasedTaxi.account,
        );
      }

      // 6. Verificación determinista del supervisor: cero marcadores + build + tests (exit code 0)
      const remainingMarkers = findRemainingConflictMarkers(worktreeDir, conflicted);
      if (remainingMarkers.length > 0) {
        return abortAndFail(
          `Quedaron marcadores de conflicto en: ${remainingMarkers.join(", ")}`,
          `🕵️‍♀️ **DC Super-Agent 99**: ❌ Quedaron marcadores de conflicto sin resolver en: \`${remainingMarkers.join(", ")}\`. Rebase abortado de forma segura.`,
          conflicted,
          leasedTaxi.account,
        );
      }

      const verification = await this.verifySupervisorChecks(worktreeDir, execCommand);
      if (!verification.ok) {
        return abortAndFail(
          `Falló la verificación determinista (${verification.stage}): ${verification.error}`,
          `🕵️‍♀️ **DC Super-Agent 99**: ❌ Verificación determinista falló en **${verification.stage}** (no exit code 0). Rebase abortado de forma segura sin pushear cambios.`,
          conflicted,
          leasedTaxi.account,
        );
      }

      // 7. Concluir rebase y push seguro con --force-with-lease
      await execCommand("git", ["add", "."], { cwd: worktreeDir });
      await execCommand("git", ["rebase", "--continue"], { cwd: worktreeDir, env: { ...process.env, GIT_EDITOR: "true" } });
      await execCommand("git", ["push", "--force-with-lease", "origin", req.headBranch], { cwd: worktreeDir });

      await notify(
        targetNotify,
        `🕵️‍♀️ **DC Super-Agent 99**: ✅ Conflictos resueltos exitosamente en worktree aislado (Taxi \`${leasedTaxi.account}\`).\n- Archivos combinados: \`${conflicted.join(", ")}\`\n- Build y Tests: ✔ Pasaron (Exit Code 0)\n- Rama actualizada en GitHub con \`--force-with-lease\`.`,
      );

      return {
        ok: true,
        prNumber: req.prNumber,
        conflictedFiles: conflicted,
        resolvedFiles: conflicted,
        message: "Conflictos resueltos y rama actualizada con éxito.",
        pushed: true,
        leasedAccount: leasedTaxi.account,
      };
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      return abortAndFail(
        `Error durante la resolución de conflictos: ${errMsg}`,
        `🕵️‍♀️ **DC Super-Agent 99**: ❌ Error inesperado resolviendo conflictos del PR #${req.prNumber}: ${errMsg}. Rebase abortado de forma segura.`,
      );
    } finally {
      // 8. Desmontaje limpio del quirófano worktree
      try { await execCommand("git", ["worktree", "remove", "--force", worktreeDir], { cwd: repoRoot }); } catch {}
      if (fs.existsSync(worktreeDir)) {
        try { fs.rmSync(worktreeDir, { recursive: true, force: true }); } catch {}
      }
    }
  }

  /**
   * Verificación determinista en el supervisor: exige exit code 0 en build Y tests
   * antes de continuar el rebase o hacer push.
   */
  private async verifySupervisorChecks(
    worktreeDir: string,
    execCommand: ConflictResolverExecCommand,
  ): Promise<{ ok: true } | { ok: false; stage: "build" | "test"; error: string }> {
    const pm = detectPackageManager(worktreeDir);

    try {
      await execCommand(pm, ["run", "build"], { cwd: worktreeDir, timeout: 120_000 });
    } catch (err: any) {
      return { ok: false, stage: "build", error: err?.stderr || err?.stdout || err?.message || "build failed" };
    }

    try {
      await execCommand(pm, ["test"], { cwd: worktreeDir, timeout: 120_000 });
    } catch (err: any) {
      return { ok: false, stage: "test", error: err?.stderr || err?.stdout || err?.message || "tests failed" };
    }

    return { ok: true };
  }

  /**
   * Spawnea el proceso `pi` autónomo en segundo plano dentro del worktree usando el taxi arrendado.
   */
  private async spawnBackgroundPiResolver(
    worktreePath: string,
    prNumber: number,
    conflictedFiles: string[],
    baseBranch: string,
    modelRef: string,
    spawnPi: ConflictResolverPiSpawner,
    timeoutMs: number,
  ): Promise<ConflictResolverPiSpawnResult> {
    const prompt = [
      `Eres la Super-Agente #99 (PR Inspector & Quality Gate) de DC Studio.`,
      `Estás resolviendo un conflicto de rebase en el PR #${prNumber} contra '${baseBranch}' dentro de un Git Worktree aislado.`,
      ``,
      `## Archivos con conflicto activo:`,
      conflictedFiles.map((f) => `- ${f}`).join("\n"),
      ``,
      `## Directivas obligatorias:`,
      `1. Lee con 'read' cada archivo en conflicto para inspeccionar los marcadores '<<<<<<< HEAD', '=======', '>>>>>>>'.`,
      `2. Comprende la intención de la rama base y del PR. Combina el código preservando ambas funcionalidades bajo el principio KISS y YAGNI.`,
      `3. Elimina por completo todos los marcadores de conflicto ('<<<<<<<', '=======', '>>>>>>>') usando 'edit'.`,
      `4. Ejecuta 'npm run build' y 'npm test' con 'bash' en este directorio hasta verificar que pasen limpiamente con exit code 0.`,
      `5. NO ejecutes git rebase --continue, git commit ni git push; el supervisor se encargará de concluir y entregar la rama una vez verificado tu trabajo.`,
      `6. Cuando los archivos estén combinados y las pruebas den exit code 0, concluye tu sesión.`,
    ].join("\n");

    const args: string[] = [];
    if (modelRef) {
      args.push("--model", modelRef);
    }
    args.push("-p", prompt, "--no-session");

    return spawnPi({
      cwd: worktreePath,
      args,
      env: { ...process.env, CI: "true" },
      timeoutMs,
    });
  }
}

export const dcPrConflictResolver = DcPrConflictResolver.getInstance();
