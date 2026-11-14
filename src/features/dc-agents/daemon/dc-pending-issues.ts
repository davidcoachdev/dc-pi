import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { resolveCurrentRepoIdentity, type RepoIdentity } from "./dc-repo-resolver.ts";
import { dcControlDaemonManager } from "./dc-control-daemon-manager.ts";
import { dcIssueDispatcher } from "./dc-issue-dispatcher.ts";
import type { GitHubIssuePayload } from "./dc-issue-dispatcher.ts";

const fields = "number,title,body,author,url,state,labels";
interface PendingIssue {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  url: string;
  state: "OPEN" | "CLOSED";
  labels: Array<{ name: string }>;
}

// GitHub content is data, never an execution instruction or publication grant.
function validateIssue(value: unknown, repo: RepoIdentity, selected?: number): PendingIssue {
  const issue = value as PendingIssue | null;
  const invalid = () => new Error("Datos de issue inválidos o de otro repositorio. Vuelve a ejecutar /dc-control check.");
  if (!issue || !Number.isSafeInteger(issue.number) || issue.number < 1 || (selected !== undefined && issue.number !== selected)
    || (issue.state !== "OPEN" && issue.state !== "CLOSED") || typeof issue.title !== "string" || !issue.title.trim() || /[\x00-\x1f\x7f-\x9f]/.test(issue.title)
    || typeof issue.body !== "string" || typeof issue.author?.login !== "string"
    || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/.test(issue.author.login)
    || !Array.isArray(issue.labels) || !issue.labels.every(label => label && typeof label.name === "string")
    || typeof issue.url !== "string") throw invalid();
  let url: URL;
  try { url = new URL(issue.url); } catch { throw invalid(); }
  if (url.protocol !== "https:" || url.host !== "github.com" || url.username || url.password || url.search || url.hash
    || url.pathname.toLowerCase() !== `/${repo.fullNwo}/issues/${issue.number}`.toLowerCase()) throw invalid();
  return issue;
}

