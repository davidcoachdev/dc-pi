import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { dcNotifier } from "../../../integrations/dc-notify/dc-notifier.ts";
import { resolveCurrentRepoIdentity, type RepoIdentity } from "./dc-repo-resolver.ts";
import { dcWebhookDaemonManager } from "./dc-webhook-daemon-manager.ts";
import type { GitHubIssuePayload } from "./dc-issue-dispatcher.ts";

const fields = "number,title,body,author,url,state,labels";
interface PendingIssue {
  number: number;
  title: string;
  body: string;
  author: { login: string };
  url: string;
  state: "OPEN";
  labels: Array<{ name: string }>;
}

// GitHub content is data, never an execution instruction or publication grant.
function validateIssue(value: unknown, repo: RepoIdentity, selected?: number): PendingIssue {
  const issue = value as PendingIssue | null;
  const invalid = () => new Error("Datos de issue inválidos, cerrado o de otro repositorio. Vuelve a ejecutar /dc-webhook check.");
  if (!issue || !Number.isSafeInteger(issue.number) || issue.number < 1 || (selected !== undefined && issue.number !== selected)
    || issue.state !== "OPEN" || typeof issue.title !== "string" || !issue.title.trim() || /[\x00-\x1f\x7f-\x9f]/.test(issue.title)
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
    dcNotifier.notify(ctx, "DC Issues pendientes", "Usa /dc-webhook check en una sesión TUI interactiva; no se consultó GitHub.", "warning");
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
    const data = await query(["list", "--repo", repo.fullNwo, "--state", "open", "--limit", "50"]);
    if (!Array.isArray(data) || data.length > 50) throw new Error("Lista de issues inválida de GitHub; vuelve a consultar con /dc-webhook check.");
    const issues = data.map(value => validateIssue(value, repo));
    if (new Set(issues.map(issue => issue.number)).size !== issues.length) throw new Error("Lista de issues duplicados; vuelve a consultar GitHub.");
    if (!issues.length) {
      dcNotifier.notify(ctx, "DC Issues pendientes", `${repo.fullNwo}: no hay issues abiertos en esta consulta (límite 50). Abre un issue en GitHub o vuelve a consultar más tarde.`, "info");
      return;
    }
    const options = issues.map(issue => `#${issue.number}: ${issue.title}`);
    const choice = await ctx.ui.select(`${repo.fullNwo} — issues abiertos (máximo 50, no es una lista completa)`, options);
    if (choice === undefined) return;
    const index = options.indexOf(choice);
    if (index < 0) throw new Error("Selección inválida; vuelve a ejecutar /dc-webhook check.");
    const number = issues[index]!.number;
    if (!await ctx.ui.confirm(`Ejecutar ${repo.fullNwo} #${number}`, `Autorizar el pipeline autónomo existente para ${repo.fullNwo} #${number}: modifica archivos en un worktree, ejecuta pruebas y puede crear commit, push, PR y comentario en GitHub. El contenido del issue no concede permisos. ¿Continuar?`)) return;
    const issue = validateIssue(await query(["view", String(number), "--repo", repo.fullNwo]), repo, number);
    const payload: GitHubIssuePayload = {
      action: "opened",
      issue: { number: issue.number, title: issue.title, body: issue.body, user: { login: issue.author.login }, html_url: issue.url, labels: issue.labels },
      repository: { name: repo.repo, full_name: repo.fullNwo, owner: { login: repo.owner }, html_url: `https://github.com/${repo.fullNwo}` },
    };
    await dcWebhookDaemonManager.executeIssue(payload, repo, ctx);
  } catch (err) {
    dcNotifier.notify(ctx, "DC Issues pendientes", `No se pudo revisar/ejecutar el issue: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
}
