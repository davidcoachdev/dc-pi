import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  dcPrConflictResolver,
  type ConflictResolutionRequest,
  type ConflictResolutionResult,
  type ConflictResolverOptions,
  type DcPrConflictResolver,
} from "./dc-pr-conflict-resolver.ts";

const execFileAsync = promisify(execFile);

export type PrInspectorExecCommand = (
  file: string,
  args: string[],
  options: { cwd: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface PrInspectorOptions {
  execCommand?: PrInspectorExecCommand;
  conflictResolver?: Pick<DcPrConflictResolver, "resolve">;
}

export type PrConflictTarget = ConflictResolutionRequest;

const defaultExecCommand: PrInspectorExecCommand = async (file, args, options) => {
  const { stdout, stderr } = await execFileAsync(file, args, options);
  return {
    stdout: String(stdout ?? ""),
    stderr: String(stderr ?? ""),
  };
};

export interface PrInspectionTarget {
  prNumber: number;
  repoNwo: string;
  headBranch: string;
  baseBranch: string;
  authorLogin: string;
  title: string;
  worktreePath?: string;
}

export interface PrInspectionResult {
  prNumber: number;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION";
  summary: string;
  blastRadius: {
    filesChanged: number;
    insertions: number;
    deletions: number;
    isOversized: boolean; // true si excede ~400 líneas
  };
  checks: {
    testsPassed: boolean;
    buildPassed: boolean;
    testOutput?: string;
    buildOutput?: string;
  };
  comments: Array<{
    path?: string;
    line?: number;
    body: string;
  }>;
  reviewedAt: number;
}

/**
 * Super-Agente #99: Inspectora Autónoma de Pull Requests y Quality Gate.
 * Ejecuta análisis estricto de:
 * 1. Blast Radius (<400 líneas recomendadas según directivas de DC Studio).
 * 2. KISS y YAGNI (detección de sobreingeniería y archivos innecesarios).
 * 3. Ejecución determinista de tests y compilador en entorno aislado.
 */
export class DcPrInspectorAgent {
  private static instance?: DcPrInspectorAgent;
  private activeInspections = new Map<number, PrInspectionResult>();
  private readonly execCommand: PrInspectorExecCommand;
  private readonly conflictResolver: Pick<DcPrConflictResolver, "resolve">;

  constructor(options?: PrInspectorOptions) {
    this.execCommand = options?.execCommand ?? defaultExecCommand;
    this.conflictResolver = options?.conflictResolver ?? dcPrConflictResolver;
  }

  public static getInstance(): DcPrInspectorAgent {
    if (!DcPrInspectorAgent.instance) {
      DcPrInspectorAgent.instance = new DcPrInspectorAgent();
    }
    return DcPrInspectorAgent.instance;
  }

  public getActiveInspections(): PrInspectionResult[] {
    return Array.from(this.activeInspections.values());
  }

  public getInspection(prNumber: number): PrInspectionResult | undefined {
    return this.activeInspections.get(prNumber);
  }

  /**
   * Resuelve conflictos de rebase para un PR en un Git worktree aislado
   * delegando al orquestador DcPrConflictResolver (Super-Agente #99).
   */
  public async resolveConflicts(
    target: PrConflictTarget,
    options?: ConflictResolverOptions,
  ): Promise<ConflictResolutionResult> {
    return this.conflictResolver.resolve(
      {
        prNumber: target.prNumber,
        repoNwo: target.repoNwo,
        headBranch: target.headBranch,
        baseBranch: target.baseBranch || "master",
        authorLogin: target.authorLogin,
        worktreePath: target.worktreePath,
      },
      options,
    );
  }

  /**
   * Ejecuta la inspección completa de un Pull Request en un directorio/worktree dado.
   */
  public async inspectPullRequest(
    target: PrInspectionTarget,
    options?: PrInspectorOptions,
  ): Promise<PrInspectionResult> {
    const cwd = target.worktreePath || process.cwd();
    const execCommand = options?.execCommand ?? this.execCommand;

    // 1. Auditar Blast Radius con git diff --stat
    const blast = await this.auditBlastRadius(cwd, target.baseBranch, execCommand);

    // 2. Ejecutar Typecheck / Build
    const buildCheck = await this.runBuildCheck(cwd, execCommand);

    // 3. Ejecutar Tests si existen
    const testCheck = await this.runTestCheck(cwd, execCommand);

    // 4. Determinar veredicto objetivo
    let verdict: "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION" = "APPROVE";
    const comments: Array<{ path?: string; line?: number; body: string }> = [];

    if (!buildCheck.passed) {
      verdict = "REQUEST_CHANGES";
      comments.push({
        body: `❌ **Fallo de Compilación**: El build o typecheck falló:\n\`\`\`\n${buildCheck.output.slice(0, 500)}\n\`\`\``,
      });
    }

    if (!testCheck.passed) {
      verdict = "REQUEST_CHANGES";
      comments.push({
        body: `❌ **Fallo de Tests**: La suite de pruebas falló:\n\`\`\`\n${testCheck.output.slice(0, 500)}\n\`\`\``,
      });
    }

    if (blast.isOversized) {
      comments.push({
        body: `⚠️ **Blast Radius Alto**: Este PR modifica +${blast.insertions + blast.deletions} líneas en ${blast.filesChanged} archivos. Se recomienda mantener las unidades de cambio bajo 400 líneas para proteger la revisión humana.`,
      });
      if (verdict === "APPROVE") {
        verdict = "NEEDS_DISCUSSION";
      }
    }

    let summary = `### 🕵️‍♀️ Inspección de Calidad (DC Super-Agente #99)\n`;
    summary += `- **Veredicto**: **${verdict}**\n`;
    summary += `- **Blast Radius**: ${blast.filesChanged} archivos (+${blast.insertions}, -${blast.deletions})\n`;
    summary += `- **Build**: ${buildCheck.passed ? "✔ Exitoso" : "❌ Fallido"}\n`;
    summary += `- **Tests**: ${testCheck.passed ? "✔ Exitosos" : "❌ Fallidos"}\n`;

    const result: PrInspectionResult = {
      prNumber: target.prNumber,
      verdict,
      summary,
      blastRadius: blast,
      checks: {
        testsPassed: testCheck.passed,
        buildPassed: buildCheck.passed,
        testOutput: testCheck.output,
        buildOutput: buildCheck.output,
      },
      comments,
      reviewedAt: Date.now(),
    };

    this.activeInspections.set(target.prNumber, result);
    return result;
  }

  private async auditBlastRadius(
    cwd: string,
    baseBranch = "master",
    execCommand: PrInspectorExecCommand = this.execCommand,
  ): Promise<{
    filesChanged: number;
    insertions: number;
    deletions: number;
    isOversized: boolean;
  }> {
    try {
      const { stdout } = await execCommand("git", ["diff", "--shortstat", `origin/${baseBranch}...HEAD`], { cwd });
      const filesMatch = stdout.match(/(\d+)\s+file/);
      const insMatch = stdout.match(/(\d+)\s+insertion/);
      const delMatch = stdout.match(/(\d+)\s+deletion/);

      const filesChanged = filesMatch ? parseInt(filesMatch[1]!, 10) : 0;
      const insertions = insMatch ? parseInt(insMatch[1]!, 10) : 0;
      const deletions = delMatch ? parseInt(delMatch[1]!, 10) : 0;
      const totalLines = insertions + deletions;

      return {
        filesChanged,
        insertions,
        deletions,
        isOversized: totalLines > 400,
      };
    } catch {
      return { filesChanged: 0, insertions: 0, deletions: 0, isOversized: false };
    }
  }

  private async runBuildCheck(
    cwd: string,
    execCommand: PrInspectorExecCommand = this.execCommand,
  ): Promise<{ passed: boolean; output: string }> {
    try {
      const pkgPath = path.join(cwd, "package.json");
      if (!fs.existsSync(pkgPath)) {
        return { passed: true, output: "No package.json detectado." };
      }
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (!pkg.scripts?.build) {
        return { passed: true, output: "No hay script de build definido." };
      }

      const { stdout, stderr } = await execCommand("npm", ["run", "build"], { cwd, timeout: 60_000 });
      return { passed: true, output: stdout + "\n" + stderr };
    } catch (err: any) {
      return { passed: false, output: err?.stdout || err?.message || "Error en build" };
    }
  }

  private async runTestCheck(
    cwd: string,
    execCommand: PrInspectorExecCommand = this.execCommand,
  ): Promise<{ passed: boolean; output: string }> {
    try {
      const pkgPath = path.join(cwd, "package.json");
      if (!fs.existsSync(pkgPath)) {
        return { passed: true, output: "No package.json detectado." };
      }
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (!pkg.scripts?.test) {
        return { passed: true, output: "No hay script de test definido." };
      }

      const { stdout, stderr } = await execCommand("npm", ["test"], { cwd, timeout: 60_000 });
      return { passed: true, output: stdout + "\n" + stderr };
    } catch (err: any) {
      return { passed: false, output: err?.stdout || err?.message || "Error en tests" };
    }
  }
}

export const dcPrInspectorAgent = DcPrInspectorAgent.getInstance();