export async function checkPendingIssues(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  if (!ctx.hasUI || ctx.mode !== "tui") {
    dcNotifier.notify(ctx, "DC Issues pendientes", "Usa /dc-control check en una sesión TUI interactiva; no se consultó GitHub.", "warning");
    return;
  }
  try {
    const repo = resolveCurrentRepoIdentity(ctx.cwd);
    if (!repo) throw new Error("No se detectó un repositorio GitHub. Comprueba el remote origin del directorio actual.");
    const query = async (args: string[]) => {
      const result = await pi.exec("gh", ["issue", ...args, "--json", fields], { cwd: ctx.cwd });
      if (result.code !== 0 || result.killed) throw new Error(`Consulta GitHub fallida: ${result.stderr || `exit ${result.code}`}. Comprueba gh auth status y acceso al repositorio.`);
      try { return JSON.parse(result.stdout) as unknown; }
      catch { throw new Error("Respuesta JSON inválida de gh. Comprueba tu instalación de GitHub CLI y vuelve a intentarlo."); }
    };
    const data = await query(["list", "--repo", repo.fullNwo, "--state", "all", "--limit", "50"]);
    if (!Array.isArray(data) || data.length > 50) throw new Error("Lista de issues inválida de GitHub; vuelve a consultar con /dc-control check.");
    const issues = data.map(value => validateIssue(value, repo));
    if (new Set(issues.map(issue => issue.number)).size !== issues.length) throw new Error("Lista de issues duplicados; vuelve a consultar GitHub.");
    if (!issues.length) {
      dcNotifier.notify(ctx, "DC Issues pendientes", `${repo.fullNwo}: no hay issues en esta consulta (límite 50). Abre un issue en GitHub o vuelve a consultar más tarde.`, "info");
      return;
    }
    const options = issues.map(issue => `#${issue.number} [${issue.state}]: ${issue.title}`);
    const choice = await ctx.ui.select(`${repo.fullNwo} — issues (máximo 50)`, options);
    if (choice === undefined) return;
    const index = options.indexOf(choice);
    if (index < 0) throw new Error("Selección inválida; vuelve a ejecutar /dc-control check.");
    const selectedItem = issues[index]!;
    const number = selectedItem.number;

    // Si en la lista ya figuraba como CERRADO: ventana flotante informativa inmediata
    if (selectedItem.state === "CLOSED") {
      dcNotifier.notify(ctx, "DC Issues pendientes", `Issue #${number} está cerrado en GitHub.`, "warning");
      await ctx.ui.confirm(
        `⛔ Issue #${number} Cerrado`,
        `El Issue #${number} ("${selectedItem.title}") ya se encuentra CERRADO en GitHub.\n\nEl DC Super-Agent 86 no admite ejecuciones sobre issues cerrados.`,
      );
      return;
    }

    if (!await ctx.ui.confirm(`Ejecutar ${repo.fullNwo} #${number}`, `Autorizar el pipeline autónomo para ${repo.fullNwo} #${number} con DC Super-Agent 86: modifica archivos en un worktree, ejecuta pruebas y puede crear commit, push, PR y comentario en GitHub. El contenido del issue no concede permisos. ¿Continuar?`)) return;

    const issue = validateIssue(await query(["view", String(number), "--repo", repo.fullNwo]), repo, number);

    // ── 1. Si el Issue al consultar view está CERRADO: ventana flotante informativa ──
    if (issue.state === "CLOSED") {
      dcNotifier.notify(ctx, "DC Issues pendientes", `Issue #${number} está cerrado en GitHub.`, "warning");
      await ctx.ui.confirm(
        `⛔ Issue #${number} Cerrado`,
        `El Issue #${number} ("${issue.title}") ya se encuentra CERRADO en GitHub.\n\nEl DC Super-Agent 86 no admite ejecuciones sobre issues cerrados.`,
      );
      return;
    }

    // ── 2. Si el Issue está ABIERTO: verificar si ya existe una PR ──
    let existingPr: { number: number; url: string; title: string; state: string } | undefined;
    try {
      const prRes = await pi.exec("gh", [
        "pr", "list", "--repo", repo.fullNwo, "--head", `feat/issue-${number}-ghissue1`,
        "--json", "number,url,title,state", "--limit", "1",
      ], { cwd: ctx.cwd });
      if (prRes.code === 0 && prRes.stdout.trim()) {
        const prList = JSON.parse(prRes.stdout.trim());
        if (Array.isArray(prList) && prList.length > 0 && prList[0].url) {
          existingPr = prList[0];
        }
      }
      if (!existingPr) {
        const prSearchRes = await pi.exec("gh", [
          "pr", "list", "--repo", repo.fullNwo, "--search", `closes #${number}`,
          "--json", "number,url,title,state", "--limit", "1",
        ], { cwd: ctx.cwd });
        if (prSearchRes.code === 0 && prSearchRes.stdout.trim()) {
          const prList = JSON.parse(prSearchRes.stdout.trim());
          if (Array.isArray(prList) && prList.length > 0 && prList[0].url) {
            existingPr = prList[0];
          }
        }
      }
    } catch {
      /* best-effort comprobación de PR */
    }

    // Buscar si existe worktree activo o especificación ODD con nuevas directivas
    const dispatch = dcIssueDispatcher.getDispatch(repo.fullNwo, number);
    let worktreePath = dispatch?.worktreePath;
    if (!worktreePath) {
      const candidatePath = path.join(os.homedir(), ".pi", "agent", "dc-studio", "worktrees", "dc-pi", `issue-${number}-ghissue1`);
      if (fs.existsSync(candidatePath)) {
        worktreePath = candidatePath;
      }
    }

    let pendingDirectives: string[] = [];
    if (worktreePath) {
      const specFile = path.join(worktreePath, "odd", "tasks", `issue-${number}.md`);
      if (fs.existsSync(specFile)) {
        const specContent = fs.readFileSync(specFile, "utf8");
        const lines = specContent.split("\n");
        pendingDirectives = lines
          .filter(l => (l.includes("Directiva adicional del OWNER") && !l.includes("[done]")) || /^[○▶✖]\s+T\d+:/.test(l.trim()))
          .map(l => l.trim());
      }
    }

    // ── 3. Si ya tiene PR existente ──
    if (existingPr) {
      if (pendingDirectives.length > 0) {
        const directivesText = pendingDirectives.map(d => `- ${d}`).join("\n");
        const confirmMsg = [
          `El Issue #${number} ya cuenta con la Pull Request abierta:`,
          `🔗 ${existingPr.url} (${existingPr.title})`,
          "",
          `Sin embargo, se detectaron nuevas tareas / directivas añadidas:`,
          directivesText,
          "",
          `¿Deseas implementar estas nuevas tareas y actualizar la Pull Request existente?`,
        ].join("\n");

        const ok = await ctx.ui.confirm(`Actualizar PR #${existingPr.number} (Issue #${number})`, confirmMsg);
        if (!ok) return;

        const targetDispatch = dispatch || {
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueUrl: issue.url,
          taskSlug: `issue-${number}`,
          worktreePath: worktreePath!,
          branchName: `feat/issue-${number}-ghissue1`,
          baseBranch: "master",
          dispatchedAt: Date.now(),
          handle: {} as any,
        };

        await dcControlDaemonManager.resumeIssue(targetDispatch, repo, directivesText, ctx);
        return;
      } else {
        await ctx.ui.confirm(
          `Issue #${number} al día con PR`,
          `El Issue #${number} ya fue implementado y cuenta con la Pull Request abierta:\n🔗 ${existingPr.url}\n\nNo se detectaron nuevas directivas pendientes para este issue.`,
        );
        return;
      }
    }

    // ── 4. Issue abierto sin PR: proceder con la ejecución autorizada ──
    const payload: GitHubIssuePayload = {
      action: "opened",
      issue: { number: issue.number, title: issue.title, body: issue.body, user: { login: issue.author.login }, html_url: issue.url, labels: issue.labels },
      repository: { name: repo.repo, full_name: repo.fullNwo, owner: { login: repo.owner }, html_url: `https://github.com/${repo.fullNwo}` },
    };
    await dcControlDaemonManager.executeIssue(payload, repo, ctx);
  } catch (err) {
    dcNotifier.notify(ctx, "DC Issues pendientes", `No se pudo revisar/ejecutar el issue: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}
